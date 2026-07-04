/**
 * regenerateWorkspace —— 从 .uproject 生成 .code-workspace
 *
 * 算法:
 *   1. 找 .uproject
 *   2. 读 EngineAssociation(版本号或 GUID)
 *   3. 定位 UE: 优先用 WorkspaceState.engineRoot（detection 已知路径），
 *      fallback 才用注册表 + 标准路径查找
 *   4. 写 .code-workspace
 *
 * 每一步通过 VS Code 进度条显示(4 步进度)。
 *
 * Phase 8：[可选] 接受 workspace 注入，优先用 workspace.engineRoot
 *           派生路径（避免重复查找 + 修 bug：detection 已知的引擎路径
 *           不应被遗漏）。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import { t } from '@i18n';

const execFileAsync = promisify(execFile);

interface UProjectJson {
  EngineAssociation?: string;
  Modules?: unknown[];
}

async function findUProject(roots: readonly vscode.WorkspaceFolder[]): Promise<string | undefined> {
  for (const folder of roots) {
    try {
      const entries = await fs.readdir(folder.uri.fsPath);
      const uproject = entries.find((e) => e.endsWith('.uproject'));
      if (uproject) {return path.join(folder.uri.fsPath, uproject);}
    } catch {
      // skip
    }
  }
  return undefined;
}

async function locateUEFromRegistry(version: string): Promise<string | null> {
  if (process.platform !== 'win32') {return null;}
  for (const regPath of [
    `HKLM\\SOFTWARE\\EpicGames\\Unreal Engine\\${version}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\EpicGames\\Unreal Engine\\${version}`,
    `HKCU\\SOFTWARE\\Epic Games, Inc.\\Unreal Engine\\${version}`,
  ]) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', regPath, '/v', 'InstallLocation']);
      const m = /InstallLocation\s+REG_SZ\s+(.+)/.exec(stdout);
      const path_ = m?.[1]?.trim();
      if (path_) {
        try {
          await fs.access(path.join(path_, 'Engine', 'Build', 'Build.version'));
          return path_;
        } catch {
          // path exists in registry but Build.version missing
        }
      }
    } catch {
      // skip
    }
  }
  return null;
}

async function locateUEFromCommonPaths(version: string): Promise<string | null> {
  const driveLetters = ['C', 'D', 'E', 'F'];
  for (const drive of driveLetters) {
    const candidate = `${drive}:\\Program Files\\Epic Games\\UE_${version}`;
    try {
      await fs.access(path.join(candidate, 'Engine', 'Build', 'Build.version'));
      return candidate;
    } catch {
      // not found, try next
    }
  }
  return null;
}

async function locateUE(version: string): Promise<string | null> {
  return (await locateUEFromRegistry(version)) ?? (await locateUEFromCommonPaths(version));
}

export async function executeRegenerateWorkspace(
  logger: Logger,
  workspace?: WorkspaceState,
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 0) {
    void vscode.window.showWarningMessage(t('regen.noWorkspace'));
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t('regen.title'),
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ message: t('regen.step1') });
        const uprojectPath = await findUProject(workspaceFolders);
        if (!uprojectPath) {
          void vscode.window.showErrorMessage(t('regen.noUproject'));
          return;
        }
        const projectName = path.basename(uprojectPath, '.uproject');
        progress.report({
          message: t('regen.step1.done', { name: String(path.basename(uprojectPath)) }),
        });

        progress.report({ message: t('regen.step2') });
        const uprojectText = await fs.readFile(uprojectPath, 'utf-8');
        const uproject = JSON.parse(uprojectText) as UProjectJson;
        const version = uproject.EngineAssociation;
        if (!version) {
          void vscode.window.showErrorMessage(t('regen.noEngineAssoc'));
          return;
        }
        progress.report({ message: t('regen.step2.done', { version }) });

        progress.report({ message: t('regen.step3', { version }) });

        // [Phase 8] 优先用 WorkspaceState.engineRoot（detection 已知引擎路径）
        // 这是修复 bug 的关键：detection 已经知道引擎路径（来自 .code-workspace
        // 的 folders[1]），不应被 ignore。否则非标准安装路径（D:/Engine 等）
        // 会被误判为"未设置"。
        let enginePath: string | null = workspace?.engineRoot ?? null;
        let engineSource: 'workspace' | 'registry' | 'common-paths' | 'none' = enginePath
          ? 'workspace'
          : 'none';

        if (!enginePath) {
          // Fallback：注册表 + 常见路径查找（兼容没有 WorkspaceState 的场景）
          enginePath = await locateUE(version);
          engineSource = enginePath ? 'registry' : 'none';
        }

        if (!enginePath) {
          void vscode.window.showErrorMessage(t('regen.engineNotFound', { version }));
          logger.warn(
            `[regenerateWorkspace] engine ${version} not found via workspace, registry, or common paths`,
          );
          return;
        }
        progress.report({
          message: t('regen.step3.done', { path: enginePath }),
        });
        logger.info(
          `[regenerateWorkspace] engine resolved via ${engineSource}: ${enginePath}`,
        );

        progress.report({ message: t('regen.step4') });
        const workspaceRoot = path.dirname(uprojectPath);
        const workspaceFile = path.join(workspaceRoot, `${projectName}.code-workspace`);
        const workspaceData = {
          folders: [
            { name: projectName, path: '.' },
            { name: `UE${version}`, path: enginePath },
          ],
          settings: {},
        };
        const json = JSON.stringify(workspaceData, null, 4);
        await fs.writeFile(workspaceFile, json, 'utf-8');
        progress.report({ message: t('regen.step4.done', { path: workspaceFile }) });

        logger.info(`[regenerateWorkspace] wrote ${workspaceFile}`);
        const choice = await vscode.window.showInformationMessage(
          t('regen.done'),
          t('regen.reopen'),
        );
        if (choice === t('regen.reopen')) {
          await vscode.commands.executeCommand(
            'vscode.openFolder',
            vscode.Uri.file(workspaceFile),
            { forceNewWindow: false },
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('[regenerateWorkspace] failed:', msg);
        void vscode.window.showErrorMessage(t('regen.failed', { error: msg }));
      }
    },
  );
}
