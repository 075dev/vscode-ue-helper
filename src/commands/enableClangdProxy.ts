/**
 * enableClangdProxy —— 启用 Clangd LSP Proxy
 *
 * 流程：
 *   1. 检查是否已激活（已激活则跳过）
 *   2. 先设置 vscodeUEHelper.clangdProxy.enabled = true（workspace 级别）
 *   3. 调用 proxyManager.enable() 备份原始 clangd 设置并写入 launcher 设置
 *   4. 任一步失败则回滚 enabled=false，避免留下半启用状态
 *   5. 显示成功消息并建议重启 clangd
 *
 * 设计原则：
 * - 只写 workspace 级别设置，不污染全局
 * - 委托 proxyManager 处理设置备份/写入
 * - 不直接操作 clangd 配置
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import type { ClangdHandles } from '@clangd';
import { t } from '@i18n';

export async function executeEnableClangdProxy(
  config: Config,
  logger: Logger,
  clangd: ClangdHandles,
): Promise<void> {
  logger.info('[enableClangdProxy] invoked');

  const { proxyManager } = clangd;

  // 检查是否已启用
  if (proxyManager.isActive) {
    void vscode.window.showInformationMessage(t('proxy.enable.alreadyEnabled'));
    logger.info('[enableClangdProxy] already active, skipping');
    return;
  }

  try {
    // proxyManager.enable() 会读取 Config.enabled；首次启用需先写 workspace 配置。
    await config.update('clangdProxy.enabled', true);

    // 调用 proxyManager.enable() —— 备份原始设置并写入 launcher
    await proxyManager.enable();

    logger.info('[enableClangdProxy] proxy enabled successfully');

    // 显示成功消息并建议重启 clangd
    const choice = await vscode.window.showInformationMessage(
      t('proxy.enable.success'),
      t('proxy.enable.restartClangd'),
    );
    if (choice === t('proxy.enable.restartClangd')) {
      await vscode.commands.executeCommand('clangd.restart');
    }
  } catch (err) {
    logger.error('[enableClangdProxy] failed:', err);
    try {
      await config.update('clangdProxy.enabled', false);
    } catch (rollbackErr) {
      logger.error('[enableClangdProxy] rollback failed:', rollbackErr);
    }
    void vscode.window.showErrorMessage(t('proxy.enable.failed'));
  }
}
