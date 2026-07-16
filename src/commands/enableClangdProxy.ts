/**
 * enableClangdProxy -- 启用 Clangd LSP Proxy
 *
 * 流程：
 *   1. 已激活（clangd.path 已指向 launcher）则 reapply 最新参数
 *   2. 否则：写 clangdProxy.enabled=true + proxyManager.enable() 备份并写入 launcher 设置
 *   3. 仅 enable 本身失败才回滚 enabled=false；后续 reload/restart 失败不影响 enable 状态
 *   4. 成功后优先提示 Reload Window（改 clangd.path 后最可靠），次选 Restart clangd（仅扩展已激活时）
 *
 * 关键修复（解决"多次 reload 才生效"循环）：
 * - clangd.restart 调用移出 enable 的 try 块，失败不回滚 enabled（历史 bug：restart 失败误 rollback
 *   导致 clangd.path=launcher 已写但 enabled=false，状态不一致，需反复 reload/再点才收敛）
 * - 改 clangd.path 后 vscode-clangd 的 restart 可能不重读 path，故优先建议 Reload Window
 * - clangd 扩展按 onLanguage:cpp 激活，未激活时 clangd.restart 命令不存在，检测后不提供该按钮
 *
 * 设计原则：
 * - 只写 workspace 级别设置，不污染全局
 * - 委托 proxyManager 处理设置备份/写入（含事务性回滚）
 * - 不直接操作 clangd 配置
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import type { ClangdHandles } from '@clangd';
import { t } from '@i18n';

const CLANGD_EXTENSION_ID = 'llvm-vs-code-extensions.vscode-clangd';

/** clangd 扩展是否已激活（未激活时 clangd.restart 命令未注册，调用会抛错） */
function isClangdExtensionActive(): boolean {
  const ext = vscode.extensions.getExtension(CLANGD_EXTENSION_ID);
  return !!ext?.isActive;
}

/**
 * enable 成功后提示用户重新加载。
 * 优先 Reload Window（改 clangd.path 后最可靠）；clangd 扩展已激活时次选 Restart clangd。
 * reload/restart 失败不影响已成功的 enable 状态。
 */
async function promptReload(logger: Logger): Promise<void> {
  const reloadBtn = t('proxy.enable.reloadWindow');
  const restartBtn = isClangdExtensionActive() ? t('proxy.enable.restartClangd') : undefined;

  const choice = restartBtn
    ? await vscode.window.showInformationMessage(t('proxy.enable.success'), reloadBtn, restartBtn)
    : await vscode.window.showInformationMessage(t('proxy.enable.success'), reloadBtn);

  if (choice === reloadBtn) {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
    return;
  }
  if (restartBtn && choice === restartBtn) {
    // clangd.restart 单独 try-catch：失败仅 warn，不回滚 enable 状态（配置已成功写入）
    try {
      await vscode.commands.executeCommand('clangd.restart');
    } catch (err) {
      logger.warn('[enableClangdProxy] clangd.restart failed, please reload window manually:', err);
    }
  }
}

export async function executeEnableClangdProxy(
  config: Config,
  logger: Logger,
  clangd: ClangdHandles,
  opts?: { suppressReloadPrompt?: boolean },
): Promise<void> {
  logger.info('[enableClangdProxy] invoked');

  const { proxyManager } = clangd;

  // 已激活（clangd.path 已指向 launcher）：重新应用最新参数（localization 等配置可能已变更）
  if (proxyManager.isActive) {
    logger.info('[enableClangdProxy] already active, reapplying args with latest config');
    try {
      await proxyManager.reapply();
    } catch (err) {
      logger.error('[enableClangdProxy] reapply failed:', err);
      void vscode.window.showErrorMessage(t('proxy.enable.failed'));
      return;
    }
    if (!opts?.suppressReloadPrompt) {
      await promptReload(logger);
    }
    return;
  }

  // 首次启用：写 enabled=true + 备份并写入 launcher 设置
  try {
    // proxyManager.enable() 会读取 Config.enabled；首次启用需先写 workspace 配置。
    await config.update('clangdProxy.enabled', true);
    await proxyManager.enable();
    logger.info('[enableClangdProxy] proxy enabled successfully');
  } catch (err) {
    // 仅 enable 本身失败才回滚 enabled=false
    // （proxyManager.enable 内部已事务回滚 clangd 配置，不会留半截）
    logger.error('[enableClangdProxy] failed:', err);
    try {
      await config.update('clangdProxy.enabled', false);
    } catch (rollbackErr) {
      logger.error('[enableClangdProxy] rollback failed:', rollbackErr);
    }
    void vscode.window.showErrorMessage(t('proxy.enable.failed'));
    return;
  }

  // enable 已成功，reload/restart 失败不影响 enable 状态
  if (!opts?.suppressReloadPrompt) {
    await promptReload(logger);
  }
}
