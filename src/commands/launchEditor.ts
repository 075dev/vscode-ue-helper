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
import { t } from '@i18n';
import type { DetectionHandles } from '@detection';

export async function executeLaunchEditor(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
): Promise<void> {
  // 先用 workspaceContext 缓存命中 —— 避免每次点 Launch 都弹 picker
  const projects = await detection.scanner.scan();
  let project = projects.find((p) => p.path === detection.workspaceContext.getSelectedProject());
  if (!project && projects.length === 1) { project = projects[0]; }
  if (!project) { project = await pickProject(projects); }
  if (!project) {
    void vscode.window.showWarningMessage(t('launchEditor.noProject'));
    return;
  }
  await detection.workspaceContext.setProject(project);

  const engines = await detection.discovery.discover();
  let engine = engines.find((e) => e.path === detection.workspaceContext.getSelectedEngine());
  if (!engine && engines.length === 1) { engine = engines[0]; }
  if (!engine) { engine = await pickEngine(engines); }
  if (!engine) {
    void vscode.window.showWarningMessage(t('cmd.noEngineSelected'));
    return;
  }
  await detection.workspaceContext.setEngine(engine);

  logger.info(`[launchEditor] launching ${engine.path} with ${project.path}`);
  try {
    await launch({
      engineRoot: engine.path,
      platform: config.platform,
      projectPath: project.path,
    });
    void vscode.window.showInformationMessage(t('launchEditor.launched', { 0: project.name }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(t('launchEditor.failed', { 0: msg }));
  }
}
