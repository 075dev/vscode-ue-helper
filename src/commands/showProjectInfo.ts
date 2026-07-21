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
import type { WorkspaceState } from '@core/workspace';
import { t } from '@i18n';
import type { ProjectInfo, EngineInstall } from '@detection/types';

export async function showProjectInfo(
  config: Config,
  logger: Logger,
  detection?: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方留 fallback；production 走 workspace
  workspace?: WorkspaceState,
  // [Phase 11 SSoT] silent = true 时跳过 information/warning 弹窗（MCP 工具调用场景）
  silent: boolean = false,
): Promise<void> {
  logger.info('showProjectInfo invoked');
  logger.show();

  // [Phase 9 SSoT] 优先 workspace.workspaceRoot，回退 workspace.workspaceFolders[0]；保留 '(none)' 显示语义
  const workspaceFolders = workspace?.workspaceFolders ?? [];
  const workspaceRootDisplay =
    workspace?.workspaceRoot ??
    (workspaceFolders.length > 0 ? workspaceFolders[0]?.absPath : undefined) ??
    '(none)';

  if (!detection) {
    logger.warn('showProjectInfo: detection handles unavailable');
    return;
  }

  const { projects, engines, workspaceFile } = await detection.ready;

  // [Phase 9 SSoT] 收敛 selected* 访问
  const selectedProject = projects.length > 0
    ? (workspace?.resolveSelectedProject(projects) ?? ((): ProjectInfo | undefined => {
        const sp = detection.workspaceContext.getSelectedProject();
        return sp ? projects.find((p) => p.path === sp) : undefined;
      })())
    : undefined;
  const selectedEngine = engines.length > 0
    ? (workspace?.resolveSelectedEngine(engines) ?? ((): EngineInstall | undefined => {
        const se = detection.workspaceContext.getSelectedEngine();
        return se ? engines.find((e) => e.path === se) : undefined;
      })())
    : undefined;
  const mcpHost = detectHost();

  const lines = [
    t('showInfo.title'),
    '',
    t('showInfo.workspace', { path: String(workspaceRootDisplay) }),
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
          workspace: String(workspaceRootDisplay),
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
    // [Phase 11 SSoT] silent = true 时 (MCP 工具调用) 不弹模态 warning,直接 logger 输出。
    if (!silent) {
      void vscode.window.showWarningMessage(t('showInfo.noEnginesNoWsWithUE'));
    }
    logger.show();
    return;
  }

  const summary = lines.slice(0, 8).join('\n');
  // [Phase 11 SSoT] silent = true 时 (MCP 工具调用) 不弹 information modal。
  const choice = silent
    ? undefined
    : await vscode.window.showInformationMessage(
        summary,
        t('showInfo.openOutput'),
      );
  if (choice === t('showInfo.openOutput')) {
    logger.show();
  }
}
