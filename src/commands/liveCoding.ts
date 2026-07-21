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
import { t } from '@i18n';
import type { DetectionHandles } from '@detection';
import type { ProjectInfo, EngineInstall } from '@detection/types';
import type { WorkspaceState } from '@core/workspace';

export async function executeLiveCoding(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
): Promise<void> {
  if (!isLiveCodingSupported(config.platform)) {
    void vscode.window.showWarningMessage(t('liveCoding.windowsOnly'));
    return;
  }

  // [Phase 9 SSoT] 收敛 selected* 访问（production 走 workspace.resolveSelected*，legacy fallback 仅供老调用方/test）
  function legacyFindProject(): ProjectInfo | undefined {
    const sp = detection.workspaceContext.getSelectedProject();
    return sp ? projects.find((p) => p.path === sp) : undefined;
  }
  function legacyFindEngine(): EngineInstall | undefined {
    const se = detection.workspaceContext.getSelectedEngine();
    return se ? engines.find((e) => e.path === se) : undefined;
  }

  const { projects } = await detection.ready;
  let project = workspace?.resolveSelectedProject(projects) ?? legacyFindProject();
  if (!project && projects.length === 1) { project = projects[0]; }
  if (!project) { project = await pickProject(projects); }
  if (!project) {
    void vscode.window.showWarningMessage(t('liveCoding.noProject'));
    return;
  }
  await (workspace ? workspace.setSelectedProject(project) : detection.workspaceContext.setProject(project));

  const engines = await detection.discovery.discover();
  let engine = workspace?.resolveSelectedEngine(engines) ?? legacyFindEngine();
  if (!engine && engines.length === 1) { engine = engines[0]; }
  if (!engine) { engine = await pickEngine(engines); }
  if (!engine) {
    void vscode.window.showWarningMessage(t('cmd.noEngineSelected'));
    return;
  }
  await (workspace ? workspace.setSelectedEngine(engine) : detection.workspaceContext.setEngine(engine));

  logger.info(`[liveCoding] triggering for ${project.name} on ${engine.version}`);
  try {
    await triggerLiveCoding({
      engineRoot: engine.path,
      platform: config.platform,
      projectPath: project.path,
    });
    void vscode.window.showInformationMessage(t('liveCoding.triggered', { 0: project.name }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(t('liveCoding.failed', { 0: msg }));
  }
}
