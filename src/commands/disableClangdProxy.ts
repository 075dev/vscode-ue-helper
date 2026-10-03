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
import {
  okEnvelope,
  errEnvelope,
  EC_CLANGD_NOT_AVAILABLE,
  EC_INTERNAL_ERROR,
  type Envelope,
} from '@core/envelope';

export async function executeDisableClangdProxy(
  config: Config,
  logger: Logger,
  clangd: ClangdHandles,
): Promise<Envelope> {
  logger.info('[disableClangdProxy] invoked');

  const { proxyManager } = clangd;

  try {
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
      // [envelope 对齐] 设置恢复失败映射 CLANGD_NOT_AVAILABLE(枚举内最接近的 clangd 域码,
      // 严格语义为"proxy 设置恢复失败",缺口登记见完成报告)
      return errEnvelope(EC_CLANGD_NOT_AVAILABLE, t('proxy.disable.failed'), {
        phase: 'restore-settings',
      });
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
    // [envelope 对齐] 成功摘要复用现有禁用成功文案;restart 失败不影响 ok 结果(原行为)
    return okEnvelope(undefined, t('proxy.disable.success'));
  } catch (err) {
    // [envelope 对齐] 函数出口 catch:未预期异常统一收口为 EC_INTERNAL_ERROR(任务卡口径 1)
    logger.error('[disableClangdProxy] unexpected error:', err);
    return errEnvelope(EC_INTERNAL_ERROR, t('proxy.disable.failed'), {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}
