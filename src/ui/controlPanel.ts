import * as vscode from 'vscode';
import { ClangdProxy } from '../clangd/proxy';
import { getHtmlContent } from './controlPanel.html';
import {
  WebViewMessage,
  ProxyStateMessage,
  ProxyActionMessage,
  ConfigUpdateMessage,
  NotificationMessage,
} from './controlPanelMessages';
import { t } from '../i18n';

export class ClangdProxyControlPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ueHelper.clangdProxyControlPanel';

  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];
  private _proxy?: ClangdProxy;
  private _proxyStatePollTimer?: NodeJS.Timeout;
  private readonly _pollInterval = 2000; // 2s polling

  constructor(private readonly _extensionUri: vscode.Uri) {}

  /**
   * 设置 ClangdProxy 实例并开始监听状态变化
   */
  public setProxy(proxy: ClangdProxy): void {
    this._proxy = proxy;
    this._startPolling();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(
      (msg: WebViewMessage) => this._handleMessage(msg),
      undefined,
      this._disposables
    );

    // 视图可见时推送初始状态
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._pushState();
      }
    });

    // 推送初始状态
    this._pushState();

    webviewView.title = t('controlPanel.title');
  }

  /**
   * 生成 HTML 内容，注入非交互式数据
   */
  private _getHtml(webview: vscode.Webview): string {
    const nonce = this._getNonce();
    return getHtmlContent({ nonce, webview, extensionUri: this._extensionUri });
  }

  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 64; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /**
   * 处理来自 WebView 的消息
   */
  private _handleMessage(msg: WebViewMessage): void {
    switch (msg.type) {
      case 'getState':
        this._pushState();
        break;

      case 'startProxy':
        this._handleProxyAction('start');
        break;

      case 'stopProxy':
        this._handleProxyAction('stop');
        break;

      case 'restartProxy':
        this._handleProxyAction('restart');
        break;

      case 'updateConfig':
        this._handleConfigUpdate(msg as ConfigUpdateMessage);
        break;

      default:
        console.warn(`[ClangdProxyControlPanel] Unknown message type: ${(msg as any).type}`);
    }
  }

  /**
   * 处理代理启动/停止/重启操作
   */
  private async _handleProxyAction(action: 'start' | 'stop' | 'restart'): Promise<void> {
    if (!this._proxy) {
      this._postNotification(t('controlPanel.proxyNotAvailable'), 'error');
      return;
    }

    try {
      switch (action) {
        case 'start':
          this._postNotification(t('controlPanel.starting'), 'info');
          await this._proxy.start();
          this._postNotification(t('controlPanel.started'), 'success');
          break;
        case 'stop':
          this._postNotification(t('controlPanel.stopping'), 'info');
          await this._proxy.stop();
          this._postNotification(t('controlPanel.stopped'), 'success');
          break;
        case 'restart':
          this._postNotification(t('controlPanel.restarting'), 'info');
          await this._proxy.stop();
          await this._proxy.start();
          this._postNotification(t('controlPanel.restarted'), 'success');
          break;
      }
      this._pushState();
    } catch (err: any) {
      this._postNotification(
        t('controlPanel.actionFailed', action, err.message || String(err)),
        'error'
      );
    }
  }

  /**
   * 处理配置更新
   */
  private async _handleConfigUpdate(msg: ConfigUpdateMessage): Promise<void> {
    const config = vscode.workspace.getConfiguration('ueHelper.clangdProxy');
    try {
      for (const [key, value] of Object.entries(msg.config)) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
      }
      this._postNotification(t('controlPanel.configUpdated'), 'success');
      this._pushState();
    } catch (err: any) {
      this._postNotification(
        t('controlPanel.configUpdateFailed', err.message || String(err)),
        'error'
      );
    }
  }

  /**
   * 推送代理状态到 WebView
   */
  private _pushState(): void {
    if (!this._view?.visible || !this._proxy) {
      return;
    }

    const state = this._proxy.getState();
    const message: ProxyStateMessage = {
      type: 'stateUpdate',
      state: {
        status: state.status,
        port: state.port,
        pid: state.pid,
        uptime: state.uptime,
        requestCount: state.requestCount,
        activeRequests: state.activeRequests,
        errorCount: state.errorCount,
        logLines: state.logLines,
        compileCommandsPath: state.compileCommandsPath,
      },
    };

    this._view.webview.postMessage(message);
  }

  /**
   * 发送通知到 WebView
   */
  private _postNotification(text: string, level: 'info' | 'success' | 'error'): void {
    if (!this._view?.visible) {
      return;
    }
    const msg: NotificationMessage = {
      type: 'notification',
      level,
      text,
    };
    this._view.webview.postMessage(msg);
  }

  /**
   * 定期轮询代理状态
   */
  private _startPolling(): void {
    this._stopPolling();
    this._proxyStatePollTimer = setInterval(() => {
      this._pushState();
    }, this._pollInterval);
  }

  private _stopPolling(): void {
    if (this._proxyStatePollTimer) {
      clearInterval(this._proxyStatePollTimer);
      this._proxyStatePollTimer = undefined;
    }
  }

  /**
   * 清理资源
   */
  public dispose(): void {
    this._stopPolling();
    this._view = undefined;
    this._proxy = undefined;
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}
