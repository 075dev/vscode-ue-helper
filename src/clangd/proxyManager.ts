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
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Config } from '@core/config';
import { Logger } from '@core/logger';
import { resolveRealClangdPath } from './proxy/realClangdResolver';
import { ClangdSettingsManager } from './proxy/settingsManager';
import { buildStatus, type ClangdProxyStatus } from './proxy/status';

export interface ClangdProxyManagerDependencies {
  readonly fileExists?: (candidate: string) => boolean;
}

export class ClangdProxyManager {
  /** 设置管理器（备份/写入/恢复 clangd 设置） */
  public readonly settingsManager: ClangdSettingsManager;

  /** launcher 脚本的完整路径 */
  public readonly launcherPath: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly deps: ClangdProxyManagerDependencies = {},
  ) {
    // 计算 launcher 路径：Windows 使用 .bat，其他平台使用 .sh
    const isWin = process.platform === 'win32';
    this.launcherPath = this.context.asAbsolutePath(
      `out/launcher/proxy-launcher${isWin ? '.bat' : '.sh'}`,
    );
    this.settingsManager = new ClangdSettingsManager(this.context, this.launcherPath);

    this.logger.info(`[proxyManager] launcher path: ${this.launcherPath}`);
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

  /** 日志文件路径（来自配置） */
  get logPath(): string | undefined {
    return this.config.clangdProxyLogPath;
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
   * 从 Config 读取 proxy 参数，从当前 clangd.arguments 读取原始参数。
   * 如果配置中未启用 proxy，仅记录警告并跳过。
   */
  async enable(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('[proxyManager] proxy not enabled in config, skipping enable');
      return;
    }

    // 读取当前 clangd 参数（这些将作为 -- 之后的真实 clangd 参数传递）
    const clangdConfig = vscode.workspace.getConfiguration('clangd');
    const originalArgs = clangdConfig.get<string[]>('arguments') ?? [];

    // 从 Config 与当前 clangd.path 解析真实 clangd，再构建 proxy 参数。
    const realClangdPath = this.resolveRealClangdPath(clangdConfig);
    const proxyArgs = this.buildProxyArgs(realClangdPath);

    await this.settingsManager.enable(proxyArgs, originalArgs);
    this.logger.info('[proxyManager] proxy enabled');
  }

  /**
   * 禁用 proxy：安全恢复原始 clangd 设置。
   */
  async disable(): Promise<void> {
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

    await this.settingsManager.updateArgs(proxyArgs, realClangdArgs);
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
   * 从 Config 与已解析 clangd 路径构建 proxy CLI 参数列表。
   */
  private buildProxyArgs(realClangdPath: string): string[] {
    const args: string[] = ['--real-clangd', realClangdPath];

    // keepalive 配置
    args.push('--keepalive-max', String(this.config.clangdProxyKeepaliveMax));
    args.push('--keepalive-ttl-sec', String(this.config.clangdProxyKeepaliveTtlSec));

    // 日志路径
    const logPath = this.config.clangdProxyLogPath;
    if (logPath) {
      args.push('--log-path', logPath);
    }

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

    return args;
  }
}

function buildDefaultClangdSearchRoots(): readonly string[] {
  if (process.platform !== 'win32') {
    return [];
  }

  return [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'LLVM', 'bin'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'LLVM', 'bin'),
    path.join(process.env.LocalAppData ?? '', 'Programs', 'LLVM', 'bin'),
  ];
}

function assertNever(value: never): never {
  throw new Error(`Unexpected real clangd resolver result: ${JSON.stringify(value)}`);
}

