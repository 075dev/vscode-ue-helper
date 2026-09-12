/**
 * statusBarConfigSync.test.ts —— 状态栏对 vscodeUEHelper.* 配置变化的同步回归
 *
 * 修复 bug 报告：使用状态栏中的按钮调整构建配置后，调整构建配置后，不能及时的反馈到状态栏按钮中。
 *
 * 根因：旧实现里 `config.onDidChange(() => { void renderOnce(); })` 把渲染逻辑
 * 包在 async 函数里，第一个 `await detection.ready` 会让出当前 tick，把
 * `statusBar.update` 推到 microtask queue。用户视角下点完 Config 按钮后，
 * 通知弹窗出现，但状态栏按钮更新滞后到下一个 microtask，看起来像"没反应"。
 *
 * 修复：在 StatusBarManager 上新增同步方法 updateConfig(settings)，只重绘
 * 仅依赖 settings 的按钮（configBtn / targetBtn,以及 projectInfoBtn 的 tooltip
 * 平台段）。activateUI 把 config.onDidChange listener 改为同步调用 updateConfig。
 *
 * 关键不变量：listener 触发后，**不 await microtask**，configBtn / targetBtn 必须
 * 已经是新值。这是同步更新的核心证据。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { activateUI } from '@ui';
import { Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';

interface FakeEvent {
  affectsConfiguration: (key: string) => boolean;
}

describe('statusBar 配置变更同步回归', () => {
  let capturedListeners: Array<(e: FakeEvent) => void>;
  let configStore: Map<string, unknown>;
  let context: vscode.ExtensionContext;
  let config: Config;
  let detection: DetectionHandles;
  let logger: Logger;
  let workspace: WorkspaceState | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedListeners = [];
    configStore = new Map<string, unknown>([
      ['configuration', 'Development'],
      ['target', 'Editor'],
      ['platform', 'Win64'],
    ]);

    // 让 workspace.getConfiguration 真正返回对象 —— 让 Config 的 root.update 走通
    vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const root = {
        get: <T>(key: string, def?: T): T | undefined => {
          if (configStore.has(key)) {
            return configStore.get(key) as T;
          }
          return def;
        },
        update: vi.fn((key: string, value: unknown) => {
          configStore.set(key, value);
          return Promise.resolve();
        }),
        inspect: <T>(_key: string) => undefined as unknown as T,
        has: (key: string) => configStore.has(key),
      };
      return root;
    });

    // 真实捕获 onDidChangeConfiguration listener（模拟 VS Code 内部异步事件派发）
    vi.spyOn(vscode.workspace, 'onDidChangeConfiguration').mockImplementation((listener) => {
      const fn = listener as unknown as (e: FakeEvent) => void;
      capturedListeners.push(fn);
      return { dispose: vi.fn() };
    });

    config = new Config();
    detection = {
      ready: Promise.resolve({
        projects: [{ name: 'TestProject', path: '/test/TestProject.uproject' }],
        engines: [{ version: '5.4', path: '/ue/5.4' }],
        workspaceFile: '/test/.code-workspace',
        workspaceRoot: '/test',
        workspaceFolders: [
          { name: 'TestProject', path: '.', role: 'project', absPath: '/test' },
          { name: 'UE5', path: '/ue/5.4', role: 'engine', absPath: '/ue/5.4' },
        ],
        projectFolder: {
          name: 'TestProject',
          path: '.',
          role: 'project',
          absPath: '/test',
        },
        engineFolder: { name: 'UE5', path: '/ue/5.4', role: 'engine', absPath: '/ue/5.4' },
      }),
      workspaceContext: {
        getSelectedProject: () => undefined,
        getSelectedEngine: () => undefined,
        setProject: vi.fn(),
        setEngine: vi.fn(),
      },
    } as unknown as DetectionHandles;

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
    } as unknown as Logger;

    context = {
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    workspace = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 同步触发 onDidChangeConfiguration 事件（模拟 VS Code 在 config.update 后的异步派发） */
  function fireConfigChange(): void {
    expect(capturedListeners.length).toBeGreaterThanOrEqual(1);
    for (const listener of capturedListeners) {
      listener({
        affectsConfiguration: (k: string) =>
          k === 'vscodeUEHelper' || k.startsWith('vscodeUEHelper.'),
      });
    }
  }

  /** 等激活 UI 完成首次 renderFull（detection.ready 已经 resolve,需要 microtask flush） */
  async function activateAndWaitFirstRender(): Promise<ReturnType<typeof activateUI>> {
    const handles = activateUI(context, config, logger, detection, workspace);
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    return handles;
  }

  it('未检测到项目时,8 个状态栏按钮全部隐藏(不显示"没项目"的噪音状态)', async () => {
    // 覆盖 detection fixture:0 个项目
    const emptyDetection = {
      ready: Promise.resolve({
        projects: [],
        engines: [],
        workspaceFile: null,
        workspaceRoot: null,
        workspaceFolders: [],
        projectFolder: null,
        engineFolder: null,
      }),
      workspaceContext: {
        getSelectedProject: () => undefined,
        getSelectedEngine: () => undefined,
        setProject: vi.fn(),
        setEngine: vi.fn(),
      },
    } as unknown as DetectionHandles;

    const handles = activateUI(context, config, logger, emptyDetection, workspace);
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const statusBar = handles.statusBar;

    const buttonNames = [
      'projectInfoBtn',
      'configBtn',
      'targetBtn',
      'buildBtn',
      'rebuildBtn',
      'cleanBtn',
      'liveCodingBtn',
      'launchBtn',
    ] as const;
    for (const name of buttonNames) {
      const btn = statusBar[name as unknown as keyof typeof statusBar] as unknown as {
        show: ReturnType<typeof vi.fn>;
        hide: ReturnType<typeof vi.fn>;
      };
      expect(btn.hide, `${name} 应调用 hide`).toHaveBeenCalled();
      expect(btn.show, `${name} 不应调用 show`).not.toHaveBeenCalled();
    }
  });

  it('selectConfig 改 configuration 后,同步触发 listener 应让 configBtn.text 立即反映新值（不 await microtask）', async () => {
    const handles = await activateAndWaitFirstRender();
    const statusBar = handles.statusBar;

    // 初始 renderFull 已经跑过,configBtn 应是 Development
    expect(statusBar['configBtn'].text).toContain('Development');

    // 模拟 selectConfig 流程:Config.update 写盘 + VS Code 触发 onDidChangeConfiguration
    await config.update('configuration', 'Shipping');
    fireConfigChange();

    // **关键**:不 await microtask,断言 configBtn 已是新值。
    // 修复前:configBtn 还是 Development(renderFull 的 await detection.ready 让出)。
    // 修复后:configBtn 立刻是 Shipping(sync updateConfig)。
    expect(config.configuration).toBe('Shipping');
    expect(statusBar['configBtn'].text).toContain('Shipping');
    expect(statusBar['configBtn'].text).not.toContain('Development');
  });

  it('selectTarget 改 target 后,同步触发 listener 应让 targetBtn.text 立即反映新值', async () => {
    const handles = await activateAndWaitFirstRender();
    const statusBar = handles.statusBar;

    expect(statusBar['targetBtn'].text).toContain('Editor');

    await config.update('target', 'Game');
    fireConfigChange();

    expect(config.target).toBe('Game');
    expect(statusBar['targetBtn'].text).toContain('Game');
    expect(statusBar['targetBtn'].text).not.toContain('Editor');
  });

  it('platform 变化后,projectInfoBtn 文本保持仅项目名,新 platform 同步进 tooltip', async () => {
    const handles = await activateAndWaitFirstRender();
    const statusBar = handles.statusBar;

    // 按钮文本精简为仅项目名;引擎版本/平台只出现在 tooltip
    expect(statusBar['projectInfoBtn'].text).toContain('TestProject');
    expect(statusBar['projectInfoBtn'].text).not.toContain('Win64');
    expect(statusBar['projectInfoBtn'].text).not.toContain('UE 5.4');
    expect(statusBar['projectInfoBtn'].tooltip).toContain('Win64');
    expect(statusBar['projectInfoBtn'].tooltip).toContain('UE 5.4');

    // Mac 不在宪法 §I 支持范围但仍可设置,这里只是验证同步刷新 tooltip 的 platform 段
    await config.update('platform', 'Mac');
    fireConfigChange();

    // 文本不受 platform 影响(仍只有项目名)
    expect(statusBar['projectInfoBtn'].text).toContain('TestProject');
    expect(statusBar['projectInfoBtn'].text).not.toContain('Win64');
    expect(statusBar['projectInfoBtn'].text).not.toContain('Mac');
    // 新 platform 同步进 tooltip
    expect(statusBar['projectInfoBtn'].tooltip).toContain('Mac');
    expect(statusBar['projectInfoBtn'].tooltip).not.toContain('Win64');
  });

  it('_isBuilding === true 时 updateConfig 直接返回,不打断 build spinner / 错误结果状态', async () => {
    const handles = await activateAndWaitFirstRender();
    const statusBar = handles.statusBar;

    // 模拟进入 build 状态(showBuilding 由 executeBuild 调用 —— 当前未接线,
    // 我们直接用内部方法触发;这是 statusBar API 的合法使用)
    statusBar.showBuilding();
    expect(statusBar.isBuilding).toBe(true);
    expect(statusBar['buildBtn'].text).toContain('Building');

    // 用户在 build 期间点 Config 按钮改配置
    await config.update('configuration', 'Shipping');
    fireConfigChange();

    // updateConfig 被 _isBuilding 守护挡掉,build 按钮状态不变
    expect(statusBar.isBuilding).toBe(true);
    expect(statusBar['buildBtn'].text).toContain('Building');
    // configBtn 可能仍是旧值(updateConfig 直接返回),不应进入 'Shipping'
    // —— 这是正确行为:build 期间不让 config 变化干扰 build 反馈,等 build 结束
    // 由 showBuildResult 的 setTimeout → update() 走完整路径一并刷新。
    expect(statusBar['configBtn'].text).toContain('Development');
  });

  // [F2-14/W16] showBuildResult 的 5s 回退 timer 必须记录 id 并在 dispose 时清理,
  // 否则插件卸载后 timer 仍会访问已释放的 StatusBarItem。
  it('showBuildResult 记录回退 timer,dispose 时清理(F2-14/W16)', async () => {
    const handles = await activateAndWaitFirstRender();
    const statusBar = handles.statusBar;

    statusBar.showBuildResult(
      true,
      0,
      { project: null, engine: null },
      { buildConfiguration: 'Development', buildTarget: 'Editor', platform: 'Win64' },
    );
    expect(statusBar['buildBtn'].text).toContain('Build OK');
    expect(statusBar['_resultTimer']).toBeDefined();

    statusBar.dispose();
    expect(statusBar['_resultTimer']).toBeUndefined();
  });

  it('showBuilding 取消上一次 showBuildResult 的回退 timer(F2-14/W16)', async () => {
    const handles = await activateAndWaitFirstRender();
    const statusBar = handles.statusBar;

    statusBar.showBuildResult(
      false,
      2,
      { project: null, engine: null },
      { buildConfiguration: 'Development', buildTarget: 'Editor', platform: 'Win64' },
    );
    expect(statusBar['_resultTimer']).toBeDefined();

    // 新一轮构建开始 → 旧 timer 被清掉,不会在构建中触发 update 冲掉 spinner
    statusBar.showBuilding();
    expect(statusBar['_resultTimer']).toBeUndefined();
    expect(statusBar.isBuilding).toBe(true);
  });

  it('完整 renderFull 仍正常 —— detection.ready resolve 后初始化所有按钮', async () => {
    const handles = await activateAndWaitFirstRender();
    const statusBar = handles.statusBar;

    // renderFull 完成:8 个按钮按 visibility 规则 show,Config/Target 是
    // 初始值,projectInfo 按钮仅显示项目名(引擎/平台在 tooltip)。
    expect(statusBar['buildBtn'].text).toContain('Build');
    expect(statusBar['configBtn'].text).toContain('Development');
    expect(statusBar['targetBtn'].text).toContain('Editor');
    expect(statusBar['projectInfoBtn'].text).toContain('TestProject');
    expect(statusBar['projectInfoBtn'].text).not.toContain('UE 5.4');
    expect(statusBar['projectInfoBtn'].text).not.toContain('Win64');
    expect(statusBar['projectInfoBtn'].tooltip).toContain('UE 5.4');
    expect(statusBar['projectInfoBtn'].tooltip).toContain('Win64');
  });

  it('config.onDidChange listener 已注册到 context.subscriptions(dispose 时回收)', () => {
    activateUI(context, config, logger, detection, workspace);
    // 期望至少 1 个 config.onDidChange listener 被推进 subscriptions
    // (controlPanel 在本测试没注册,只有 ui/index.ts 那一个)
    expect(context.subscriptions.length).toBeGreaterThan(0);
    // dispose 时不应抛错
    expect(() => {
      for (const sub of context.subscriptions) {
        sub.dispose();
      }
    }).not.toThrow();
  });
});
