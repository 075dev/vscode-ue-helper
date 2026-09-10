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
import { type Logger } from '@core/logger';
import { t } from '@i18n';
import type { WorkspaceState } from '@core/workspace';

interface CleanupTarget {
  label: string;
  paths: string[];
}

/**
 * 删除 .vscode/vscodeuehelper/ 下的托管文件,保留 addCompletions.h / addMacroCompletions.h。
 *
 * [F2-20/§8.8] 这两个文件声明保留用户编辑(见 src/clangd/completionFiles.ts:487-512):
 *   - addCompletions.h 是纯用户文件,仅在不存在时创建模板,已存在绝不覆盖;
 *   - addMacroCompletions.h 托管刷新,但 MANAGED/USER 分区里 USER 区归用户所有。
 * 整目录递归删除会毁掉用户内容,因此改为逐文件删除,最后尝试移除空目录。
 *
 * @returns 是否删除了至少一个文件(用于结果汇总)
 */
async function cleanupHelperDir(dir: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    // 目录不存在 → 无清理项
    return false;
  }
  let removedAny = false;
  for (const name of entries) {
    // 保留用户可能编辑过的文件
    if (name === 'addCompletions.h' || name === 'addMacroCompletions.h') {
      continue;
    }
    try {
      await fs.rm(path.join(dir, name), { recursive: true, force: true });
      removedAny = true;
    } catch {
      // ignore — 文件可能不存在
    }
  }
  // 目录清空后尝试移除空目录(失败无妨——残留空目录不构成"托管文件"残留)
  try {
    await fs.rmdir(dir);
  } catch {
    // ignore
  }
  return removedAny;
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

  // [F2-20/§8.8] .vscode/vscodeuehelper/ 不能整目录递归删除 —— addCompletions.h 与
  // addMacroCompletions.h 声明保留用户编辑。只删托管文件,保留这两个文件。
  const helperDir = path.join(root, '.vscode', 'vscodeuehelper');
  if (await cleanupHelperDir(helperDir)) {
    removed.push('.vscode/vscodeuehelper/');
  }

  void vscode.window.showInformationMessage(
    removed.length > 0
      ? t('uninstall.cleaned', { 0: removed.join(', ') })
      : t('uninstall.cleanedEmpty'),
  );
  logger.info(`[uninstall] removed ${removed.length} target(s)`);
}
