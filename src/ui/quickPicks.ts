/**
 * quickPicks —— 可复用的 picker
 *
 * 主要导出:
 *   - pickProject(projects): 让用户选 .uproject
 *   - pickEngine(engines): 让用户选 UE 引擎
 *   - pickConfiguration(): 让用户选 Build Configuration
 *   - pickTarget(): 让用户选 Target 类型
 *   - pickPlatform(): 让用户选平台
 *
 * 全部基于 vscode.window.showQuickPick,返回用户选中的项或 undefined。
 */

import * as vscode from 'vscode';
import { ProjectInfo, EngineInstall } from '@detection';

export async function pickProject(projects: ProjectInfo[]): Promise<ProjectInfo | undefined> {
  if (projects.length === 0) {
    void vscode.window.showInformationMessage('No .uproject files found in workspace.');
    return undefined;
  }
  const items = projects.map((p) => ({
    label: p.name,
    description: p.path,
    detail: p.engineAssociation ? `Engine: ${p.engineAssociation}` : undefined,
    project: p,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a .uproject',
    matchOnDescription: true,
  });
  return picked?.project;
}

export async function pickEngine(engines: EngineInstall[]): Promise<EngineInstall | undefined> {
  if (engines.length === 0) {
    void vscode.window.showInformationMessage(
      'No Unreal Engine installations detected. Set vscodeUEHelper.engineRoot manually.',
    );
    return undefined;
  }
  const items = engines.map((e) => ({
    label: e.version,
    description: e.path,
    detail: e.isLauncherInstall ? 'Launcher install' : 'Custom install',
    engine: e,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select Unreal Engine version',
    matchOnDescription: true,
  });
  return picked?.engine;
}

export async function pickConfiguration(): Promise<string | undefined> {
  return vscode.window.showQuickPick(['Debug', 'DebugGame', 'Development', 'Shipping', 'Test'], {
    placeHolder: 'Select build configuration',
  });
}

export async function pickTarget(): Promise<string | undefined> {
  return vscode.window.showQuickPick(['Editor', 'Game', 'Server', 'Client'], {
    placeHolder: 'Select build target',
  });
}

export async function pickPlatform(): Promise<string | undefined> {
  const items: vscode.QuickPickItem[] = [
    { label: 'Win64', description: 'Windows 64-bit' },
    { label: 'Mac', description: 'macOS' },
    { label: 'Linux', description: 'Linux' },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select target platform',
  });
  return picked?.label;
}
