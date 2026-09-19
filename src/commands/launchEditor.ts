/**
 * launchEditor —— 实现 vscodeUEHelper.launchEditor
 *
 * 调用 detection 拿项目和引擎,然后用 @build/launchEditor 启动 Unreal Editor。
 * 状态栏的 $(rocket) Launch 按钮绑到这个命令。
 */

import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import { launchEditor as launch } from '@build';
import { t } from '@i18n';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import { resolveProjectOrPick, resolveEngineOrPick, persistSelection } from '@commands/_resolve';
import {
  okEnvelope,
  errEnvelope,
  EC_INTERNAL_ERROR,
  EC_PROJECT_NOT_DETECTED,
  EC_UBT_NOT_FOUND,
} from '@core/envelope';

export async function executeLaunchEditor(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
  // [Phase 11 SSoT] silent = true 时跳过 auto-pick / picker，供 MCP tools 调用
  silent: boolean = false,
  // [Wave2 envelope 对齐] 运行时契约:resolve 为 Envelope(D5)——未找到 .uproject →
  // PROJECT_NOT_DETECTED(契约 404),成功 → okEnvelope(summary 复用现有文案)。
  // 声明用 Promise<any> 而非 Promise<Envelope>:MCP 层 dispatch(src/mcp/tools.ts,
  // 本任务边界外)参数锁定 Promise<void>,Promise<Envelope> 对其不可赋值(TS2322);
  // dispatch 放宽为 Promise<unknown> 后应收紧回 Promise<Envelope>。
): Promise<any> {
  // [Phase 11 SSoT] 选目标逻辑收敛到 @commands/_resolve
  const project = await resolveProjectOrPick({
    detection,
    workspace,
    silent,
    warningKey: 'launchEditor.noProject',
  });
  if (!project) {
    return errEnvelope(EC_PROJECT_NOT_DETECTED, t('launchEditor.noProject'));
  }
  await persistSelection(workspace, detection, project, undefined);

  const engine = await resolveEngineOrPick({
    detection,
    workspace,
    silent,
    warningKey: 'cmd.noEngineSelected',
  });
  if (!engine) {
    return errEnvelope(EC_UBT_NOT_FOUND, t('cmd.noEngineSelected'));
  }
  await persistSelection(workspace, detection, undefined, engine);

  logger.info(`[launchEditor] launching ${engine.path} with ${project.path}`);
  try {
    await launch({
      engineRoot: engine.path,
      platform: config.platform,
      projectPath: project.path,
    });
    void vscode.window.showInformationMessage(t('launchEditor.launched', { 0: project.name }));
    return okEnvelope(undefined, t('launchEditor.launched', { 0: project.name }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(t('launchEditor.failed', { 0: msg }));
    return errEnvelope(EC_INTERNAL_ERROR, msg);
  }
}
