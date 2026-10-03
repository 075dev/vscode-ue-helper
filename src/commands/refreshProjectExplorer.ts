/**
 * refreshProjectExplorer —— 手动刷新项目目录树。
 */

import type { ProjectExplorerProvider } from '@ui/projectExplorer';
import { okEnvelope, type Envelope } from '@core/envelope';

export function executeRefreshProjectExplorer(provider: ProjectExplorerProvider): Envelope {
  provider.refresh();
  // [契约对齐] 纯 UI 命令:无结构化结果,返回 summary(C6 从宽:中文文案待填充阶段接 i18n)
  return okEnvelope(undefined, '已刷新项目目录树');
}
