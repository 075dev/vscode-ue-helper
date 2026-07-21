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
import { t } from '@i18n';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import { resolveProjectOrPick, resolveEngineOrPick, persistSelection } from '@commands/_resolve';

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

  // [Phase 11 SSoT] 选目标逻辑收敛到 @commands/_resolve
  const project = await resolveProjectOrPick({
    detection,
    workspace,
    warningKey: 'liveCoding.noProject',
  });
  if (!project) {return;}
  await persistSelection(workspace, detection, project, undefined);

  const engine = await resolveEngineOrPick({
    detection,
    workspace,
    warningKey: 'cmd.noEngineSelected',
  });
  if (!engine) {return;}
  await persistSelection(workspace, detection, undefined, engine);

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
