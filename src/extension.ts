/**
 * VSCodeUEHelper —— 插件入口文件
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import { activateDetection } from '@detection';
import { activateBuild } from '@build';
import { activateClangd } from '@clangd';
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
    const build = activateBuild(context, config, logger, detection);
    const clangd = activateClangd(context, config, logger, detection);
    const ui = activateUI(context, config, logger, detection);
    activateCommands(context, config, logger, detection, clangd);

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
