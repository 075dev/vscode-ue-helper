/**
 * controlPanel.test.ts —— ControlPanelProvider 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { ControlPanelProvider } from '@ui/controlPanel';
import { getControlPanelHtml } from '@ui/controlPanel.html';
import {
  BUTTON_GROUPS,
  COMMAND_MAP,
  CONFIG_FIELDS,
  PROXY_FIELDS,
  getFieldType,
  CONFIG_KEY_MAP,
} from '@ui/controlPanelMessages';
import { initI18n } from '@i18n';

type MockWebviewView = vscode.WebviewView & {
  webview: vscode.Webview & {
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
  };
};

function createMockWebviewView(): MockWebviewView {
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
    title: '',
    description: '',
    badge: undefined,
    show: vi.fn(),
    dispose: vi.fn(),
  } as unknown as MockWebviewView;
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    show: vi.fn(),
    setLevel: vi.fn(),
    channel: {} as never,
    prefix: 'test',
    currentLevel: 'info' as const,
    dispose: vi.fn(),
  } as unknown as import('@core/logger').Logger;
}

function createMockConfig() {
  // 真实 Config 内部用 this.root.get<...>("clangdProxy.enabled") 这种**带点号全名**读取
  // （见 src/core/config.ts:167-218）。所以 mock 必须用同样的全名作为存储键，getter 通过 cfg['...'] 重读。
  const cfg: Record<string, unknown> = {
    configuration: 'Development',
    target: 'Editor',
    platform: 'Win64',
    // T2.1 后 completionMode 永远是 'slow'；mock config 也改为 'slow' 保持状态栏状态一致。
    completionMode: 'slow',
    useMCP: 'auto',
    autoBackupWorkspace: true,
    lspLoggingLevel: 'info',
    'clangdProxy.enabled': false,
    'clangdProxy.keepaliveMax': 20,
    'clangdProxy.keepaliveTtlSec': 900,
    'clangdProxy.realClangdPath': undefined,
    'clangdProxy.logPath': undefined,
    'clangdProxy.localization.enabled': false,
    'clangdProxy.localization.mode': 'append',
    'clangdProxy.localization.targets': ['diagnostics', 'codeActions', 'hover'],
  };
  const updateCalls: Array<[string, unknown]> = [];
  const update = (key: string, value: unknown): Promise<void> => {
    updateCalls.push([key, value]);
    cfg[key] = value;
    return Promise.resolve();
  };
  return {
    get configuration() {
      return cfg.configuration;
    },
    get target() {
      return cfg.target;
    },
    get platform() {
      return cfg.platform;
    },
    get completionMode() {
      return cfg.completionMode;
    },
    get useMCP() {
      return cfg.useMCP;
    },
    get autoBackupWorkspace() {
      return cfg.autoBackupWorkspace;
    },
    get lspLoggingLevel() {
      return cfg.lspLoggingLevel;
    },
    get clangdProxyEnabled() {
      return cfg['clangdProxy.enabled'];
    },
    get clangdProxyKeepaliveMax() {
      return cfg['clangdProxy.keepaliveMax'];
    },
    get clangdProxyKeepaliveTtlSec() {
      return cfg['clangdProxy.keepaliveTtlSec'];
    },
    get clangdProxyRealClangdPath() {
      return cfg['clangdProxy.realClangdPath'];
    },
    get clangdProxyLogPath() {
      return cfg['clangdProxy.logPath'];
    },
    get clangdProxyLocalizationEnabled() {
      return cfg['clangdProxy.localization.enabled'];
    },
    get clangdProxyLocalizationMode() {
      return cfg['clangdProxy.localization.mode'];
    },
    get clangdProxyLocalizationTargets() {
      return cfg['clangdProxy.localization.targets'];
    },
    update,
    _updateCalls: updateCalls,
    // 真实 Config.onDidChange 返回 listener subscription；测试里 mock 也保留订阅并提供
    // _fire()，方便"用户从 settings.json 改了配置"这条路径做端到端回归。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onDidChange: createMockOnDidChange(),
    ueVersion: undefined,
    clangdPath: undefined,
  } as unknown as import('@core/config').Config & { _updateCalls: Array<[string, unknown]> };
}

// 抽出 onDidChange mock 工厂，避免在 createMockConfig 大字面量里写 IIFE + 自引用导致
// lint/类型签名混乱。返回 callable + vi.fn 包装以兼容 toHaveBeenCalledTimes 等 spy 断言。
function createMockOnDidChange() {
  type Listener = (e: { affectsConfiguration: (k: string) => boolean }) => void;
  const listeners: Listener[] = [];
  const subscription = { dispose: vi.fn() };
  const spy = vi.fn((listener: Listener) => {
    listeners.push(listener);
    return subscription;
  });
  // 测试钩子：手动触发所有订阅者。参数模拟真实 ConfigurationChangeEvent 形状。
  const fire = (key: string): void => {
    for (const l of listeners) {
      l({ affectsConfiguration: (k: string) => k.startsWith('vscodeUEHelper.') || k === key });
    }
  };
  const result = spy as unknown as ReturnType<typeof spy> & {
    _fire: typeof fire;
    _listeners: Listener[];
  };
  result._fire = fire;
  result._listeners = listeners;
  return result;
}

function createMockDetectionHandles() {
  return {
    scanner: {
      scan: vi
        .fn()
        .mockResolvedValue([{ name: 'TestProject', path: '/test/TestProject.uproject' }]),
    },
    discovery: { discover: vi.fn().mockResolvedValue([{ version: '5.4', path: '/ue/5.4' }]) },
    workspaceContext: {
      getSelectedProject: vi.fn().mockReturnValue('/test/TestProject.uproject'),
      getSelectedEngine: vi.fn().mockReturnValue('/ue/5.4'),
      setProject: vi.fn(),
      setEngine: vi.fn(),
    },
    ready: Promise.resolve(),
  };
}

function createMockClangdHandles(config: ReturnType<typeof createMockConfig>) {
  // isActive 真实读 settingsManager.isUsingOurLauncher（跟 clangd.path 实际值有关）。
  // 默认 false；测试可在拿到 mock 后通过赋值改写模拟 enable/disable 效果。
  let isActive = false;
  return {
    proxyManager: {
      // 真实 proxyManager.getStatus() 内部从 this.config 读 enabled/keepalive*/localization*/logPath，
      // 这里 mock 也同步行为：每次调用重读 config getter，让"保存后推 statusValues"的回归
      // 测试能验证真实字段链。
      getStatus: vi.fn().mockImplementation(() => ({
        enabled: config.clangdProxyEnabled,
        active: isActive,
        launcherPath: '',
        realClangdPath: config.clangdProxyRealClangdPath,
        keepaliveMax: config.clangdProxyKeepaliveMax,
        keepaliveTtlSec: config.clangdProxyKeepaliveTtlSec,
        localizationEnabled: config.clangdProxyLocalizationEnabled,
        localizationMode: config.clangdProxyLocalizationMode,
        logPath: config.clangdProxyLogPath,
        backupExists: false,
        lastKnownProblem: undefined,
      })),
      get isActive() {
        return isActive;
      },
      // 暴露 setter 让测试可以模拟 enable/disable 命令路径：实际场景下
      // settingsManager.enable() 把 clangd.path 改成 launcher → isActive=true。
      _setActive(v: boolean) {
        isActive = v;
      },
      enable: vi.fn(),
      disable: vi.fn(),
    },
  };
}

function createDeps() {
  const config = createMockConfig();
  return {
    context: { subscriptions: [] } as unknown as vscode.ExtensionContext,
    config,
    logger: createMockLogger(),
    detection: createMockDetectionHandles() as unknown as import('@detection').DetectionHandles,
    clangd: createMockClangdHandles(config) as unknown as import('@clangd').ClangdHandles,
  };
}

async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1));
}

describe('BUTTON_GROUPS', () => {
  it('defines 6 groups', () => {
    expect(BUTTON_GROUPS).toHaveLength(6);
  });
  it('each group has buttons mapped in COMMAND_MAP', () => {
    for (const g of BUTTON_GROUPS) {
      for (const b of g.buttons) {
        expect(COMMAND_MAP[b.id]).toBeTruthy();
      }
    }
  });
  it('tools has 3 buttons (regenerateWorkspace removed), proxy has 2 (showClangdProxyStatus removed)', () => {
    const tools = BUTTON_GROUPS.find((g) => g.id === 'tools');
    expect(tools?.buttons).toHaveLength(3);
    expect(tools?.buttons.find((b) => b.id === 'regenerateWorkspace')).toBeUndefined();
    const proxy = BUTTON_GROUPS.find((g) => g.id === 'proxy');
    expect(proxy?.buttons).toHaveLength(2);
  });
});

describe('COMMAND_MAP', () => {
  it('contains 14 panel commands (5 others: showProjectInfo/showClangdProxyStatus/showControlPanel/selectConfig/selectTarget are out of panel; toggleCompletionMode removed per Plan B)', () => {
    expect(Object.keys(COMMAND_MAP)).toEqual([
      'build',
      'rebuild',
      'clean',
      'launchEditor',
      'liveCoding',
      'createProject',
      'generateCompileCommands',
      'diagnoseProject',
      'setSystemIncludes',
      'enableClangdProxy',
      'disableClangdProxy',
      'openWorkspaceFile',
      'installRules',
      'uninstall',
    ]);
  });
});

describe('Config/Proxy field definitions', () => {
  it('CONFIG_FIELDS has expected fields', () => {
    // T2.1：completionMode 不再作为用户可配置项出现在 CONFIG_FIELDS 中。
    expect(CONFIG_FIELDS).toEqual([
      'configuration',
      'target',
      'useMCP',
      'lspLoggingLevel',
      'autoBackupWorkspace',
    ]);
  });
  it('PROXY_FIELDS has expected fields', () => {
    expect(PROXY_FIELDS).toEqual([
      'clangdProxyEnabled',
      'clangdProxyKeepaliveMax',
      'clangdProxyKeepaliveTtlSec',
      'clangdProxyRealClangdPath',
      'clangdProxyLogPath',
      'localizationEnabled',
      'localizationMode',
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

describe('getControlPanelHtml', () => {
  beforeEach(() => {
    initI18n();
  });
  it('returns valid HTML', () => {
    const html = getControlPanelHtml('vscode-webview://test', 'Test', '5.4', []);
    expect(html).toContain('<!DOCTYPE html>');
  });
  it('has all 5 tabs (含 Plan Add 收束 自定义 Add)', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '', []);
    expect(html).toContain('id="tab-actions"');
    expect(html).toContain('id="tab-config"');
    expect(html).toContain('id="tab-add-flags"');
    expect(html).toContain('id="tab-proxy-settings"');
    expect(html).toContain('id="tab-status"');
  });
  it('渲染 add-flags 内容容器 + save 按钮', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '', []);
    expect(html).toContain('id="content-add-flags"');
    expect(html).toContain('id="add-flags-save-btn"');
    expect(html).toContain('id="add-flag-list"');
  });
  it('注入 glossary 元数据 ADD_FLAG_ENTRIES JSON', () => {
    const entries = [
      {
        id: 'compat-header',
        category: 'forced-include',
        title: 'T',
        description: 'D',
        severity: 'recommended' as const,
      },
    ];
    const html = getControlPanelHtml('vscode-webview://test', '', '', entries);
    expect(html).toContain('"id":"compat-header"');
    expect(html).toContain('"category":"forced-include"');
  });
  it('renders config form fields', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '', []);
    expect(html).toContain('id="cfg-configuration"');
    expect(html).toContain('id="cfg-target"');
    expect(html).toContain('id="cfg-autoBackupWorkspace"');
    expect(html).toContain('id="config-save-btn"');
    // T2.1：completionMode 不再是表单字段，由面板内嵌提示文案解释已合并。
    // 测试走默认 'en' locale，匹配面板里的提示正文片段。
    expect(html).toContain('Fast/Slow modes have been merged');
    expect(html).not.toContain('id="cfg-completionMode"');
    // platform 切换选项已删除（只读 status 保留）
    expect(html).not.toContain('id="cfg-platform"');
  });
  it('renders proxy form fields', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '', []);
    expect(html).toContain('id="proxy-clangdProxyEnabled"');
    expect(html).toContain('id="proxy-clangdProxyKeepaliveMax"');
    expect(html).toContain('id="proxy-clangdProxyRealClangdPath"');
    expect(html).toContain('id="proxy-localizationMode"');
    expect(html).toContain('id="proxy-save-btn"');
  });
  it('status tab shows all sections', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '', []);
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
  let mockView: MockWebviewView;

  beforeEach(() => {
    initI18n();
    ControlPanelProvider.resetInstance();
    mockView = createMockWebviewView();
    (vscode.window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ dispose: vi.fn() }),
    );
    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string) => {
        if (cmd === 'vscodeUEHelper.unknown') {
          return Promise.reject(new Error('unknown command'));
        }
        return Promise.resolve();
      },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('register calls registerWebviewViewProvider', () => {
    ControlPanelProvider.register(createDeps());
    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith(
      'vscodeUEHelper.controlPanel',
      expect.any(Object),
      expect.objectContaining({ webviewOptions: { retainContextWhenHidden: true } }),
    );
  });

  it('resolveWebviewView sets up HTML', () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    expect(mockView.webview.html).toContain('<!DOCTYPE html>');
    expect(mockView.webview.onDidReceiveMessage).toHaveBeenCalled();
  });

  it('handles executeCommand', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({ type: 'executeCommand', command: 'build' });
    await drain();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscodeUEHelper.build');
  });

  it('sends commandResult on success', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({ type: 'executeCommand', command: 'build' });
    await drain();
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'commandResult', success: true }),
    );
  });

  it('handles getConfig', () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({ type: 'getConfig' });
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'configValues' }),
    );
  });

  it('handles getProxyConfig', () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({ type: 'getProxyConfig' });
    expect(mockView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'proxyConfigValues' }),
    );
  });

  it('handles saveConfig batch updates', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({
      type: 'saveConfig',
      updates: [
        { key: 'configuration', value: 'Shipping' },
        { key: 'target', value: 'Game' },
      ],
    });
    await drain();
    const calls = mockView.webview.postMessage.mock.calls;
    const saveCall = calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'saveResult',
    );
    expect(saveCall).toBeDefined();
    expect(saveCall![0]).toMatchObject({
      scope: 'config',
      result: { success: true, saved: 2, failed: 0 },
    });
  });

  // [Status 同步 bug 回归测试] 保存 config 后必须推一次 statusValues，
  // 否则 Status Tab 上看到的 configuration / target 等字段不会刷新。
  it('saveConfig 后同步推送 statusValues 反映新值', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({
      type: 'saveConfig',
      updates: [
        { key: 'configuration', value: 'Shipping' },
        { key: 'target', value: 'Game' },
      ],
    });
    await drain();
    const calls = mockView.webview.postMessage.mock.calls;
    const statusCall = calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'statusValues',
    );
    expect(statusCall).toBeDefined();
    expect(
      (statusCall![0] as { values: { configuration: string; target: string } }).values,
    ).toMatchObject({
      configuration: 'Shipping',
      target: 'Game',
    });
  });

  it('handles saveProxyConfig batch updates', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({
      type: 'saveProxyConfig',
      updates: [
        { key: 'clangdProxyEnabled', value: true },
        { key: 'clangdProxyKeepaliveMax', value: 10 },
      ],
    });
    await drain();
    const calls = mockView.webview.postMessage.mock.calls;
    const saveCall = calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'saveResult',
    );
    expect(saveCall).toBeDefined();
    expect(saveCall![0]).toMatchObject({
      scope: 'proxy',
      result: { success: true, saved: 2, failed: 0 },
    });
  });

  // [Status 同步 bug 回归测试] 保存 proxy 配置后必须同步推 statusValues，让 Status Tab
  // 上看到的 proxyEnabled / keepaliveMax / localizationEnabled / logPath 等实时刷新。
  // proxyRealClangdPath / logPath 走 'value ?? (auto-detect)/(not set)' 显示逻辑；测试用
  // 真实字符串以绕开回落分支验证完整字段链。
  it('saveProxyConfig 后同步推送 statusValues 反映刚写入的 proxy 配置', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({
      type: 'saveProxyConfig',
      updates: [
        { key: 'clangdProxyEnabled', value: true },
        { key: 'clangdProxyKeepaliveMax', value: 42 },
        { key: 'clangdProxyKeepaliveTtlSec', value: 1234 },
        { key: 'localizationEnabled', value: true },
        { key: 'localizationMode', value: 'zh-only' },
        { key: 'clangdProxyRealClangdPath', value: '/custom/clangd' },
        { key: 'clangdProxyLogPath', value: '/tmp/proxy.log' },
      ],
    });
    await drain();
    const calls = mockView.webview.postMessage.mock.calls;
    const statusCall = calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'statusValues',
    );
    expect(statusCall).toBeDefined();
    const values = (statusCall![0] as { values: Record<string, unknown> }).values;
    expect(values.proxyEnabled).toBe(true);
    expect(values.proxyKeepaliveMax).toBe(42);
    expect(values.proxyKeepaliveTtlSec).toBe(1234);
    expect(values.proxyLocalizationEnabled).toBe(true);
    expect(values.proxyLocalizationMode).toBe('zh-only');
    expect(values.proxyRealClangdPath).toBe('/custom/clangd');
    expect(values.proxyLogPath).toBe('/tmp/proxy.log');
  });

  it('handles getStatus', () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({ type: 'getStatus' });
    const calls = mockView.webview.postMessage.mock.calls;
    const statusCall = calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'statusValues',
    );
    expect(statusCall).toBeDefined();
    expect((statusCall![0] as { values: unknown }).values).toMatchObject({
      configuration: 'Development',
      target: 'Editor',
      proxyEnabled: false,
    });
  });

  // [外部激活状态同步 bug 回归] 用户跑过 enableClangdProxy 命令后，clangd.path 已指向
  // launcher（F-fix 设计故意不写 clangdProxy.enabled 配置），但 UI 不应显示"未启用"。
  // 派生规则：proxyEnabled 显示 = isActive || enabled，让 Status 反映事实状态。
  it('proxyEnabled 显示派生为 isActive || enabled —— 用户开了 proxy 但 enabled 配置 false 时仍显示已启用', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    // 模拟 enable 命令路径：settingsManager 已写入 launcher，但 Config.clangdProxyEnabled=false
    (deps.clangd.proxyManager as unknown as { _setActive: (v: boolean) => void })._setActive(true);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({ type: 'getStatus' });
    await drain();
    const calls = mockView.webview.postMessage.mock.calls;
    const statusCall = calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'statusValues',
    );
    expect(statusCall).toBeDefined();
    const values = (statusCall![0] as { values: { proxyEnabled: boolean; proxyActive: boolean } })
      .values;
    expect(values.proxyActive).toBe(true);
    expect(values.proxyEnabled).toBe(true);
  });

  // [代理设置 Tab 派生显示] getProxyConfig 同样派生 enabled，覆盖代理设置表单的回读。
  it('getProxyConfig 表单显示也派生为 isActive || enabled', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    (deps.clangd.proxyManager as unknown as { _setActive: (v: boolean) => void })._setActive(true);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({ type: 'getProxyConfig' });
    await drain();
    const calls = mockView.webview.postMessage.mock.calls;
    const call = calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'proxyConfigValues',
    );
    expect(call).toBeDefined();
    const values = (call![0] as { values: { clangdProxyEnabled: boolean } }).values;
    expect(values.clangdProxyEnabled).toBe(true);
  });

  // [外部配置同步 bug 回归] 用户从 VS Code 设置 UI / settings.json 改了 vscodeUEHelper.*
  // 配置后，控制面板应立即收到最新 statusValues 与 proxyConfigValues，不再需要切换 tab
  // 或按 refresh 按钮。
  it('config.onDidChange 触发后自动推送 proxyConfigValues + statusValues 到 webview', async () => {
    const deps = createDeps();
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    // 模拟用户在 Settings UI 把 clangdProxyEnabled 改回 true 后，VS Code 触发
    // workspace.onDidChangeConfiguration → Config.onDidChange 转发到我们的 listener。
    // eslint-disable-next-line @typescript-eslint/unbound-method -- mock cast 类型不可解析，eslint 误判；mock 是 spy 而非 bound method
    const onDidChange = deps.config.onDidChange as unknown as { _fire: (k: string) => void };
    onDidChange._fire('vscodeUEHelper.clangdProxy.enabled');
    await drain();
    const calls = mockView.webview.postMessage.mock.calls;
    const proxyCall = calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'proxyConfigValues',
    );
    const statusCall = calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'statusValues',
    );
    expect(proxyCall).toBeDefined();
    expect(statusCall).toBeDefined();
    expect(
      (proxyCall![0] as { values: { clangdProxyEnabled: boolean } }).values.clangdProxyEnabled,
    ).toBe(false);
    expect((statusCall![0] as { values: { proxyEnabled: boolean } }).values.proxyEnabled).toBe(
      false,
    );
  });

  // [外部配置同步 bug 回归] register 应该真的把 onDidChange 的 disposable 推进
  // context.subscriptions，确保 dispose 时 listener 被回收（防内存泄漏）。
  // 这里用 .mock.calls.length 而非 toHaveBeenCalledTimes，因为 deps.config 经过
  // `as unknown as Config` cast 后类型推断走 method-path，eslint unbound-method
  // 规则会把 expect(toHaveBeenCalledTimes) 误报为 unbound method。calls.length
  // 与 spy .mock.calls 直接对齐，行为等价。
  it('register 把 config.onDidChange listener push 到 context.subscriptions', () => {
    const deps = createDeps();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- mock cast 类型不可解析；mock 是 spy 而非 bound method
    const onDidChangeSpy = deps.config.onDidChange as unknown as { mock: { calls: unknown[][] } };
    ControlPanelProvider.register(deps);
    expect(onDidChangeSpy.mock.calls.length).toBe(1);
    expect(deps.context.subscriptions.length).toBeGreaterThanOrEqual(2); // registerWebviewViewProvider disposable + onDidChange disposable
  });

  it('CONFIG_KEY_MAP maps proxy field names', () => {
    expect(CONFIG_KEY_MAP.clangdProxyEnabled).toBe('clangdProxy.enabled');
    expect(CONFIG_KEY_MAP.localizationMode).toBe('clangdProxy.localization.mode');
    expect(CONFIG_KEY_MAP.configuration).toBe('configuration');
  });

  it('show calls workbench.view.extension.ueHelper', () => {
    ControlPanelProvider.show();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.view.extension.ueHelper',
    );
  });
});
