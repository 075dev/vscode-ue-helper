/**
 * showClangdProxyStatus —— 显示 Clangd LSP Proxy 当前状态
 *
 * 输出到 Output 面板的信息：
 * - 启用状态（enabled / disabled）
 * - launcher 路径
 * - 真实 clangd 路径（来自配置）
 * - keepalive 默认值（max / ttl）
 * - 日志路径
 * - 备份是否存在
 * - 是否激活（clangd.path 指向 launcher）
 *
 * 设计原则：
 * - 只读，不修改任何设置
 * - 通过 proxyManager 和 config 获取状态
 * - 输出到 logger（Output 面板）和信息消息
 */

import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import type { ClangdHandles } from '@clangd';
import { t } from '@i18n';
import { okEnvelope, errEnvelope, EC_INTERNAL_ERROR, type Envelope } from '@core/envelope';

export function executeShowClangdProxyStatus(
  _config: unknown,
  logger: Logger,
  clangd: ClangdHandles,
): Envelope {
  logger.info('[showClangdProxyStatus] invoked');

  // [envelope 对齐] 只读命令,正常路径恒成功;函数出口 catch 把未预期异常统一收口为
  // EC_INTERNAL_ERROR(任务卡口径 1),日志/弹窗行为保持原样。
  try {
    logger.show();

    const status = clangd.proxyManager.getStatus();

    const lines: string[] = [
      t('proxy.status.title'),
      '',
      t('proxy.status.enabled', { value: status.enabled ? t('common.yes') : t('common.no') }),
      t('proxy.status.active', { value: status.active ? t('common.yes') : t('common.no') }),
      t('proxy.status.launcherPath', { value: status.launcherPath }),
      t('proxy.status.realClangdPath', {
        value: status.realClangdPath ?? t('common.autoDetect'),
      }),
      t('proxy.status.keepaliveMax', { value: String(status.keepaliveMax) }),
      t('proxy.status.keepaliveTtlSec', { value: String(status.keepaliveTtlSec) }),
      t('proxy.status.localizationEnabled', {
        value: status.localizationEnabled ? t('common.yes') : t('common.no'),
      }),
      ...(status.localizationEnabled
        ? [
            t('proxy.status.localizationDetail', {
              mode: status.localizationMode,
            }),
          ]
        : []),
      t('proxy.status.logPath', {
        value: status.logPath ?? t('common.notSet'),
      }),
      t('proxy.status.backupExists', {
        value: status.backupExists ? t('common.yes') : t('common.no'),
      }),
    ];

    // 如果有 lastKnownProblem，追加一行
    if (status.lastKnownProblem) {
      lines.push('');
      lines.push(`[!] ${status.lastKnownProblem}`);
    }

    const output = lines.join('\n');
    logger.info(output);

    const summary = t('proxy.status.summary', {
      enabled: status.enabled ? t('common.yes') : t('common.no'),
      active: status.active ? t('common.yes') : t('common.no'),
    });

    void vscode.window.showInformationMessage(summary);

    // [envelope 对齐] 摘要复用现有状态弹窗文案(已本地化,契约 summary 要求)
    return okEnvelope(undefined, summary);
  } catch (err) {
    logger.error('[showClangdProxyStatus] unexpected error:', err);
    return errEnvelope(EC_INTERNAL_ERROR, t('proxy.status.title'), {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}
