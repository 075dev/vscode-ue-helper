/**
 * controlPanel.test.ts —— ControlPanelProvider 单元测试
 *
 * 测试覆盖：
 * - 消息协议类型定义
 * - HTML 模板生成（含 Config/Proxy 表单）
 * - Provider 注册和单例行为
 * - resolveWebviewView 解析
 * - 消息路由（命令执行、配置读写）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { ControlPanelProvider } from '@ui/controlPanel';
import { getControlPanelHtml } from '@ui/controlPanel.html';
import {
  BUTTON_GROUPS, COMMAND_MAP,
  CONFIG_FIELDS, CONFIG_SELECTS, CONFIG_BOOLEANS,
  PROXY_FIELDS, PROXY_SELECTS, PROXY_BOOLEANS,
  getFieldType, CONFIG_KEY_MAP,
} from '@ui/controlPanelMessages';
import type { WebViewMessage, ConfigValues, ProxyConfigValues } from '@ui/controlPanelMessages';
import { initI18n } from '@i18n';

// ── Mocks ──

function createMockWebviewView(): vscode.WebviewView {
  return {
    webview: {
      html: '',
      cspSource: 'vscode-webview://test',
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      postMessage: vi.fn(() => Promise.resolve(true)),
      asWebviewUri: vi.fn(),
      options: {},
    } as unknown as vscode.Webview,
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    visible: true,
    viewType: 'vscodeUEHelper.controlPanel',
    title: 'UE Helper Control Panel',
    description: '',
    badge: undefined,
    show: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.WebviewView;
}

function createMockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    show: vi.fn(), setLevel: vi.fn(), channel: {} as never,
    prefix: 'test', currentLevel: 'info' as const, dispose: vi.fn(),
  } as unknown as import('@core/logger').Logger;
}

function createMockConfig() {
  const cfg: Record<string, unknown> = {
    configuration: 'Development',
    target: 'Editor',
    platform: 'Win64',
    completionMode: 'fast',
    useMCP: 'auto',
    autoBackupWorkspace: true,
    lspLoggingLevel: 'info',
    clangdProxyEnabled: false,
    clangdProxyKeepaliveMax: 20,
    clangdProxyKeepaliveTtlSec: 900,
    clangdProxyRealClangdPath: undefined,
    clangdProxyLogPath: undefined,
    clangdProxyLocalizationEnabled: false,
    clangdProxyLocalizationMode: 'append',
    clangdProxyLocalizationTargets: ['diagnostics', 'codeActions', 'hover'],
  };

  const updateCalls: Array<[string, unknown]> = [];
  const update = async (key: string, value: unknown) => {
    updateCalls.push([key, value]);
    cfg[key] = value;
  };

  return {
    get configuration() { return cfg.configuration; },
    get target() { return cfg.target; },
    get platform() { return cfg.platform; },
    get completionMode() { return cfg.completionMode; },
    get useMCP() { return cfg.useMCP; },
    get autoBackupWorkspace() { return cfg.autoBackupWorkspace; },
    get lspLoggingLevel() { return cfg.lspLoggingLevel; },
    get clangdProxyEnabled() { return cfg.clangdProxyEnabled; },
    get clangdProxyKeepaliveMax() { return cfg.clangdProxyKeepaliveMax; },
    get clangdProxyKeepaliveTtlSec() { return cfg.clangdProxyKeepaliveTtlSec; },
    get clangdProxyRealClangdPath() { return cfg.clangdProxyRealClangdPath; },
    get clangdProxyLogPath() { return cfg.clangdProxyLogPath; },
    get clangdProxyLocalizationEnabled() { return cfg.clangdProxyLocalizationEnabled; },
    get clangdProxyLocalizationMode() { return cfg.clangdProxyLocalizationMode; },
    get clangdProxyLocalizationTargets() { return cfg.clangdProxyLocalizationTargets; },
    update,
    _updateCalls: updateCalls,
    onDidChange: () => ({ dispose: () => {} }),
    ueVersion: undefined,
    clangdPath: undefined,
  } as unknown as import('@core/config').Config & { _updateCalls: Array<[string, unknown]> };
}

function createMockDetectionHandles() {
  const scan = vi.fn().mockResolvedValue([{ name: 'TestProject', path: '/test/TestProject.uproject' }]);
  const discover = vi.fn().mockResolvedValue([{ version: '5.4', path: '/ue/5.4' }]);
  return {
    scanner: { scan },
    discovery: { discover },
    workspaceContext: {
      getSelectedProject: vi.fn().mockReturnValue('/test/TestProject.uproject'),
      getSelectedEngine: vi.fn().mockReturnValue('/ue/5.4'),
      setProject: vi.fn(),
      setEngine: vi.fn(),
    },
    ready: Promise.resolve(),
  };
}

function createMockClangdHandles() {
  return {
    proxyManager: {
      getStatus: vi.fn().mockReturnValue({
        enabled: false, active: false, launcherPath: '',
        realClangdPath: undefined, keepaliveMax: 20, keepaliveTtlSec: 900,
        localizationEnabled: false, localizationMode: 'append',
        localizationTargets: [], logPath: undefined, backupExists: false,
        lastKnownProblem: undefined,
      }),
      enable: vi.fn(), disable: vi.fn(),
    },
  };
}

function createDeps() {
  return {
    context: { subscriptions: [] } as unknown as vscode.ExtensionContext,
    config: createMockConfig(),
    logger: createMockLogger(),
    detection: createMockDetectionHandles() as never,
    clangd: createMockClangdHandles() as never,
  };
}

/** Drain microtasks so async void handlers complete. */
async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1));
}

// ── Message Protocol Tests ──

describe('BUTTON_GROUPS', () => {
  it('defines 6 groups', () => {
    expect(BUTTON_GROUPS).toHaveLength(6);
  });

  it('each group has buttons mapped in COMMAND_MAP', () => {
    for (const group of BUTTON_GROUPS) {
      for (const btn of group.buttons) {
        expect(COMMAND_MAP[btn.id]).toBeTruthy();
      }
    }
  });

  it('tools group has 4 buttons (showProjectInfo removed), proxy has 2 (showClangdProxyStatus removed)', () => {
    const tools = BUTTON_GROUPS.find((g) => g.id === 'tools');
    expect(tools?.buttons).toHaveLength(4);
    expect(tools?.buttons.find((b) => b.id === 'showProjectInfo')).toBeUndefined();

    const proxy = BUTTON_GROUPS.find((g) => g.id === 'proxy');
    expect(proxy?.buttons).toHaveLength(2);
    expect(proxy?.buttons.find((b) => b.id === 'showClangdProxyStatus')).toBeUndefined();
  });
});

describe('COMMAND_MAP', () => {
  it('contains all 16 expected commands (showProjectInfo and showClangdProxyStatus removed)', () => {
    expect(Object.keys(COMMAND_MAP)).toEqual([
      'build', 'rebuild', 'clean',
      'launchEditor', 'liveCoding',
      'createProject', 'generateCompileCommands',
      'diagnoseProject', 'toggleCompletionMode', 'setSystemIncludes',
      'enableClangdProxy', 'disableClangdProxy',
      'regenerateWorkspace', 'openWorkspaceFile',
      'installRules', 'uninstall',
    ]);
  });
});

describe('Config/Proxy field definitions', () => {
  it('CONFIG_FIELDS has expected fields', () => {
    expect(CONFIG_FIELDS).toEqual([
      'configuration', 'target', 'platform',
      'completionMode', 'useMCP', 'lspLoggingLevel', 'autoBackupWorkspace',
    ]);
  });

  it('PROXY_FIELDS has expected fields', () => {
    expect(PROXY_FIELDS).toEqual([
      'clangdProxyEnabled', 'clangdProxyKeepaliveMax', 'clangdProxyKeepaliveTtlSec',
      'clangdProxyRealClangdPath', 'clangdProxyLogPath',
      'localizationEnabled', 'localizationMode', 'localizationTargets',
    ]);
  });

  it('getFieldType returns correct types', () => {
    expect(getFieldType('configuration', false)).toBe('select');
    expect(getFieldType('autoBackupWorkspace', false)).toBe('boolean');
    expect(getFieldType('clangdProxyKeepaliveMax', true)).toBe('number');
    expect(getFieldType('clangdProxyRealClangdPath', true)).toBe('text');
    expect(getFieldType('localizationMode', true)).toBe('select');
    expect(getFieldType('clangdProxyEnabled', true)).toBe('boolean');
  });
});

// ── HTML Template Tests ──

describe('getControlPanelHtml', () => {
  beforeEach(() => { initI18n(); });

  it('returns valid HTML', () => {
    const html = getControlPanelHtml('vscode-webview://test', 'TestProject', '5.4');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes project name and engine version', () => {
    const html = getControlPanelHtml('vscode-webview://test', 'MyProject', '5.3');
    expect(html).toContain('MyProject');
    expect(html).toContain('UE 5.3');
  });

  it('contains all button data-command attributes', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '');
    for (const group of BUTTON_GROUPS) {
      for (const btn of group.buttons) {
        expect(html).toContain(`data-command="${btn.id}"`);
      }
    }
  });

  it('has CSP meta tag', () => {
    const html = getControlPanelHtml('vscode-webview://abc', '', '');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('vscode-webview://abc');
  });

  it('handles empty project/engine gracefully', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '');
    expect(html).not.toContain('undefined');
  });

  it('has all 4 tabs', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '');
    expect(html).toContain('id="tab-actions"');
    expect(html).toContain('id="tab-config"');
    expect(html).toContain('id="tab-proxy-settings"');
    expect(html).toContain('id="tab-status"');
  });

  it('renders config tab with form fields', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '');
    expect(html).toContain('id="content-config"');
    expect(html).toContain('id="cfg-configuration"');
    expect(html).toContain('id="cfg-target"');
    expect(html).toContain('id="cfg-platform"');
    expect(html).toContain('id="cfg-completionMode"');
    expect(html).toContain('id="cfg-useMCP"');
    expect(html).toContain('id="cfg-lspLoggingLevel"');
    expect(html).toContain('id="cfg-autoBackupWorkspace"');
    expect(html).toContain('id="config-save-btn"');
  });

  it('renders proxy tab with form fields', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '');
    expect(html).toContain('id="content-proxy"');
    expect(html).toContain('id="proxy-clangdProxyEnabled"');
    expect(html).toContain('id="proxy-clangdProxyKeepaliveMax"');
    expect(html).toContain('id="proxy-clangdProxyKeepaliveTtlSec"');
    expect(html).toContain('id="proxy-clangdProxyRealClangdPath"');
    expect(html).toContain('id="proxy-clangdProxyLogPath"');
    expect(html).toContain('id="proxy-localizationEnabled"');
    expect(html).toContain('id="proxy-localizationMode"');
    expect(html).toContain('name="proxy-localizationTargets"');
    expect(html).toContain('id="proxy-save-btn"');
  });

  it('status tab shows all status sections with full details', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '');
    expect(html).toContain('id="content-status"');
    // Project section
    expect(html).toContain('id="st-project-name"');
    expect(html).toContain('id="st-project-path"');
    expect(html).toContain('id="st-engine-version"');
    expect(html).toContain('id="st-engine-path"');
    expect(html).toContain('id="st-workspace-file"');
    // Build/Config section (replaces showProjectInfo)
    expect(html).toContain('id="st-configuration"');
    expect(html).toContain('id="st-target"');
    expect(html).toContain('id="st-platform"');
    expect(html).toContain('id="st-clangd-path"');
    expect(html).toContain('id="st-completion-mode"');
    expect(html).toContain('id="st-mcp-mode"');
    expect(html).toContain('id="st-mcp-host"');
    expect(html).toContain('id="st-log-level"');
    // Proxy section (replaces showClangdProxyStatus)
    expect(html).toContain('id="st-proxy-enabled"');
    expect(html).toContain('id="st-proxy-active"');
    expect(html).toContain('id="st-proxy-launcher-path"');
    expect(html).toContain('id="st-proxy-real-clangd"');
    expect(html).toContain('id="st-proxy-keepalive"');
    expect(html).toContain('id="st-proxy-log-path"');
    expect(html).toContain('id="st-proxy-backup"');
    expect(html).toContain('id="st-localization"');
    expect(html).toContain('id="status-refresh-btn"');
    expect(html).not.toContain('Coming soon');
  });

  it('contains postMessage and acquireVsCodeApi', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '');
    expect(html).toContain('postMessage');
    expect(html).toContain('acquireVsCodeApi');
  });
});

// ── Provider Tests ──

describe('ControlPanelProvider (WebviewViewProvider)', () => {
  let mockView: vscode.WebviewView;

  beforeEach(() => {
    initI18n();
    ControlPanelProvider.resetInstance();
    mockView = createMockWebviewView();
    (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ dispose: vi.fn() }),
    );
    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string) => {
        if (cmd === 'vscodeUEHelper.unknown') return Promise.reject(new Error('unknown command'));
        return Promise.resolve();
      },
    );
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('register calls registerWebviewViewProvider', () => {
    ControlPanelProvider.register(createDeps());
    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith(
      'vscodeUEHelper.controlPanel',
      expect.any(Object),
      expect.objectContaining({ webviewOptions: { retainContextWhenHidden: true } }),
    );
  });

  it('resolveWebviewView sets up HTML and message listener', () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    const provider = ControlPanelProvider.getInstance();
    provider.resolveWebviewView(mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    expect(mockView.webview.html).toContain('<!DOCTYPE html>');
    expect(mockView.webview.onDidReceiveMessage).toHaveBeenCalled();
  });

  it('sends updateTitle after async refresh', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken,
    );
    await drain();
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'updateTitle', projectName: 'TestProject', engineVersion: '5.4' }),
    );
  });

  it('handles executeCommand message', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'executeCommand', command: 'build' });
    await drain();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscodeUEHelper.build');
  });

  it('sends commandResult on success', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'executeCommand', command: 'build' });
    await drain();
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'commandResult', command: 'build', success: true }),
    );
  });

  it('sends commandResult on failure', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'executeCommand', command: 'unknown' });
    await drain();
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'commandResult', command: 'unknown', success: false }),
    );
  });

  it('handles getConfig and returns config values', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'getConfig' });
    await drain();

    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'configValues',
        values: expect.objectContaining({
          configuration: 'Development',
          target: 'Editor',
          platform: 'Win64',
          completionMode: 'fast',
          useMCP: 'auto',
          autoBackupWorkspace: true,
          lspLoggingLevel: 'info',
        }),
      }),
    );
  });

  it('handles getProxyConfig and returns proxy config values', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'getProxyConfig' });
    await drain();

    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'proxyConfigValues',
        values: expect.objectContaining({
          clangdProxyEnabled: false,
          clangdProxyKeepaliveMax: 20,
          clangdProxyKeepaliveTtlSec: 900,
          localizationEnabled: false,
          localizationMode: 'append',
        }),
      }),
    );
  });

  it('handles updateConfig and calls config.update', () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'updateConfig', key: 'configuration', value: 'Shipping' });

    const calls = (deps.config as unknown as { _updateCalls: Array<[string, unknown]> })._updateCalls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual(['configuration', 'Shipping']);
  });

  it('handles updateProxyConfig and calls config.update with mapped key', () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'updateProxyConfig', key: 'clangdProxyEnabled', value: true });

    const calls = (deps.config as unknown as { _updateCalls: Array<[string, unknown]> })._updateCalls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual(['clangdProxy.enabled', true]);
  });

  it('handles getStatus and returns expanded status values', () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];

    expect(() => listener({ type: 'getStatus' })).not.toThrow();

    const calls = mockView.webview.postMessage.mock.calls;
    const statusCall = calls.find((c: unknown[]) => c[0]?.type === 'statusValues');
    expect(statusCall).toBeDefined();
    expect(statusCall[0].values).toMatchObject({
      // projectName/engineVersion set asynchronously via refreshTitleInfo
      configuration: 'Development',
      target: 'Editor',
      platform: 'Win64',
      completionMode: 'fast',
      mcpMode: 'auto',
      logLevel: 'info',
      proxyEnabled: false,
      proxyActive: false,
      proxyKeepaliveMax: 20,
      proxyKeepaliveTtlSec: 900,
      proxyLocalizationEnabled: false,
      proxyLocalizationMode: 'append',
    });
  });

  it('handles saveConfig with batch updates and sends saveResult', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({
      type: 'saveConfig',
      updates: [
        { key: 'configuration', value: 'Shipping' },
        { key: 'target', value: 'Game' },
      ],
    });
    await drain();

    const calls = mockView.webview.postMessage.mock.calls;
    const saveCall = calls.find((c: unknown[]) => c[0]?.type === 'saveResult');
    expect(saveCall).toBeDefined();
    expect(saveCall[0]).toMatchObject({
      scope: 'config',
      result: { success: true, saved: 2, failed: 0 },
    });
  });

  it('handles saveProxyConfig with batch updates and sends saveResult', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({
      type: 'saveProxyConfig',
      updates: [
        { key: 'clangdProxyEnabled', value: true },
        { key: 'clangdProxyKeepaliveMax', value: 10 },
      ],
    });
    await drain();

    const calls = mockView.webview.postMessage.mock.calls;
    const saveCall = calls.find((c: unknown[]) => c[0]?.type === 'saveResult');
    expect(saveCall).toBeDefined();
    expect(saveCall[0]).toMatchObject({
      scope: 'proxy',
      result: { success: true, saved: 2, failed: 0 },
    });
  });

  it('CONFIG_KEY_MAP maps proxy field names to VS Code config keys', () => {
    expect(CONFIG_KEY_MAP.clangdProxyEnabled).toBe('clangdProxy.enabled');
    expect(CONFIG_KEY_MAP.clangdProxyKeepaliveMax).toBe('clangdProxy.keepaliveMax');
    expect(CONFIG_KEY_MAP.clangdProxyKeepaliveTtlSec).toBe('clangdProxy.keepaliveTtlSec');
    expect(CONFIG_KEY_MAP.clangdProxyRealClangdPath).toBe('clangdProxy.realClangdPath');
    expect(CONFIG_KEY_MAP.clangdProxyLogPath).toBe('clangdProxy.logPath');
    expect(CONFIG_KEY_MAP.localizationEnabled).toBe('clangdProxy.localization.enabled');
    expect(CONFIG_KEY_MAP.localizationMode).toBe('clangdProxy.localization.mode');
    expect(CONFIG_KEY_MAP.localizationTargets).toBe('clangdProxy.localization.targets');
    // Non-proxy fields should pass through
    expect(CONFIG_KEY_MAP.configuration).toBe('configuration');
    expect(CONFIG_KEY_MAP.completionMode).toBe('completionMode');
  });

  it('handles panelReady without error', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'panelReady' });
    await drain();
  });

  it('show calls workbench.view.extension.ueHelper', () => {
    ControlPanelProvider.show();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.view.extension.ueHelper');
  });
});
