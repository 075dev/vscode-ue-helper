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
    void vscode.window.showWarningMessage('Live Coding is currently Windows-only. Use Rebuild instead.');
    return;
  }

  const projects = await detection.scanner.scan();
  let project = projects.find((p) => p.path === detection.workspaceContext.getSelectedProject());
  if (!project && projects.length === 1) { project = projects[0]; }
  if (!project) { project = await pickProject(projects); }
  if (!project) {
    void vscode.window.showWarningMessage('No .uproject to live-code.');
    return;
  }
  await detection.workspaceContext.setProject(project);

  const engines = await detection.discovery.discover();
  let engine = engines.find((e) => e.path === detection.workspaceContext.getSelectedEngine());
  if (!engine && engines.length === 1) { engine = engines[0]; }
  if (!engine) { engine = await pickEngine(engines); }
  if (!engine) {
    void vscode.window.showWarningMessage('No Unreal Engine installation selected.');
    return;
  }
  await detection.workspaceContext.setEngine(engine);

  logger.info(`[liveCoding] triggering for ${project.name} on ${engine.version}`);
  try {
    await triggerLiveCoding({
      engineRoot: engine.path,
      platform: config.platform,
      projectPath: project.path,
    });
    void vscode.window.showInformationMessage(`Live Coding triggered for ${project.name}`);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Live Coding failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
