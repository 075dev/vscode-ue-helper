/**
 * VSCodeUEHelper —— 插件入口文件
 *
 * Phase 8 架构：单一真相源 WorkspaceState 在 detection.ready 后注入，
 * 通过 ClangdOps 暴露给需要 .clangd 操作的模块（暂未集成到各模块激活流程，
 * 保留旧 API 作为过渡，后续 PR 逐步迁移调用方）。
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import { WorkspaceState } from '@core/workspace';
import { ClangdOps } from '@clangd/clangdOps';
import { activateDetection } from '@detection';
import { activateBuild } from '@build';
import { activateClangd } from '@clangd';
import { startHeaderWatcher } from '@clangd/headerWatcher';
import { activateUI } from '@ui';
import { activateCommands } from '@commands';
import { showProjectInfo } from '@commands/showProjectInfo';
import { initI18n, t } from '@i18n';
import { ControlPanelProvider } from '@ui/controlPanel';

let logger: Logger;
const disposables: vscode.Disposable[] = [];

export function activate(context: vscode.ExtensionContext): Promise<void> {
  initI18n();
  logger = new Logger('VSCodeUEHelper');
  const config = new Config();
  const activationStart = Date.now();
  logger.info('Activating VSCodeUEHelper...');

  try {
    const detection = activateDetection(context, config, logger);

    // [Phase 8 架构] WorkspaceState 单一真相源
    // 构造时自动订阅 detection.ready 并 setResult。所有模块通过 workspace getter 访问
    // 项目/引擎/路径信息，统一派生路径 get 函数 + 去重错误通知。
    const workspace = new WorkspaceState({ detection, logger });

    // [Phase 8 架构] ClangdOps 统一 .clangd 操作 API（mutate / setAddFlag / replaceAddBlock）
    const clangdOps = new ClangdOps({ workspace, logger });

    // 旧模块激活流程（保持兼容，后续 PR 逐步迁移到接受 workspace 参数）
    const build = activateBuild(context, config, logger, detection);
    // [Phase 8 Stage 1] 注入 ClangdOps 给 activateClangd，让 CompletionModeController 走统一 API
    const clangd = activateClangd(context, config, logger, detection, workspace, clangdOps);
    // [Phase 8] UE 反射头保存自动同步 watcher（D-14：在 activateClangd 之后注册，确保 WorkspaceState 已就绪）
    startHeaderWatcher(context, config, logger, workspace);
    const ui = activateUI(context, config, logger, detection);
    activateCommands(context, config, logger, detection, clangd, workspace);

    // workspace + clangdOps 暂时挂在 disposables 防止被 GC，后续 PR 接入
    disposables.push(workspace as unknown as vscode.Disposable);
    disposables.push(clangdOps as unknown as vscode.Disposable);

    ControlPanelProvider.register({ context, config, logger, detection, clangd });

    const elapsed = Date.now() - activationStart;
    logger.info(`VSCodeUEHelper activated in ${elapsed}ms`);

    void build;
    void ui;

    const hasShownWelcome = context.globalState.get<boolean>('vscodeUEHelper.welcomed');
    if (!hasShownWelcome) {
      void vscode.window.showInformationMessage(t('ui.welcome.real'), 'Open').then((choice) => {
        if (choice === 'Open') {
          void showProjectInfo(config, logger, detection);
        }
      });
      void context.globalState.update('vscodeUEHelper.welcomed', true);
    }
  } catch (err) {
    logger.error('Activation failed:', err);
    void vscode.window.showErrorMessage(
      `VSCodeUEHelper failed to activate: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return Promise.resolve();
}

export function deactivate(): void {
  logger?.info('Deactivating VSCodeUEHelper...');
  while (disposables.length) {
    const d = disposables.pop();
    try { d?.dispose(); } catch { /* ignore */ }
  }
}
