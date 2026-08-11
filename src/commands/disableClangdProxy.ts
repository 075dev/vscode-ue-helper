/**
 * disableClangdProxy —— 禁用 Clangd LSP Proxy
 *
 * 流程：
 *   1. 调用 proxyManager.disable() 恢复原始 clangd 设置
 *   2. 设置 vscodeUEHelper.clangdProxy.enabled = false（workspace 级别）
 *   3. 无备份时显示警告但不抛出异常
 *   4. 建议重启 clangd
 *
 * 设计原则：
 * - 只写 workspace 级别设置
 * - 委托 proxyManager 处理设置恢复
 * - 无备份时不抛出异常，仅显示警告
 * - clangd.restart 单独 try-catch（对照 enableClangdProxy）：clangd 扩展未激活时该命令
 *   不存在会 reject，此时设置已成功恢复，restart 失败仅 warn，不影响"禁用成功"结果
 */

import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import type { ClangdHandles } from '@clangd';
import { t } from '@i18n';

export async function executeDisableClangdProxy(
  config: Config,
  logger: Logger,
  clangd: ClangdHandles,
): Promise<void> {
  logger.info('[disableClangdProxy] invoked');

  const { proxyManager } = clangd;

  try {
    // 调用 proxyManager.disable() —— 恢复原始设置（内部处理无备份警告）
    await proxyManager.disable();

    // 设置配置项
    await config.update('clangdProxy.enabled', false);

    logger.info('[disableClangdProxy] proxy disabled, settings restored');
  } catch (err) {
    // 仅"设置恢复"本身失败才弹失败提示
    logger.error('[disableClangdProxy] failed:', err);
    void vscode.window.showErrorMessage(t('proxy.disable.failed'));
    return;
  }

  // clangd.restart 移出主 try 块：clangd 扩展未激活时该命令未注册会 reject，
  // 此时设置已成功恢复，restart 失败仅 warn，不影响"禁用成功"收尾。
  const choice = await vscode.window.showInformationMessage(
    t('proxy.disable.success'),
    t('proxy.disable.restartClangd'),
  );
  if (choice === t('proxy.disable.restartClangd')) {
    try {
      await vscode.commands.executeCommand('clangd.restart');
    } catch (err) {
      logger.warn('[disableClangdProxy] clangd.restart failed, please restart clangd manually:', err);
    }
  }
}
