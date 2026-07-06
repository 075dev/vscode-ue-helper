/**
 * headerWatcher —— UE 反射头文件保存自动同步 watcher
 *
 * ## Phase 8 入口模块 —— 见 08-CONTEXT.md D-01..D-15
 *
 * D-01 onDidSaveTextDocument 监听保存事件
 * D-02 严格触发条件：.h + 反射宏（UCLASS/USTRUCT/UENUM/UINTERFACE/UFUNCTION/UPROPERTY/GENERATED_BODY/UMETA）
 * D-03 文件必须在 workspace.projectFolder（projectDir）之内
 * D-04 1500ms debounce，连续保存合并为单次 UBT
 * D-05/D-06 config gate，默认开启
 * D-07 复用现有 generateCompileCommands 管线（Phase 7 指纹缓存）
 * D-08 setStatusBarMessage 三段反馈
 * D-09/D-10 失败静默 → Output channel + logger.warn
 * D-11 不重试
 * D-12/D-13 cancelHeaderWatcherTrigger 手动命令取消 pending debounce
 * D-14 在 activateClangd 之后注册（extension.ts 注入）
 * D-15 detection.ready gate（projectFolder/engineRoot non-null 才激活）
 *
 * ## 设计要点
 *
 * - D-08 用 vscode.window.setStatusBarMessage（超时消失）而非持久 StatusBarItem ——
 *   状态栏上 8 个按钮已满，再放一个常驻 button 会让布局拥挤。
 * - D-12 用 module-level 变量保留 timer handle，
 *   使 cancelHeaderWatcherTrigger() 可以不持有实例也能清除 pending debounce。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { generateCompileCommands } from './compileCommands';
import type { GenerateOptions } from './compileCommands';
import { CompileCommandsCache } from './compileCommandsCache';
import type { Config } from '@core/config';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import { t } from '@i18n';

/* ------------------------------------------------------------------ */
/*  常量                                                                */
/* ------------------------------------------------------------------ */

/** D-04: debounce 时长（毫秒） */
const DEBOUNCE_MS = 1500;
/** D-02: UE 反射宏正则 —— 匹配头文件内容中的反射宏 */
const UE_MACRO_RE = /\b(?:UCLASS|USTRUCT|UENUM|UINTERFACE|UFUNCTION|UPROPERTY|GENERATED_BODY|UMETA)\b/;
/** D-02: 重入保护 —— 防止 UHT 写 .generated.h 时二次触发 */
const GENERATED_HEADER_SUFFIX = '.generated.h';
/** D-02: 仅监听 .h 后缀（不含 .hpp / .inl / .cpp） */
const HEADER_SUFFIX = '.h';
/** D-10: Output channel 日志前缀 */
const LOG_PREFIX = '[headerWatcher]';

/** D-08: 三段状态栏消息时长（毫秒） */
const STATUS_INPROGRESS_MS = 4000;
const STATUS_SUCCESS_MS = 3000;
const STATUS_FAILURE_MS = 5000;

/* ------------------------------------------------------------------ */
/*  模块级状态 —— D-12/D-13 跨 handle 共享                              */
/* ------------------------------------------------------------------ */

/** 当前活跃的 watcher 实例（手动命令取消时引用） */
let activeWatcher: HeaderWatcher | null = null;
/** 双写 timer handle —— moduleTimerHandle 让不持有实例的 cancelHeaderWatcherTrigger 也能清除 */
let moduleTimerHandle: NodeJS.Timeout | null = null;

/* ------------------------------------------------------------------ */
/*  HeaderWatcher 类                                                    */
/* ------------------------------------------------------------------ */

/**
 * 单个 project+engine 的 UE 反射头保存监听器
 *
 * 生命周期绑定到 context.subscriptions，不需要 dispose 时自动清理。
 */
class HeaderWatcher {
  /** 当前 debounce timer */
  private debounceTimer: NodeJS.Timeout | null = null;
  /** 所有 VS Code 订阅（onDidSaveTextDocument 等） */
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly workspace: WorkspaceState,
    /** Logger —— 留给外部 cancelHeaderWatcherTrigger 使用 (D-12/D-13) */
    public readonly logger: Logger,
    private readonly config: Config,
  ) {}

  /**
   * 启动 watcher —— 订阅 onDidSaveTextDocument（D-01）
   *
   * 返回的 Disposable 已推入 context.subscriptions，无需调用方手动管理。
   */
  start(): vscode.Disposable {
    const subscription = vscode.workspace.onDidSaveTextDocument((doc) => {
      void this.handleSave(doc.uri.fsPath);
    });
    this.disposables.push(subscription);
    this.logger.info(`${LOG_PREFIX} started`);

    // 返回封装 disposable —— dispose 时清理内部状态
    return new vscode.Disposable(() => this.dispose());
  }

  /**
   * D-02/D-03/D-05 过滤链：对每次保存事件做完整的项目/扩展/反射宏检测
   *
   * 返回 true 表示 scheduleTrigger 已被调用（异步调度中），
   * false 表示本次保存被过滤（原因见代码注释）。
   */
  private async handleSave(fsPath: string): Promise<void> {
    // D-05: setting disabled → early-out
    if (!this.config.clangdHeaderWatcherEnabled) {
      return;
    }

    // D-02: 仅 .h + 非 .generated.h（重入保护）
    if (!fsPath.endsWith(HEADER_SUFFIX) || fsPath.endsWith(GENERATED_HEADER_SUFFIX)) {
      return;
    }

    // D-15: projectFolder 未 ready → skip（detection 未完成）
    const projectDir = this.workspace.projectDir;
    if (!projectDir) {
      this.logger.info(`${LOG_PREFIX} skipped (no projectDir) — detection not ready`);
      return;
    }

    // D-03: 必须在 projectDir 目录内 —— 拒绝 '..' 前缀或绝对路径（防御路径穿越 T-08-02）
    const rel = path.relative(projectDir, fsPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return;
    }

    // D-02: 读取文件内容 + 反射宏正则检测
    let content: string;
    try {
      content = await fs.readFile(fsPath, 'utf8');
    } catch (err) {
      this.logger.warn(
        `${LOG_PREFIX} read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (!UE_MACRO_RE.test(content)) {
      return;
    }

    // 通过全部过滤 → 调度触发
    this.scheduleTrigger(fsPath);
  }

  /**
   * D-04: 防抖调度 —— 清除前一个 timer，1500ms 后触发 UBT
   *
   * 双写模式：同时更新 this.debounceTimer 与 module-level moduleTimerHandle，
   * 使 bare function cancelHeaderWatcherTrigger()（不持有实例引用）也能取消。
   */
  private scheduleTrigger(fsPath: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      moduleTimerHandle = null;
      void this.runUbtRegen(fsPath);
    }, DEBOUNCE_MS);
    // D-12/D-13: 双写 —— module cancel 也能命中
    moduleTimerHandle = this.debounceTimer;
    this.logger.info(`${LOG_PREFIX} scheduled UBT regen for ${fsPath}`);
  }

  /**
   * D-07/D-08/D-09/D-10: 跑 UBT GenerateClangDatabase + 状态栏反馈
   *
   * 失败走 logger.warn（D-10 Output channel），不弹窗（D-09），不重试（D-11）。
   */
  private async runUbtRegen(fsPath: string): Promise<void> {
    const project = this.workspace.project;
    const engine = this.workspace.engine;
    if (!project || !engine) {
      this.logger.info(`${LOG_PREFIX} skipped (project/engine not ready) — ${fsPath}`);
      return;
    }

    // D-08: 开始 —— $(sync~spin) 旋转进度
    vscode.window.setStatusBarMessage(t('headerWatcher.regenerating'), STATUS_INPROGRESS_MS);

    try {
      // [BUGFIX] Phase 7 compileCommandsCache 的 fingerprint 仅含 .uproject/Build.cs/Target.cs，
      // 不含 .h 文件变更 → HeaderWatcher 触发时总是 cache HIT 并跳过 UBT → .generated.h 不刷新。
      // 所以在触发前主动 invalidate，强制走完整 UBT/UHT 路径以重新生成 .generated.h。
      const fixCache = new CompileCommandsCache({ logger: this.logger });
      const projectDir = this.workspace.projectDir;
      if (projectDir) {
        await fixCache.invalidate(projectDir);
      }

      // D-07: 复用管线
      await generateCompileCommands({
        project: project.path,
        engineRoot: engine.path,
        logger: this.logger,
        workspace: this.workspace,
      } as GenerateOptions);

      // D-08: 成功
      vscode.window.setStatusBarMessage(t('headerWatcher.synced'), STATUS_SUCCESS_MS);
      this.logger.info(`${LOG_PREFIX} UBT regen success — ${fsPath}`);
    } catch (err) {
      // D-09/D-10: 失败 → logger.warn（Output channel 可见），不弹窗，不重试
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`${LOG_PREFIX} UBT failed: ${msg}`);
      vscode.window.setStatusBarMessage(t('headerWatcher.failed'), STATUS_FAILURE_MS);
    }
  }

  /**
   * D-12/D-13: 取消 pending debounce（实例级）
   */
  cancelPendingTrigger(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      this.logger.info(`${LOG_PREFIX} pending trigger cancelled`);
    }
  }

  /**
   * 清理：取消 timer + 销毁所有订阅（多次调用安全）
   */
  dispose(): void {
    this.cancelPendingTrigger();
    for (const d of this.disposables) {
      try { d.dispose(); } catch { /* ignore */ }
    }
    this.disposables = [];
  }
}

/* ------------------------------------------------------------------ */
/*  模块导出                                                            */
/* ------------------------------------------------------------------ */

/**
 * Phase 8 入口：创建并启动一个 HeaderWatcher，推入 context.subscriptions
 *
 * disposable 封装了 watcher.dispose() —— 扩展停用时自动清理。
 */
export function startHeaderWatcher(
  context: vscode.ExtensionContext,
  config: Config,
  logger: Logger,
  workspace: WorkspaceState,
): vscode.Disposable {
  const watcher = new HeaderWatcher(workspace, logger, config);
  activeWatcher = watcher;

  const handle = watcher.start();
  context.subscriptions.push(handle);

  return handle;
}

/**
 * D-12/D-13: 取消 pending debounce 的 bare 函数形式
 *
 * 由手动命令 executeGenerateCompileCommands 在入口调用 —— 避免自动触发 + 手动触发双跑 UBT。
 * 不持有 watcher 实例，依赖 module-level moduleTimerHandle 清除 timer。
 */
export function cancelHeaderWatcherTrigger(): void {
  if (moduleTimerHandle) {
    clearTimeout(moduleTimerHandle);
    moduleTimerHandle = null;
    activeWatcher?.logger.info(`${LOG_PREFIX} pending trigger cancelled by manual command`);
  }
}
