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
import type { ProjectInfo, EngineInstall } from '@detection/types';
import type { WorkspaceState } from '@core/workspace';

export async function executeLaunchEditor(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
): Promise<void> {
  // [Phase 9 SSoT] 收敛 selected* 访问
  function legacyFindProject(): ProjectInfo | undefined {
    const sp = detection.workspaceContext.getSelectedProject();
    return sp ? projects.find((p) => p.path === sp) : undefined;
  }
  function legacyFindEngine(): EngineInstall | undefined {
    const se = detection.workspaceContext.getSelectedEngine();
    return se ? engines.find((e) => e.path === se) : undefined;
  }

  // 先用 selection 缓存命中 —— 避免每次点 Launch 都弹 picker
  const { projects } = await detection.ready;
  let project = workspace?.resolveSelectedProject(projects) ?? legacyFindProject();
  if (!project && projects.length === 1) { project = projects[0]; }
  if (!project) { project = await pickProject(projects); }
  if (!project) {
    void vscode.window.showWarningMessage(t('launchEditor.noProject'));
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
