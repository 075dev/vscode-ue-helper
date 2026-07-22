/**
 * selectConfig —— 弹 quickPick 选 Build Configuration 并持久化
 *
 * 绑到状态栏的 $(gear) Configuration 按钮。单击切换,不用打开命令面板。
 */

import * as vscode from 'vscode';
import { Config } from '@core/config';
import { Logger } from '@core/logger';
import { pickConfiguration } from '@ui/quickPicks';
import { t } from '@i18n';

export async function executeSelectConfig(config: Config, logger: Logger): Promise<void> {
  const picked = await pickConfiguration();
  if (!picked) {
    return;
  }
  await config.update('configuration', picked);
  logger.info(`[selectConfig] configuration = ${picked}`);
  void vscode.window.showInformationMessage(t('picker.configChanged', { 0: picked }));
}
