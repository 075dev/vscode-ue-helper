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
import type { DetectionHandles } from '@detection';

interface CleanupTarget {
  label: string;
  paths: string[];
}

export async function executeUninstall(logger: Logger, detection: DetectionHandles): Promise<void> {
  const project = await detection.scanner.findSingle();
  const root = project
    ? path.dirname(project.path)
    : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    void vscode.window.showWarningMessage('No workspace root found.');
    return;
  }

  const targets: CleanupTarget[] = [
    { label: '.clangd', paths: [path.join(root, '.clangd')] },
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
    removed.length > 0 ? `Cleaned: ${removed.join(', ')}` : 'No generated files found to clean.',
  );
  logger.info(`[uninstall] removed ${removed.length} target(s)`);
}
