/**
 * showProjectInfo —— 显示当前检测状态
 *
 * 把项目、引擎、配置、MCP、日志级别等信息写到 Output 面板,
 * 用户首次激活或者诊断问题时调用。
 *
 * 0 引擎分支:根据 .code-workspace 是否存在 + 系统是否关联 .uproject,
 * 给用户三种引导:打开 .code-workspace / 重新生成 / 下载 UE。
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { Config } from '@core/config';
import { Logger } from '@core/logger';
import { detectHost } from '@mcp/lifecycle';
import type { DetectionHandles } from '@detection';
import { checkUprojectAssociation } from '@detection/uprojectAssociation';
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

  let projects: Array<{ path: string; name: string }> = [];
  let engines: Array<{ path: string; version: string }> = [];
  if (detection) {
    try {
      projects = await detection.scanner.scan();
      engines = await detection.discovery.discover();
    } catch (err) {
      logger.warn('Detection failed in showProjectInfo:', err);
    }
  }

  const selectedProject =
    detection && projects.length > 0
      ? projects.find((p) => p.path === detection.workspaceContext.getSelectedProject())
      : undefined;
  const selectedEngine =
    detection && engines.length > 0
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

  // 0 engines — branch on whether .code-workspace exists.
  if (engines.length === 0) {
    let hasWorkspaceFile = false;
    for (const folder of workspaceFolders) {
      try {
        const entries = await fs.readdir(folder.uri.fsPath);
        if (entries.some((e) => e.endsWith('.code-workspace'))) {
          hasWorkspaceFile = true;
          break;
        }
      } catch {
        // skip
      }
    }

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

    logger.info('[showProjectInfo] no .code-workspace — checking OS .uproject association');
    const hasUE = await checkUprojectAssociation();
    if (!hasUE) {
      const choice = await vscode.window.showWarningMessage(
        t('showInfo.noEnginesNoWsNoUE', { project: projects[0]?.name ?? '(none)' }),
        t('showInfo.btn.downloadUE'),
      );
      if (choice === t('showInfo.btn.downloadUE')) {
        await vscode.env.openExternal(vscode.Uri.parse('https://www.unrealengine.com/download'));
      }
      logger.show();
      return;
    }

    // [Phase 8] 不再提供"重新生成工作区"按钮——该命令会覆盖用户已有的
    // .code-workspace 设置（settings / extensions 推荐块等），是导致用户
    // 工作区文件被改错的根源。改为弹一次通知，提示用户从 .uproject
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
