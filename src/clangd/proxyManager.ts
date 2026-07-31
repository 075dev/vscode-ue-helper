/**
 * proxyManager.ts —— Clangd LSP Proxy 扩展端管理器
 *
 * 职责：
 * - 计算 launcher 脚本路径（基于 context.extensionPath）
 * - 读取 Config 中 proxy 相关配置
 * - 创建 ClangdSettingsManager 实例用于备份/写入/恢复 clangd 设置
 * - 暴露 enable/disable 辅助方法
 * - 提供状态查询（enabled / isActive / hasBackup / logPath）
 *
 * 设计原则：
 * - 不在激活期间 spawn 子进程——clangd 扩展通过 clangd.path 启动 proxy
 * - 不修改 clangd 设置，除非显式调用 enable()
 * - 所有写入操作委托给 ClangdSettingsManager
 * - 注册 disposable 用于清理
 *
 * [deactivate 清理] 实现 `vscode.Disposable`：
 * dispose() 在 extension 卸载时由 context.subscriptions 触发，
 * 若 proxy 当前处于激活状态（clangd.path 仍指向本扩展的 launcher），
 * 自动调用 `disable()` 恢复原始 clangd 设置，避免扩展卸载后留下
 * "clangd 仍指向我们的 launcher 但 launcher 已不存在"的死链。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Config } from '@core/config';
import { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import { resolveRealClangdPath } from './proxy/realClangdResolver';
import { ClangdSettingsManager } from './proxy/settingsManager';
import { buildStatus, type ClangdProxyStatus } from './proxy/status';
import { resolveUBTPath } from '@build/ubt';
import { ProxyLogTailer } from './proxyLogTailer';
import { getProxyLogChannel } from './proxyLogChannel';

export interface ClangdProxyManagerDependencies {
  readonly fileExists?: (candidate: string) => boolean;
  /**
   * [Phase 8] WorkspaceState 引用 —— enable/buildProxyArgs 时动态读 projectDir/engineRoot。
   *
   * 之前用 projectDir/engineRoot 字符串快照，但 activateClangd 同步执行时 detection 尚未
   * ready，WorkspaceState getter 返回 null 并触发 _notifyMissing（永久污染 _notifiedFields），
   * 导致后续即使 ready 也拿不到值。改成持 workspace 引用，enable 时（用户手动操作，通常
   * ready 后）动态读，避免构造时污染。
   */
  readonly workspace?: WorkspaceState;
  /** @deprecated 用 workspace.projectDir 动态读；保留向后兼容（测试/旧调用方） */
  readonly projectDir?: string;
  /** @deprecated 用 workspace.engineRoot 动态读；保留向后兼容（测试/旧调用方） */
  readonly engineRoot?: string;
}

export class ClangdProxyManager implements vscode.Disposable {
  /** 设置管理器（备份/写入/恢复 clangd 设置） */
  public readonly settingsManager: ClangdSettingsManager;

  /** launcher 脚本的完整路径 */
  public readonly launcherPath: string;

  /** 默认 proxy 日志路径（context.logUri 下，按会话隔离） */
  private readonly defaultLogPath: string;

  /** 当前运行的日志 tailer（proxy 激活时存在） */
  private tailer: ProxyLogTailer | null = null;

  /** proxy 日志 channel 是否已注册到 subscriptions（只注册一次，channel 单例） */
  private channelRegistered = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly deps: ClangdProxyManagerDependencies = {},
  ) {
    // Windows-only：launcher 固定为 .bat（其他平台不在本插件支持范围）
    this.launcherPath = this.context.asAbsolutePath('out/launcher/proxy-launcher.bat');
    this.settingsManager = new ClangdSettingsManager(this.context, this.launcherPath);

    // 默认日志路径：VS Code 每次启动给扩展的带时间戳日志目录，按会话隔离不累积
    this.defaultLogPath = vscode.Uri.joinPath(context.logUri, 'clangd-proxy.log').fsPath;

    this.logger.info(`[proxyManager] launcher path: ${this.launcherPath}`);
    this.logger.info(`[proxyManager] default proxy log path: ${this.defaultLogPath}`);

    // 窗口重载时 proxy 可能已被 clangd 扩展启动（clangd.path 仍指向我们的 launcher），
    // 此时立即拉起 tailer，否则重载后看不到 proxy 日志。
    if (this.isActive) {
      this.startTailer();
    }
  }

  // ===== 状态查询 =====

  /** 配置中是否启用了 proxy */
  get enabled(): boolean {
    return this.config.clangdProxyEnabled;
  }

  /** proxy 当前是否处于激活状态（clangd.path 指向我们的 launcher） */
  get isActive(): boolean {
    return this.settingsManager.isUsingOurLauncher;
  }

  /** 是否有备份存在 */
  get hasBackup(): boolean {
    return this.settingsManager.hasBackup;
  }

  /** 日志文件路径（用户配置优先，否则默认 context.logUri 下） */
  get logPath(): string {
    return this.resolveLogPath();
  }

  /**
   * 解析 proxy 日志路径：用户在 clangdProxy.logPath 配置了就用配置值，
   * 否则回退到默认（context.logUri/clangd-proxy.log）。始终返回有效路径，
   * 保证 proxy 总会写文件、扩展端 tailer 总有目标可读。
   */
  private resolveLogPath(): string {
    return this.config.clangdProxyLogPath ?? this.defaultLogPath;
  }

  /**
   * 构建当前代理状态。
   *
   * 纯数据查询，不修改任何设置，不连接运行中的代理进程。
   */
  getStatus(): ClangdProxyStatus {
    return buildStatus({
      enabled: this.enabled,
      launcherPath: this.launcherPath,
      realClangdPath: this.config.clangdProxyRealClangdPath,
      keepaliveMax: this.config.clangdProxyKeepaliveMax,
      keepaliveTtlSec: this.config.clangdProxyKeepaliveTtlSec,
      localizationEnabled: this.config.clangdProxyLocalizationEnabled,
      localizationMode: this.config.clangdProxyLocalizationMode,
      logPath: this.logPath,
      hasBackup: this.hasBackup,
    });
  }

  // ===== 操作 =====

  /**
   * 启用 proxy：备份原始 clangd 设置并写入 launcher 设置。
   *
   * 不再检查 Config.clangdProxyEnabled —— 这是 plumbing 层，应该听调用方的；
   * 调用方（enableClangdProxy command / 自动启用逻辑）已自行决定是否要启用。
   * 历史耦合：旧版 require 用户先 config.update('clangdProxy.enabled', true) 才能 enable，
   * 但 B+C 修复后也只在某些 VS Code 实例下生效（target 解析问题），遂完全解耦。
   */
  async enable(): Promise<void> {
    // 读取当前 clangd 参数（这些将作为 -- 之后的真实 clangd 参数传递）
    const clangdConfig = vscode.workspace.getConfiguration('clangd');
    const originalArgs = clangdConfig.get<string[]>('arguments') ?? [];

    // 从 Config 与当前 clangd.path 解析真实 clangd，再构建 proxy 参数。
    const realClangdPath = this.resolveRealClangdPath(clangdConfig);
    const proxyArgs = this.buildProxyArgs(realClangdPath);

    // P1-2: 确保后台索引优先级为 normal（用户未显式设置时注入，可逆）
    const ensuredRealArgs = ensureBackgroundIndexPriority(originalArgs);
    if (ensuredRealArgs.length !== originalArgs.length) {
      this.logger.info(
        '[proxyManager] injected --background-index-priority=normal into clangd args (P1-2)',
      );
    }
    await this.settingsManager.enable(proxyArgs, ensuredRealArgs);
    this.logger.info('[proxyManager] proxy enabled');
    // proxy 即将由 clangd 扩展启动，拉起 tailer 实时转发日志到 Output 面板
    this.startTailer();
  }

  /**
   * 禁用 proxy：安全恢复原始 clangd 设置。
   */
  async disable(): Promise<void> {
    // proxy 即将被 clangd 扩展停止，先停 tailer 避免读已关闭的文件
    this.stopTailer();
    const result = await this.settingsManager.disable();
    if (result.restored) {
      this.logger.info('[proxyManager] proxy disabled, settings restored');
    } else {
      this.logger.warn(`[proxyManager] proxy disable: ${result.warning ?? 'unknown'}`);
    }
  }

  /**
   * 重新应用 proxy 参数（已激活状态下更新配置）。
   *
   * 当用户修改了 localization 等配置后，无需禁用再启用，
   * 直接重新构建参数并写入 clangd.arguments，然后提示重启 clangd。
   */
  async reapply(): Promise<void> {
    if (!this.isActive) {
      this.logger.warn('[proxyManager] proxy not active, cannot reapply; call enable() instead');
      return;
    }
    const clangdConfig = vscode.workspace.getConfiguration('clangd');
    const originalArgs = clangdConfig.get<string[]>('arguments') ?? [];
    // 从 -- 分隔符后提取真实 clangd 参数
    const dashDashIdx = originalArgs.indexOf('--');
    const realClangdArgs = dashDashIdx === -1 ? [] : originalArgs.slice(dashDashIdx + 1);

    const realClangdPath = this.resolveRealClangdPath(clangdConfig);
    const proxyArgs = this.buildProxyArgs(realClangdPath);

    // P1-2: reapply 也确保后台索引优先级（幂等，已含则不动）
    const ensuredRealArgs = ensureBackgroundIndexPriority(realClangdArgs);
    await this.settingsManager.updateArgs(proxyArgs, ensuredRealArgs);
    this.logger.info('[proxyManager] proxy args reapplied');
  }

  // ===== 内部方法 =====

  /**
   * 解析真实 clangd 路径，失败时阻止写入 clangd 设置。
   */
  private resolveRealClangdPath(clangdConfig: vscode.WorkspaceConfiguration): string {
    const result = resolveRealClangdPath({
      proxyRealClangdPath: this.config.clangdProxyRealClangdPath,
      configuredClangdPath: this.config.clangdPath,
      currentClangdPath: clangdConfig.get<string | undefined>('path'),
      backupClangdPath: this.settingsManager.backup?.path,
      launcherPath: this.launcherPath,
      envPath: process.env.PATH,
      pathDelimiter: path.delimiter,
      defaultSearchRoots: buildDefaultClangdSearchRoots(),
      fileExists: this.deps.fileExists ?? fs.existsSync,
    });

    switch (result.kind) {
      case 'found':
        return result.path;
      case 'notFound': {
        const message = 'Unable to resolve real clangd path for clangd proxy';
        this.logger.error(`[proxyManager] ${message}`);
        throw new Error(message);
      }
      default:
        return assertNever(result);
    }
  }

  /**
   * 解析 UBT 脚本路径。
   *
   * 用 build/ubt.ts 的 resolveUBTPath（Windows: Build.bat, Unix: RunUBT.sh）+ fs.existsSync 验证。
   * 旧实现用 ueHelpers.getUbtPath（依赖 vscode.workspace.fs.stat），在某些环境对引擎路径返回 null，
   * 导致 --ubt-path 不传、UeDiagnosticWatcher 不创建。
   */
  private resolveUbtPath(engineRoot: string): string | null {
    const candidate = resolveUBTPath(engineRoot);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    this.logger.warn(`[proxyManager] UBT script not found at ${candidate}`);
    return null;
  }

  /**
   * 解析 Build Target 名称（取第一个 .Target.cs，Editor 优先）。
   *
   * 用 fs.readdirSync 扫描 Source/*.Target.cs。旧实现用 getBuildTargetNames
   * （依赖 vscode.workspace.fs.readDirectory），对 workspace 外路径返回 []。
   */
  private resolveBuildTarget(projectDir: string): string | null {
    const sourceDir = path.join(projectDir, 'Source');
    try {
      const entries = fs.readdirSync(sourceDir);
      const targets = entries
        .filter((e) => e.endsWith('.Target.cs'))
        .map((e) => e.slice(0, -'.Target.cs'.length));
      // Editor 优先（对齐 ueHelpers.getBuildTargetNames 逻辑）
      const editorIdx = targets.findIndex((t) => t.includes('Editor'));
      if (editorIdx > 0) {
        const editor = targets.splice(editorIdx, 1)[0];
        if (editor) {
          targets.unshift(editor);
        }
      }
      const first = targets[0];
      if (!first) {
        this.logger.warn(`[proxyManager] no .Target.cs found in ${sourceDir}`);
      }
      return first ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[proxyManager] failed to read Source dir ${sourceDir}: ${msg}`);
      return null;
    }
  }

  /**
   * 启动日志 tailer：监听 resolveLogPath() 指向的文件，增量转发到
   * 'VSCodeUEHelper Proxy' Output 面板。重复调用安全（先停旧实例）。
   */
  private startTailer(): void {
    if (this.tailer) {
      return;
    }
    const logPath = this.resolveLogPath();
    const channel = getProxyLogChannel();
    // channel 单例，只注册一次到 subscriptions，扩展卸载时统一 dispose
    if (!this.channelRegistered) {
      this.context.subscriptions.push(channel);
      this.channelRegistered = true;
    }
    this.tailer = new ProxyLogTailer(logPath, channel, this.logger);
    this.tailer.start();
    // tailer 每次启动推入 subscriptions（dispose 幂等，重复 push 安全）
    this.context.subscriptions.push(this.tailer);
  }

  /**
   * 停止日志 tailer。重复调用安全。
   */
  private stopTailer(): void {
    if (!this.tailer) {
      return;
    }
    this.tailer.dispose();
    this.tailer = null;
  }

  /**
   * [deactivate 清理] vscode.Disposable.dispose。
   *
   * 当 extension 被卸载/窗口 reload 时,VS Code 通过 context.subscriptions
   * 同步调本方法。若 proxy 当前处于激活状态（clangd.path 仍指向我们的 launcher）,
   * 调 `disable()` 恢复用户原始 clangd 设置 —— 避免卸载后留下"clangd 指向
   * 一个已不存在的 launcher"的死链(下次用户打开工作区,IntelliSense 不可用)。
   *
   * 注意:
   * - 这是 best-effort:disable() 失败也不抛错(用户可能已手动改过 clangd.path)
   * - 不杀 proxy 子进程:本插件不直接 spawn proxy(proxy 由 clangd 扩展 spawn),
   *   恢复 clangd.path 后 clangd 扩展会自行结束 proxy 子进程
   * - 幂等:重复 dispose() 安全
   */
  dispose(): void {
    if (!this.isActive) {
      this.logger.info('[proxyManager] dispose: proxy not active, no settings to restore');
      return;
    }
    this.logger.info('[proxyManager] dispose: proxy still active, restoring clangd settings');
    // disable() 内部已 best-effort,这里不 await(deactivate 同步)
    void this.disable().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[proxyManager] dispose: disable failed: ${msg}`);
    });
  }

  /**
   * 从 Config 与已解析 clangd 路径构建 proxy CLI 参数列表。
   */
  private buildProxyArgs(realClangdPath: string): string[] {
    const args: string[] = ['--real-clangd', realClangdPath];

    // keepalive 配置
    args.push('--keepalive-max', String(this.config.clangdProxyKeepaliveMax));
    args.push('--keepalive-ttl-sec', String(this.config.clangdProxyKeepaliveTtlSec));

    // 日志路径（始终传，保证 proxy 写文件供扩展端 tailer 读取）
    args.push('--log-path', this.resolveLogPath());

    // 本地化配置
    if (this.config.clangdProxyLocalizationEnabled) {
      args.push('--localization-enabled');
      args.push('--localization-mode', this.config.clangdProxyLocalizationMode);
    }

    // UE 文档词典路径
    const dictPath = this.config.clangdProxyDictionaryPath;
    if (dictPath) {
      args.push('--dictionary-path', dictPath);
    }

    // [Phase 8] UE 诊断被动响应模式参数
    // extension 侧解析 UBT target/路径，proxy 是 vscode-free 进程无法调用 ueHelpers
    // 动态从 workspace 读 projectDir/engineRoot（enable 时 detection.ready 已完成），
    // fallback 旧快照字段（向后兼容）
    const projectDir = this.deps.workspace?.projectDir ?? this.deps.projectDir ?? undefined;
    const engineRoot = this.deps.workspace?.engineRoot ?? this.deps.engineRoot ?? undefined;
    if (projectDir) {
      args.push('--project-dir', projectDir);
      if (engineRoot) {
        args.push('--engine-root', engineRoot);
        // 解析 UBT 路径 + Build Target 名称，传给 proxy
        try {
          const ubtPath = this.resolveUbtPath(engineRoot);
          this.logger.info(`[proxyManager] resolved ubtPath: ${ubtPath ?? '(null)'}`);
          if (ubtPath) {
            args.push('--ubt-path', ubtPath);
          }
          const targetName = this.resolveBuildTarget(projectDir);
          this.logger.info(`[proxyManager] resolved buildTarget: ${targetName ?? '(null)'}`);
          if (targetName) {
            args.push('--build-target', targetName);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`[proxyManager] failed to resolve UBT params: ${msg}`);
        }
      }
    }

    return args;
  }
}

/**
 * 确保真实 clangd 参数含 --background-index-priority=normal（P1-2）。
 *
 * .clangd 的 Index.Background:Build 等价于 --background-index，但 --background-index-priority
 * 没有 .clangd 等价项，只能命令行注入。unreal-sense 实战：18k 文件 UE 项目里 background
 * 优先级会让索引被每次按键饿死、永远建不完；normal 优先级让索引能正常建完。
 *
 * 仅在用户未显式设置 --background-index-priority 时追加，尊重用户配置。
 * 注入可逆：disable 时 settingsManager 恢复备份的原始 arguments。
 */
export function ensureBackgroundIndexPriority(args: string[]): string[] {
  const hasPriority = args.some((a) => a.startsWith('--background-index-priority'));
  if (hasPriority) {
    return args;
  }
  return [...args, '--background-index-priority=normal'];
}

function buildDefaultClangdSearchRoots(): readonly string[] {
  // Windows-only：默认 clangd 搜索根（VS 2022 + LLVM 标准安装路径）
  return [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'LLVM', 'bin'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'LLVM', 'bin'),
    path.join(process.env.LocalAppData ?? '', 'Programs', 'LLVM', 'bin'),
  ];
}

function assertNever(value: never): never {
  throw new Error(`Unexpected real clangd resolver result: ${JSON.stringify(value)}`);
}
