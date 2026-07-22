/**
 * commands —— 模块入口
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
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
import { executeSelectConfig } from './selectConfig';
import { executeSelectTarget } from './selectTarget';
import { executeEnableClangdProxy } from './enableClangdProxy';
import { executeDisableClangdProxy } from './disableClangdProxy';
import { executeShowClangdProxyStatus } from './showClangdProxyStatus';
import { executeDiagnoseProject } from './diagnoseProject';
import { executeShowControlPanel } from './showControlPanel';
import { executeRefreshProjectExplorer } from './refreshProjectExplorer';
import { executeOpenProjectExplorerFile } from './openProjectExplorerFile';
import type { ProjectExplorerProvider } from '@ui/projectExplorer';

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
): void {
  // [Plan D] 把 Config 注入 CompletionModeController，让 rewriteClangd 能读 userAddFlags
  if (clangd?.completionMode && typeof clangd.completionMode.setConfig === 'function') {
    clangd.completionMode.setConfig(config);
  }
  // 用本地计数器替代硬编码 20,避免后续增删命令时日志与实际不一致
  let commandCount = 0;
  const track = (label: string, fn: (...args: unknown[]) => unknown): void => {
    commandCount += 1;
    registerCommand(context, label, fn);
  };
  track('vscodeUEHelper.showProjectInfo', () =>
    showProjectInfo(config, logger, detection, workspace),
  );
  track('vscodeUEHelper.build', () => executeBuild('build', config, logger, detection, workspace));
  track('vscodeUEHelper.rebuild', () =>
    executeBuild('rebuild', config, logger, detection, workspace),
  );
  track('vscodeUEHelper.clean', () => executeBuild('clean', config, logger, detection, workspace));
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
