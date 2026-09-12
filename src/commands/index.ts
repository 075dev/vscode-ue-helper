/**
 * commands —— 模块入口
 */

import type * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import { registerCommand } from '@core/command-registry';
import type { WorkspaceState } from '@core/workspace';
import type { DetectionHandles } from '@detection';
import type { ClangdHandles } from '@clangd';
import type { ClangdOps } from '@clangd/clangdOps';
import { showProjectInfo } from '@commands/showProjectInfo';
import { executeBuild } from './build';
import { executeLaunchEditor } from './launchEditor';
import { executeLiveCoding } from './liveCoding';
import { executeGenerateCompileCommands } from './generateCompileCommands';
import { executeCreateProject } from './createProject';
import { executeInstallRules } from './installRules';
import { executeUninstall } from './uninstall';
import { executeSetSystemIncludes } from './setSystemIncludes';
import { executeOpenWorkspaceFile } from './openWorkspaceFile';
import { executeOpenTerminalInNewWindow } from './openTerminalInNewWindow';
import { executeSelectConfig } from './selectConfig';
import { executeSelectTarget } from './selectTarget';
import { executeEnableClangdProxy } from './enableClangdProxy';
import { executeDisableClangdProxy } from './disableClangdProxy';
import { executeShowClangdProxyStatus } from './showClangdProxyStatus';
import { executeDiagnoseProject } from './diagnoseProject';
import { executeShowControlPanel } from './showControlPanel';
import { executeRefreshProjectExplorer } from './refreshProjectExplorer';
import { executeOpenProjectExplorerFile } from './openProjectExplorerFile';
import { executeNoLint } from './noLint';
import { executeCopyBuildCommand } from './copyBuildCommand';
import type { ProjectExplorerProvider } from '@ui/projectExplorer';
import type { StatusBarManager } from '@ui/statusBar';
import { runFirstTimeInit, type FirstRunInitDeps } from './firstRunInit';

export function activateCommands(
  context: vscode.ExtensionContext,
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  clangd: ClangdHandles,
  // [Phase 8 + Plan Add 收束] workspace 与 clangdOps 一并向下游命令透传
  workspace?: WorkspaceState,
  clangdOps?: ClangdOps,
  projectExplorer?: ProjectExplorerProvider,
  // [F2-14/W16] 状态栏构建反馈接线；未注入时 executeBuild 仅走 withProgress
  statusBar?: StatusBarManager,
): void {
  // 用本地计数器替代硬编码 20,避免后续增删命令时日志与实际不一致
  let commandCount = 0;
  const track = (label: string, fn: (...args: unknown[]) => unknown): void => {
    commandCount += 1;
    registerCommand(context, label, fn);
  };
  track('vscodeUEHelper.showProjectInfo', () =>
    showProjectInfo(config, logger, detection, workspace),
  );
  track('vscodeUEHelper.build', () =>
    executeBuild('build', config, logger, detection, workspace, false, statusBar),
  );
  track('vscodeUEHelper.rebuild', () =>
    executeBuild('rebuild', config, logger, detection, workspace, false, statusBar),
  );
  track('vscodeUEHelper.clean', () =>
    executeBuild('clean', config, logger, detection, workspace, false, statusBar),
  );
  track('vscodeUEHelper.launchEditor', () =>
    executeLaunchEditor(config, logger, detection, workspace),
  );
  track('vscodeUEHelper.liveCoding', () => executeLiveCoding(config, logger, detection, workspace));
  track('vscodeUEHelper.generateCompileCommands', () =>
    executeGenerateCompileCommands(config, logger, detection, workspace),
  );
  track('vscodeUEHelper.diagnoseProject', () =>
    executeDiagnoseProject(logger, detection, workspace, clangdOps),
  );
  track('vscodeUEHelper.createProject', () =>
    executeCreateProject(config, logger, detection, clangdOps, workspace),
  );
  track('vscodeUEHelper.installRules', () => executeInstallRules(logger, workspace));
  track('vscodeUEHelper.uninstall', () => executeUninstall(logger, workspace));
  track('vscodeUEHelper.setSystemIncludes', () =>
    executeSetSystemIncludes(config, logger, detection, workspace, clangdOps),
  );
  track('vscodeUEHelper.openWorkspaceFile', () => executeOpenWorkspaceFile(workspace));
  track('vscodeUEHelper.openTerminalInNewWindow', (uri) =>
    executeOpenTerminalInNewWindow(uri as vscode.Uri | undefined, logger),
  );
  track('vscodeUEHelper.selectConfig', () => executeSelectConfig(config, logger));
  track('vscodeUEHelper.selectTarget', () => executeSelectTarget(config, logger));
  track('vscodeUEHelper.enableClangdProxy', () => executeEnableClangdProxy(config, logger, clangd));
  track('vscodeUEHelper.disableClangdProxy', () =>
    executeDisableClangdProxy(config, logger, clangd),
  );
  track('vscodeUEHelper.showClangdProxyStatus', () =>
    executeShowClangdProxyStatus(config, logger, clangd),
  );
  track('vscodeUEHelper.showControlPanel', () => executeShowControlPanel());
  // [借鉴 vscode-boreal] 复制当前选中项目/引擎/配置对应的 UBT 命令行,排查构建问题时
  // 可在任意终端手动复现
  track('vscodeUEHelper.copyBuildCommand', () =>
    executeCopyBuildCommand(config, logger, detection, workspace),
  );
  // [借鉴 boocs/unreal-clangd] clang-tidy 行级屏蔽(vscode.TextEditor 作为首参透传)
  track('vscodeUEHelper.noLintCurrentLine', (editor) =>
    executeNoLint('current', editor as vscode.TextEditor | undefined, logger),
  );
  track('vscodeUEHelper.noLintNextLine', (editor) =>
    executeNoLint('next', editor as vscode.TextEditor | undefined, logger),
  );
  // [bug-fix] 重试首次初始化:失败弹窗的 "重试" 按钮 + 用户手动命令面板触发。
  // 复用同一套 deps(全 ready),无需再走 activation 起点。
  if (workspace) {
    const retryDeps: FirstRunInitDeps = {
      context,
      config,
      logger,
      detection,
      clangd,
      workspace,
      clangdOps,
    };
    track('vscodeUEHelper.retryFirstTimeInit', () =>
      runFirstTimeInit(retryDeps, context).catch((err: unknown) =>
        logger.error('[firstRunInit] retry unexpected error:', err),
      ),
    );
  }
  if (projectExplorer) {
    track('vscodeUEHelper.refreshProjectExplorer', () =>
      executeRefreshProjectExplorer(projectExplorer),
    );
    track('vscodeUEHelper.openProjectExplorerFile', (uri) =>
      executeOpenProjectExplorerFile(uri as vscode.Uri | undefined, logger),
    );
  }
  logger.info(`[commands] registered ${commandCount} commands`);
}
