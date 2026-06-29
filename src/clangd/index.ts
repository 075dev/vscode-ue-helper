/**
 * clangd —— 模块入口
 *
 * 把 clangd 层接入插件：compile_commands.json 生成、.clangd 配置、
 * 补全文件系统（curated header）、工作区备份防 UBT 覆盖、
 * completion-mode 状态栏（fast/slow 实际控制 .clangd）。
 *
 * 主要导出:
 *   - writeClangdConfig / renderClangdConfig: 写/渲染 .clangd
 *   - generateCompileCommands / linkToWorkspaceRoot: 跑 UBT 生成 compile_commands.json
 *   - createCompletionFiles / addCompletionHelperToCompileCommands: 补全文件系统
 *   - WorkspaceBackup: 备份 .code-workspace 防 UBT 覆盖
 *   - CompletionModeController: fast/slow 模式状态栏（含 .clangd 重写）
 *   - discoverSystemIncludes: 发现 MSVC + Windows SDK 路径
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import { WorkspaceBackup } from './workspaceBackup';
import { CompletionModeController } from './completionMode';
import { ClangdProxyManager } from './proxyManager';

export {
  writeClangdConfig,
  defaultClangdConfig,
  renderClangdConfig,
  replaceSystemIncludeBlock,
  findClangdConfig,
  SYSTEM_INCLUDE_FILTER_PREFIXES,
  type ClangdConfigOptions,
} from './clangdConfig';
export { generateCompileCommands, linkToWorkspaceRoot, isClangdAvailable, fillMissingCompileCommands } from './compileCommands';
export {
  createCompletionFiles,
  addCompletionHelperToCompileCommands,
  getMacroCompletionHelperPath,
  getCompletionHelperPath,
  FILENAME_COMPLETION_HELPER,
  FILENAME_DEFAULT_COMP,
  FILENAME_ADD_COMPLETIONS,
  FILENAME_MACRO_COMP_HELPER,
  FILENAME_ADD_MACRO_COMPLETIONS,
  populateAddCompletions,
  findUhtGeneratedHeaders,
  parseExistingIncludes,
  type PopulateOptions,
  type PopulateResult,
} from './completionFiles';
export {
  loadBundledList,
  mergeUserCustomizations,
  getPrepareIncludesList,
  toIncludeFlags,
} from './preparseIncludes';
export { WorkspaceBackup } from './workspaceBackup';
export { CompletionModeController } from './completionMode';
export {
  discoverSystemIncludes,
  listMsvcVersions,
  listSdkVersions,
  renderClangdFlags,
  type SystemIncludeInfo,
} from './windowsSdk';
export {
  FILENAME_UE_CLANGD_COMPAT,
  getUeClangdCompatDir,
  getUeClangdCompatPath,
  getUeClangdCompatContent,
} from './ueClangdCompat';
export type { CompletionMode, CompileCommandsEntry, ClangdConfig } from './types';
export { startModifyResponseFiles } from './modifyRspFiles';
export { startCreateRspMatchers, type RspMatcher } from './createRspMatchers';

export interface ClangdHandles {
  completionMode: CompletionModeController;
  backup: WorkspaceBackup;
  proxyManager: ClangdProxyManager;
}

export function activateClangd(
  context: vscode.ExtensionContext,
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
): ClangdHandles {
  const completionMode = new CompletionModeController(config);
  const backup = new WorkspaceBackup(detection.scanner['maxResults']?.toString() ?? '');
  const proxyManager = new ClangdProxyManager(context, config, logger);

  // Render the status bar item and listen for config changes.
  completionMode.show();
  context.subscriptions.push(
    config.onDidChange((e) => {
      if (e.affectsConfiguration('vscodeUEHelper.completionMode')) {
        completionMode.refresh();
        // .clangd 重写由 toggle() 方法内部处理，这里只刷新 UI
      }
    }),
  );
  context.subscriptions.push({ dispose: () => completionMode.dispose() });

  // TODO Phase 4: replace the WorkspaceBackup constructor argument with a real
  // projectPath sourced from the detection layer (after the user picks one).
  // For Phase 3 we just register the contract.

  logger.info('[clangd] activated (status bar ready)');
  return { completionMode, backup, proxyManager };
}
