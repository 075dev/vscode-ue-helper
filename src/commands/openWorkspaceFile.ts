/**
 * openWorkspaceFile —— 在编辑器里打开 .code-workspace
 *
 * 让用户能直接看到 folders[] 数组，检测失败时可以手动编辑。
 * [Phase 8] 不再提供自动重新生成命令——用户需手动从 .uproject 创建。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { t } from '@i18n';
import type { WorkspaceState } from '@core/workspace';

export async function executeOpenWorkspaceFile(workspace?: WorkspaceState): Promise<void> {
  // [Phase 9 SSoT] 优先 workspace.workspaceFolders（检测已 ready 时）
  // 未传时（如单仓库场景 fallback）回落到 vscode.workspace.workspaceFolders
  // eslint-disable-next-line no-restricted-syntax -- 单仓库/测试兼容 fallback
  const folders = workspace?.workspaceFolders ?? vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage(t('openWorkspaceFile.noWorkspace'));
    return;
  }
  // Look for a .code-workspace in any of the workspace roots.
  for (const folder of folders) {
    try {
      // folder 是 WorkspaceFolderInfo（无 uri）| vscode.WorkspaceFolder（有 uri）—— 处理两种形态
      const folderPath = (folder as { uri?: { fsPath: string }; absPath?: string }).uri?.fsPath
        ?? (folder as { absPath?: string }).absPath;
      if (!folderPath) {continue;}
      const entries = await fs.readdir(folderPath);
      const ws = entries.find((e) => e.endsWith('.code-workspace'));
      if (ws) {
        const filePath = path.join(folderPath, ws);
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
        return;
      }
    } catch {
      // skip
    }
  }
  void vscode.window.showInformationMessage(t('openWorkspaceFile.notFound'));
}
