/**
 * uninstall —— 删除插件生成的所有文件
 *
 * 清理的文件:
 *   - .clangd (项目根)
 *   - compile_commands.json (项目根)
 *   - .vscode/vscodeuehelper/
 *   - .vscode/.code-workspace.backup
 *   - .cursor/rules/unreal-cpp.mdc
 *   - .github/copilot-instructions.md
 *
 * 保留 addCompletions.h / addMacroCompletions.h (用户可能编辑过)
 *
 * Does NOT touch user files (.uproject, .Build.cs, etc.).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { t } from '@i18n';
import type { WorkspaceState } from '@core/workspace';

interface CleanupTarget {
  label: string;
  paths: string[];
}

export async function executeUninstall(
  logger: Logger,
  // [Phase 9 SSoT] 唯一真相源 workspace.projectDir——删除 detection 与 workspaceFolders 双真相源反模式
  workspace?: WorkspaceState,
): Promise<void> {
  // [Phase 9 SSoT] 单一真相源；.clangd 路径用 WorkspaceState 派生
  const root = workspace?.projectDir;
  const clangdPath = workspace?.clangdConfigPath;
  if (!root) {
    void vscode.window.showWarningMessage(t('cmd.noWorkspaceRoot'));
    return;
  }

  const targets: CleanupTarget[] = [
    // [Phase 9 SSoT] .clangd 路径用 WorkspaceState 派生，不走 path.join
    { label: '.clangd', paths: [clangdPath ?? path.join(root, '.clangd')] },
    { label: 'compile_commands.json', paths: [path.join(root, 'compile_commands.json')] },
    { label: '.vscode/vscodeuehelper/', paths: [path.join(root, '.vscode', 'vscodeuehelper')] },
    {
      label: '.vscode/.code-workspace.backup',
      paths: [path.join(root, '.vscode', '.code-workspace.backup')],
    },
    {
      label: '.cursor/rules/unreal-cpp.mdc',
      paths: [path.join(root, '.cursor', 'rules', 'unreal-cpp.mdc')],
    },
    {
      label: '.github/copilot-instructions.md',
      paths: [path.join(root, '.github', 'copilot-instructions.md')],
    },
  ];

  const removed: string[] = [];
  for (const t of targets) {
    for (const p of t.paths) {
      try {
        await fs.rm(p, { recursive: true, force: true });
        removed.push(t.label);
      } catch {
        // ignore — file may not exist
      }
    }
  }

  void vscode.window.showInformationMessage(
    removed.length > 0
      ? t('uninstall.cleaned', { 0: removed.join(', ') })
      : t('uninstall.cleanedEmpty'),
  );
  logger.info(`[uninstall] removed ${removed.length} target(s)`);
}
