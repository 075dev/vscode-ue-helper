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
import { Logger } from '@core/logger';
import type { ClangdHandles } from '@clangd';
import { t } from '@i18n';

export function executeShowClangdProxyStatus(
  _config: unknown,
  logger: Logger,
  clangd: ClangdHandles,
): void {
  logger.info('[showClangdProxyStatus] invoked');
  logger.show();

  const status = clangd.proxyManager.getStatus();

  const lines: string[] = [
    t('proxy.status.title'),
    '',
    t('proxy.status.enabled', { value: status.enabled ? t('common.yes') : t('common.no') }),
    t('proxy.status.active', { value: status.enabled ? t('common.yes') : t('common.no') }),
    t('proxy.status.launcherPath', { value: status.launcherPath }),
    t('proxy.status.realClangdPath', {
      value: status.realClangdPath ?? t('common.autoDetect'),
    }),
    t('proxy.status.keepaliveMax', { value: String(status.keepaliveMax) }),
    t('proxy.status.keepaliveTtlSec', { value: String(status.keepaliveTtlSec) }),
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

  void vscode.window.showInformationMessage(
    t('proxy.status.summary', {
      enabled: status.enabled ? t('common.yes') : t('common.no'),
      active: status.enabled ? t('common.yes') : t('common.no'),
    }),
  );
}
