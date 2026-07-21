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
import { t } from '@i18n';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import { resolveProjectOrPick, resolveEngineOrPick, persistSelection } from '@commands/_resolve';

export async function executeLaunchEditor(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
  // [Phase 11 SSoT] silent = true 时跳过 auto-pick / picker，供 MCP tools 调用
  silent: boolean = false,
): Promise<void> {
  // [Phase 11 SSoT] 选目标逻辑收敛到 @commands/_resolve
  const project = await resolveProjectOrPick({
    detection,
    workspace,
    silent,
    warningKey: 'launchEditor.noProject',
  });
  if (!project) {return;}
  await persistSelection(workspace, detection, project, undefined);

  const engine = await resolveEngineOrPick({
    detection,
    workspace,
    silent,
    warningKey: 'cmd.noEngineSelected',
  });
  if (!engine) {return;}
  await persistSelection(workspace, detection, undefined, engine);

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
