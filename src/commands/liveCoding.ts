/**
 * liveCoding —— 实现 vscodeUEHelper.liveCoding
 *
 * 触发 UE Live Coding 热重载。Windows-only,其他平台 warn 后 no-op。
 * 状态栏的 $(zap) Live Coding 按钮绑到这里。
 */

import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import { triggerLiveCoding, isLiveCodingSupported } from '@build';
import { t } from '@i18n';
import { withProgress } from '@ui/notifications';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import { resolveProjectOrPick, resolveEngineOrPick, persistSelection } from '@commands/_resolve';
import {
  okEnvelope,
  errEnvelope,
  EC_BUILD_FAILED,
  EC_INTERNAL_ERROR,
  EC_LIVE_CODING_UNAVAILABLE,
  EC_OPERATION_CANCELLED,
  EC_PROJECT_NOT_DETECTED,
  EC_UBT_NOT_FOUND,
  type Envelope,
} from '@core/envelope';

export async function executeLiveCoding(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
  // [Phase 11 SSoT] silent = true 时跳过 auto-pick / picker，供 MCP tools 调用
  silent: boolean = false,
  // [Wave2 envelope 对齐] 运行时契约:resolve 为 Envelope(D5)——不可用/失败 →
  // errEnvelope(契约全局错误码),成功 → okEnvelope(summary 复用现有文案,data 恒为空)。
  // [Wave3 类型收口] dispatch(src/mcp/tools.ts)形参已放宽为 Promise<unknown>,
  // 声明收紧为精确的 Promise<Envelope<undefined>>(成功路径无 data)。
): Promise<Envelope<undefined>> {
  if (!isLiveCodingSupported(config.platform)) {
    void vscode.window.showWarningMessage(t('liveCoding.windowsOnly'));
    return errEnvelope(EC_LIVE_CODING_UNAVAILABLE, t('liveCoding.windowsOnly'));
  }

  // 选目标 + 触发放在同一 progress 内，避免解析阶段无反馈像"卡住"
  return await withProgress(t('liveCoding.running'), async (report, token): Promise<Envelope<undefined>> => {
    // [Phase 11 SSoT] 选目标逻辑收敛到 @commands/_resolve
    report('Resolving project / engine...');
    const project = await resolveProjectOrPick({
      detection,
      workspace,
      silent,
      warningKey: 'liveCoding.noProject',
    });
    if (!project) {
      return errEnvelope(EC_PROJECT_NOT_DETECTED, t('liveCoding.noProject'));
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

    logger.info(`[liveCoding] triggering for ${project.name} on ${engine.version}`);
    try {
      report('Running UBT Live Coding compile...');
      // Bridge VS Code's CancellationToken to a Web AbortSignal so runBuild
      // can kill the child process when the user clicks Cancel(与 build.ts 同模式)。
      const controller = new AbortController();
      const onCancel = (): void => controller.abort();
      if (token.isCancellationRequested) {
        void onCancel();
      } else {
        token.onCancellationRequested(onCancel);
      }
      const outcome = await triggerLiveCoding(
        {
          engineRoot: engine.path,
          platform: config.platform,
          projectPath: project.path,
          configuration: config.configuration,
          targetType: config.target,
        },
        // UBT 编译可能持续数十秒到几分钟,把进度推给 withProgress 避免"像卡住"
        { signal: controller.signal, onProgress: (chunk) => report(chunk) },
      );
      if (!outcome.ok) {
        void vscode.window.showErrorMessage(t('liveCoding.failed', { 0: outcome.error.message }));
        // 触发失败(Editor 未运行/控制台未连接等)→ 契约 409 语义
        return errEnvelope(
          EC_LIVE_CODING_UNAVAILABLE,
          t('liveCoding.failed', { 0: outcome.error.message }),
        );
      } else if (outcome.value.cancelled) {
        // [F2-1] 用户取消:中性提示,不弹失败警告
        void vscode.window.showInformationMessage(t('cmd.buildCancelled'));
        return errEnvelope(EC_OPERATION_CANCELLED, t('cmd.buildCancelled'));
      } else if (outcome.value.exitCode === 0) {
        void vscode.window.showInformationMessage(t('liveCoding.triggered', { 0: project.name }));
        return okEnvelope(undefined, t('liveCoding.triggered', { 0: project.name }));
      } else {
        // 编译失败:附 UBT 输出尾部几行帮助定位;UBT 退出码非 0 → BUILD_FAILED
        const tail = outcome.value.output.slice(-5).join('\n');
        const detail = `UBT exit ${outcome.value.exitCode}\n${tail}`;
        void vscode.window.showErrorMessage(t('liveCoding.failed', { 0: detail }));
        return errEnvelope(EC_BUILD_FAILED, t('liveCoding.failed', { 0: detail }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(t('liveCoding.failed', { 0: msg }));
      return errEnvelope(EC_INTERNAL_ERROR, msg);
    }
  });
}
