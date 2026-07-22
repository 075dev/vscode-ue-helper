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
import { Logger } from '@core/logger';
import { Config } from '@core/config';
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

  const renderOnce = async (): Promise<void> => {
    try {
      logger.info('[ui] renderOnce: awaiting detection.ready...');
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

  // Initial render once detection has finished pre-warm.
  void renderOnce();

  // Re-render when the user changes any relevant config field. We listen
  // broadly and re-render — cheap and avoids missing config keys.
  context.subscriptions.push(
    config.onDidChange(() => {
      void renderOnce();
    }),
  );

  context.subscriptions.push({
    dispose: () => {
      statusBar.dispose();
      disposeOutputChannel();
      disposeDiagnosticCollection();
    },
  });

  logger.info('[ui] activated (status bar ready)');
  return { statusBar };
}
