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
import { getBuildTargetNames, getUbtPath, getUnrealPlatform } from './ueHelpers';
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
/**
 * UBT UHT 执行器的类型（参数对齐 ubtShellTask 的签名）。
 */
type UhtExecutor = (cmd: string, args: readonly string[], cwd: string, log: Logger) => Promise<number>;

/**
 * UBT 完成后的 clangd 通知器类型。
 * 参数：projectDir, ubtStartTimeMs → 异步通知 clangd 重新索引变更的 .generated.h。
 */
type ClangdNotifier = (projectDir: string, ubtStartTimeMs: number, logger: Logger) => Promise<void>;

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
    /** 测试注入：UBT UHT 执行器。生产环境默认跑真实 UBT 任务。 */
    private readonly uhtExecutor: UhtExecutor = ubtShellTask,
    /** 测试注入：clangd 通知器。生产环境默认走真实文件扫描 + VS Code FS 通知。 */
    private readonly clangdNotifier: ClangdNotifier = notifyClangdOfGeneratedHeaderChangesImpl,
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

    // 记录 UBT 开始时间，用于后续判断哪些 .generated.h 被本次 UBT 修改
    const ubtStartTime = Date.now();

    try {
      // [Phase 8] 仅跑 UHT 重新生成 .generated.h，不碰 compile_commands.json。
      // 调用 UBT 的 UnrealHeaderTool 独立 mode（不生成 compile_commands.json）。
      await runHeaderToolOnlyWithExecutor(this.workspace, this.logger, this.uhtExecutor);

      // [Phase 8] UBT 完成后，主动通知 clangd 重新索引变更的 .generated.h。
      // 原因：clangd 文件监视有延迟，主动推 watchers 让 clangd 立即重索引。
      const projectDir = this.workspace.projectDir;
      if (projectDir) {
        await this.clangdNotifier(projectDir, ubtStartTime, this.logger);
      }

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
 *
 * @param uhtExecutor 可选的 UBT UHT 执行器注入 — 生产环境不传（默认走真实 UBT 任务），
 *                    单测传入 fake executor 避免真正派发 VS Code Task。
 */
export function startHeaderWatcher(
  context: vscode.ExtensionContext,
  config: Config,
  logger: Logger,
  workspace: WorkspaceState,
  uhtExecutor?: UhtExecutor,
  clangdNotifier?: ClangdNotifier,
): vscode.Disposable {
  const watcher = new HeaderWatcher(workspace, logger, config, uhtExecutor, clangdNotifier);
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

/**
 * Phase 8: 单独调用 UBT 的 `-Mode=UnrealHeaderTool` 只跑 UHT codegen。
 *
 * 为什么不用 generateCompileCommands：
 *   UBT 的 `-Mode=GenerateClangDatabase` 在进程内部先跑 UHT 再自动生成 compile_commands.json，
 *   无法拆开。而 HeaderWatcher 只需要 .generated.h 重新生成 —— clangd 文件监视会自动感知
 *   .generated.h 变化并重索引，不需要 compile_commands.json 也不需要重启 clangd。
 *
 * 实现：复用 compileCommands.ts 的 executeShellTask 走 VS Code Task API
 *   （对齐 generateCompileCommands 的 UBT 调用方式，含 quoting/cleanup/进度）。
 *
 * UBT UnrealHeaderTool mode 实测（UE 5.8）：
 *   - 接受 -Target="<TargetName> <Platform> <Config> -Project=<uproject>" 参数
 *   - 4 秒内完成整个工程的 UHT 检查（incremental，未变更模块跳过）
 *   - 不生成 compile_commands.json，不触碰 Phase 7 缓存
 */
/**
 * UBT UHT-only 运行器：注入 ubtExecutor 方便单测 mock（避免 vi.mock 拦截内部 ES module 导出调用的限制）。
 *
 * 生产环境调用方传入 ubtShellTask（真实 VS Code Task API）；单测传入 fake executor。
 */
export async function runHeaderToolOnlyWithExecutor(
  workspace: WorkspaceState,
  logger: Logger,
  ubtExecutor: (cmd: string, args: readonly string[], cwd: string, log: Logger) => Promise<number>,
  logPrefix: string = LOG_PREFIX,
): Promise<void> {
  const project = workspace.project;
  const engine = workspace.engine;
  if (!project || !engine) {
    throw new Error(`${logPrefix} cannot run UHT: project/engine not ready`);
  }

  const engineUri = vscode.Uri.file(engine.path);
  const ubtAbsPath = await getUbtPath(engineUri);
  if (!ubtAbsPath) {
    throw new Error(`[headerWatcher] UBT not found under ${engine.path}`);
  }

  const projectDir = workspace.projectDir;
  if (!projectDir) {
    throw new Error('[headerWatcher] projectDir not set');
  }

  const targetNames = await getBuildTargetNames(projectDir);
  if (targetNames.length === 0) {
    throw new Error(`[headerWatcher] no .Target.cs found in ${projectDir}/Source`);
  }

  const buildTargetName = targetNames[0]!;
  const platform = getUnrealPlatform(process.platform);
  if (!platform) {
    throw new Error(`[headerWatcher] unsupported platform: ${process.platform}`);
  }

  // 将 UBT 绝对路径转为引擎相对路径（对齐 compileCommands.ts 的 ubtRelPath 策略）
  const ubtRelPath = `.${path.sep}${path.relative(engine.path, ubtAbsPath)}`;

  // UBT UnrealHeaderTool mode 参数（对齐 UBT -Mode=UnrealHeaderTool -Help 输出）
  const ubtArgs = [
    '-Mode=UnrealHeaderTool',
    `-Target=${buildTargetName} ${platform} Development -Project=${project.path}`,
  ];

  logger.info(`${logPrefix} starting UHT-only: ${ubtRelPath} ${ubtArgs.join(' ')}`);

  // 复用 compileCommands.ts 已有的 UBT 任务包装（VS Code Task API + quoting + cleanup）
  const exitCode = await ubtExecutor(ubtRelPath, ubtArgs, engine.path, logger);
  if (exitCode !== 0) {
    throw new Error(`${logPrefix} UHT task exited with code ${exitCode}`);
  }

  logger.info(`${logPrefix} UHT-only completed successfully`);
}

/**
 * 极简 VS Code Task API 包装，复用 compileCommands.ts 同一模式跑 UBT。
 * 与那里不同的：这里是模块私有函数，并且使用 headerWatcher-specific 任务名。
 */
function ubtShellTask(
  cmd: string,
  args: ReadonlyArray<string>,
  cwd: string,
  log: Logger,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const unrealFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cwd));
    const scope = unrealFolder ?? vscode.workspace.workspaceFolders?.[0];
    if (!scope) {
      reject(new Error('[headerWatcher] No workspace folder open.'));
      return;
    }

    const task: vscode.Task = new vscode.Task(
      { type: 'shell' },
      scope,
      'vscodeUEHelper: HeaderWatcher UHT',
      'headerWatcher',
      new vscode.ShellExecution(cmd, [...args], {
        cwd,
        executable: process.platform === 'win32' ? 'PowerShell.exe' : undefined,
      }),
    );
    task.group = vscode.TaskGroup.Build;
    task.problemMatchers = ['$msCompile'];

    vscode.tasks.executeTask(task).then(
      (execution) => {
        const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
          if (e.execution === execution) {
            disposable.dispose();
            log.info(`${LOG_PREFIX} UHT task exited with code ${e.exitCode}`);
            resolve(e.exitCode ?? 0);
          }
        });
      },
      (err) => reject(err),
    );
  });
}

/**
 * Phase 8: UBT 完成后，主动通知 clangd 哪些 .generated.h 被改了。
 *
 * 问题：clangd 文件监视有延迟 —— UBT T+4s 写完 .generated.h 后，
 * clangd 可能还要几百毫秒才触发 re-index，让用户感知报错闪烁。
 *
 * 解法：扫描 Intermediate/Build 下 mtime >= ubtStartTime 的 .generated.h，
 * 对每个变更文件通过 writeFile 触发 VS Code 文件监视，
 * VS Code 会自动把变更转发给 clangd 立即重索引。
 */
export async function notifyClangdOfGeneratedHeaderChangesImpl(
  projectDir: string,
  ubtStartTime: number,
  logger: Logger,
): Promise<void> {
  const generatedHeaders = await findRecentlyModifiedGeneratedHeaders(projectDir, ubtStartTime);

  if (generatedHeaders.length === 0) {
    logger.info(`${LOG_PREFIX} no .generated.h modified since UBT start`);
    return;
  }

  logger.info(
    `${LOG_PREFIX} notifying clangd about ${generatedHeaders.length} changed .generated.h file(s)`,
  );

  // 用 VS Code 的 FileSystemEmitter 触发变更事件 —— VS Code 会把事件转发给 clangd
  const emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  // 注册一个临时 watcher 让 VS Code 转发事件（通过 onDidChange）
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(projectDir, 'Intermediate/Build/**/Inc/**/UHT/*.generated.h'),
  );
  watcher.onDidChange((uri) => {
    // VS Code 会自动把事件转发给 clangd，这里只记录日志
    logger.info(`[headerWatcher] file change event forwarded: ${uri.fsPath}`);
  });

  // 对每个变更文件：读取内容后写回（更新时间戳触发 watcher）
  for (const fsPath of generatedHeaders) {
    try {
      const uri = vscode.Uri.file(fsPath);
      const content = await fs.readFile(fsPath);
      // 写回相同内容 —— 强制更新 mtime 触发 watcher
      await vscode.workspace.fs.writeFile(uri, content);
    } catch (err) {
      logger.warn(
        `[headerWatcher] failed to touch ${fsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 清理临时 watcher
  watcher.dispose();
  emitter.dispose();
}

/**
 * 扫描工程 Intermediate/Build 下所有 .generated.h，返回 mtime >= sinceTimeMs 的文件路径。
 */
async function findRecentlyModifiedGeneratedHeaders(
  projectDir: string,
  sinceTimeMs: number,
): Promise<string[]> {
  const result: string[] = [];
  const baseDir = path.join(projectDir, 'Intermediate', 'Build');

  // 平台目录（Win64/Mac/Linux 等）
  let platformDirs: string[];
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    platformDirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(baseDir, e.name));
  } catch {
    return result;
  }

  for (const platformDir of platformDirs) {
    await scanDirForGeneratedHeaders(platformDir, sinceTimeMs, result);
  }

  return result;
}

/**
 * 递归扫描目录下的 *.generated.h 文件，mtime >= sinceTimeMs 的加入 result。
 */
async function scanDirForGeneratedHeaders(
  dir: string,
  sinceTimeMs: number,
  result: string[],
): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as unknown as Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanDirForGeneratedHeaders(fullPath, sinceTimeMs, result);
    } else if (entry.isFile() && entry.name.endsWith('.generated.h')) {
      try {
        const stat = await fs.stat(fullPath);
        if (stat.mtimeMs >= sinceTimeMs) {
          result.push(fullPath);
        }
      } catch {
        // ignore
      }
    }
  }
}
