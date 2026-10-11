/**
 * workspaceBackup —— 保护 .code-workspace 不被 UBT 覆盖
 *
 * UBT 的 -ProjectFiles 重新生成模式会重写项目的 .code-workspace(以及
 * .vscode/launch.json),不保留用户自定义。本模块:
 *   1. UBT 跑前快照 workspace
 *   2. UBT 跑完后恢复用户自定义
 *
 * 模式参考 unreal-clangd 的 src/workspaceBackup.ts。
 *
 * 类 WorkspaceBackup:
 *   - snapshot(): 复制当前 .code-workspace 到 .vscode/.code-workspace.backup
 *   - restore(): 从备份恢复
 *   - startWatching(): 监听变化自动恢复
 *
 * 接入点：src/commands/build.ts 在 UBT 构建前 snapshot()、构建后（finally）restore()，
 * 尊重 `autoBackupWorkspace` 设置（默认 true）。无 .code-workspace 文件时自然 no-op。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const BACKUP_DIR = '.vscode';
const BACKUP_FILE = '.code-workspace.backup';

export class WorkspaceBackup {
  constructor(private readonly projectPath: string) {}

  /**
   * Snapshot the current .code-workspace. Called before UBT regenerates.
   * If no workspace file exists, this is a no-op.
   */
  async snapshot(): Promise<void> {
    // We can't know which workspace file matches the project — glob for it.
    const dir = path.dirname(this.projectPath);
    const entries = await fs.readdir(dir).catch(() => []);
    const workspaceFile = entries.find((e) => e.endsWith('.code-workspace'));
    if (!workspaceFile) {
      return;
    }

    const src = path.join(dir, workspaceFile);
    const dst = path.join(dir, BACKUP_DIR, BACKUP_FILE);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
  }

  /**
   * Restore the workspace from the backup. Called after UBT finishes.
   * No-op if no backup exists.
   */
  async restore(): Promise<void> {
    const dir = path.dirname(this.projectPath);
    const entries = await fs.readdir(dir).catch(() => []);
    const workspaceFile = entries.find((e) => e.endsWith('.code-workspace'));
    if (!workspaceFile) {
      return;
    }

    const src = path.join(dir, BACKUP_DIR, BACKUP_FILE);
    const dst = path.join(dir, workspaceFile);

    try {
      await fs.copyFile(src, dst, fs.constants.COPYFILE_FICLONE);
    } catch {
      // Backup doesn't exist or unreadable — leave current state alone.
    }
  }
}
