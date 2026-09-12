/**
 * controlPanel —— 侧边栏 WebView 控制面板（WebviewViewProvider）
 */

import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdHandles } from '@clangd';
import type { ClangdOps } from '@clangd/clangdOps';
import type { ProjectInfo, EngineInstall } from '@detection/types';
import { resolveFlags, getGlossaryForWebview } from '@clangd/flagGlossary';
import { t } from '@i18n';
import { getControlPanelHtml } from './controlPanel.html';
import {
  COMMAND_MAP,
  COMMAND_REQUIREMENT,
  CONFIG_KEY_MAP,
} from './controlPanelMessages';
import type { WebViewMessage, PanelMessage } from './controlPanelMessages';

/**
 * 合法消息 type 白名单。与 controlPanelMessages.ts 的 WebViewMessage union 保持同步——
 * 白名单外 / 形状错误的消息一律在入口拒绝,不回推进 switch。
 */
const MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'executeCommand',
  'panelReady',
  'getConfig',
  'getProxyConfig',
  'updateConfig',
  'updateProxyConfig',
  'saveConfig',
  'saveProxyConfig',
  'getStatus',
  'getAddFlags',
  'saveAddFlags',
]);

/**
 * 面板侧需要"启动即返回"的长任务命令（UBT 等）。
 * await 到进程结束会让 toast「正在执行…」一直挂着，看起来像卡在加载。
 */
const LONG_RUNNING_COMMANDS: ReadonlySet<string> = new Set([
  'build',
  'rebuild',
  'clean',
  'generateCompileCommands',
  'createProject',
  'diagnoseProject',
  'liveCoding',
]);

/** 校验单条 ConfigUpdate 形状:必须是 { key: string } 对象 */
function isConfigUpdate(u: unknown): u is import('./controlPanelMessages').ConfigUpdate {
  return typeof u === 'object' && u !== null && typeof (u as { key?: unknown }).key === 'string';
}

/**
 * CONFIG_KEY_MAP 白名单查表:已知 UI key 返回对应配置 key,未知返回 undefined。
 *
 * [F2-16/W23] 统一入口,替代旧的 `CONFIG_KEY_MAP[key] ?? key` 击穿模式 ——
 * 未知 key 不再透传写入 config,由调用方拒绝并回推错误。
 */
function getConfigKey(key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(CONFIG_KEY_MAP, key) ? CONFIG_KEY_MAP[key] : undefined;
}

/**
 * [F2-16/W23] WebView 消息运行时校验。
 *
 * 损坏消息(非对象 / type 缺失 / type 不在白名单 / 必填字段缺失)返回 null,
 * 调用方回推错误,避免 handleMessage 崩溃或把不可信输入写进 config。
 */
function validateMessage(msg: unknown): WebViewMessage | null {
  if (typeof msg !== 'object' || msg === null) {
    return null;
  }
  const m = msg as Record<string, unknown>;
  if (typeof m['type'] !== 'string' || !MESSAGE_TYPES.has(m['type'])) {
    return null;
  }
  switch (m['type']) {
    case 'executeCommand':
      return typeof m['command'] === 'string' ? (msg as WebViewMessage) : null;
    case 'updateConfig':
    case 'updateProxyConfig':
      return typeof m['key'] === 'string' ? (msg as WebViewMessage) : null;
    case 'saveConfig':
    case 'saveProxyConfig':
      return Array.isArray(m['updates']) && (m['updates'] as unknown[]).every(isConfigUpdate)
        ? (msg as WebViewMessage)
        : null;
    case 'saveAddFlags':
      return Array.isArray(m['selectedIds']) ? (msg as WebViewMessage) : null;
    default:
      // panelReady / getConfig / getProxyConfig / getStatus / getAddFlags 无必填载荷
      return msg as WebViewMessage;
  }
}

export interface ControlPanelDeps {
  context: vscode.ExtensionContext;
  config: Config;
  logger: Logger;
  detection: DetectionHandles;
  // [Phase 9 SSoT] 与 UI 其他模块一致：可选依赖，未传则 selected* fallback 到 detection
  workspace?: WorkspaceState;
  clangd: ClangdHandles;
  /** [Plan Add 收束] 注入用于在 .clangd 上整体重写 Add 字段 */
  clangdOps?: ClangdOps;
}

export class ControlPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vscodeUEHelper.controlPanel';

  private static instance: ControlPanelProvider | null = null;

  private _view: vscode.WebviewView | undefined;
  private deps: ControlPanelDeps;
  private disposables: vscode.Disposable[] = [];
  private projectName = '';
  private engineVersion = '';
  /** [面板可用性] 工作区是否检测到 .uproject 项目 / UE 引擎（驱动按钮适用度与空状态） */
  private hasProject = false;
  private hasEngine = false;

  private constructor(deps: ControlPanelDeps) {
    this.deps = deps;
  }

  static getInstance(deps?: ControlPanelDeps): ControlPanelProvider {
    if (!ControlPanelProvider.instance && deps) {
      ControlPanelProvider.instance = new ControlPanelProvider(deps);
    }
    if (!ControlPanelProvider.instance) {
      throw new Error('ControlPanelProvider 尚未初始化');
    }
    return ControlPanelProvider.instance;
  }

  static resetInstance(): void {
    ControlPanelProvider.instance = null;
  }

  static register(deps: ControlPanelDeps): vscode.Disposable {
    const provider = ControlPanelProvider.getInstance(deps);
    const disposable = vscode.window.registerWebviewViewProvider(
      ControlPanelProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    );
    deps.context.subscriptions.push(disposable);
    deps.logger.info('[controlPanel] provider registered');

    // [外部配置同步 bug 修复] 订阅 vscodeUEHelper.* 配置变化，自动把最新 proxy/status
    // 推到 webview。仅靠 webview 内部 save handler 无法覆盖以下场景：
    //   - 用户在 VS Code 设置 UI 改了 clangdProxy.enabled / keepalive 等
    //   - 用户直接编辑 .vscode/settings.json
    //   - 其它命令（如 setSystemIncludes、firstRunInit）改了 vscodeUEHelper.*
    // 没有这个 listener，控制面板只在 save 与 visibility 切换时刷新，会一直停留在旧值。
    // Config.onDidChange 内部已过滤无关 namespace（src/core/config.ts:311-317）。
    const configListener = deps.config.onDidChange(() => {
      // onDidChange 由 VS Code workspace.onDidChangeConfiguration 触发，同进程内是异步
      // （microtask 后）。webview 仍然可能尚未 ready，但 postMessage 内部已经处理 _view 不存在
      // 的情况（静默跳过），所以这里不必等待 panelReady。
      provider.pushProxyConfig();
      provider.pushStatus();
    });
    deps.context.subscriptions.push(configListener);

    // [面板可用性] 用户切换项目/引擎选择后重推面板状态，按钮适用度即时刷新。
    // _view 不存在时 postMessage 静默跳过，无需等待 panelReady。
    if (deps.workspace) {
      const selectionListener = deps.workspace.onDidChangeSelection(() => {
        provider.pushPanelState();
      });
      deps.context.subscriptions.push(selectionListener);
    }
    return disposable;
  }

  /**
   * 把当前 proxy 表单回写到 webview —— 用于被 config.onDidChange 触发，也供外部
   * （如命令调用）显式刷新时复用。proxyEnabled 派生为"真实激活 OR 配置启用"，
   * 让 enable 命令开 proxy 但 clangdProxy.enabled 还没写时的"看起来没开"陷阱消失。
   * 该函数不抛错，_view 不存在则跳过（panelReady 前的早期 onDidChange 安全）。
   */
  private pushProxyConfig(): void {
    const { config, clangd } = this.deps;
    const displayEnabled = clangd.proxyManager.isActive || config.clangdProxyEnabled;
    this.postMessage({
      type: 'proxyConfigValues',
      values: {
        clangdProxyEnabled: displayEnabled,
        clangdProxyKeepaliveMax: config.clangdProxyKeepaliveMax,
        clangdProxyKeepaliveTtlSec: config.clangdProxyKeepaliveTtlSec,
        clangdProxyRealClangdPath: config.clangdProxyRealClangdPath ?? '',
        clangdProxyLogPath: config.clangdProxyLogPath ?? '',
        localizationEnabled: config.clangdProxyLocalizationEnabled,
        localizationMode: config.clangdProxyLocalizationMode,
      },
    });
  }

  /** 把当前 status 推到 webview —— 同上，供 onDidChange 与命令复用 */
  private pushStatus(): void {
    this.postMessage({ type: 'statusValues', values: this.buildStatusValues() });
  }

  static show(): void {
    void vscode.commands.executeCommand('workbench.view.extension.ueHelper');
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    void this.refreshTitleInfo();
    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((msg: WebViewMessage) => {
        void this.handleMessage(msg);
      }),
    );

    this.disposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          // [F2-17/W24] 只刷新标题信息,不再重设 .html —— 重设 html 会整页 reload,
          // 清空用户在表单里填了一半的内容。refreshTitleInfo 只 postMessage 不重建 html。
          void this.refreshTitleInfo();
        }
      }),
    );

    this.deps.logger.info('[controlPanel] view resolved');
  }

  private async refreshTitleInfo(): Promise<void> {
    const { detection, workspace } = this.deps;
    try {
      const { projects, engines } = await detection.ready;
      // [Phase 9 SSoT] 收敛 selected* 访问
      const legacyFindProject = (): ProjectInfo | undefined => {
        const sp = detection.workspaceContext.getSelectedProject();
        return sp ? projects.find((p) => p.path === sp) : undefined;
      };
      const legacyFindEngine = (): EngineInstall | undefined => {
        const se = detection.workspaceContext.getSelectedEngine();
        return se ? engines.find((e) => e.path === se) : undefined;
      };
      const project =
        workspace?.resolveSelectedProject(projects) ?? legacyFindProject() ?? projects[0];
      this.projectName = project?.name ?? '';
      const engine = workspace?.resolveSelectedEngine(engines) ?? legacyFindEngine() ?? engines[0];
      this.engineVersion = engine?.version ?? '';
      // [面板可用性] 项目/引擎存在性驱动按钮适用度与空状态（面板整体不可用）
      this.hasProject = projects.length > 0;
      this.hasEngine = engines.length > 0;
    } catch {
      this.projectName = '';
      this.engineVersion = '';
      this.hasProject = false;
      this.hasEngine = false;
    }
    this.postMessage({
      type: 'updateTitle',
      projectName: this.projectName,
      engineVersion: this.engineVersion,
    });
    this.pushPanelState();
  }

  /**
   * [面板可用性] 把项目/引擎存在性推到 webview。
   * webview 据此切换无项目空状态（面板整体不可用）并按适用度 disable 按钮。
   * _view 不存在（panelReady 前）时 postMessage 静默跳过。
   */
  private pushPanelState(): void {
    this.postMessage({
      type: 'panelState',
      hasProject: this.hasProject,
      hasEngine: this.hasEngine,
    });
  }

  private async handleMessage(msg: WebViewMessage): Promise<void> {
    const { logger, config } = this.deps;

    // [F2-16/W23] 入口校验:损坏消息(type 白名单外 / 载荷形状错)不崩,回推错误后直接返回。
    const validated = validateMessage(msg);
    if (!validated) {
      logger.warn(`[controlPanel] invalid message rejected: ${JSON.stringify(msg)}`);
      this.postMessage({ type: 'showError', message: 'Invalid message' });
      return;
    }
    msg = validated;

    switch (msg.type) {
      case 'panelReady':
        logger.info('[controlPanel] panel ready');
        break;

      case 'executeCommand': {
        const cmdId = COMMAND_MAP[msg.command];
        if (!cmdId) {
          logger.warn(`[controlPanel] unknown command: ${msg.command}`);
          this.postMessage({
            type: 'commandResult',
            command: msg.command,
            success: false,
            message: `Unknown command: ${msg.command}`,
          });
          return;
        }
        logger.info(`[controlPanel] executing command: ${cmdId}`);
        // [面板可用性] 服务端兜底：webview 的 disabled 只是 UI 层防线，消息可被伪造，
        // 这里按按钮适用档位再拦一道——无项目/无引擎时拒绝执行并回推原因。
        const requirement = COMMAND_REQUIREMENT[msg.command] ?? 'project';
        if (requirement !== 'always' && !this.hasProject) {
          logger.warn(`[controlPanel] command blocked (no project): ${cmdId}`);
          this.postMessage({
            type: 'commandResult',
            command: msg.command,
            success: false,
            message: t('panel.cmdBlocked.noProject'),
          });
          return;
        }
        if (requirement === 'engine' && !this.hasEngine) {
          logger.warn(`[controlPanel] command blocked (no engine): ${cmdId}`);
          this.postMessage({
            type: 'commandResult',
            command: msg.command,
            success: false,
            message: t('panel.cmdBlocked.noEngine'),
          });
          return;
        }
        // 长任务（UBT build 等）不能 await 到进程结束：否则面板 toast「正在执行…」
        // 会一直挂着，看起来像卡在加载。启动后立刻回 started，结果由命令自身通知。
        if (LONG_RUNNING_COMMANDS.has(msg.command)) {
          this.postMessage({
            type: 'commandResult',
            command: msg.command,
            success: true,
            message: `${cmdId} started`,
          });
          void vscode.commands.executeCommand(cmdId).then(
            () => {
              logger.info(`[controlPanel] long command finished: ${cmdId}`);
            },
            (err: unknown) => {
              const errMsg = err instanceof Error ? err.message : String(err);
              logger.error(`[controlPanel] long command failed: ${cmdId}`, errMsg);
            },
          );
          break;
        }
        try {
          await vscode.commands.executeCommand(cmdId);
          this.postMessage({
            type: 'commandResult',
            command: msg.command,
            success: true,
            message: `${cmdId} completed`,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[controlPanel] command failed: ${cmdId}`, errMsg);
          this.postMessage({
            type: 'commandResult',
            command: msg.command,
            success: false,
            message: errMsg,
          });
        }
        break;
      }

      case 'getConfig':
        this.postMessage({
          type: 'configValues',
          values: {
            configuration: config.configuration,
            target: config.target,
            platform: config.platform,
            useMCP: config.useMCP,
            autoBackupWorkspace: config.autoBackupWorkspace,
            lspLoggingLevel: config.lspLoggingLevel,
          },
        });
        break;

      case 'getProxyConfig':
        // 复用 pushProxyConfig()，统一走 "isActive || enabled" 派生显示。
        this.pushProxyConfig();
        break;

      case 'updateConfig': {
        // [F2-16/W23] 未知 key 直接拒绝并回推错误,不再 `?? msg.key` 击穿把不可信 key 写进 config
        const configKey = getConfigKey(msg.key);
        if (!configKey) {
          logger.warn(`[controlPanel] unknown config key rejected: ${msg.key}`);
          this.postMessage({ type: 'showError', message: `Unknown config key: ${msg.key}` });
          return;
        }
        logger.info(`[controlPanel] update config: ${msg.key}=${String(msg.value)}`);
        try {
          await config.update(configKey, msg.value);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[controlPanel] update config failed: ${msg.key}`, errMsg);
        }
        break;
      }

      case 'updateProxyConfig': {
        // [F2-16/W23] 同 updateConfig:未知 key 拒绝并回推错误
        const configKey = getConfigKey(msg.key);
        if (!configKey) {
          logger.warn(`[controlPanel] unknown proxy config key rejected: ${msg.key}`);
          this.postMessage({ type: 'showError', message: `Unknown proxy config key: ${msg.key}` });
          return;
        }
        logger.info(`[controlPanel] update proxy config: ${msg.key}=${String(msg.value)}`);
        try {
          await config.update(configKey, msg.value);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[controlPanel] update proxy config failed: ${msg.key}`, errMsg);
        }
        break;
      }

      case 'saveConfig': {
        // [F2-16/W23] batchSave 包 try/catch:意外异常也回推 saveResult,不让 handleMessage 抛出去
        try {
          const result = await this.batchSave(msg.updates);
          this.postMessage({ type: 'saveResult', scope: 'config', result });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('[controlPanel] saveConfig batch failed:', errMsg);
          this.postMessage({
            type: 'saveResult',
            scope: 'config',
            result: {
              success: false,
              saved: 0,
              failed: msg.updates.length,
              firstError: errMsg,
            },
          });
        }
        // [Status 同步 bug 修复] 保存顶层配置后也推一次 statusValues，Status Tab 上的
        // configuration / target / clangdPath / lspLoggingLevel 等字段才能即时反映。
        // config.onDidChange 监听器也会触发（异步），这里显式同步先推一份保证 webview
        // 立即收到，避免刷新时序空白。
        this.pushStatus();
        break;
      }

      case 'saveProxyConfig': {
        try {
          const result = await this.batchSave(msg.updates);
          this.postMessage({ type: 'saveResult', scope: 'proxy', result });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('[controlPanel] saveProxyConfig batch failed:', errMsg);
          this.postMessage({
            type: 'saveResult',
            scope: 'proxy',
            result: {
              success: false,
              saved: 0,
              failed: msg.updates.length,
              firstError: errMsg,
            },
          });
        }
        // [Status 同步 bug 修复] 保存 Proxy 配置后必须再推一次 statusValues。原代码只
        // 回 saveResult，导致用户在 Status Tab 上看到的 proxyEnabled / keepalive /
        // localization / logPath / backup 等状态一直停留在旧值，要切走/刷新按钮才更新。
        this.pushStatus();
        // 同时回写 proxy 表单——保证用户在 Proxy Tab 上看到刚保存的值覆盖原 UI 状态
        // （例如 uncheck clangdProxyEnabled 后此 checkbox 显示 unchecked 而不是
        // 仍派生显示 enabled）。pushProxyConfig 内部仍走 isActive||enabled 派生。
        this.pushProxyConfig();
        break;
      }

      case 'getStatus':
        this.pushStatus();
        break;

      case 'getAddFlags': {
        // [Plan Add 收束] 把 glossary 元数据 + 当前 selectedIds 一起推到 webview
        const entries = getGlossaryForWebview();
        this.postMessage({
          type: 'addFlagValues',
          values: { entries, selectedIds: config.userAddFlags },
        });
        break;
      }

      case 'saveAddFlags': {
        // 整体 force-write：把 selectedIds 通过 flagGlossary 渲染后写入 .clangd
        const clangdOps = this.deps.clangdOps;
        if (!clangdOps) {
          this.postMessage({
            type: 'addFlagSaveResult',
            result: { success: false, saved: 0, failed: 1, firstError: 'ClangdOps 未注入' },
          });
          return;
        }
        try {
          // [Plan 循环保护] 注意：这里走"写 userAddFlags → onDidChange 监听器会再触发 applyAddFlags"的双阶段写入。
          // 为避免 race 与重复 IO，我们**先**算 addFlags，再 await config.update，然后 applyAddFlags 仍然执行一次。
          // onDidChange 监听器幂等（写入相同内容不会修改文件），所以无重复风险。
          const addFlags = resolveFlags(msg.selectedIds, {});
          await config.update('clangd.userAddFlags', msg.selectedIds);
          const applyRes = await clangdOps.applyAddFlags(addFlags);
          if (applyRes.ok) {
            this.postMessage({
              type: 'addFlagSaveResult',
              result: { success: true, saved: msg.selectedIds.length, failed: 0 },
            });
          } else {
            this.postMessage({
              type: 'addFlagSaveResult',
              result: {
                success: false,
                saved: 0,
                failed: 1,
                firstError: `applyAddFlags ${applyRes.reason}`,
              },
            });
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('[controlPanel] saveAddFlags failed:', errMsg);
          this.postMessage({
            type: 'addFlagSaveResult',
            result: { success: false, saved: 0, failed: 1, firstError: errMsg },
          });
        }
        break;
      }

      default:
        ((_exhaustive: never) => {
          logger.warn(
            `[controlPanel] unhandled message type: ${(_exhaustive as { type: string }).type}`,
          );
        })(msg);
    }
  }

  private async batchSave(
    updates: import('./controlPanelMessages').ConfigUpdate[],
  ): Promise<import('./controlPanelMessages').SaveResult> {
    const { logger, config } = this.deps;
    let saved = 0,
      failed = 0,
      firstError: string | undefined;
    const localizationModeChanged = updates.some((u) => u.key === 'localizationMode');
    for (const u of updates) {
      // [F2-16/W23] 未知 key 直接计入失败,不再 `?? u.key` 击穿把不可信 key 写进 config
      const configKey = getConfigKey(u.key);
      if (!configKey) {
        failed++;
        firstError ??= `Unknown config key: ${u.key}`;
        logger.warn(`[controlPanel] unknown key skipped: ${u.key}`);
        continue;
      }
      try {
        await config.update(configKey, u.value);
        saved++;
        logger.info(`[controlPanel] saved: ${configKey}=${JSON.stringify(u.value)}`);
      } catch (err) {
        failed++;
        firstError ??= err instanceof Error ? err.message : String(err);
        logger.error(`[controlPanel] save failed: ${configKey}`, firstError);
      }
    }
    return { success: failed === 0, saved, failed, firstError, localizationModeChanged };
  }

  private postMessage(msg: PanelMessage): void {
    if (this._view) {
      void this._view.webview.postMessage(msg);
    }
  }

  private getHtmlContent(webview: vscode.Webview): string {
    return getControlPanelHtml(
      webview.cspSource,
      this.projectName,
      this.engineVersion,
      getGlossaryForWebview(),
    );
  }

  private buildStatusValues(): import('./controlPanelMessages').StatusValues {
    const { config, detection, clangd, workspace } = this.deps;
    let projectPath = '',
      enginePath = '',
      workspaceFilePath = '',
      hasWorkspaceFile = false;
    const mcpHost = '';

    try {
      // [Phase 9 SSoT] 收敛 selected* 访问
      // status 字段只展示用——单一真源是 workspace，但 workspaceContext 在 production 是 backing store
      const sp = workspace?.selectedProject ?? detection.workspaceContext.getSelectedProject();
      if (sp) {
        projectPath = sp;
      }
      const se = workspace?.selectedEngine ?? detection.workspaceContext.getSelectedEngine();
      if (se) {
        enginePath = se;
      }
      // [Phase 9 SSoT] workspaceFile 走 workspace.workspaceFile（单一真相源；无 fallback）
      const wsFile = workspace?.workspaceFile;
      if (wsFile) {
        workspaceFilePath = wsFile;
        hasWorkspaceFile = true;
      }
    } catch {
      /* ignore */
    }

    const ps = clangd.proxyManager.getStatus();

    return {
      projectName: this.projectName,
      projectPath,
      engineVersion: this.engineVersion,
      enginePath,
      hasWorkspaceFile,
      workspaceFilePath,
      configuration: config.configuration,
      target: config.target,
      platform: config.platform,
      clangdPath: config.clangdPath ?? '(auto-detect)',
      completionMode: config.completionMode,
      mcpMode: config.useMCP,
      mcpHost,
      logLevel: config.lspLoggingLevel,
      // [外部激活状态同步 bug 修复] proxyEnabled 派生为"真实激活 OR 配置启用"。
      // enableClangdProxy 命令为避免 Config.update scope 静默失败陷阱故意不写
      // clangdProxy.enabled 配置（F-fix 决策），但 clangd.path 已经指向 launcher
      // → proxy 实际激活。如果只看 config 显示 false，就是用户报告的"开了却显示没开"。
      // 派生为 isActive || enabled，让 Status 反映事实；保存路径仍写原 config key
      // （去激活需要走 disable 命令或在配置里改）。
      proxyEnabled: ps.enabled || clangd.proxyManager.isActive,
      proxyActive: clangd.proxyManager.isActive,
      proxyLauncherPath: ps.launcherPath,
      proxyRealClangdPath: ps.realClangdPath ?? '(auto-detect)',
      proxyKeepaliveMax: ps.keepaliveMax,
      proxyKeepaliveTtlSec: ps.keepaliveTtlSec,
      proxyLogPath: ps.logPath ?? '(not set)',
      proxyBackupExists: ps.backupExists,
      proxyLastKnownProblem: ps.lastKnownProblem ?? '',
      proxyLocalizationEnabled: ps.localizationEnabled,
      proxyLocalizationMode: ps.localizationMode,
    };
  }
}
