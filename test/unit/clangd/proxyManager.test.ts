/**
 * proxyManager.test.ts —— ClangdProxyManager 扩展端管理器 单元测试
 *
 * 测试策略：
 * - 使用 vi.mocked 模拟 vscode 和 Config
 * - 验证 manager 创建时不修改 clangd 设置
 * - 验证 enabled=false 时 enable() 跳过写入
 * - 验证 launcherPath 计算正确
 * - 验证状态查询 getter 正常工作
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { ClangdProxyManager } from '@clangd/proxyManager';

// ---------------------------------------------------------------------------
// 辅助：创建 ExtensionContext mock
// ---------------------------------------------------------------------------

function createContextMock(overrides?: Partial<vscode.ExtensionContext>): vscode.ExtensionContext {
  return {
    subscriptions: [],
    extensionPath: '/fake/extension',
    extensionUri: vscode.Uri.file('/fake/extension'),
    workspaceState: {
      get: vi.fn(),
      update: vi.fn(),
    } as unknown as vscode.Memento,
    globalState: {} as vscode.Memento,
    secrets: {} as vscode.SecretStorage,
    storageUri: undefined,
    storagePath: undefined,
    globalStorageUri: vscode.Uri.file('/fake/globalStorage'),
    globalStoragePath: '/fake/globalStorage',
    logPath: '/fake/log',
    logUri: vscode.Uri.file('/fake/log'),
    extensionMode: 3, // ExtensionMode.Test
    environmentVariableCollection: {} as unknown as vscode.EnvironmentVariableCollection,
    asAbsolutePath: (p: string) => `/fake/extension/${p}`,
    ...overrides,
  } as unknown as vscode.ExtensionContext;
}

// ---------------------------------------------------------------------------
// 辅助：创建 Logger mock
// ---------------------------------------------------------------------------

function createLoggerMock() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// 辅助：创建 Config mock
// ---------------------------------------------------------------------------

function createConfigMock(
  overrides?: Partial<{
    clangdPath: string | undefined;
    clangdProxyEnabled: boolean;
    clangdProxyKeepaliveMax: number;
    clangdProxyKeepaliveTtlSec: number;
    clangdProxyRealClangdPath: string | undefined;
    clangdProxyLogPath: string | undefined;
    clangdProxyLocalizationEnabled: boolean;
    clangdProxyLocalizationMode: string;
    clangdProxyLocalizationTargets: string[];
  }>,
) {
  return {
    clangdPath: undefined,
    clangdProxyEnabled: false,
    clangdProxyKeepaliveMax: 20,
    clangdProxyKeepaliveTtlSec: 900,
    clangdProxyRealClangdPath: undefined,
    clangdProxyLogPath: undefined,
    clangdProxyLocalizationEnabled: false,
    clangdProxyLocalizationMode: 'append',
    clangdProxyLocalizationTargets: ['diagnostics', 'codeActions', 'hover'],
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    ...overrides,
  };
}

// ===========================================================================
// 测试套件
// ===========================================================================

describe('ClangdProxyManager — 扩展端代理管理器', () => {
  let context: vscode.ExtensionContext;
  let logger: ReturnType<typeof createLoggerMock>;
  let fileExists: ReturnType<typeof vi.fn<[candidate: string], boolean>>;

  beforeEach(() => {
    context = createContextMock();
    logger = createLoggerMock();
    fileExists = vi.fn<[candidate: string], boolean>(() => false);
  });

  describe('创建与 launcherPath', () => {
    it('Windows 平台使用 .bat 后缀', () => {
      // 模拟 Windows 平台
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const manager = new ClangdProxyManager(context, createConfigMock() as never, logger as never);
      expect(manager.launcherPath).toBe('/fake/extension/out/launcher/proxy-launcher.bat');

      // 恢复
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });

    // 注：原"非 Windows 平台使用 .sh 后缀"case 已删除——本插件仅支持 Windows，
    //      launcher 固定为 .bat。N1 死代码清理后该 case 失去意义。

    it('创建时不修改 clangd 设置', () => {
      const updateMock = vi.fn();
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn(),
        update: updateMock,
      } as unknown as vscode.WorkspaceConfiguration);

      new ClangdProxyManager(context, createConfigMock() as never, logger as never);

      // 创建时不应调用 update（读 get 用于 isActive 检查是允许的）
      expect(updateMock).not.toHaveBeenCalled();
    });
  });

  describe('状态查询', () => {
    it('enabled 返回配置值', () => {
      const manager = new ClangdProxyManager(
        context,
        createConfigMock({ clangdProxyEnabled: true }) as never,
        logger as never,
      );
      expect(manager.enabled).toBe(true);
    });

    it('enabled 默认 false', () => {
      const manager = new ClangdProxyManager(context, createConfigMock() as never, logger as never);
      expect(manager.enabled).toBe(false);
    });

    it('isActive 委托给 settingsManager.isUsingOurLauncher', () => {
      const manager = new ClangdProxyManager(context, createConfigMock() as never, logger as never);
      // 默认 mock 返回 undefined，所以 isActive 应为 false
      expect(manager.isActive).toBe(false);
    });

    it('hasBackup 委托给 settingsManager.hasBackup', () => {
      const manager = new ClangdProxyManager(context, createConfigMock() as never, logger as never);
      expect(manager.hasBackup).toBe(false);
    });

    it('logPath 返回配置值', () => {
      const manager = new ClangdProxyManager(
        context,
        createConfigMock({ clangdProxyLogPath: '/tmp/clangd-proxy.log' }) as never,
        logger as never,
      );
      expect(manager.logPath).toBe('/tmp/clangd-proxy.log');
    });

    it('logPath 未配置时返回默认路径（context.logUri 下）', () => {
      const manager = new ClangdProxyManager(context, createConfigMock() as never, logger as never);
      // 未配置 clangdProxyLogPath 时回落到 defaultLogPath（始终有值，保证 proxy 写文件）
      expect(manager.logPath).toContain('clangd-proxy.log');
    });
  });

  describe('enable — 启用代理', () => {
    it('proxy 禁用时 enable 仍执行（已解耦 Config.enabled）', async () => {
      // F-fix: enable() 不再读取 Config.clangdProxyEnabled。
      // 用户点 "启用 proxy" 命令就直接启用；isActive 由 clangd.path 决定，不依赖 toggle 设置。
      const manager = new ClangdProxyManager(
        context,
        createConfigMock({ clangdProxyEnabled: false }) as never,
        logger as never,
      );
      // enable 内部会调 settingsManager.enable（依赖 fs 不存在等 mocked）
      // 这里只验证：不被 enabled=false 拦截（不再 throw 'not enabled'）
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === 'arguments') {
            return [];
          }
          if (key === 'path') {
            return undefined;
          }
          return undefined;
        }),
        update: vi.fn(async () => await Promise.resolve()),
        inspect: vi.fn(),
        has: vi.fn(),
      } as never);
      try {
        await manager.enable();
      } catch (err) {
        // 允许任何其它错误（resolveRealClangd notFound 等），仅不允许 'not enabled in config'
        expect(String(err)).not.toMatch(/not enabled in config/);
      }
    });

    it('Given 仅配置 vscodeUEHelper.clangdPath When enable Then settingsManager.enable 参数包含 --real-clangd 且位于 -- 前', async () => {
      // Given
      const configuredClangd = '/opt/llvm/bin/clangd.exe';
      const configMock = createConfigMock({
        clangdProxyEnabled: true,
        clangdProxyRealClangdPath: undefined,
        clangdPath: configuredClangd,
      });
      fileExists.mockImplementation((candidate) => candidate === configuredClangd);

      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === 'arguments') {
            return ['--background-index'];
          }
          if (key === 'path') {
            return undefined;
          }
          return undefined;
        }),
        update: vi.fn(),
      } as unknown as vscode.WorkspaceConfiguration);

      const manager = new ClangdProxyManager(context, configMock as never, logger as never, {
        fileExists,
      });
      const enableSpy = vi.spyOn(manager.settingsManager, 'enable');

      // When
      await manager.enable();

      // Then
      expect(enableSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['--real-clangd', configuredClangd]),
        ['--background-index', '--background-index-priority=normal'],
      );
      const [proxyArgs] = enableSpy.mock.calls[0] ?? [];
      expect(proxyArgs).toEqual([
        '--real-clangd',
        configuredClangd,
        '--keepalive-max',
        '20',
        '--keepalive-ttl-sec',
        '900',
        '--log-path',
        '/fake/log/clangd-proxy.log',
      ]);
    });

    it('Given 无真实 clangd 候选 When enable Then 不调用 settingsManager.enable 并抛出错误', async () => {
      // Given
      const configMock = createConfigMock({
        clangdProxyEnabled: true,
        clangdPath: '/missing/clangd.exe',
      });
      fileExists.mockReturnValue(false);

      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === 'arguments') {
            return ['--background-index'];
          }
          if (key === 'path') {
            return '/missing/current-clangd.exe';
          }
          return undefined;
        }),
        update: vi.fn(),
      } as unknown as vscode.WorkspaceConfiguration);

      const manager = new ClangdProxyManager(context, configMock as never, logger as never, {
        fileExists,
      });
      const enableSpy = vi.spyOn(manager.settingsManager, 'enable');

      // When / Then
      await expect(manager.enable()).rejects.toThrow('Unable to resolve real clangd path');
      expect(enableSpy).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Unable to resolve real clangd path'),
      );
    });
  });

  describe('disable — 禁用代理', () => {
    it('disable 调用 settingsManager.disable', async () => {
      const manager = new ClangdProxyManager(context, createConfigMock() as never, logger as never);

      const disableSpy = vi.spyOn(manager.settingsManager, 'disable');

      await manager.disable();

      expect(disableSpy).toHaveBeenCalledOnce();
    });
  });

  describe('locator 缓存失效（add-003）', () => {
    it('Given 三个源键任一变更 When 配置事件派发 Then locator.invalidate 被调用', () => {
      // Given — 捕获构造时注册的 onDidChangeConfiguration 监听
      const listeners: Array<(e: { affectsConfiguration: (k: string) => boolean }) => void> = [];
      vi.spyOn(vscode.workspace, 'onDidChangeConfiguration').mockImplementation((listener) => {
        listeners.push(listener as unknown as (e: {
          affectsConfiguration: (k: string) => boolean;
        }) => void);
        return { dispose: vi.fn() };
      });
      const invalidate = vi.fn();
      const locator = { resolveRealClangd: vi.fn(), invalidate };

      new ClangdProxyManager(context, createConfigMock() as never, logger as never, {
        locator: locator as never,
      });
      expect(listeners.length).toBe(1);
      const fire = listeners[0];
      if (!fire) {
        throw new Error('onDidChangeConfiguration listener not captured');
      }

      // When / Then — override、插件 clangdPath、第三方 clangd.path 三键逐个触发（CRITICAL-1 回归钉）
      for (const key of [
        'vscodeUEHelper.clangdPath',
        'vscodeUEHelper.clangdProxy.realClangdPath',
        'clangd.path',
      ]) {
        invalidate.mockClear();
        fire({ affectsConfiguration: (k) => k === key });
        expect(invalidate).toHaveBeenCalledTimes(1);
      }

      // 无关键不触发
      invalidate.mockClear();
      fire({ affectsConfiguration: () => false });
      expect(invalidate).not.toHaveBeenCalled();
    });
  });
});
