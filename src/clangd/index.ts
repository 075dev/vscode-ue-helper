/**
 * clangd —— 模块入口
 *
 * 把 clangd 层接入插件：compile_commands.json 生成、.clangd 配置、
 * 补全文件系统（curated header）、工作区备份防 UBT 覆盖、
 * completion-mode 状态栏（fast/slow 实际控制 .clangd）。
 *
 * Phase 8 架构：通过 ClangdOps + WorkspaceState 统一 .clangd 操作。
 *
 * 主要导出:
 *   - writeClangdConfig / renderClangdConfig: 写/渲染 .clangd（兼容旧 API）
 *   - generateCompileCommands / linkToWorkspaceRoot: 跑 UBT 生成 compile_commands.json
 *   - createCompletionFiles / addCompletionHelperToCompileCommands: 补全文件系统
 *   - WorkspaceBackup: 备份 .code-workspace 防 UBT 覆盖
 *   - CompletionModeController: fast/slow 模式状态栏（含 .clangd 重写）
 *   - discoverSystemIncludes: 发现 MSVC + Windows SDK 路径
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from './clangdOps';
import type { DetectionHandles } from '@detection';
import { WorkspaceBackup } from './workspaceBackup';
import { CompletionModeController } from './completionMode';
import { ClangdProxyManager } from './proxyManager';
import { registerUeMacroCompletionProvider } from './ueMacroCompletionProvider';
import { perfLog } from './perfLog';
import { PerfStatusBar } from '@ui/perfStatusBar';
import { IncrementalFileWatcher } from './fileWatcher';

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
export { CompletionModeController, type CompletionModeProjectContext, type RewriteResult, type ToggleResult } from './completionMode';
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
export {
  diagnoseProject,
  formatDiagnosticReport,
  type DiagnosticReport,
  type DiagnosticCheck,
  type CheckStatus,
  type CheckSeverity,
  type ReportStatus,
} from './diagnoseProject';
export { startModifyResponseFiles } from './modifyRspFiles';
export { startCreateRspMatchers, type RspMatcher } from './createRspMatchers';
export { registerUeMacroCompletionProvider } from './ueMacroCompletionProvider';

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
  workspace?: WorkspaceState,
  clangdOps?: ClangdOps,
): ClangdHandles {
  const completionMode = new CompletionModeController(config);
  // [Phase 8] 注入 ClangdOps（如可用），让 rewriteClangd 走统一 API
  if (clangdOps) {
    completionMode.setClangdOps(clangdOps);
  }
  const backup = new WorkspaceBackup(detection.scanner['maxResults']?.toString() ?? '');
  // 传 workspace 引用而非 projectDir/engineRoot 快照：activateClangd 同步执行时 detection
  // 尚未 ready，读 workspace.projectDir 会触发 _notifyMissing 永久污染 getter。改成在
  // enable/buildProxyArgs 时动态读（此时 ready 已完成）。
  const proxyManager = new ClangdProxyManager(context, config, logger, {
    workspace,
  });
  const ueMacroCompletionProvider = registerUeMacroCompletionProvider();

  // workspace 参数当前未使用（保留以备后续 stage 使用）
  void workspace;

  // detection.ready 完成后设置 projectPath/engineRoot，确保 toggle/rewrite 能定位 .clangd 写入位置
  // 并能解析 preparse header 中的 $(EngineRoot) 占位符。
  void detection.ready.then((result) => {
    const project = result.projects[0];
    const engine = result.engines[0];
    if (project?.path) {
      completionMode.setProjectContext({
        projectPath: project.path,
        ...(engine?.path ? { engineRoot: engine.path } : {}),
      });
      logger.info('[clangd] projectPath/engineRoot set from detection.ready');
    } else {
      logger.warn('[clangd] no projectPath available: toggle will skip .clangd rewrite');
    }
  });

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
  context.subscriptions.push(ueMacroCompletionProvider);

  // [Phase 7 PLAN A / per D-06] 性能状态栏（尊重 showPerfInStatusBar setting）
  // - 设置为 false 时完全跳过创建（尊重用户选择）
  // - perfLog 始终在内存中记录；状态栏关闭只关 UI 不关数据通路
  if (config.showPerfInStatusBar) {
    const perfBar = new PerfStatusBar();
    context.subscriptions.push(perfBar);
    perfBar.show();
    context.subscriptions.push(
      perfLog.onMetricUpdate((m) => {
        perfBar.update({
          ...(typeof m.genMs === 'number' ? { genMs: m.genMs } : {}),
          ...(typeof m.hitRate === 'number' ? { hitRate: m.hitRate } : {}),
          ...(typeof m.incrMs === 'number' ? { incrMs: m.incrMs } : {}),
        });
      }),
    );
    logger.info('[clangd] perfStatusBar enabled (per D-06)');
  } else {
    logger.info('[clangd] perfStatusBar disabled by setting (perfLog still records)');
  }

  // [Phase 7 PLAN B / per D-15/D-16] 增量扫描（chokidar + 100ms debounce）
  // - 选择 chokidar over VS Code FileSystemWatcher（per CONTEXT §Discretion）：
  //   (a) 项目已有 chokidar ^3.6.0 依赖；
  //   (b) awaitWriteFinish 内置防抖省 30 行手写代码；
  //   (c) UE 5000+ 文件下 Windows 句柄压力可控；
  //   (d) **不主动发送 LSP workspace/didChangeWatchedFiles** — clangd 自己的 watcher 已在工作
  // - vscodeUEHelper.showPerfInStatusBar 关闭时 watcher 仍启动并埋点（per D-06：埋点与 UI 解耦）
  void detection.ready.then((result) => {
    const project = result.projects[0];
    if (!project?.path) {
      logger.warn('[clangd] no projectPath: skip incremental watcher');
      return;
    }
    const projectDir = path.dirname(project.path);
    const watcher = new IncrementalFileWatcher();
    watcher.onBatch = (batch) => {
      // 通知 perfLog（per D-15/D-17）—— 状态栏可订阅 onMetricUpdate 实时刷新
      perfLog.recordIncrementalScan(batch.totalLatencyMs, batch.files.length);
      // 同时落 perfLog.record 通用事件（per D-03，header/source 分级元数据）
      try {
        perfLog.record({
          event: 'incremental.scanComplete',
          elapsedMs: batch.totalLatencyMs,
          meta: {
            headerCount: batch.headerCount,
            sourceCount: batch.sourceCount,
            fileCount: batch.files.length,
          },
        });
      } catch (err) {
        // 失败仅 logger.warn，不阻塞主流程（per T-7-13）
        logger.warn(
          `[perf] incremental scan record failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };
    const handle = watcher.start({
      patterns: [
        path.join(projectDir, 'Source', '**', '*.{h,hpp,inl,cpp}'),
        path.join(projectDir, 'Plugins', '**', 'Source', '**', '*.{h,hpp,inl,cpp}'),
      ],
      debounceMs: 100,
    });
    context.subscriptions.push(handle);
    logger.info(`[clangd] incremental watcher started for: ${projectDir}`);
  });

  // TODO Phase 4: replace the WorkspaceBackup constructor argument with a real
  // projectPath sourced from the detection layer (after the user picks one).
  // For Phase 3 we just register the contract.

  logger.info('[clangd] activated (status bar + perf ready)');
  return { completionMode, backup, proxyManager };
}
