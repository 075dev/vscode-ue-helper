/**
 * controlPanel —— 侧边栏 WebView 控制面板（WebviewViewProvider）
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import type { ClangdHandles } from '@clangd';
import { getControlPanelHtml } from './controlPanel.html';
import { COMMAND_MAP, CONFIG_KEY_MAP } from './controlPanelMessages';
import type { WebViewMessage, PanelMessage } from './controlPanelMessages';

export interface ControlPanelDeps {
  context: vscode.ExtensionContext;
  config: Config;
  logger: Logger;
  detection: DetectionHandles;
  clangd: ClangdHandles;
}

export class ControlPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vscodeUEHelper.controlPanel';

  private static instance: ControlPanelProvider | null = null;

  private _view: vscode.WebviewView | undefined;
  private deps: ControlPanelDeps;
  private disposables: vscode.Disposable[] = [];
  private projectName = '';
  private engineVersion = '';

  private constructor(deps: ControlPanelDeps) {
    this.deps = deps;
  }

  static getInstance(deps?: ControlPanelDeps): ControlPanelProvider {
    if (!ControlPanelProvider.instance && deps) {
      ControlPanelProvider.instance = new ControlPanelProvider(deps);
    }
    return ControlPanelProvider.instance!;
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
    return disposable;
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
          void this.refreshTitleInfo();
          webviewView.webview.html = this.getHtmlContent(webviewView.webview);
        }
      }),
    );

    this.deps.logger.info('[controlPanel] view resolved');
  }

  private async refreshTitleInfo(): Promise<void> {
    const { detection } = this.deps;
    try {
      const projects = await detection.scanner.scan();
      const selectedProject = detection.workspaceContext.getSelectedProject();
      const project = projects.find((p) => p.path === selectedProject) ?? projects[0];
      this.projectName = project?.name ?? '';
      const engines = await detection.discovery.discover();
      const selectedEngine = detection.workspaceContext.getSelectedEngine();
      const engine = engines.find((e) => e.path === selectedEngine) ?? engines[0];
      this.engineVersion = engine?.version ?? '';
    } catch {
      this.projectName = '';
      this.engineVersion = '';
    }
    this.postMessage({ type: 'updateTitle', projectName: this.projectName, engineVersion: this.engineVersion });
  }

  private async handleMessage(msg: WebViewMessage): Promise<void> {
    const { logger, config } = this.deps;

    switch (msg.type) {
      case 'panelReady':
        logger.info('[controlPanel] panel ready');
        break;

      case 'executeCommand': {
        const cmdId = COMMAND_MAP[msg.command];
        if (!cmdId) {
          logger.warn(`[controlPanel] unknown command: ${msg.command}`);
          this.postMessage({ type: 'commandResult', command: msg.command, success: false, message: `Unknown command: ${msg.command}` });
          return;
        }
        logger.info(`[controlPanel] executing command: ${cmdId}`);
        try {
          await vscode.commands.executeCommand(cmdId);
          this.postMessage({ type: 'commandResult', command: msg.command, success: true, message: `${cmdId} completed` });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[controlPanel] command failed: ${cmdId}`, errMsg);
          this.postMessage({ type: 'commandResult', command: msg.command, success: false, message: errMsg });
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
            completionMode: config.completionMode,
            useMCP: config.useMCP,
            autoBackupWorkspace: config.autoBackupWorkspace,
            lspLoggingLevel: config.lspLoggingLevel,
          },
        });
        break;

      case 'getProxyConfig':
        this.postMessage({
          type: 'proxyConfigValues',
          values: {
            clangdProxyEnabled: config.clangdProxyEnabled,
            clangdProxyKeepaliveMax: config.clangdProxyKeepaliveMax,
            clangdProxyKeepaliveTtlSec: config.clangdProxyKeepaliveTtlSec,
            clangdProxyRealClangdPath: config.clangdProxyRealClangdPath ?? '',
            clangdProxyLogPath: config.clangdProxyLogPath ?? '',
            localizationEnabled: config.clangdProxyLocalizationEnabled,
            localizationMode: config.clangdProxyLocalizationMode,
          },
        });
        break;

      case 'updateConfig':
        logger.info(`[controlPanel] update config: ${msg.key}=${msg.value}`);
        try { await config.update(CONFIG_KEY_MAP[msg.key] ?? msg.key, msg.value); } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[controlPanel] update config failed: ${msg.key}`, errMsg);
        }
        break;

      case 'updateProxyConfig':
        logger.info(`[controlPanel] update proxy config: ${msg.key}=${msg.value}`);
        try { await config.update(CONFIG_KEY_MAP[msg.key] ?? msg.key, msg.value); } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[controlPanel] update proxy config failed: ${msg.key}`, errMsg);
        }
        break;

      case 'saveConfig':
        this.postMessage({ type: 'saveResult', scope: 'config', result: await this.batchSave(msg.updates, false) });
        break;

      case 'saveProxyConfig':
        this.postMessage({ type: 'saveResult', scope: 'proxy', result: await this.batchSave(msg.updates, true) });
        break;

      case 'getStatus':
        this.postMessage({ type: 'statusValues', values: this.buildStatusValues() });
        break;

      default:
        ((_exhaustive: never) => {
          logger.warn(`[controlPanel] unhandled message type: ${(_exhaustive as { type: string }).type}`);
        })(msg);
    }
  }

  private async batchSave(
    updates: import('./controlPanelMessages').ConfigUpdate[],
    isProxy: boolean,
  ): Promise<import('./controlPanelMessages').SaveResult> {
    const { logger, config } = this.deps;
    let saved = 0, failed = 0, firstError: string | undefined;
    const localizationModeChanged = updates.some(u => u.key === 'localizationMode');
    for (const u of updates) {
      const configKey = CONFIG_KEY_MAP[u.key] ?? u.key;
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
    return getControlPanelHtml(webview.cspSource, this.projectName, this.engineVersion);
  }

  private buildStatusValues(): import('./controlPanelMessages').StatusValues {
    const { config, detection, clangd } = this.deps;
    let projectPath = '', enginePath = '', workspaceFilePath = '', hasWorkspaceFile = false, mcpHost = '';

    try {
      const selectedProject = detection.workspaceContext.getSelectedProject();
      if (selectedProject) projectPath = selectedProject;
      const selectedEngine = detection.workspaceContext.getSelectedEngine();
      if (selectedEngine) enginePath = selectedEngine;
      const wsFolders = vscode.workspace.workspaceFolders;
      if (wsFolders && wsFolders.length > 0) {
        const wsFile = vscode.workspace.workspaceFile;
        if (wsFile) { workspaceFilePath = wsFile.fsPath; hasWorkspaceFile = true; }
      }
    } catch { /* ignore */ }

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
      proxyEnabled: ps.enabled,
      proxyActive: ps.active,
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
