/**
 * ui —— 模块入口
 *
 * 接入状态栏管理器 + 把 UI 工具函数共享给 commands。
 *
 * 主要流程:
 *   1. 创建 StatusBarManager
 *   2. await detection.ready 拿结果
 *   3. 把结果转成 StatusBarContext,调 statusBar.update(ctx, settings) 渲染
 *   4. 监听 Config.onDidChange,变化时重新渲染
 *
 * 失败处理:
 *   - detection.ready reject → statusBar.update({project:null, engine:null}, settings)
 *     降级显示警告按钮
 *
 * 主要导出:
 *   - StatusBarManager: 状态栏 11 按钮管理类
 *   - getOutputChannel / disposeOutputChannel: Output 通道
 *   - getDiagnosticCollection / pushDiagnostics: Problems 面板
 *   - withProgress: 长任务进度条
 *   - pickProject / pickEngine / etc.: QuickPick helpers
 */

import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import type { ProjectInfo, EngineInstall } from '@detection/types';
import type { WorkspaceState } from '@core/workspace';
import {
  StatusBarManager,
  settingsFromConfig,
  type StatusBarContext,
  type StatusBarSettings,
} from './statusBar';
import { disposeOutputChannel } from './outputChannel';
import { disposeDiagnosticCollection } from './problemsPanel';
import { ProjectExplorerProvider } from './projectExplorer';
import { VscodeProjectExplorerFs } from './projectExplorerFs';
import { t } from '@i18n';

export {
  StatusBarManager,
  settingsFromConfig,
  type StatusBarContext,
  type StatusBarSettings,
} from './statusBar';
export { getOutputChannel, disposeOutputChannel } from './outputChannel';
export {
  getDiagnosticCollection,
  pushDiagnostics,
  clearDiagnostics,
  disposeDiagnosticCollection,
} from './problemsPanel';
export { withProgress } from './notifications';
export { pickProject, pickEngine, pickConfiguration, pickTarget, pickPlatform } from './quickPicks';

export interface UIHandles {
  statusBar: StatusBarManager;
  projectExplorer: ProjectExplorerProvider;
}

export function activateUI(
  context: vscode.ExtensionContext,
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——保留 legacy 调用兼容；production 由 extension.ts 注入
  workspace?: WorkspaceState,
): UIHandles {
  const statusBar = new StatusBarManager();
  const projectExplorer = new ProjectExplorerProvider(
    workspace ?? ({} as WorkspaceState),
    new VscodeProjectExplorerFs(),
    logger,
  );
  const treeView = vscode.window.createTreeView(ProjectExplorerProvider.viewType, {
    treeDataProvider: projectExplorer,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push(projectExplorer);
  if (workspace) {
    const scheduleRefresh = (): void => {
      // 等待 WorkspaceState 注入完成（detection.ready 完成）后再请求刷新，
      // 避免在 ready 之前误报"工作区缺失"。
      void detection.ready.then(() => projectExplorer.refresh());
    };
    void detection.ready.then(() => projectExplorer.refresh());
    context.subscriptions.push(
      config.onDidChange(() => {
        scheduleRefresh();
      }),
    );
    // [Project Explorer] 同步 panel/context 可见性：检测到项目后
    // `setContext('vscodeUEHelper.projectDetected', true)`，从而让
    // package.json 里 `view.when` 条件生效，Tree View 才会出现在 Activity Bar。
    // 仅在 detection.ready 解析时同步一次，session 期间不持续监听。
    void detection.ready.then((result) => {
      void vscode.commands.executeCommand(
        'setContext',
        'vscodeUEHelper.projectDetected',
        result.projects.length > 0,
      );
    });
  } else {
    logger.warn(t('projectExplorer.noProject'));
  }

  /**
   * 完整重绘 —— 依赖 detection.ready 解析后的 ctx（含项目/引擎 + 用户选择）。
   * 用于初始激活、projectExplorer 刷新等需要全量重绘的场景。
   *
   * 因为依赖 detection,内部需要 await detection.ready,意味着这是异步路径。
   * 走这条路径会引入 microtask 延迟,**不**用于 config.onDidChange（详见 renderConfigOnly）。
   */
  const renderFull = async (): Promise<void> => {
    try {
      logger.info('[ui] renderFull: awaiting detection.ready...');
      const result = await detection.ready;
      logger.info(
        `[ui] detection.ready resolved: projects=${result.projects.length} engines=${result.engines.length}`,
      );
      for (const p of result.projects) {
        logger.info(`[ui]   project: name="${p.name}" path="${p.path}"`);
      }
      for (const e of result.engines) {
        logger.info(`[ui]   engine:  version="${e.version}" path="${e.path}"`);
      }

      // [Phase 9 SSoT] 收敛 selected* 访问
      const legacyFindProject = (): ProjectInfo | undefined => {
        const sp = detection.workspaceContext.getSelectedProject();
        return sp ? result.projects.find((p) => p.path === sp) : undefined;
      };
      const legacyFindEngine = (): EngineInstall | undefined => {
        const se = detection.workspaceContext.getSelectedEngine();
        return se ? result.engines.find((e) => e.path === se) : undefined;
      };
      const selectedProject =
        workspace?.resolveSelectedProject(result.projects) ?? legacyFindProject();
      const selectedEngine = workspace?.resolveSelectedEngine(result.engines) ?? legacyFindEngine();
      logger.info(
        `[ui] selection: selectedProject=${selectedProject?.path ?? '(none)'} selectedEngine=${selectedEngine?.path ?? '(none)'}`,
      );

      const project = selectedProject ?? result.projects[0];
      const engine = selectedEngine ?? result.engines[0];
      const ctx: StatusBarContext = {
        project: project ? { name: project.name, path: project.path } : null,
        engine: engine ? { version: engine.version, path: engine.path } : null,
      };

      const settings: StatusBarSettings = settingsFromConfig(config);
      logger.info(
        `[ui] statusBar.update: project="${ctx.project?.name ?? '(none)'}" engine="${ctx.engine?.version ?? '(none)'}" cfg=${settings.buildConfiguration} target=${settings.buildTarget} platform=${settings.platform}`,
      );
      statusBar.update(ctx, settings);
      logger.info('[ui] statusBar.update: done');
    } catch (err) {
      logger.error('[ui] initial render failed:', err);
      statusBar.update({ project: null, engine: null }, settingsFromConfig(config));
    }
  };

  /**
   * **同步**重绘仅依赖 config 的按钮 —— 不走 detection.ready,同一 tick 内更新。
   *
   * 修复状态栏配置变更反馈延迟 bug：之前 config.onDidChange 走 renderFull(async),
   * 第一个 await detection.ready 会让出当前 tick,把 statusBar.update 推到 microtask,
   * 用户在 selectConfig / selectTarget 后能感知到状态栏按钮的更新滞后。改走
   * statusBar.updateConfig(settings) 同步重绘 configBtn / targetBtn / projectInfoBtn
   * 的 platform 段,用户点完按钮立刻看到新值。
   *
   * 不重绘 build/launch/rebuild/clean/liveCoding 按钮(那些由 ctx 决定 visibility,
   * 不依赖 config 变化)。
   */
  const renderConfigOnly = (): void => {
    const settings = settingsFromConfig(config);
    logger.info(
      `[ui] statusBar.updateConfig (sync): cfg=${settings.buildConfiguration} target=${settings.buildTarget} platform=${settings.platform}`,
    );
    statusBar.updateConfig(settings);
  };

  // Initial render once detection has finished pre-warm.
  void renderFull();

  // Re-render when the user changes any relevant config field. **同步**路径 —— 不走 async
  // renderFull,避免 microtask 延迟导致状态栏按钮更新滞后于用户操作。
  context.subscriptions.push(
    config.onDidChange(() => {
      renderConfigOnly();
    }),
  );

  // [F2-15/W17/A4] 用户通过 QuickPick 切换项目/引擎后,状态栏必须刷新显示新选择。
  // workspace.setSelectedProject / setSelectedEngine 持久化成功后 fire 事件,这里全量重绘
  // (renderFull 依赖 detection.ready 解析 ctx,内部会走 workspace.resolveSelectedProject,
  // 能反映刚写入的新 selection)。workspace 可选——未注入时不订阅(仅测试/legacy 调用路径)。
  if (workspace) {
    context.subscriptions.push(
      workspace.onDidChangeSelection(() => {
        void renderFull();
      }),
    );
  }

  context.subscriptions.push({
    dispose: () => {
      statusBar.dispose();
      disposeOutputChannel();
      disposeDiagnosticCollection();
    },
  });

  logger.info('[ui] activated (status bar ready)');
  return { statusBar, projectExplorer };
}
