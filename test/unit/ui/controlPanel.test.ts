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
  COMMAND_REQUIREMENT,
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

/** mock logger 视图:公开方法声明为 Mock 属性(而非方法签名),避免 unbound-method。 */
type MockLogger = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  setLevel: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

/** 把 Logger 转成 Mock 属性视图,供 spy 断言使用 */
function asMockLogger(logger: import('@core/logger').Logger): MockLogger {
  return logger as unknown as MockLogger;
}

function createMockLogger(): import('@core/logger').Logger {
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
    // refreshTitleInfo 会解构 ready 的 resolve 值（projects/engines 驱动面板可用性），
    // 必须返回正确形状，否则解构抛错走 catch → hasProject/hasEngine=false。
    ready: Promise.resolve({
      projects: [{ name: 'TestProject', path: '/test/TestProject.uproject' }],
      engines: [{ version: '5.4', path: '/ue/5.4' }],
      workspaceFolders: [],
      projectFolder: null,
      engineFolder: null,
    }),
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
    // clangdOps 可选:默认不注入,由各测试按需赋值。
    // 必须显式标注联合类型——若只写 undefined,推断出的属性类型是字面量 undefined,
    // 后续 deps.clangdOps = {...} 赋值会 TS2322。
    clangdOps: undefined as import('@clangd/clangdOps').ClangdOps | undefined,
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

describe('COMMAND_REQUIREMENT — 按钮适用档位', () => {
  it('BUTTON_GROUPS 中每个按钮都在 COMMAND_REQUIREMENT 中有档位', () => {
    for (const g of BUTTON_GROUPS) {
      for (const b of g.buttons) {
        expect(COMMAND_REQUIREMENT[b.id]).toBeDefined();
      }
    }
  });
  // 无 .uproject 时面板整体不可用，唯一出口是创建项目
  it('createProject 是唯一 always 档（无项目时的入口）', () => {
    const always = Object.entries(COMMAND_REQUIREMENT)
      .filter(([, req]) => req === 'always')
      .map(([id]) => id);
    expect(always).toEqual(['createProject']);
  });
  it('UBT 类命令是 engine 档（需要项目 + 引擎）', () => {
    for (const id of [
      'build',
      'rebuild',
      'clean',
      'launchEditor',
      'liveCoding',
      'generateCompileCommands',
    ]) {
      expect(COMMAND_REQUIREMENT[id]).toBe('engine');
    }
  });
  it('诊断/工具/代理类命令是 project 档（需要项目）', () => {
    for (const id of [
      'diagnoseProject',
      'setSystemIncludes',
      'enableClangdProxy',
      'disableClangdProxy',
      'openWorkspaceFile',
      'installRules',
      'uninstall',
    ]) {
      expect(COMMAND_REQUIREMENT[id]).toBe('project');
    }
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
    // [面板可用性] 先等 refreshTitleInfo 完成（detection.ready 注入 hasProject/hasEngine），
    // 模拟真实时序：用户点击按钮时检测早已完成，engine 档命令放行。
    await drain();
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
    await drain();
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

  // ===== A3: handleMessage 未覆盖分支 =====

  // 辅助:建立已 resolve 的 provider + 返回 listener
  function setupResolvedProvider() {
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
    return { deps, listener };
  }

  it('handleMessage: updateConfig 调 config.update(走 CONFIG_KEY_MAP 翻译)', async () => {
    const { deps, listener } = setupResolvedProvider();
    listener({ type: 'updateConfig', key: 'clangdProxyEnabled', value: true });
    await drain();
    // CONFIG_KEY_MAP 把 'clangdProxyEnabled' 翻译为 'clangdProxy.enabled'
    expect(deps.config._updateCalls).toContainEqual(['clangdProxy.enabled', true]);
    expect(asMockLogger(deps.logger).info).toHaveBeenCalled();
  });

  it('handleMessage: updateConfig 失败时记 error 但不抛', async () => {
    const { deps, listener } = setupResolvedProvider();
    deps.config.update = vi.fn().mockRejectedValue(new Error('write fail'));
    expect(() =>
      listener({ type: 'updateConfig', key: 'configuration', value: 'Shipping' }),
    ).not.toThrow();
    await drain();
    expect(asMockLogger(deps.logger).error).toHaveBeenCalled();
  });

  it('handleMessage: updateProxyConfig 调 config.update(走 CONFIG_KEY_MAP 翻译)', async () => {
    const { deps, listener } = setupResolvedProvider();
    listener({ type: 'updateProxyConfig', key: 'localizationMode', value: 'zh-only' });
    await drain();
    expect(deps.config._updateCalls).toContainEqual(['clangdProxy.localization.mode', 'zh-only']);
  });

  it('handleMessage: getAddFlags 推送 addFlagValues 消息,含 entries + 当前 selectedIds', async () => {
    const { listener } = setupResolvedProvider();
    listener({ type: 'getAddFlags' });
    await drain();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'addFlagValues',
    );
    expect(call).toBeDefined();
    const values = (call![0] as { values: { entries: unknown[]; selectedIds: unknown } }).values;
    expect(Array.isArray(values.entries)).toBe(true);
    // selectedIds 来自 config.userAddFlags(当前 mock 中未定义,getter 返回 undefined)—
    // 这里只断言"键存在",不强求数组形态(以反映真实行为:若 config 没设,后端兜底空数组)。
    expect('selectedIds' in values).toBe(true);
  });

  it('handleMessage: saveAddFlags 在 clangdOps 未注入时优雅降级', async () => {
    // createDeps 默认不传 clangdOps
    const { listener } = setupResolvedProvider();
    listener({ type: 'saveAddFlags', selectedIds: ['compat-header'] });
    await drain();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'addFlagSaveResult',
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({
      result: { success: false, failed: 1, firstError: 'ClangdOps 未注入' },
    });
  });

  it('handleMessage: saveAddFlags 在 clangdOps 注入 + applyAddFlags ok 时返回 success', async () => {
    const deps = createDeps();
    const applyAddFlags = vi.fn().mockResolvedValue({ ok: true });
    deps.clangdOps = { applyAddFlags } as unknown as import('@clangd/clangdOps').ClangdOps;
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({ type: 'saveAddFlags', selectedIds: ['compat-header', 'preparse-system'] });
    await drain();
    expect(applyAddFlags).toHaveBeenCalled();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'addFlagSaveResult',
    );
    expect(call![0]).toMatchObject({
      result: { success: true, saved: 2, failed: 0 },
    });
  });

  it('handleMessage: saveAddFlags 在 applyAddFlags 返回失败时上报 firstError', async () => {
    const deps = createDeps();
    const applyAddFlags = vi.fn().mockResolvedValue({ ok: false, reason: 'disk full' });
    deps.clangdOps = { applyAddFlags } as unknown as import('@clangd/clangdOps').ClangdOps;
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    listener({ type: 'saveAddFlags', selectedIds: ['x'] });
    await drain();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'addFlagSaveResult',
    );
    expect(call![0]).toMatchObject({
      result: { success: false, firstError: 'applyAddFlags disk full' },
    });
  });

  it('handleMessage: saveAddFlags 在 applyAddFlags 抛异常时记 error 并返回 failure', async () => {
    const deps = createDeps();
    const applyAddFlags = vi.fn().mockRejectedValue(new Error('boom'));
    deps.clangdOps = { applyAddFlags } as unknown as import('@clangd/clangdOps').ClangdOps;
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    expect(() =>
      listener({ type: 'saveAddFlags', selectedIds: ['x'] }),
    ).not.toThrow();
    await drain();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'addFlagSaveResult',
    );
    expect(call![0]).toMatchObject({
      result: { success: false, firstError: 'boom' },
    });
    expect(asMockLogger(deps.logger).error).toHaveBeenCalled();
  });

  it('handleMessage: unknown type 在入口被拒绝,warn + 回推 showError 但不抛(F2-16/W23)', async () => {
    const { deps, listener } = setupResolvedProvider();
    // 类型断言绕过 WebViewMessage union 检查——这里故意构造未知 type
    expect(() =>
      listener({ type: 'totallyUnknown', payload: 'x' } as unknown as { type: string }),
    ).not.toThrow();
    await drain();
    expect(asMockLogger(deps.logger).warn).toHaveBeenCalled();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'showError',
    );
    expect(call).toBeDefined();
  });

  // ===== F2-16/W23:消息校验与 key 白名单 =====

  it('handleMessage: 损坏消息(非对象)不挂起,回推 showError', async () => {
    const { deps, listener } = setupResolvedProvider();
    expect(() => listener(null as unknown as { type: string })).not.toThrow();
    expect(() => listener(undefined as unknown as { type: string })).not.toThrow();
    await drain();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'showError',
    );
    expect(call).toBeDefined();
    expect(asMockLogger(deps.logger).warn).toHaveBeenCalled();
  });

  it('handleMessage: type 非字符串 / 白名单外 type 拒绝并回推 showError', async () => {
    const { deps, listener } = setupResolvedProvider();
    expect(() => listener({ type: 42 } as unknown as { type: string })).not.toThrow();
    expect(() =>
      listener({ type: 'notInWhitelist' } as unknown as { type: string }),
    ).not.toThrow();
    await drain();
    const calls = mockView.webview.postMessage.mock.calls;
    const showErrors = calls.filter(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'showError',
    );
    expect(showErrors.length).toBeGreaterThanOrEqual(2);
    expect(asMockLogger(deps.logger).warn).toHaveBeenCalled();
  });

  it('handleMessage: 必填字段缺失(executeCommand 无 command / updateConfig 无 key / saveConfig 无 updates)拒绝', async () => {
    const { listener } = setupResolvedProvider();
    expect(() =>
      listener({ type: 'executeCommand' } as unknown as { type: string }),
    ).not.toThrow();
    expect(() =>
      listener({ type: 'updateConfig', value: 1 } as unknown as { type: string }),
    ).not.toThrow();
    expect(() => listener({ type: 'saveConfig' } as unknown as { type: string })).not.toThrow();
    await drain();
    const calls = mockView.webview.postMessage.mock.calls;
    const showErrors = calls.filter(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'showError',
    );
    expect(showErrors.length).toBeGreaterThanOrEqual(3);
  });

  it('handleMessage: updateConfig 未知 key 拒绝并回推 showError,不调 config.update', async () => {
    const { deps, listener } = setupResolvedProvider();
    listener({ type: 'updateConfig', key: 'notARealKey', value: 1 } as unknown as {
      type: string;
    });
    await drain();
    expect(deps.config._updateCalls).toHaveLength(0);
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'showError',
    );
    expect(call).toBeDefined();
    expect((call![0] as { message?: string }).message).toContain('notARealKey');
  });

  it('handleMessage: updateProxyConfig 未知 key 拒绝并回推 showError', async () => {
    const { listener } = setupResolvedProvider();
    listener({ type: 'updateProxyConfig', key: 'bogus', value: true } as unknown as {
      type: string;
    });
    await drain();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'showError',
    );
    expect(call).toBeDefined();
  });

  it('handleMessage: saveConfig 含未知 key 时计入失败并回推 saveResult', async () => {
    const { deps, listener } = setupResolvedProvider();
    listener({
      type: 'saveConfig',
      updates: [
        { key: 'configuration', value: 'Shipping' },
        { key: 'notARealKey', value: 1 },
      ],
    });
    await drain();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'saveResult',
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({
      scope: 'config',
      result: { success: false, saved: 1, failed: 1 },
    });
    expect(deps.config._updateCalls).toContainEqual(['configuration', 'Shipping']);
  });

  it('handleMessage: executeCommand 未知 commandId 回写 commandResult(success=false)', async () => {
    const { listener } = setupResolvedProvider();
    // 'notInMap' 不在 COMMAND_MAP 中
    listener({ type: 'executeCommand', command: 'notInMap' });
    await drain();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'commandResult',
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({
      type: 'commandResult',
      command: 'notInMap',
      success: false,
    });
  });

  it('handleMessage: saveConfig 批量含失败项时,result 聚合 saved/failed/firstError', async () => {
    const { deps, listener } = setupResolvedProvider();
    // 让 update 在特定 key 上失败
    const originalUpdate = deps.config.update.bind(deps.config);
    let count = 0;
    deps.config.update = vi.fn().mockImplementation((k: string, v: unknown) => {
      count++;
      if (k === 'target') {return Promise.reject(new Error('write target fail'));}
      return originalUpdate(k, v);
    });
    listener({
      type: 'saveConfig',
      updates: [
        { key: 'configuration', value: 'Shipping' },
        { key: 'target', value: 'Game' },
        { key: 'lspLoggingLevel', value: 'debug' },
      ],
    });
    void count;
    await drain();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'saveResult',
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({
      result: { success: false, saved: 2, failed: 1, firstError: 'write target fail' },
    });
  });

  // ===== [面板可用性] 无 .uproject 面板不可用 + 按钮按项目/引擎适用度启用 =====

  /** 以指定的 projects/engines 检测结果建立已 resolve 的 provider，返回 listener */
  async function setupWithDetection(projects: unknown[], engines: unknown[]) {
    const deps = createDeps();
    (
      deps.detection as unknown as { ready: Promise<unknown> }
    ).ready = Promise.resolve({
      projects,
      engines,
      workspaceFolders: [],
      projectFolder: null,
      engineFolder: null,
    });
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    // 等待 refreshTitleInfo 完成（注入 hasProject/hasEngine + 推送 panelState）
    await drain();
    const listener = mockView.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    return { deps, listener };
  }

  it('refreshTitleInfo 后推送 panelState（hasProject/hasEngine 按检测结果显示）', async () => {
    await setupWithDetection(
      [{ name: 'P', path: '/p/P.uproject' }],
      [{ version: '5.4', path: '/ue/5.4' }],
    );
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'panelState',
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({ type: 'panelState', hasProject: true, hasEngine: true });
  });

  it('refreshTitleInfo 推送 panelState：无项目时 hasProject=false', async () => {
    await setupWithDetection([], []);
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'panelState',
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({ type: 'panelState', hasProject: false, hasEngine: false });
  });

  it('无项目时 engine 档命令被服务端兜底拒绝（build 不执行）', async () => {
    const { listener } = await setupWithDetection([], []);
    listener({ type: 'executeCommand', command: 'build' });
    await drain();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('vscodeUEHelper.build');
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'commandResult',
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({ type: 'commandResult', success: false });
  });

  it('无项目时 project 档命令同样被拒绝（diagnoseProject）', async () => {
    const { listener } = await setupWithDetection([], []);
    listener({ type: 'executeCommand', command: 'diagnoseProject' });
    await drain();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'commandResult',
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({ type: 'commandResult', success: false });
  });

  it('无项目时 always 档命令放行（createProject 是空状态的出口）', async () => {
    const { listener } = await setupWithDetection([], []);
    listener({ type: 'executeCommand', command: 'createProject' });
    await drain();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscodeUEHelper.createProject');
  });

  it('有项目但无引擎时 engine 档被拒、project 档放行', async () => {
    const { listener } = await setupWithDetection([{ name: 'P', path: '/p/P.uproject' }], []);
    listener({ type: 'executeCommand', command: 'liveCoding' });
    await drain();
    const blocked = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'commandResult',
    );
    expect(blocked).toBeDefined();
    expect(blocked![0]).toMatchObject({ type: 'commandResult', success: false });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('vscodeUEHelper.liveCoding');

    listener({ type: 'executeCommand', command: 'installRules' });
    await drain();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscodeUEHelper.installRules');
  });

  it('detection.ready 失败时走安全默认（hasProject=false，命令拒绝）', async () => {
    const deps = createDeps();
    (
      deps.detection as unknown as { ready: Promise<unknown> }
    ).ready = Promise.reject(new Error('scan failed'));
    ControlPanelProvider.register(deps);
    ControlPanelProvider.getInstance().resolveWebviewView(
      mockView,
      {} as unknown as vscode.WebviewViewResolveContext,
      {} as unknown as vscode.CancellationToken,
    );
    await drain();
    const call = mockView.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string })?.type === 'panelState',
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({ type: 'panelState', hasProject: false });
  });
});
