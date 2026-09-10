/**
 * installRules —— 安装 AI Agent 规则文件
 *
 * 把插件内置的 .cursorrules / rules 文件复制到项目,让 Cursor / Claude Code
 * 等 AI 工具能感知 UE 项目结构,给出更好的代码补全和建议。
 *
 * 内容单一真相源：`@rules`（src/rules/cursorRules.ts）。
 *   - Cursor: `.cursor/rules/*.mdc` 用 `UE_HELPER_RULES_MDC`（含 frontmatter）
 *   - Copilot: `.github/copilot-instructions.md` 用 `UE_HELPER_COPILOT_INSTRUCTIONS`（纯 markdown）
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { t } from '@i18n';
import type { WorkspaceState } from '@core/workspace';
import { UE_HELPER_RULES_MDC, UE_HELPER_COPILOT_INSTRUCTIONS } from '../rules';

export async function executeInstallRules(
  logger: Logger,
  // [Phase 9 SSoT] 唯一真相源 workspace.projectDir——删除 detection 与 workspaceFolders 双真相源反模式
  workspace?: WorkspaceState,
): Promise<void> {
  const root = workspace?.projectDir;
  if (!root) {
    void vscode.window.showWarningMessage(t('cmd.noWorkspaceRoot'));
    return;
  }

  // Cursor: .cursor/rules/*.mdc（含 frontmatter）
  const cursorDir = path.join(root, '.cursor', 'rules');
  await fs.mkdir(cursorDir, { recursive: true });
  const cursorFile = path.join(cursorDir, 'unreal-cpp.mdc');
  await fs.writeFile(cursorFile, UE_HELPER_RULES_MDC, 'utf-8');

  // Copilot: .github/copilot-instructions.md（纯 markdown，无 frontmatter）
  const ghDir = path.join(root, '.github');
  await fs.mkdir(ghDir, { recursive: true });
  const copilotFile = path.join(ghDir, 'copilot-instructions.md');
  await fs.writeFile(copilotFile, UE_HELPER_COPILOT_INSTRUCTIONS, 'utf-8');

  void vscode.window.showInformationMessage(
    t('installRules.installed', { 0: cursorFile, 1: copilotFile }),
  );
  logger.info(`[installRules] wrote ${cursorFile} + ${copilotFile}`);
}
