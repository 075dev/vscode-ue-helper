/**
 * selectConfig —— 弹 quickPick 选 Build Configuration 并持久化
 *
 * 绑到状态栏的 $(gear) Configuration 按钮。单击切换,不用打开命令面板。
 *
 * [Wave2 契约对齐] 返回契约 envelope(决策 D5):取消 → OPERATION_CANCELLED,
 * 异常出口 → INTERNAL_ERROR,成功 → okEnvelope(data=选中值, summary 复用现有文案)。
 */

import * as vscode from 'vscode';
import { type Config } from '@core/config';
import { type Logger } from '@core/logger';
import {
  okEnvelope,
  errEnvelope,
  EC_OPERATION_CANCELLED,
  EC_INTERNAL_ERROR,
  type Envelope,
} from '@core/envelope';
import { pickConfiguration } from '@ui/quickPicks';
import { t } from '@i18n';

export async function executeSelectConfig(config: Config, logger: Logger): Promise<Envelope<string>> {
  try {
    const picked = await pickConfiguration();
    if (!picked) {
      // 用户取消 QuickPick → 契约取消码(不新增 UI 行为,保持原样静默)
      return errEnvelope(EC_OPERATION_CANCELLED, '已取消选择构建配置 / Build configuration selection cancelled');
    }
    await config.update('configuration', picked);
    logger.info(`[selectConfig] configuration = ${picked}`);
    void vscode.window.showInformationMessage(t('picker.configChanged', { 0: picked }));
    // summary 复用现有用户文案语义
    return okEnvelope(picked, t('picker.configChanged', { 0: picked }));
  } catch (err) {
    // 函数出口兜底:未知错误 → INTERNAL_ERROR
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[selectConfig] unexpected error:', err);
    return errEnvelope(EC_INTERNAL_ERROR, `选择构建配置失败: ${msg}`);
  }
}
