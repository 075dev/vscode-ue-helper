/**
 * showProjectInfo —— 显示当前检测状态
 *
 * 把项目、引擎、配置、MCP、日志级别等信息写到 Output 面板,
 * 用户首次激活或者诊断问题时调用。
 *
 * 0 引擎分支:仅依据 `vscode.workspace.workspaceFile` 区分两种引导——
 * 打开了 .code-workspace 时提示「打开 workspace」,未打开时统一提示
 * 用户从 .uproject 创建 .code-workspace（不调用任何 OS 扫描）。
 */

import * as vscode from 'vscode';
import { Config } from '@core/config';
import { Logger } from '@core/logger';
import { detectHost } from '@core/runtime-detect';
import type { DetectionHandles } from '@detection';
import { t } from '@i18n';

export async function showProjectInfo(
  config: Config,
  logger: Logger,
  detection?: DetectionHandles,
): Promise<void> {
  logger.info('showProjectInfo invoked');
  logger.show();

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const workspace = workspaceFolders.length > 0 ? workspaceFolders[0]?.uri.fsPath : '(none)';

  if (!detection) {
    logger.warn('showProjectInfo: detection handles unavailable');
    return;
  }

  const { projects, engines, workspaceFile } = await detection.ready;

  const selectedProject =
    projects.length > 0
      ? projects.find((p) => p.path === detection.workspaceContext.getSelectedProject())
      : undefined;
  const selectedEngine =
    engines.length > 0
      ? engines.find((e) => e.path === detection.workspaceContext.getSelectedEngine())
      : undefined;
  const mcpHost = detectHost();

  const lines = [
    t('showInfo.title'),
    '',
    t('showInfo.workspace', { path: String(workspace) }),
    t('showInfo.projectsFound', { count: String(projects.length) }),
    ...projects.slice(0, 5).map((p, i) =>
      t('showInfo.projectLine', {
        index: String(i + 1),
        name: p.name,
        selected: selectedProject?.path === p.path ? t('showInfo.selected') : '',
      }),
    ),
    ...(projects.length > 5 ? [t('showInfo.andMore', { count: String(projects.length - 5) })] : []),
    '',
    t('showInfo.enginesFound', {
      count: String(engines.length === 0 ? t('showInfo.enginesFoundEmpty') : engines.length),
    }),
    ...engines.slice(0, 5).map((e, i) =>
      t('showInfo.projectLine', {
        index: String(i + 1),
        name: `UE ${e.version}`,
        selected: selectedEngine?.path === e.path ? t('showInfo.selected') : '',
      }),
    ),
    ...(engines.length > 5 ? [t('showInfo.andMore', { count: String(engines.length - 5) })] : []),
    '',
    t('showInfo.configuration', { value: config.configuration }),
    t('showInfo.target', { value: config.target }),
    t('showInfo.platform', { value: config.platform }),
    t('showInfo.engineRoot'),
    t('showInfo.clangdPath', {
      value: config.clangdPath ?? t('showInfo.clangdPathEmpty'),
    }),
    t('showInfo.completionMode', { value: config.completionMode }),
    t('showInfo.mcpMode', { value: config.useMCP }),
    t('showInfo.mcpHost', {
      value: mcpHost ?? t('showInfo.mcpHostNone'),
    }),
    t('showInfo.logLevel', { value: config.lspLoggingLevel }),
  ];

  logger.info(lines.join('\n'));

  // 0 engines — branch on whether .code-workspace is open (信任 detection.ready 的 workspaceFile)
  if (engines.length === 0) {
    const hasWorkspaceFile = !!workspaceFile;

    if (hasWorkspaceFile) {
      const choice = await vscode.window.showWarningMessage(
        t('showInfo.noEnginesWithWs', {
          project: projects[0]?.name ?? '(none)',
          workspace: String(workspace),
        }),
        t('showInfo.btn.openWs'),
      );
      if (choice === t('showInfo.btn.openWs')) {
        await vscode.commands.executeCommand('vscodeUEHelper.openWorkspaceFile');
      }
      logger.show();
      return;
    }

    // 未打开 .code-workspace：准则要求不调 OS 扫描，统一提示用户从 .uproject
    // 手动创建 .code-workspace（与 WorkspaceState 缺失提示一致）。
    void vscode.window.showWarningMessage(t('showInfo.noEnginesNoWsWithUE'));
    logger.show();
    return;
  }

  const summary = lines.slice(0, 8).join('\n');
  const choice = await vscode.window.showInformationMessage(
    summary,
    t('showInfo.openOutput'),
  );
  if (choice === t('showInfo.openOutput')) {
    logger.show();
  }
}
