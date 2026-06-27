/**
 * liveCoding —— 实现 vscodeUEHelper.liveCoding
 *
 * 触发 UE Live Coding 热重载。Windows-only,其他平台 warn 后 no-op。
 * 状态栏的 $(zap) Live Coding 按钮绑到这里。
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import { triggerLiveCoding, isLiveCodingSupported } from '@build';
import { pickProject, pickEngine } from '@ui/quickPicks';
import type { DetectionHandles } from '@detection';

export async function executeLiveCoding(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
): Promise<void> {
  if (!isLiveCodingSupported(config.platform)) {
    vscode.window.showWarningMessage('Live Coding is currently Windows-only. Use Rebuild instead.');
    return;
  }

  const project =
    (await pickProject(await detection.scanner.scan())) ?? (await detection.scanner.findSingle());
  if (!project) {
    vscode.window.showWarningMessage('No .uproject to live-code.');
    return;
  }

  const engines = await detection.discovery.discover();
  const engine =
    (await pickEngine(engines)) ??
    engines.find((e) => e.path === detection.workspaceContext.getSelectedEngine());
  if (!engine) {
    vscode.window.showWarningMessage('No Unreal Engine installation selected.');
    return;
  }

  logger.info(`[liveCoding] triggering for ${project.name} on ${engine.version}`);
  try {
    await triggerLiveCoding({
      engineRoot: engine.path,
      platform: config.platform,
      projectPath: project.path,
    });
    vscode.window.showInformationMessage(`Live Coding triggered for ${project.name}`);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Live Coding failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
