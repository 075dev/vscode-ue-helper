/**
 * commands —— 模块入口
 *
 * 把 package.json manifest 里的每个命令绑到实现。从 extension.ts 在激活时调用。
 *
 * 注册的命令(vscodeUEHelper.*):
 *   - build / rebuild / clean
 *   - launchEditor / liveCoding
 *   - generateCompileCommands / createProject
 *   - toggleCompletionMode / showProjectInfo
 *   - setSystemIncludes / installRules / uninstall
 *   - openWorkspaceFile / regenerateWorkspace
 *   - selectConfig / selectTarget
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import { registerCommand } from '@core/command-registry';
import type { DetectionHandles } from '@detection';
import type { ClangdHandles } from '@clangd';
import { showProjectInfo } from '@commands/showProjectInfo';
import { executeBuild } from './build';
import { executeLaunchEditor } from './launchEditor';
import { executeLiveCoding } from './liveCoding';
import { executeGenerateCompileCommands } from './generateCompileCommands';
import { executeToggleCompletionMode } from './toggleCompletionMode';
import { executeCreateProject } from './createProject';
import { executeInstallRules } from './installRules';
import { executeUninstall } from './uninstall';
import { executeSetSystemIncludes } from './setSystemIncludes';
import { executeOpenWorkspaceFile } from './openWorkspaceFile';
import { executeRegenerateWorkspace } from './regenerateWorkspace';
import { executeSelectConfig } from './selectConfig';
import { executeSelectTarget } from './selectTarget';

export function activateCommands(
  context: vscode.ExtensionContext,
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  clangd: ClangdHandles,
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
    executeGenerateCompileCommands(logger, detection),
  );
  registerCommand(context, 'vscodeUEHelper.toggleCompletionMode', () =>
    executeToggleCompletionMode(logger, clangd),
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
  registerCommand(context, 'vscodeUEHelper.regenerateWorkspace', () =>
    executeRegenerateWorkspace(logger),
  );
  registerCommand(context, 'vscodeUEHelper.selectConfig', () =>
    executeSelectConfig(config, logger),
  );
  registerCommand(context, 'vscodeUEHelper.selectTarget', () =>
    executeSelectTarget(config, logger),
  );
  logger.info(`[commands] registered 16 commands`);
}
