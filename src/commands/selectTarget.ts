/**
 * selectTarget —— 弹 quickPick 选 Target 类型并持久化
 *
 * 绑到状态栏的 $(symbol-class) Target 按钮。Editor/Game/Server/Client 四选一。
 * 实际 UBT target 名(XianDreamwalkingEditor)在 build 时由 resolveUBTTarget 转换。
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
import { pickTarget } from '@ui/quickPicks';
import { t } from '@i18n';

export async function executeSelectTarget(config: Config, logger: Logger): Promise<Envelope<string>> {
  try {
    const picked = await pickTarget();
    if (!picked) {
      // 用户取消 QuickPick → 契约取消码(不新增 UI 行为,保持原样静默)
      return errEnvelope(EC_OPERATION_CANCELLED, '已取消选择构建目标 / Build target selection cancelled');
    }
    await config.update('target', picked);
    logger.info(`[selectTarget] target = ${picked}`);
    void vscode.window.showInformationMessage(t('picker.targetChanged', { 0: picked }));
    // summary 复用现有用户文案语义
    return okEnvelope(picked, t('picker.targetChanged', { 0: picked }));
  } catch (err) {
    // 函数出口兜底:未知错误 → INTERNAL_ERROR
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[selectTarget] unexpected error:', err);
    return errEnvelope(EC_INTERNAL_ERROR, `选择构建目标失败: ${msg}`);
  }
}
