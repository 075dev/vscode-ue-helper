/**
 * installRules —— 安装 AI Agent 规则文件
 *
 * 把插件内置的 .cursorrules / rules 文件复制到项目,让 Cursor / Claude Code
 * 等 AI 工具能感知 UE 项目结构,给出更好的代码补全和建议。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { t } from '@i18n';
import type { WorkspaceState } from '@core/workspace';

const RULES_CONTENT = `# UE Helper — AI Agent Rules

These rules help AI coding assistants (Cursor, Claude Code, GitHub Copilot)
work effectively with Unreal Engine C++ projects opened in this workspace.

## Build & Live Coding

- Use UBT (UnrealBuildTool) for builds — never try to compile .cpp files directly.
- Prefer Live Coding for fast iteration when only headers changed.
- All paths to engine binaries go through \`vscodeUEHelper.*\` settings or the
  detection layer; do not hardcode engine paths.

## Conventions

- Use UCLASS / UPROPERTY / UFUNCTION macros as documented in Unreal Engine docs.
- Generated.h files are auto-generated — do not edit them.
- Module dependencies are declared in \`<Module>.Build.cs\` not in code.
- Prefer TObjectPtr<T> over raw T* for UPROPERTY pointers (UE 5.0+).

## Workflow

- After editing .cpp/.h, suggest a Live Coding reload if only a header changed.
- After editing .Build.cs or adding a new module, suggest a full Rebuild.
- Surface compile errors in the Problems panel — never paper over them silently.
`;

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

  // Cursor: .cursor/rules/*.mdc
  const cursorDir = path.join(root, '.cursor', 'rules');
  await fs.mkdir(cursorDir, { recursive: true });
  const cursorFile = path.join(cursorDir, 'unreal-cpp.mdc');
  await fs.writeFile(cursorFile, RULES_CONTENT, 'utf-8');

  // Copilot: .github/copilot-instructions.md
  const ghDir = path.join(root, '.github');
  await fs.mkdir(ghDir, { recursive: true });
  const copilotFile = path.join(ghDir, 'copilot-instructions.md');
  await fs.writeFile(copilotFile, RULES_CONTENT, 'utf-8');

  void vscode.window.showInformationMessage(
    t('installRules.installed', { 0: cursorFile, 1: copilotFile }),
  );
  logger.info(`[installRules] wrote ${cursorFile} + ${copilotFile}`);
}
