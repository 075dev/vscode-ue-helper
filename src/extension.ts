/**
 * VSCodeUEHelper —— 插件入口文件
 *
 * Phase 8 架构：单一真相源 WorkspaceState 在 detection.ready 后注入，
 * 通过 ClangdOps 暴露给需要 .clangd 操作的模块（暂未集成到各模块激活流程，
 * 保留旧 API 作为过渡，后续 PR 逐步迁移调用方）。
 */

import * as vscode from 'vscode';
import { type Logger, sharedLogger } from '@core/logger';
import { Config } from '@core/config';
import { WorkspaceState } from '@core/workspace';
import { sharedSubprocessRegistry } from '@core/subprocessRegistry';
import { ClangdOps } from '@clangd/clangdOps';
import { activateDetection } from '@detection';
import { activateBuild } from '@build';
import { activateClangd } from '@clangd';
import { perfLog } from '@clangd/perfLog';
import { activateUI } from '@ui';
import { activateCommands } from '@commands';
import { runFirstTimeInit } from '@commands/firstRunInit';
import { showProjectInfo } from '@commands/showProjectInfo';
import { initI18n, t } from '@i18n';
import { ControlPanelProvider } from '@ui/controlPanel';
import { activateMCP } from '@mcp/index';

let logger: Logger;

export function activate(context: vscode.ExtensionContext): Promise<void> {
  initI18n();
  logger = sharedLogger;
  const config = new Config();
  // [F1-5] 激活时把 lspLoggingLevel 设置接到 Logger，用户设 debug 立即生效
  logger.setLevel(config.lspLoggingLevel);
  // [F1-5] 设置热更新：lspLoggingLevel 变化时动态调整 Logger 级别，无需重启
  context.subscriptions.push(
    config.onDidChange((e) => {
      if (e.affectsConfiguration('vscodeUEHelper.lspLoggingLevel')) {
        logger.setLevel(config.lspLoggingLevel);
      }
    }),
  );
  const activationStart = Date.now();
  logger.info('Activating VSCodeUEHelper...');

  try {
    const detection = activateDetection(context, config, logger);

    // [Phase 8 架构] WorkspaceState 单一真相源
    // 构造时自动订阅 detection.ready 并 setResult。所有模块通过 workspace getter 访问
    // 项目/引擎/路径信息，统一派生路径 get 函数 + 去重错误通知。
    // [Phase 9 SSoT] 注入 WorkspaceContext，selected* getter 才生效；收敛 29 处
    //   `detection.workspaceContext.*` 调用全部到 workspace.selected* / setSelected*。
    const workspace = new WorkspaceState({
      detection,
      logger,
      workspaceContext: detection.workspaceContext,
    });

    // [Phase 8 架构] ClangdOps 统一 .clangd 操作 API（mutate / setAddFlag / replaceAddBlock）
    // [Phase 9 SSoT] 实际 API: readConfig / exists / writeFull / mutate / applyAddFlags（无 setAddFlag / replaceAddBlock）
    const clangdOps = new ClangdOps({ workspace, logger });

    // 旧模块激活流程（保持兼容，后续 PR 逐步迁移到接受 workspace 参数）
    const build = activateBuild(context, config, logger, detection);
    // [Phase 8 Stage 1] 注入 ClangdOps 给 activateClangd，让 CompletionModeController 走统一 API
    const clangd = activateClangd(context, config, logger, detection, workspace, clangdOps);
    // [Phase 8] headerWatcher removed — UBT triggered by proxy-side UeDiagnosticWatcher only
    const ui = activateUI(context, config, logger, detection, workspace);
    // [Plan Add 收束] 把 clangdOps 沿 commands 链透传给 createProject / setSystemIncludes
    activateCommands(
      context,
      config,
      logger,
      detection,
      clangd,
      workspace,
      clangdOps,
      ui.projectExplorer,
      ui.statusBar,
    );

    // [first-time-init] 首次打开插件时检测 + 弹窗 + 初始化编排
    // fire-and-forget：内部会 await，但激活主流程不应被阻塞
    void runFirstTimeInit(
      { context, config, logger, detection, clangd, workspace, clangdOps },
      context,
    ).catch((err: unknown) => logger.error('[firstRunInit] unexpected error:', err));

    // [bugfix-002] MCP 服务器接线 —— Phase 11 起 extension.ts 从未调 activateMCP
    // (src/mcp/index.ts 头注释自称"Plan 12 处理"但从未落地),导致 MCP 在任何宿主
    // 下都不可用(AI agent 的 9 个 ue_* 工具全部拿到 MCP_CONTEXT_NOT_INITIALIZED)。
    // 宿主门控在 activateMCP 内部(detectHost + config.useMCP):Cursor / Claude Code
    // 宿主启动 stdio server,普通 VS Code 为 no-op;启动失败只记日志,不阻塞激活。
    void activateMCP(context, config, logger, detection, workspace, clangdOps).catch(
      (err: unknown) => logger.error('[mcp] activation error:', err),
    );

    // [T2.7] workspace + clangdOps 已 implements vscode.Disposable
    // 接入 context.subscriptions 让 deactivate 时随 extension 一起释放
    context.subscriptions.push(workspace);
    context.subscriptions.push(clangdOps);
    // [deactivate 子进程清理] sharedSubprocessRegistry 第一个 push —— 顺序倒序
    // dispose 时最先被调,杀所有 spawn 子进程。Subsequent 资源(detached spawn
    // 可能在 dispose 链尾部发生)能继续 register,但 killAll 已触发不会再杀。
    context.subscriptions.push(sharedSubprocessRegistry);

    ControlPanelProvider.register({
      context,
      config,
      logger,
      detection,
      workspace,
      clangd,
      clangdOps,
    });

    const elapsed = Date.now() - activationStart;
    logger.info(`VSCodeUEHelper activated in ${elapsed}ms`);
    // 轻量 perfLog 埋点：记录激活时长（同步，开销 < 1ms）
    try {
      perfLog.record({
        event: 'activation.elapsed',
        elapsedMs: elapsed,
        meta: { phase: 'full' },
      });
    } catch {
      // 埋点失败不影响主流程
    }

    void build;
    void ui;

    // [Phase 9 SSoT] 把 workspace 注入 perfLog 单例，让 flushToDisk 走单一真相源
    perfLog.setWorkspace(workspace);

    const hasShownWelcome = context.globalState.get<boolean>('vscodeUEHelper.welcomed');
    if (!hasShownWelcome) {
      void vscode.window.showInformationMessage(t('ui.welcome.real'), 'Open').then((choice) => {
        if (choice === 'Open') {
          void showProjectInfo(config, logger, detection);
        }
      });
      void context.globalState.update('vscodeUEHelper.welcomed', true);
    }
  } catch (err) {
    logger.error('Activation failed:', err);
    void vscode.window.showErrorMessage(
      `VSCodeUEHelper failed to activate: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return Promise.resolve();
}

export function deactivate(): void {
  // 资源释放全部走 context.subscriptions(VS Code 自动倒序 dispose);
  // 此处仅留日志。
  logger?.info('Deactivating VSCodeUEHelper...');
}
