/**
 * controlPanel.test.ts —— ControlPanelProvider 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { ControlPanelProvider } from '@ui/controlPanel';
import { getControlPanelHtml } from '@ui/controlPanel.html';
import {
  BUTTON_GROUPS, COMMAND_MAP,
  CONFIG_FIELDS, PROXY_FIELDS,
  getFieldType, CONFIG_KEY_MAP,
} from '@ui/controlPanelMessages';
import type { WebViewMessage } from '@ui/controlPanelMessages';
import { initI18n } from '@i18n';

function createMockWebviewView(): vscode.WebviewView {
  return {
    webview: {
      html: '', cspSource: 'vscode-webview://test',
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      postMessage: vi.fn(() => Promise.resolve(true)),
      asWebviewUri: vi.fn(), options: {},
    } as unknown as vscode.Webview,
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    visible: true, viewType: 'vscodeUEHelper.controlPanel',
    title: '', description: '', badge: undefined,
    show: vi.fn(), dispose: vi.fn(),
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
    configuration: 'Development', target: 'Editor', platform: 'Win64',
    completionMode: 'fast', useMCP: 'auto', autoBackupWorkspace: true, lspLoggingLevel: 'info',
    clangdProxyEnabled: false, clangdProxyKeepaliveMax: 20, clangdProxyKeepaliveTtlSec: 900,
    clangdProxyRealClangdPath: undefined, clangdProxyLogPath: undefined,
    clangdProxyLocalizationEnabled: false, clangdProxyLocalizationMode: 'append',
    clangdProxyLocalizationTargets: ['diagnostics', 'codeActions', 'hover'],
  };
  const updateCalls: Array<[string, unknown]> = [];
  const update = async (key: string, value: unknown) => { updateCalls.push([key, value]); cfg[key] = value; };
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
    update, _updateCalls: updateCalls,
    onDidChange: () => ({ dispose: () => {} }),
    ueVersion: undefined, clangdPath: undefined,
  } as unknown as import('@core/config').Config & { _updateCalls: Array<[string, unknown]> };
}

function createMockDetectionHandles() {
  return {
    scanner: { scan: vi.fn().mockResolvedValue([{ name: 'TestProject', path: '/test/TestProject.uproject' }]) },
    discovery: { discover: vi.fn().mockResolvedValue([{ version: '5.4', path: '/ue/5.4' }]) },
    workspaceContext: {
      getSelectedProject: vi.fn().mockReturnValue('/test/TestProject.uproject'),
      getSelectedEngine: vi.fn().mockReturnValue('/ue/5.4'),
      setProject: vi.fn(), setEngine: vi.fn(),
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

async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1));
}

describe('BUTTON_GROUPS', () => {
  it('defines 6 groups', () => { expect(BUTTON_GROUPS).toHaveLength(6); });
  it('each group has buttons mapped in COMMAND_MAP', () => {
    for (const g of BUTTON_GROUPS) for (const b of g.buttons) expect(COMMAND_MAP[b.id]).toBeTruthy();
  });
  it('tools has 4 buttons (showProjectInfo removed), proxy has 2 (showClangdProxyStatus removed)', () => {
    const tools = BUTTON_GROUPS.find((g) => g.id === 'tools');
    expect(tools?.buttons).toHaveLength(4);
    expect(tools?.buttons.find((b) => b.id === 'showProjectInfo')).toBeUndefined();
    const proxy = BUTTON_GROUPS.find((g) => g.id === 'proxy');
    expect(proxy?.buttons).toHaveLength(2);
    expect(proxy?.buttons.find((b) => b.id === 'showClangdProxyStatus')).toBeUndefined();
  });
});

describe('COMMAND_MAP', () => {
  it('contains 16 commands (showProjectInfo and showClangdProxyStatus removed)', () => {
    expect(Object.keys(COMMAND_MAP)).toEqual([
      'build', 'rebuild', 'clean', 'launchEditor', 'liveCoding',
      'createProject', 'generateCompileCommands', 'diagnoseProject',
      'toggleCompletionMode', 'setSystemIncludes', 'enableClangdProxy', 'disableClangdProxy',
      'regenerateWorkspace', 'openWorkspaceFile', 'installRules', 'uninstall',
    ]);
  });
});

describe('Config/Proxy field definitions', () => {
  it('CONFIG_FIELDS has expected fields', () => {
    expect(CONFIG_FIELDS).toEqual(['configuration', 'target', 'platform', 'completionMode', 'useMCP', 'lspLoggingLevel', 'autoBackupWorkspace']);
  });
  it('PROXY_FIELDS has expected fields', () => {
    expect(PROXY_FIELDS).toEqual(['clangdProxyEnabled', 'clangdProxyKeepaliveMax', 'clangdProxyKeepaliveTtlSec', 'clangdProxyRealClangdPath', 'clangdProxyLogPath', 'localizationEnabled', 'localizationMode', 'localizationTargets']);
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

describe('getControlPanelHtml', () => {
  beforeEach(() => { initI18n(); });
  it('returns valid HTML', () => {
    const html = getControlPanelHtml('vscode-webview://test', 'Test', '5.4');
    expect(html).toContain('<!DOCTYPE html>');
  });
  it('has all 4 tabs', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '');
    expect(html).toContain('id="tab-actions"');
    expect(html).toContain('id="tab-config"');
    expect(html).toContain('id="tab-proxy-settings"');
    expect(html).toContain('id="tab-status"');
  });
  it('renders config form fields', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '');
    expect(html).toContain('id="cfg-configuration"');
    expect(html).toContain('id="cfg-target"');
    expect(html).toContain('id="cfg-platform"');
    expect(html).toContain('id="cfg-completionMode"');
    expect(html).toContain('id="cfg-autoBackupWorkspace"');
    expect(html).toContain('id="config-save-btn"');
  });
  it('renders proxy form fields', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '');
    expect(html).toContain('id="proxy-clangdProxyEnabled"');
    expect(html).toContain('id="proxy-clangdProxyKeepaliveMax"');
    expect(html).toContain('id="proxy-clangdProxyRealClangdPath"');
    expect(html).toContain('id="proxy-localizationMode"');
    expect(html).toContain('name="proxy-localizationTargets"');
    expect(html).toContain('id="proxy-save-btn"');
  });
  it('status tab shows all sections', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '');
    expect(html).toContain('id="st-project-name"');
    expect(html).toContain('id="st-configuration"');
    expect(html).toContain('id="st-target"');
    expect(html).toContain('id="st-clangd-path"');
    expect(html).toContain('id="st-mcp-mode"');
    expect(html).toContain('id="st-proxy-enabled"');
    expect(html).toContain('id="st-proxy-launcher-path"');
    expect(html).toContain('id="st-proxy-keepalive"');
    expect(html).toContain('id="st-proxy-backup"');
    expect(html).toContain('id="status-refresh-btn"');
  });
});

describe('ControlPanelProvider', () => {
  let mockView: vscode.WebviewView;

  beforeEach(() => {
    initI18n();
    ControlPanelProvider.resetInstance();
    mockView = createMockWebviewView();
    (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mockImplementation(() => ({ dispose: vi.fn() }));
    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'vscodeUEHelper.unknown') return Promise.reject(new Error('unknown command'));
      return Promise.resolve();
    });
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('register calls registerWebviewViewProvider', () => {
    ControlPanelProvider.register(createDeps());
    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith(
      'vscodeUEHelper.controlPanel', expect.any(Object), expect.objectContaining({ webviewOptions: { retainContextWhenHidden: true } }),
    );
  });

  it('resolveWebviewView sets up HTML', () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(mockView, {} as any, {} as any);
    expect(mockView.webview.html).toContain('<!DOCTYPE html>');
    expect(mockView.webview.onDidReceiveMessage).toHaveBeenCalled();
  });

  it('handles executeCommand', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(mockView, {} as any, {} as any);
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'executeCommand', command: 'build' });
    await drain();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscodeUEHelper.build');
  });

  it('sends commandResult on success', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(mockView, {} as any, {} as any);
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'executeCommand', command: 'build' });
    await drain();
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'commandResult', success: true }));
  });

  it('handles getConfig', () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(mockView, {} as any, {} as any);
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'getConfig' });
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'configValues' }));
  });

  it('handles getProxyConfig', () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(mockView, {} as any, {} as any);
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'getProxyConfig' });
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'proxyConfigValues' }));
  });

  it('handles saveConfig batch updates', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(mockView, {} as any, {} as any);
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'saveConfig', updates: [{ key: 'configuration', value: 'Shipping' }, { key: 'target', value: 'Game' }] });
    await drain();
    const calls = mockView.webview.postMessage.mock.calls;
    const saveCall = calls.find((c: unknown[]) => c[0]?.type === 'saveResult');
    expect(saveCall).toBeDefined();
    expect(saveCall[0]).toMatchObject({ scope: 'config', result: { success: true, saved: 2, failed: 0 } });
  });

  it('handles saveProxyConfig batch updates', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(mockView, {} as any, {} as any);
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'saveProxyConfig', updates: [{ key: 'clangdProxyEnabled', value: true }, { key: 'clangdProxyKeepaliveMax', value: 10 }] });
    await drain();
    const calls = mockView.webview.postMessage.mock.calls;
    const saveCall = calls.find((c: unknown[]) => c[0]?.type === 'saveResult');
    expect(saveCall).toBeDefined();
    expect(saveCall[0]).toMatchObject({ scope: 'proxy', result: { success: true, saved: 2, failed: 0 } });
  });

  it('handles getStatus', () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(mockView, {} as any, {} as any);
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0][0];
    listener({ type: 'getStatus' });
    const calls = mockView.webview.postMessage.mock.calls;
    const statusCall = calls.find((c: unknown[]) => c[0]?.type === 'statusValues');
    expect(statusCall).toBeDefined();
    expect(statusCall[0].values).toMatchObject({ configuration: 'Development', target: 'Editor', proxyEnabled: false });
  });

  it('CONFIG_KEY_MAP maps proxy field names', () => {
    expect(CONFIG_KEY_MAP.clangdProxyEnabled).toBe('clangdProxy.enabled');
    expect(CONFIG_KEY_MAP.localizationMode).toBe('clangdProxy.localization.mode');
    expect(CONFIG_KEY_MAP.configuration).toBe('configuration');
  });

  it('show calls workbench.view.extension.ueHelper', () => {
    ControlPanelProvider.show();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.view.extension.ueHelper');
  });
});
