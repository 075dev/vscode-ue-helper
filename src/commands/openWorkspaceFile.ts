/**
 * openWorkspaceFile —— 在编辑器里打开 .code-workspace
 *
 * 让用户能直接看到 folders[] 数组，检测失败时可以手动编辑。
 * [Phase 8] 不再提供自动重新生成命令——用户需手动从 .uproject 创建。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

export async function executeOpenWorkspaceFile(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage('No workspace open.');
    return;
  }
  // Look for a .code-workspace in any of the workspace roots.
  for (const folder of folders) {
    try {
      const entries = await fs.readdir(folder.uri.fsPath);
      const ws = entries.find((e) => e.endsWith('.code-workspace'));
      if (ws) {
        const filePath = path.join(folder.uri.fsPath, ws);
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
        return;
      }
    } catch {
      // skip
    }
  }
  void vscode.window.showInformationMessage('No .code-workspace file found in workspace roots.');
}
