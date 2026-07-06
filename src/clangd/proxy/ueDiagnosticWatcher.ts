/**
 * ueDiagnosticWatcher —— 拦截 clangd 诊断，识别 UE 宏报错，触发 UBT 修复。
 *
 * ## 核心思路
 *
 * 问题本质：不是"文件改了需要更新 generated.h"，而是"generated.h 过期导致 clangd 报错"。
 *
 * 所以正确的触发链是**被动响应**而非主动预测：
 *
 *   clangd 报告 UE 宏报错（UCLASS/USTRUCT/UFUNCTION 等 undefined）
 *     → proxy 拦截诊断，识别这是 generated.h 过期导致的
 *     → proxy 触发 UBT 重新生成 .generated.h
 *     → UBT 完成 → proxy 通知 clangd re-parse
 *     → 报错消失
 *
 * ## 为什么不在 extension 侧做
 *
 *   - extension 无法直接观察 clangd 的诊断输出（被 proxy 隔开）
 *   - proxy 是唯一能看到 clangd 诊断的地方
 *   - proxy 已经有到 clangd 的 stdin 通道，可以直接注入 re-parse 通知
 *
 * ## 错误模式匹配
 *
 * clangd 对过期 .generated.h 的典型报错：
 *   - "unknown type name 'UCLASS'"
 *   - "unknown type name 'USTRUCT'"
 *   - "use of undeclared identifier 'UPROPERTY'"
 *   - "use of undeclared identifier 'UFUNCTION'"
 *   - "use of undeclared identifier 'GENERATED_BODY'"
 *   - "no member named 'UPROPERTY' in ..."
 *
 * 匹配逻辑：诊断 message 包含 UE 宏名 + 出现在 .h 文件中。
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import chokidar from 'chokidar';
import type { LspBridge } from './bridge';
import type { Logger } from '@core/logger';
import { getUbtPath } from './../ueHelpers';
import { getBuildTargetNames, getUnrealPlatform } from './../ueHelpers';

/** UE 宏报错正则 — clangd 对过期 generated.h 的典型错误消息 */
const UE_MACRO_ERROR_PATTERNS: RegExp[] = [
  /unknown type name\s+'UCLASS'/,
  /unknown type name\s+'USTRUCT'/,
  /unknown type name\s+'UENUM'/,
  /unknown type name\s+'UINTERFACE'/,
  /use of undeclared identifier\s+'UFUNCTION'/,
  /use of undeclared identifier\s+'UPROPERTY'/,
  /use of undeclared identifier\s+'GENERATED_BODY'/,
  /use of undeclared identifier\s+'UMETA'/,
  /no member named\s+'UPROPERTY'/,
  /no member named\s+'UFUNCTION'/,
  /no type named\s+'UCLASS'/,
  /no type named\s+'USTRUCT'/,
];

/** 需要至少连续 N 次诊断到同样的 UE 报错才触发 UBT（避免一次性错误误触发） */
const DEFAULT_TRIGGER_THRESHOLD = 2;

/** 两次诊断之间的最大间隔（毫秒），超过则计数重置 */
const DEFAULT_DIAGNOSTIC_WINDOW_MS = 5000;

/** UBT 运行的最小间隔（毫秒），防止频繁触发 */
const DEFAULT_MIN_UBT_INTERVAL_MS = 10000;

/** 最大重试次数，超过后不再自动触发 */
const DEFAULT_MAX_RETRIES = 3;

export interface UeDiagnosticWatcherOptions {
  /** 项目根目录 */
  projectDir: string;
  /** 引擎根目录 */
  engineRoot: string;
  /** 触发阈值：连续多少次诊断到 UE 报错才触发 UBT */
  triggerThreshold?: number;
  /** 诊断窗口时间（毫秒） */
  diagnosticWindowMs?: number;
  /** UBT 最小间隔（毫秒） */
  minUbtIntervalMs?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 自定义 UBT 路径（可选，不提供则自动查找） */
  ubtPath?: string;
}

/**
 * UE 诊断监听器 — 拦截 clangd 诊断，识别 UE 报错，触发 UBT 修复。
 */
export class UeDiagnosticWatcher {
  /** 连续诊断到 UE 报错的次数 */
  private consecutiveErrorCount = 0;
  /** 上次诊断到 UE 报错的时间 */
  private lastErrorTime = 0;
  /** 上次触发 UBT 的时间 */
  private lastUbtTime = 0;
  /** 当前重试次数 */
  private retryCount = 0;
  /** 是否正在运行 UBT */
  private ubtRunning = false;
  /** chokidar watcher（监听 .generated.h 变化） */
  private fileWatcher: chokidar.FSWatcher | null = null;

  private readonly triggerThreshold: number;
  private readonly diagnosticWindowMs: number;
  private readonly minUbtIntervalMs: number;
  private readonly maxRetries: number;

  constructor(
    private readonly bridge: LspBridge,
    private readonly logger: Logger,
    private readonly options: UeDiagnosticWatcherOptions,
  ) {
    this.triggerThreshold = options.triggerThreshold ?? DEFAULT_TRIGGER_THRESHOLD;
    this.diagnosticWindowMs = options.diagnosticWindowMs ?? DEFAULT_DIAGNOSTIC_WINDOW_MS;
    this.minUbtIntervalMs = options.minUbtIntervalMs ?? DEFAULT_MIN_UBT_INTERVAL_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /**
   * 处理诊断通知 — 由 bridge 在收到 publishDiagnostics 时调用。
   *
   * @param params - textDocument/publishDiagnostics 的 params
   */
  async handleDiagnostics(params: {
    uri: string;
    diagnostics: Array<{
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      severity: number;
      source?: string;
      message: string;
    }>;
  }): Promise<void> {
    // 只关注 Error（severity === 1）
    const errors = params.diagnostics.filter((d) => d.severity === 1);

    // 检查是否有 UE 宏报错
    const hasUEError = errors.some((d) => this.isUEMacroError(d.message));

    if (!hasUEError) {
      // 没有 UE 报错 → 重置计数（问题已解决或无关错误）
      if (this.consecutiveErrorCount > 0) {
        this.logger.info('[ueDiagnosticWatcher] UE errors cleared, reset counter');
        this.consecutiveErrorCount = 0;
        this.retryCount = 0;
      }
      return;
    }

    const now = Date.now();

    // 检查是否在诊断窗口内
    if (this.lastErrorTime > 0 && now - this.lastErrorTime > this.diagnosticWindowMs) {
      // 超过窗口 → 重置计数
      this.consecutiveErrorCount = 0;
      this.retryCount = 0;
    }

    this.consecutiveErrorCount++;
    this.lastErrorTime = now;

    this.logger.info(
      `[ueDiagnosticWatcher] UE macro error detected (${this.consecutiveErrorCount}/${this.triggerThreshold}) in ${path.basename(params.uri)}: ${errors.find((e) => this.isUEMacroError(e.message))?.message.slice(0, 80)}`,
    );

    // 达到阈值 → 触发 UBT
    if (this.consecutiveErrorCount >= this.triggerThreshold) {
      await this.triggerUbtIfNeeded();
    }
  }

  /**
   * 判断诊断消息是否是 UE 宏报错。
   */
  private isUEMacroError(message: string): boolean {
    return UE_MACRO_ERROR_PATTERNS.some((re) => re.test(message));
  }

  /**
   * 触发 UBT（如果满足条件）。
   */
  private async triggerUbtIfNeeded(): Promise<void> {
    if (this.ubtRunning) {
      this.logger.info('[ueDiagnosticWatcher] UBT already running, skipping');
      return;
    }

    if (this.retryCount >= this.maxRetries) {
      this.logger.warn(`[ueDiagnosticWatcher] max retries (${this.maxRetries}) reached, giving up`);
      return;
    }

    const now = Date.now();
    if (this.lastUbtTime > 0 && now - this.lastUbtTime < this.minUbtIntervalMs) {
      this.logger.info('[ueDiagnosticWatcher] UBT triggered too frequently, skipping');
      return;
    }

    this.ubtRunning = true;
    this.lastUbtTime = now;
    this.retryCount++;

    try {
      this.logger.info(
        `[ueDiagnosticWatcher] triggering UBT (attempt ${this.retryCount}/${this.maxRetries})`,
      );
      await this.runUbt();

      // UBT 完成后，启动文件监听等待 .generated.h 变化
      this.waitForGeneratedHeaderChanges();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[ueDiagnosticWatcher] UBT failed: ${msg}`);
    } finally {
      this.ubtRunning = false;
    }
  }

  /**
   * 运行 UBT -Mode=UnrealHeaderTool。
   */
  private async runUbt(): Promise<void> {
    const ubtPath = this.options.ubtPath ?? (await getUbtPath({ fsPath: this.options.engineRoot } as never));
    if (!ubtPath) {
      throw new Error(`UBT not found under ${this.options.engineRoot}`);
    }

    const targetNames = await getBuildTargetNames(this.options.projectDir);
    if (targetNames.length === 0) {
      throw new Error(`No .Target.cs found in ${this.options.projectDir}/Source`);
    }

    const buildTargetName = targetNames[0]!;
    const platform = getUnrealPlatform(process.platform);
    if (!platform) {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    const projectFile = path.join(this.options.projectDir, `${path.basename(this.options.projectDir)}.uproject`);

    const ubtRelPath = `.${path.sep}${path.relative(this.options.engineRoot, ubtPath)}`;
    const args = [
      '-Mode=UnrealHeaderTool',
      `-Target=${buildTargetName} ${platform} Development ${projectFile}`,
    ];

    this.logger.info('[ueDiagnosticWatcher] running UBT: ' + ubtRelPath + ' ' + args.join(' '));

    return new Promise<void>((resolve, reject) => {
      const child = spawn(ubtRelPath, args, {
        cwd: this.options.engineRoot,
        windowsHide: true,
      });

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('error', (err) => {
        reject(new Error(`UBT spawn failed: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`UBT exited with code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        this.logger.info('[ueDiagnosticWatcher] UBT completed successfully');
        resolve();
      });
    });
  }

  /**
   * 等待 .generated.h 文件变化，变化后通知 clangd re-parse。
   */
  private waitForGeneratedHeaderChanges(): void {
    // 清理旧的 watcher
    this.disposeFileWatcher();

    const pattern = path.join(
      this.options.projectDir,
      'Intermediate',
      'Build',
      '**',
      'Inc',
      '**',
      'UHT',
      '*.generated.h',
    );

    let timeout: NodeJS.Timeout | null = null;
    const changedFiles: string[] = [];

    this.fileWatcher = chokidar.watch(pattern, {
      ignoreInitial: true,
      persistent: false,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 50,
      },
    });

    const notifyClangd = (): void => {
      if (changedFiles.length === 0) {
        return;
      }

      this.logger.info(
        `[ueDiagnosticWatcher] notifying clangd about ${changedFiles.length} changed .generated.h file(s)`,
      );

      // 注入 workspace/didChangeWatchedFiles 通知给 clangd
      this.bridge.injectClientNotification('workspace/didChangeWatchedFiles', {
        changes: changedFiles.map((fsPath) => ({
          uri: `file://${fsPath}`,
          type: 2, // Changed
        })),
      });

      // 重置计数
      this.consecutiveErrorCount = 0;
    };

    this.fileWatcher.on('change', (filePath) => {
      this.logger.info(`[ueDiagnosticWatcher] .generated.h changed: ${filePath}`);
      changedFiles.push(filePath);

      // 防抖：最后一个文件变化后 1 秒再通知 clangd
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(notifyClangd, 1000);
    });

    // 30 秒后超时清理
    setTimeout(() => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      notifyClangd(); // 即使没有变化也尝试通知（UBT 可能没改文件但可能修复了状态）
      this.disposeFileWatcher();
    }, 30000);
  }

  private disposeFileWatcher(): void {
    if (this.fileWatcher) {
      void this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  /**
   * 销毁监听器。
   */
  dispose(): void {
    this.disposeFileWatcher();
  }
}
