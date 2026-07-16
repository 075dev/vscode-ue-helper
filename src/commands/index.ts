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

export function activateCommands(
  context: vscode.ExtensionContext,
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  clangd: ClangdHandles,
  // [Phase 8] workspace 当前未直接使用，保留以便后续命令迁移时透传
  _workspace?: WorkspaceState,
): void {
  registerCommand(context, 'vscodeUEHelper.showProjectInfo', () =>
    showProjectInfo(config, logger, detection),
  );
  registerCommand(context, 'vscodeUEHelper.build', () =>
    executeBuild('build', config, logger, detection),
  );
  registerCommand(context, 'vscodeUEHelper.rebuild', () =>
    executeBuild('rebuild', config, logger, detection),
  );
  registerCommand(context, 'vscodeUEHelper.clean', () =>
    executeBuild('clean', config, logger, detection),
  );
  registerCommand(context, 'vscodeUEHelper.launchEditor', () =>
    executeLaunchEditor(config, logger, detection),
  );
  registerCommand(context, 'vscodeUEHelper.liveCoding', () =>
    executeLiveCoding(config, logger, detection),
  );
  registerCommand(context, 'vscodeUEHelper.generateCompileCommands', () =>
    executeGenerateCompileCommands(config, logger, detection),
  );
  registerCommand(context, 'vscodeUEHelper.diagnoseProject', () =>
    executeDiagnoseProject(logger, detection),
  );
  registerCommand(context, 'vscodeUEHelper.createProject', () =>
    executeCreateProject(config, logger, detection),
  );
  registerCommand(context, 'vscodeUEHelper.installRules', () =>
    executeInstallRules(logger, detection),
  );
  registerCommand(context, 'vscodeUEHelper.uninstall', () => executeUninstall(logger, detection));
  registerCommand(context, 'vscodeUEHelper.setSystemIncludes', () =>
    executeSetSystemIncludes(config, logger, detection),
  );
  registerCommand(context, 'vscodeUEHelper.openWorkspaceFile', () => executeOpenWorkspaceFile());
  registerCommand(context, 'vscodeUEHelper.selectConfig', () =>
    executeSelectConfig(config, logger),
  );
  registerCommand(context, 'vscodeUEHelper.selectTarget', () =>
    executeSelectTarget(config, logger),
  );
  registerCommand(context, 'vscodeUEHelper.enableClangdProxy', () =>
    executeEnableClangdProxy(config, logger, clangd),
  );
  registerCommand(context, 'vscodeUEHelper.disableClangdProxy', () =>
    executeDisableClangdProxy(config, logger, clangd),
  );
  registerCommand(context, 'vscodeUEHelper.showClangdProxyStatus', () =>
    executeShowClangdProxyStatus(config, logger, clangd),
  );
  registerCommand(context, 'vscodeUEHelper.showControlPanel', () =>
    executeShowControlPanel(),
  );
  logger.info(`[commands] registered 20 commands`);
}
