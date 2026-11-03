/**
 * build —— 构建模块入口
 *
 * 把构建层接入插件激活流程,re-export 公共 API 给 commands / MCP 模块消费。
 *
 * 主要导出:
 *   - runBuild: 跑 UBT + 流式输出
 *   - buildUBTCommand: 构造 UBT 命令行
 *   - resolveUBTPath / resolveEditorPath / resolveLiveCodingCmd
 *   - launchEditor: 启动 Unreal Editor
 *   - triggerLiveCoding: 触发 Live Coding 热重载
 */

import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import { UBTTaskProvider, buildTaskArgs } from './taskProvider';

export { UBTTaskProvider, buildTaskArgs };
export { runBuild, type BuildResult_ } from './buildRunner';
export {
  buildUBTCommand,
  resolveUBTPath,
  resolveUBTTarget,
  resolveEditorPath,
  resolveLiveCodingCmd,
} from './ubt';
export { launchEditor, type LaunchOptions } from './launchEditor';
export { triggerLiveCoding, isLiveCodingSupported } from './liveCoding';
export {
  isUnrealEditorRunning,
  shouldSuggestLiveCoding,
  parseTasklistOutput,
  EDITOR_PROCESS_IMAGE_NAMES,
} from './editorDetect';
export {
  rememberBuildSnapshot,
  getLastBuildSnapshot,
  resetLastBuildSnapshot,
  summarizeBuildErrorsForAgent,
  MAX_AGENT_DIAGNOSTICS,
  type LastBuildSnapshot,
  type BuildErrorsSummary,
} from './lastBuild';
export type { UBTArgs, UBTCommand, BuildResult, BuildOptions } from './types';
export type { ParsedDiagnostic } from '@core/types/diagnostic';

export interface BuildHandles {
  taskProvider: UBTTaskProvider;
}

export function activateBuild(
  context: vscode.ExtensionContext,
  config: Config,
  _logger: Logger,
  _detection: DetectionHandles,
  // [D9] WorkspaceState —— TaskProvider 从这里同步取项目/引擎路径,
  // 构造真实 UBT 命令（不再用 placeholder echo）。
  workspace?: WorkspaceState,
): BuildHandles {
  const taskProvider = new UBTTaskProvider(workspace, config);
  context.subscriptions.push(vscode.tasks.registerTaskProvider('ue', taskProvider));
  _logger.info('[build] task provider registered');
  return { taskProvider };
}
