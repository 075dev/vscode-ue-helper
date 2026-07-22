/**
 * settingsManager.ts —— clangd 设置备份/写入/恢复管理器
 *
 * 职责：
 * - 启用代理时备份原始 clangd 设置（path、arguments、useScriptAsExecutable）
 * - 写入 workspace 级别设置，指向本扩展的 launcher
 * - 禁用代理时安全恢复原始设置
 * - 用户手动修改 clangd.path 后跳过恢复并给出警告
 *
 * 设计原则：
 * - 只写 workspace 级别设置，不写 user/global
 * - 使用 context.workspaceState 存储备份
 * - 恢复前检查当前 clangd.path 是否仍指向本扩展的 launcher
 */

import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 备份的 clangd 设置 */
export interface ClangdSettingsBackup {
  path?: string;
  arguments?: string[];
  useScriptAsExecutable?: boolean;
}

/** 禁用结果 */
export interface DisableResult {
  /** 是否成功恢复 */
  restored: boolean;
  /** 警告信息（如有） */
  warning?: string;
}

/** workspaceState 中备份的键名 */
const BACKUP_KEY = 'vscodeUEHelper.clangdProxy.backup';

// ---------------------------------------------------------------------------
// ClangdSettingsManager
// ---------------------------------------------------------------------------

export class ClangdSettingsManager {
  private readonly context: vscode.ExtensionContext;
  private readonly launcherPath: string;

  constructor(context: vscode.ExtensionContext, launcherPath: string) {
    this.context = context;
    this.launcherPath = launcherPath;
  }

  /**
   * 是否有备份存在。
   */
  get hasBackup(): boolean {
    return (
      this.context.workspaceState.get<ClangdSettingsBackup | undefined>(BACKUP_KEY) !== undefined
    );
  }

  /**
   * 当前备份内容，供 proxyManager 在 launcher 已写入后继续读取原始 clangd.path。
   */
  get backup(): ClangdSettingsBackup | undefined {
    return this.context.workspaceState.get<ClangdSettingsBackup | undefined>(BACKUP_KEY);
  }

  /**
   * 当前 clangd.path 是否指向本扩展的 launcher。
   */
  get isUsingOurLauncher(): boolean {
    const clangdConfig = vscode.workspace.getConfiguration('clangd');
    const currentPath = clangdConfig.get<string | undefined>('path');
    return currentPath === this.launcherPath;
  }

  /**
   * 启用代理：备份原始设置并写入 launcher 设置。
   *
   * @param proxyArgs - 代理 CLI 参数（不含 -- 分隔符）
   * @param realClangdArgs - 真实 clangd 参数（-- 分隔符之后）
   */
  async enable(proxyArgs: string[], realClangdArgs: string[]): Promise<void> {
    const clangdConfig = vscode.workspace.getConfiguration('clangd');

    // 1. 备份原始设置（在任何写入之前完成，确保后续失败时可回滚）
    const backup: ClangdSettingsBackup = {
      path: clangdConfig.get<string | undefined>('path'),
      arguments: clangdConfig.get<string[] | undefined>('arguments'),
      useScriptAsExecutable: clangdConfig.get<boolean | undefined>('useScriptAsExecutable'),
    };
    await this.context.workspaceState.update(BACKUP_KEY, backup);

    const fullArgs = [...proxyArgs, '--', ...realClangdArgs];
    const target = vscode.ConfigurationTarget.Workspace;

    // 2. 依次写入三项。任一失败则回滚已写入字段为备份值，避免半截配置
    //    （半截配置会让 launcher 启动失败：例如 path 已写但 arguments 缺 --real-clangd，
    //     proxy CLI 校验失败直接退出，clangd 扩展报错无 IntelliSense，reload 也救不回）。
    const written: Array<'path' | 'arguments' | 'useScriptAsExecutable'> = [];
    try {
      await clangdConfig.update('path', this.launcherPath, target);
      written.push('path');
      await clangdConfig.update('arguments', fullArgs, target);
      written.push('arguments');
      // 3. 设置 useScriptAsExecutable = true（Windows 上脚本 launcher 需要）
      await clangdConfig.update('useScriptAsExecutable', true, target);
      written.push('useScriptAsExecutable');
    } catch (err) {
      // 回滚已写入的字段为备份值，尽量恢复原始状态
      for (const key of written) {
        try {
          if (key === 'path') {
            await clangdConfig.update('path', backup.path, target);
          } else if (key === 'arguments') {
            await clangdConfig.update('arguments', backup.arguments, target);
          } else {
            await clangdConfig.update(
              'useScriptAsExecutable',
              backup.useScriptAsExecutable,
              target,
            );
          }
        } catch {
          // 单个回滚失败不阻断其余回滚
        }
      }
      // enable 整体失败，清除备份避免污染后续 disable
      try {
        await this.context.workspaceState.update(BACKUP_KEY, undefined);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  /**
   * 更新代理 CLI 参数（不修改备份、不修改 path）。
   *
   * 用于已激活状态下重新应用最新配置（如 localization 设置变更）。
   * 只覆写 clangd.arguments，保留已有的 clangd.path 和备份。
   *
   * @param proxyArgs - 新的代理 CLI 参数
   * @param realClangdArgs - 新的真实 clangd 参数（-- 分隔符之后）
   */
  async updateArgs(proxyArgs: string[], realClangdArgs: string[]): Promise<void> {
    const clangdConfig = vscode.workspace.getConfiguration('clangd');
    const fullArgs = [...proxyArgs, '--', ...realClangdArgs];
    await clangdConfig.update('arguments', fullArgs, vscode.ConfigurationTarget.Workspace);
  }

  /**
   * 禁用代理：安全恢复原始设置。
   *
   * 仅在当前 clangd.path 仍指向本扩展 launcher 时恢复。
   * 如果用户手动修改了 clangd.path，跳过恢复并给出警告。
   *
   * @returns 禁用结果
   */
  async disable(): Promise<DisableResult> {
    const backup = this.context.workspaceState.get<ClangdSettingsBackup | undefined>(BACKUP_KEY);

    if (!backup) {
      return {
        restored: false,
        warning: '未找到 clangd 设置备份，跳过恢复。',
      };
    }

    // 检查当前 clangd.path 是否仍指向本扩展的 launcher
    if (!this.isUsingOurLauncher) {
      return {
        restored: false,
        warning: '用户修改了 clangd.path，跳过恢复以保留用户更改。',
      };
    }

    const clangdConfig = vscode.workspace.getConfiguration('clangd');

    // 恢复原始设置
    await clangdConfig.update('path', backup.path, vscode.ConfigurationTarget.Workspace);
    await clangdConfig.update('arguments', backup.arguments, vscode.ConfigurationTarget.Workspace);
    await clangdConfig.update(
      'useScriptAsExecutable',
      backup.useScriptAsExecutable,
      vscode.ConfigurationTarget.Workspace,
    );

    // 清除备份
    await this.context.workspaceState.update(BACKUP_KEY, undefined);

    return { restored: true };
  }
}
