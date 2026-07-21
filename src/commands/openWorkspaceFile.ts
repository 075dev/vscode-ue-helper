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
  // [Phase 11 SSoT 包 6] workspace.workspaceFolders 是单一真相源——删除 vscode.workspace.workspaceFolders fallback
  const folders = workspace?.workspaceFolders ?? [];
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
