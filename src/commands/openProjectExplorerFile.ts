/**
 * openProjectExplorerFile —— 项目目录树触发的文件打开命令。
 */

import * as vscode from 'vscode';
import type { Logger } from '@core/logger';
import { okEnvelope, errEnvelope, EC_INTERNAL_ERROR, type Envelope } from '@core/envelope';
import { t } from '@i18n';

export function executeOpenProjectExplorerFile(
  uri: vscode.Uri | undefined,
  logger?: Logger,
): Envelope {
  if (!uri) {
    logger?.warn('[projectExplorer] 收到空的 uri，无法打开文件');
    // [契约对齐] 空 uri 属调用异常,9 项枚举无贴切码 → 兜底 INTERNAL_ERROR(完成报告登记缺口)
    return errEnvelope(EC_INTERNAL_ERROR, t('projectExplorer.openFailed', { error: 'empty uri' }));
  }
  const result = vscode.commands.executeCommand('vscode.open', uri) as
    Thenable<unknown> | undefined;
  if (result && typeof (result as { then?: unknown }).then === 'function') {
    void Promise.resolve(result).then(
      () => undefined,
      (error: unknown) => {
        logger?.error(
          `[projectExplorer] ${t('projectExplorer.openFailed', { error: String(error) })}`,
        );
      },
    );
  }
  // [契约对齐] fire-and-forget 打开:命令本身成功即 ok(打开失败仅 logger,保持现状)
  return okEnvelope(undefined, '已打开文件');
}
