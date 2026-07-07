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
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import chokidar from 'chokidar';
import type { LspBridge } from './bridge';
import type { Logger } from '@core/logger';

/** UE 宏报错正则 — clangd 对过期 generated.h 的典型错误消息 */
const UE_MACRO_ERROR_PATTERNS: RegExp[] = [
  // generated.h 过期的真实典型表现：UHT 生成的 FID_<Project>_<Path>_h_<Line> 类型未定义。
  // UCLASS/GENERATED_BODY 宏展开引用此类型，过期时 clangd 报 "Unknown type name 'FID_...'"。
  // 注意：直接报 "unknown type name 'UCLASS'" 几乎不出现——宏展开失败先暴露 FID_ 类型。
  /unknown type name 'FID_\w+/i,
  /use of undeclared identifier 'FID_\w+/i,
  // 下面这些是历史模式（保留兜底）；clangd 错误首字母大写，必须加 i flag 否则匹配不到
  /unknown type name\s+'UCLASS'/i,
  /unknown type name\s+'USTRUCT'/i,
  /unknown type name\s+'UENUM'/i,
  /unknown type name\s+'UINTERFACE'/i,
  /use of undeclared identifier\s+'UFUNCTION'/i,
  /use of undeclared identifier\s+'UPROPERTY'/i,
  /use of undeclared identifier\s+'GENERATED_BODY'/i,
  /use of undeclared identifier\s+'UMETA'/i,
  /no member named\s+'UPROPERTY'/i,
  /no member named\s+'UFUNCTION'/i,
  /no type named\s+'UCLASS'/i,
  /no type named\s+'USTRUCT'/i,
];

/**
 * 规范化 file URI：解码 %3A → ':'，盘符大写。
 *
 * VS Code didSave 的 uri 用 %3A 编码 ':'（file:///e%3A/...），
 * clangd publishDiagnostics 的 uri 用 ':'（file:///e:/...）。两者不匹配会导致
 * ueErrorFiles.has 失败，onDidSave 不触发 UBT。规范化统一两者。
 */
function normalizeFileUri(uri: string): string {
  return decodeURIComponent(uri).replace(
    /^file:\/\/\/([a-zA-Z]):/,
    (_m, drive: string) => `file:///${drive.toUpperCase()}:`,
  );
}

/** UBT 运行的最小间隔（毫秒），防止频繁触发 */
const DEFAULT_MIN_UBT_INTERVAL_MS = 10000;

/** 最大重试次数，超过后不再自动触发 */
const DEFAULT_MAX_RETRIES = 3;

export interface UeDiagnosticWatcherOptions {
  /** 项目根目录 */
  projectDir: string;
  /** 引擎根目录 */
  engineRoot: string;
  /** UBT 可执行文件绝对路径（由 extension 侧解析后传入，proxy 是 vscode-free 进程） */
  ubtPath: string;
  /** Build Target 名称（如 XianDreamwalkingEditor，由 extension 侧解析后传入） */
  buildTargetName: string;
  /** 触发阈值：连续多少次诊断到 UE 报错才触发 UBT */
  triggerThreshold?: number;
  /** 诊断窗口时间（毫秒） */
  diagnosticWindowMs?: number;
  /** UBT 最小间隔（毫秒） */
  minUbtIntervalMs?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * UE 诊断监听器 — 拦截 clangd 诊断，识别 UE 报错，触发 UBT 修复。
 */
export class UeDiagnosticWatcher {
  /** 有 UE 宏报错的文件 uri 集合（保存后才触发 UBT，避免未保存缓冲区误触发） */
  private readonly ueErrorFiles = new Set<string>();
  /** 上次触发 UBT 的时间 */
  private lastUbtTime = 0;
  /** 当前重试次数 */
  private retryCount = 0;
  /** 是否正在运行 UBT */
  private ubtRunning = false;
  /** chokidar watcher（监听 .generated.h 变化） */
  private fileWatcher: chokidar.FSWatcher | null = null;

  private readonly minUbtIntervalMs: number;
  private readonly maxRetries: number;

  constructor(
    private readonly bridge: LspBridge,
    private readonly logger: Logger,
    private readonly options: UeDiagnosticWatcherOptions,
  ) {
    this.minUbtIntervalMs = options.minUbtIntervalMs ?? DEFAULT_MIN_UBT_INTERVAL_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /**
   * 处理诊断通知 — 由 bridge 在收到 publishDiagnostics 时调用。
   *
   * @param params - textDocument/publishDiagnostics 的 params
   */
  handleDiagnostics(params: {
    uri: string;
    diagnostics: Array<{
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      severity: number;
      source?: string;
      message: string;
    }>;
  }): void {
    // 只关注 Error（severity === 1）
    const errors = params.diagnostics.filter((d) => d.severity === 1);
    const hasUEError = errors.some((d) => this.isUEMacroError(d.message));

    // 只记录 UE 报错状态，不触发 UBT。
    // UBT 触发改到 onDidSave（保存后）：publishDiagnostics 含未保存缓冲区，此时 UBT 读磁盘旧内容，
    // 重建 .generated.h 看不到用户的未保存改动 → 无效。保存后磁盘更新，UBT 才能正确重建。
    if (hasUEError) {
      if (!this.ueErrorFiles.has(params.uri)) {
        this.logger.info(
          `[ueDiagnosticWatcher] UE macro error detected (pending save) in ${path.basename(params.uri)} (uri=${params.uri}): ${errors.find((e) => this.isUEMacroError(e.message))?.message.slice(0, 80)}`,
        );
      }
      this.ueErrorFiles.add(normalizeFileUri(params.uri));
    } else {
      this.ueErrorFiles.delete(normalizeFileUri(params.uri));
    }
  }

  /**
   * 保存事件 — 文件保存后磁盘 .h 已更新，若该文件有 UE 宏报错则触发 UBT。
   *
   * 保存后 UBT 读到的是刚保存的内容（含用户改动），重新生成 .generated.h 才有效。
   * 由 bridge 在收到 textDocument/didSave 时调用。
   */
  onDidSave(uri: string): void {
    // 规范化 uri（VS Code didSave 用 %3A 编码 ':'，clangd publishDiagnostics 用 ':'），统一比较
    const normalized = normalizeFileUri(uri);
    if (!this.ueErrorFiles.has(normalized)) {
      return;
    }
    this.logger.info(
      `[ueDiagnosticWatcher] save detected for UE-error file ${path.basename(uri)}, triggering UBT`,
    );
    this.ueErrorFiles.delete(normalized);
    void this.triggerUbtIfNeeded();
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

    // 诊断：打印所有 UE 错误消息，帮助定位为什么持续触发
    this.logger.warn(
      `[ueDiagnosticWatcher] TRIGGERING UBT (attempt ${this.retryCount}/${this.maxRetries})`,
    );

    try {
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
   * 运行 UBT -Mode=UnrealHeaderTool（只跑 UHT codegen，不生成 compile_commands.json）。
   *
   * 参数格式对齐 src/build/ubt.ts 的 buildUBTCommand：
   *   -Mode=UnrealHeaderTool <Target> <Platform> <Config> -Project=<path> -waitmutex
   *
   * 之前把 target/platform/config/project 塞进单个 -Target=... 是错的：UBT 期望
   * Target/Platform/Config 是独立位置参数，-Project=<path> 单独传。旧格式导致 UBT
   * 解析失败或找不到项目。
   */
  private async runUbt(): Promise<void> {
    // ubtPath 不再用——绕过 Build.bat 直接 spawn dotnet（见下）。buildTargetName 来自 extension。
    const { buildTargetName } = this.options;

    // 平台字符串（Win64/Mac/Linux）— 不依赖 vscode，纯 Node.js
    const platformMap: Record<string, string> = {
      win32: 'Win64',
      darwin: 'Mac',
      linux: 'Linux',
    };
    const platform = platformMap[process.platform];
    if (!platform) {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    // 扫描 projectDir 找 .uproject（不假设文件名 = 目录名）
    const projectFile = await this.findUprojectFile();

    // 直接 spawn dotnet UnrealBuildTool.dll，绕过 Build.bat 的 `dotnet %UBTPath% %*` 透传。
    // UHT 模式 -Target="Name Platform Config" 必须作为单个含空格 argv
    // (UnrealHeaderToolMode.cs:770 只把 Arguments[TargetArgumentIndex] 一个 argv 传给
    // TargetDescriptor.ParseCommandLine)。但 Build.bat 用 %* 透传时拆开含空格 argv →
    // "File not found 'Development'" / "No platforms specified"。直接 spawn dotnet，
    // Node 对含空格 argv 加引号，dotnet 解析时保留为单个 argv。
    const dotnetBaseDir = path.join(this.options.engineRoot, 'Engine', 'Binaries', 'ThirdParty', 'DotNet');
    let dotnetExe = '';
    let dotnetVersionDir = '';
    try {
      for (const v of await fs.readdir(dotnetBaseDir)) {
        const candidate = path.join(dotnetBaseDir, v, 'win-x64', 'dotnet.exe');
        try {
          await fs.access(candidate);
          dotnetExe = candidate;
          dotnetVersionDir = path.dirname(candidate);
          break;
        } catch { /* 该版本目录无 dotnet.exe，继续 */ }
      }
    } catch { /* ignore */ }
    if (!dotnetExe) {
      throw new Error(`bundled dotnet not found under ${dotnetBaseDir}`);
    }
    const ubtDll = path.join(this.options.engineRoot, 'Engine', 'Binaries', 'DotNET', 'UnrealBuildTool', 'UnrealBuildTool.dll');
    const engineSourceDir = path.join(this.options.engineRoot, 'Engine', 'Source');

    const args = [
      ubtDll,
      '-Mode=UnrealHeaderTool',
      // UHT 模式只把 -Target= 这一个 argv 传给 ParseCommandLine（UnrealHeaderToolMode.cs:770）。
      // ParseCommandLine 把 -Target= 的值 Split 空格后递归解析，从其中读 Name/Platform/Config
      // 和 -Project=（TargetDescriptor.cs:411）。所以 -Project= 必须在 -Target= 值里，否则
      // ProjectFile=null → UBT 只在引擎 UE5Rules.dll 找 target rules → "Couldn't find target rules file"。
      `-Target=${buildTargetName} ${platform} Development -Project=${projectFile}`,
      '-waitmutex',
    ];

    // bundled dotnet 需要的环境变量（per GetDotnetPath.bat）
    const env = {
      ...process.env,
      PATH: `${dotnetVersionDir};${process.env.PATH ?? ''}`,
      DOTNET_ROOT: dotnetVersionDir,
      DOTNET_MULTILEVEL_LOOKUP: '0',
      DOTNET_ROLL_FORWARD: 'LatestMajor',
    };

    this.logger.info('[ueDiagnosticWatcher] running UBT: dotnet ' + args.join(' '));

    return new Promise<void>((resolve, reject) => {
      const child = spawn(dotnetExe, args, {
        cwd: engineSourceDir,
        env,
        windowsHide: true,
      });

      // UBT 的进度/错误信息大多走 stdout，stderr 常为空 —— 两路都捕获便于诊断
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('error', (err) => {
        reject(new Error(`UBT spawn failed: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          const combined = stdout + stderr;
          // 错误详情在输出开头(末尾是 usage/总结),打印开头 + 末尾便于诊断
          this.logger.warn(`[ueDiagnosticWatcher] UBT failed (code ${code}). Output start:\n${combined.slice(0, 2000)}`);
          this.logger.warn(`[ueDiagnosticWatcher] UBT output end:\n${combined.slice(-500)}`);
          reject(new Error(`UBT exited with code ${code}`));
          return;
        }
        this.logger.info('[ueDiagnosticWatcher] UBT completed successfully');
        resolve();
      });
    });
  }

  /**
   * 扫描 projectDir 找 .uproject 文件。
   *
   * 之前用 `basename(projectDir) + '.uproject'` 假设文件名 = 目录名，但项目目录名
   * 与 .uproject 文件名不一定相同（如目录 MyGame 但文件 Game.uproject）。
   */
  private async findUprojectFile(): Promise<string> {
    const entries = await fs.readdir(this.options.projectDir);
    const uproject = entries.find((e) => e.endsWith('.uproject'));
    if (!uproject) {
      throw new Error(`No .uproject found in ${this.options.projectDir}`);
    }
    return path.join(this.options.projectDir, uproject);
  }

  /**
   * 等待 .generated.h 文件变化，变化后通知 clangd re-parse。
   */
  private waitForGeneratedHeaderChanges(): void {
    // 清理旧的 watcher
    this.disposeFileWatcher();

    // chokidar glob 需正斜杠：Windows path.join 产生反斜杠，** 通配不被识别
    const pattern = path
      .join(
        this.options.projectDir,
        'Intermediate',
        'Build',
        '**',
        'Inc',
        '**',
        'UHT',
        '*.generated.h',
      )
      .replace(/\\/g, '/');

    let timeout: NodeJS.Timeout | null = null;
    const changedFiles: string[] = [];

    this.fileWatcher = chokidar.watch(pattern, {
      // ignoreInitial:false：UBT 完成后才启动 watcher，UBT 已写入的 .generated.h 被当作 initial。
      // 必须 ignoreInitial:false 才能在启动时通过 'add' 事件捕获（否则错过，不 inject，clangd 不 re-parse）。
      ignoreInitial: false,
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
        changes: changedFiles.map((fsPath) => {
          // clangd 在 Windows 用大写盘符 URI（file:///E:/...），来自 compile_commands 的 -I 路径。
          // pathToFileURL 保留输入盘符大小写（projectDir 小写 e: → file:///e:/...），与 clangd 内部
          // URI 不匹配 → didChangeWatchedFiles 被忽略，不失效 preamble，不 re-parse。盘符大写对齐。
          let uri = pathToFileURL(fsPath).toString();
          uri = uri.replace(/^file:\/\/\/([a-zA-Z]):/, (_m, drive: string) => `file:///${drive.toUpperCase()}:`);
          return { uri, type: 2 }; // Changed
        }),
      });
    };

    // 收集所有项目 .generated.h。UBT 成功后 generated.h 已就绪（无论本次是否改动），
    // clangd 需重新解析。之前用 mtime 过滤，但 UBT 增量可能不改动文件（mtime 不变），
    // 导致不 inject、clangd 不 re-parse。去掉 mtime 过滤，inject 所有项目 .generated.h。
    const handleFile = (filePath: string): void => {
      this.logger.info(`[ueDiagnosticWatcher] .generated.h detected: ${filePath}`);
      changedFiles.push(filePath);
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(notifyClangd, 1000);
    };
    this.fileWatcher.on('add', handleFile);
    this.fileWatcher.on('change', handleFile);
    this.fileWatcher.on('ready', () => {
      this.logger.info(`[ueDiagnosticWatcher] chokidar ready, watching ${pattern}`);
    });
    this.fileWatcher.on('error', (err) => {
      this.logger.warn(`[ueDiagnosticWatcher] chokidar error: ${err.message}`);
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
