/**
 * selectTarget —— 弹 quickPick 选 Target 类型并持久化
 *
 * 绑到状态栏的 $(symbol-class) Target 按钮。Editor/Game/Server/Client 四选一。
 * 实际 UBT target 名(XianDreamwalkingEditor)在 build 时由 resolveUBTTarget 转换。
 */

import * as vscode from 'vscode';
import { Config } from '@core/config';
import { Logger } from '@core/logger';
import { pickTarget } from '@ui/quickPicks';
import { t } from '@i18n';

export async function executeSelectTarget(config: Config, logger: Logger): Promise<void> {
  const picked = await pickTarget();
  if (!picked) {
    return;
  }
  await config.update('target', picked);
  logger.info(`[selectTarget] target = ${picked}`);
  void vscode.window.showInformationMessage(t('picker.targetChanged', { 0: picked }));
}
