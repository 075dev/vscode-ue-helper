/**
 * openProjectExplorerFile —— 项目目录树触发的文件打开命令。
 */

import * as vscode from 'vscode';
import type { Logger } from '@core/logger';
import { t } from '@i18n';

export function executeOpenProjectExplorerFile(uri: vscode.Uri | undefined, logger?: Logger): void {
  if (!uri) {
    logger?.warn('[projectExplorer] 收到空的 uri，无法打开文件');
    return;
  }
  const result = vscode.commands.executeCommand('vscode.open', uri) as
    | Thenable<unknown>
    | undefined;
  if (result && typeof (result as { then?: unknown }).then === 'function') {
    void Promise.resolve(result).then(
      () => undefined,
      (error: unknown) => {
        logger?.error(
          `[projectExplorer] ${t('projectExplorer.openFailed', { error: String(error) })}`,
        );
      },
    );
  }
}
