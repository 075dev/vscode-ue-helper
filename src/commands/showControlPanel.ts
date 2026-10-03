/**
 * showControlPanel —— 聚焦侧边栏控制面板
 *
 * [Wave2 契约对齐] 返回契约 envelope(决策 D5):成功 → okEnvelope(纯 UI 命令,
 * 无结构化结果,summary 复用"打开控制面板"语义);异常出口 → INTERNAL_ERROR。
 */

import {
  okEnvelope,
  errEnvelope,
  EC_INTERNAL_ERROR,
  type Envelope,
} from '@core/envelope';
import { ControlPanelProvider } from '@ui/controlPanel';

export function executeShowControlPanel(): Envelope {
  try {
    ControlPanelProvider.show();
    return okEnvelope(undefined, '控制面板已打开 / Control panel opened');
  } catch (err) {
    // 函数出口兜底:未知错误 → INTERNAL_ERROR
    const msg = err instanceof Error ? err.message : String(err);
    return errEnvelope(EC_INTERNAL_ERROR, `打开控制面板失败: ${msg}`);
  }
}
