/**
 * refreshProjectExplorer —— 手动刷新项目目录树。
 */

import type { ProjectExplorerProvider } from '@ui/projectExplorer';

export function executeRefreshProjectExplorer(provider: ProjectExplorerProvider): void {
  provider.refresh();
}
