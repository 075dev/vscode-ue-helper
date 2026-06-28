/**
 * launchEditor —— 实现 vscodeUEHelper.launchEditor
 *
 * 调用 detection 拿项目和引擎,然后用 @build/launchEditor 启动 Unreal Editor。
 * 状态栏的 $(rocket) Launch 按钮绑到这个命令。
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import { launchEditor as launch } from '@build';
import { pickProject, pickEngine } from '@ui/quickPicks';
import type { DetectionHandles } from '@detection';

export async function executeLaunchEditor(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
): Promise<void> {
  const project =
    (await pickProject(await detection.scanner.scan())) ?? (await detection.scanner.findSingle());
  if (!project) {
    void vscode.window.showWarningMessage('No .uproject to launch.');
    return;
  }

  const engines = await detection.discovery.discover();
  const engine =
    (await pickEngine(engines)) ??
    engines.find((e) => e.path === detection.workspaceContext.getSelectedEngine());
  if (!engine) {
    void vscode.window.showWarningMessage('No Unreal Engine installation selected.');
    return;
  }

  logger.info(`[launchEditor] launching ${engine.path} with ${project.path}`);
  try {
    await launch({
      engineRoot: engine.path,
      platform: config.platform,
      projectPath: project.path,
    });
    void vscode.window.showInformationMessage(`Launched Unreal Editor for ${project.name}`);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Failed to launch editor: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
