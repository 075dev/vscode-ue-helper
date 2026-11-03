/**
 * uninstall —— 删除插件生成的所有文件
 *
 * 清理的文件:
 *   - .clangd (项目根)
 *   - compile_commands.json (项目根)
 *   - .vscode/vscodeuehelper/
 *   - .vscode/uehelper-backup/ (D12 起的备份目录;路径取自 @clangd/workspaceBackup
 *     的单一真相源,避免两处各写一份常量而漂移)
 *   - .vscode/.code-workspace.backup (D12 之前的旧备份目录,遗留清理)
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
import {
  okEnvelope,
  errEnvelope,
  EC_PROJECT_NOT_DETECTED,
  EC_INTERNAL_ERROR,
  type Envelope,
} from '@core/envelope';
import { t } from '@i18n';
import type { WorkspaceState } from '@core/workspace';
import { getWorkspaceBackupDir } from '@clangd/workspaceBackup';

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
): Promise<Envelope<{ removed: string[] }>> {
  try {
    // [Phase 9 SSoT] 单一真相源；.clangd 路径用 WorkspaceState 派生
    const root = workspace?.projectDir;
    const clangdPath = workspace?.clangdConfigPath;
    if (!root) {
      // 项目未检测到 → 契约错误码;UI 行为(警告弹窗)保持原样
      const msg = t('cmd.noWorkspaceRoot');
      void vscode.window.showWarningMessage(msg);
      return errEnvelope(EC_PROJECT_NOT_DETECTED, msg);
    }

    const targets: CleanupTarget[] = [
      // [Phase 9 SSoT] .clangd 路径用 WorkspaceState 派生，不走 path.join
      { label: '.clangd', paths: [clangdPath ?? path.join(root, '.clangd')] },
      { label: 'compile_commands.json', paths: [path.join(root, 'compile_commands.json')] },
      {
        // [M1] D12 起备份落在 `.vscode/uehelper-backup/<原文件名>` —— 路径取自
        // @clangd/workspaceBackup 的单一真相源。此前这里写的是 D12 之前的旧路径
        // `.vscode/.code-workspace.backup`，插件**自己创建的备份目录永远不会被清理**，
        // 与 README「Uninstall (Clean Generated Files)」的承诺不符。
        label: '.vscode/uehelper-backup/',
        paths: [getWorkspaceBackupDir(root)],
      },
      {
        // D12 之前的旧备份目录（历史遗留，一并清掉）
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

    // summary 复用现有用户文案语义
    const summary =
      removed.length > 0
        ? t('uninstall.cleaned', { 0: removed.join(', ') })
        : t('uninstall.cleanedEmpty');
    void vscode.window.showInformationMessage(summary);
    logger.info(`[uninstall] removed ${removed.length} target(s)`);
    return okEnvelope({ removed }, summary);
  } catch (err) {
    // 函数出口兜底:未知错误 → INTERNAL_ERROR
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[uninstall] unexpected error:', err);
    return errEnvelope(EC_INTERNAL_ERROR, `卸载清理失败: ${msg}`);
  }
}
