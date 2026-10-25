/**
 * clangd —— 模块入口
 *
 * 把 clangd 层接入插件：compile_commands.json 生成、.clangd 配置、
 * 补全文件系统（curated header）、工作区备份防 UBT 覆盖、
 * completion-mode 状态栏（fast/slow 实际控制 .clangd）。
 *
 * Phase 8 架构 + Phase 9 SSoT：通过 ClangdOps + WorkspaceState 统一 .clangd 操作
 * 与项目/引擎信息访问；过期直写 API（writeClangdConfig / findClangdConfig）已删除。
 *
 * 主要导出:
 *   - renderClangdConfig: 渲染 .clangd YAML（仅产出文本，fs 由 ClangdOps 统一）
 *   - generateCompileCommands / linkToWorkspaceRoot: 跑 UBT 生成 compile_commands.json
 *   - createCompletionFiles / addCompletionHelperToCompileCommands: 补全文件系统
 *   - WorkspaceBackup: 备份 .code-workspace 防 UBT 覆盖
 *   - CompletionModeController: fast/slow 模式状态栏（含 .clangd 重写）
 *   - discoverSystemIncludes: 发现 MSVC + Windows SDK 路径
 */

import type * as vscode from 'vscode';
import * as path from 'node:path';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from './clangdOps';
import type { DetectionHandles } from '@detection';
import { CompletionModeController } from './completionMode';
import { ClangdProxyManager } from './proxyManager';
// [H1] 保存 .h 后自动触发 UHT codegen
import { UeLinkManager } from './ueLinkManager';
import { registerUeMacroCompletionProvider } from './ueMacroCompletionProvider';
import { registerUeReflectionLinter } from './ueReflectionLinter';
// [D5] 「哪些配置变更要重写 .clangd」的单一真相源 —— 与本文件下方的 re-export 同源
import { shouldRewriteClangd } from './clangdFlagRenderer';
import { perfLog } from './perfLog';
import { PerfStatusBar } from '@ui/perfStatusBar';
import { IncrementalFileWatcher } from './fileWatcher';
// [借鉴 boocs/unreal-clangd] 新增源文件时提示刷新 compile_commands.json
import { CompileCommandsRefreshHint } from './compileCommandsHint';

// [Phase 9 SSoT] clangd 模块内部允许 import 自己的 clangdConfig（仅产出 config 对象 + YAML 字符串，无 fs 副作用）
// eslint-disable-next-line no-restricted-imports
export { defaultClangdConfig, renderClangdConfig, type ClangdConfigOptions } from './clangdConfig';
export {
  resolveFlags,
  getGlossaryForWebview,
  DEFAULT_FLAG_GLOSSARY,
  findFlagEntry,
  type FlagCategory,
  type FlagSeverity,
  type FlagEntry,
  type WireFlagEntry,
  type ResolveContext,
} from './flagGlossary';
export {
  generateCompileCommands,
  linkToWorkspaceRoot,
  locateCompileCommands,
  isClangdAvailable,
  fillMissingCompileCommands,
  type FillResult,
} from './compileCommands';
// [D14] DB 读写原语 + 纯计算的「补齐缺失条目」
export {
  readCompileCommands,
  writeCompileCommandsAtomic,
  resolveCompileCommandsWriteTarget,
  type CompileCommandEntry,
} from './compileCommands/dbFile';
export { computeMissingEntries } from './compileCommands/fillMissing';
export {
  generateFallbackCompileCommands,
  type FallbackOptions,
  type FallbackResult,
} from './compileCommandsFallback';
export {
  collectIntermediateUhtDirs,
  type IntermediateUhtCollectorOptions,
} from './intermediateUhtCollector';
export {
  runUhtCodegen,
  type UhtResult,
  type RunUhtCodegenOptions,
  type MinimalLogger,
} from './uhtGeneration';
export {
  createCompletionFiles,
  addCompletionHelperToCompileCommands,
  buildCompletionHelperEntry,
  getMacroCompletionHelperPath,
  getCompletionHelperPath,
  FILENAME_COMPLETION_HELPER,
  FILENAME_DEFAULT_COMP,
  FILENAME_ADD_COMPLETIONS,
  FILENAME_MACRO_COMP_HELPER,
  FILENAME_ADD_MACRO_COMPLETIONS,
} from './completionFiles';
export {
  loadBundledList,
  mergeUserCustomizations,
  getPrepareIncludesList,
  toIncludeFlags,
} from './preparseIncludes';
export { WorkspaceBackup } from './workspaceBackup';
export {
  CompletionModeController,
  type CompletionModeProjectContext,
  type RewriteResult,
} from './completionMode';
export {
  discoverSystemIncludes,
  listMsvcVersions,
  listSdkVersions,
  renderClangdFlags,
  readMsvcVersion,
  type SystemIncludeInfo,
} from './windowsSdk';
// [D5] .clangd Add 的统一渲染 + 写入入口
export {
  renderClangdAddFlags,
  collectClangdFlagContext,
  writeClangdAddFlags,
  CLANGD_REWRITE_CONFIG_KEYS,
  shouldRewriteClangd,
  type ClangdFlagRenderContext,
  type ClangdFlagWriterDeps,
  type ConfigurationChangeLike,
} from './clangdFlagRenderer';
// [D3] .clangd 多文档 YAML 原语
export {
  parseClangdDocs,
  mergeConfigIntoDoc,
  renderClangdDocs,
  type ParsedClangdDocs,
} from './clangdYaml';
export {
  FILENAME_UE_CLANGD_COMPAT,
  getUeClangdCompatDir,
  getUeClangdCompatPath,
  getUeClangdCompatContent,
} from './ueClangdCompat';
// T2.1：CompletionMode 已收敛为字面 'slow'，不再对外暴露类型别名。
//       历史调用者改用字面量 'slow' 或 `string` 即可。
export type { CompileCommandsEntry, ClangdConfig } from './types';
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
export { registerUeReflectionLinter } from './ueReflectionLinter';
// [借鉴 boocs/unreal-clangd] createProject 可选脚手架:.clang-format / .clang-tidy
export {
  scaffoldClangFormatAndTidy,
  CLANG_FORMAT_TEMPLATE,
  CLANG_TIDY_TEMPLATE,
  type ScaffoldFormatTidyResult,
  type FileScaffoldResult,
} from './formatTidyFiles';
// [H1] 保存 .h 后自动触发 UHT codegen：mtime 跳过 + 5s 节流 + 状态栏反馈
export {
  UeLinkManager,
  type UeLinkManagerOptions,
  type UeLinkSnapshot,
  type UeLinkState,
} from './ueLinkManager';

export interface ClangdHandles {
  completionMode: CompletionModeController;
  proxyManager: ClangdProxyManager;
  /** [H1] 保存 .h 后自动 UHT codegen 入口。undefined 表示未激活。 */
  ueLink?: UeLinkManager;
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
  // 传 workspace 引用而非 projectDir/engineRoot 快照：activateClangd 同步执行时 detection
  // 尚未 ready，读 workspace.projectDir 会触发 _notifyMissing 永久污染 getter。改成在
  // enable/buildProxyArgs 时动态读（此时 ready 已完成）。
  const proxyManager = new ClangdProxyManager(context, config, logger, {
    workspace,
  });

  // [H1] 保存 .h 后自动触发 UHT codegen：mtime 跳过 + 5s 节流 + 状态栏反馈
  // 实测：在 XianDreamwalking（10206 文件）下，UHT 子进程本身要 3-4s，
  // 大头是 dotnet + UnrealBuildTool.dll 启动 + 10206 文件 hash 校验。
  // Rider 通过 IPC 复用 UE Editor 进程内嵌 UHT 跳过这个开销——我们做不到。
  // 本文实现的加速全部来自"避免不必要地跑 UHT"：
  //   - mtime 跳过：保存但内容/时间未变 → 0ms
  //   - 内容预过滤：.h 不含反射宏 → 0ms
  //   - 5s 节流：连续保存合并成 1 次
  //   - 状态栏 `$(sync~spin) UHT…` 让用户知道在等而不是卡住
  // [H1] ueLink 仅在 workspace 注入时启用 —— 无 workspace 是单元测试场景,
  // 不应依赖 detection.ready 状态。生产路径（src/extension.ts）必传 workspace。
  let ueLink: UeLinkManager | undefined;
  if (workspace) {
    ueLink = new UeLinkManager({ config, logger, workspace });
    context.subscriptions.push(ueLink);
    // 跟随 detection.ready 状态:project/engine 准备好后才接受保存事件;
    // 未检测到 UE 项目时状态项隐身(与其他插件状态项一致)
    void detection.ready.then((result) => {
      ueLink?.setVisible(result.projects.length > 0);
      logger.info(
        `[H1] ueLinkManager armed, listening for onDidSaveTextDocument (projects=${result.projects.length})`,
      );
    });
  }

  // [状态自愈] reload 后可能出现 isActive(clangd.path=launcher)但 enabled=false 的不一致状态
  // （历史 enable 因 clangd.restart 失败被误 rollback 留下）。clangd.path 已指向 launcher，
  // 说明代理本就该启用，自动修正 enabled=true，避免状态显示混乱与 reapply 判定异常。
  if (proxyManager.isActive && !proxyManager.enabled) {
    logger.warn('[clangd] detected isActive=true but enabled=false, self-healing enabled=true');
    void config.update('clangdProxy.enabled', true).catch((err) => {
      logger.warn('[clangd] self-heal enabled=true failed:', err);
    });
  }

  // [deactivate 清理] ClangdProxyManager 实现 vscode.Disposable:
  // extension 卸载时若 proxy 仍激活,自动恢复 clangd.path 备份。
  // 必须 push 到 subscriptions,VS Code 才会调 dispose()。
  context.subscriptions.push(proxyManager);

  const ueMacroCompletionProvider = registerUeMacroCompletionProvider();
  // P2-2: UE 反射诊断 linter（UCLASS 缺 GENERATED_BODY / 前缀违规 / UFUNCTION 多 RPC）
  const ueReflectionLinter = registerUeReflectionLinter();

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

  // Plan B: 状态栏按钮已删除（toggle 完成模式 → 命令面板项移除），CompletionModeController
  //        现在仅承载 rewriteClangd() 用于首次激活/refresh。
  context.subscriptions.push(ueMacroCompletionProvider);
  context.subscriptions.push(ueReflectionLinter);

  // [D5] 配置变更 → 重写 .clangd
  //
  // rewriteClangd 此前是**零生产调用点的死函数**，所以「用户直接改
  // settings.json 里的 clangd.userAddFlags 后 .clangd 不跟着变」一直没被发现。
  // 现在把它接到 config.onDidChange 上：配置一变就用统一入口重写 .clangd。
  //
  // 控制面板的保存路径也会触发这条链路（面板先 config.update 再写 .clangd），
  // 两次写入内容相同，ClangdOps 侧有「内容未变则不重写」的判定，不会产生
  // 无谓的磁盘写与 mtime 抖动。
  context.subscriptions.push(
    config.onDidChange((e) => {
      if (!shouldRewriteClangd(e)) {
        return;
      }
      void completionMode
        .rewriteClangd()
        .then((result) => {
          if (!result.written) {
            logger.warn(`[clangd] .clangd rewrite skipped: ${result.warning ?? 'unknown'}`);
          }
        })
        .catch((err) => {
          logger.warn(
            `[clangd] .clangd rewrite failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }),
  );

  // [Phase 7 PLAN A / per D-06] 性能状态栏（尊重 showPerfInStatusBar setting）
  // - 设置为 false 时完全跳过创建（尊重用户选择）
  // - perfLog 始终在内存中记录；状态栏关闭只关 UI 不关数据通路
  // - 未检测到 UE 项目时不显示（与其他插件状态项一致），detection.ready 后按需出现
  if (config.showPerfInStatusBar) {
    const perfBar = new PerfStatusBar();
    context.subscriptions.push(perfBar);
    void detection.ready.then((result) => {
      if (result.projects.length > 0) {
        perfBar.show();
      }
    });
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
    // [借鉴 boocs/unreal-clangd] 新增 .h/.cpp → 刷新 compile_commands.json。
    // [add-004 / D9] 默认 auto:节流到期后台静默重建(quiet,无弹窗);
    // compileCommandsAutoRefresh=false 回到手动提示模式。getter 每拍现读,
    // 配置开关变更即时生效,无需 reload。
    const compileCommandsHint = new CompileCommandsRefreshHint({
      logger,
      mode: () => (config.compileCommandsAutoRefresh ? 'auto' : 'notify'),
    });
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
      // 新增源文件提示（自带节流 + 异常吞噬，不阻塞 perfLog 链路）
      void compileCommandsHint.onBatch(batch);
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

  logger.info('[clangd] activated (status bar + perf ready)');
  return { completionMode, proxyManager, ...(ueLink ? { ueLink } : {}) };
}
