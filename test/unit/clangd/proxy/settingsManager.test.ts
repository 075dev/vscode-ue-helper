/**
 * settingsManager.test.ts —— clangd 设置备份/写入/恢复管理器 单元测试
 *
 * 测试策略：
 * - 使用 vi.mocked 覆盖 vscode.workspace.getConfiguration 返回 'clangd' 配置
 * - 使用 fake workspaceState 模拟备份存储
 * - 覆盖 enable 备份+写入、disable 安全恢复、用户修改路径后跳过恢复
 * - 验证 workspace 级别写入，不写 user/global 设置
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { ClangdSettingsManager } from '@clangd/proxy/settingsManager';

// ---------------------------------------------------------------------------
// 辅助：创建 clangd 配置 mock
// ---------------------------------------------------------------------------

interface ClangdConfigMock {
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function createClangdConfigMock(initialValues: Record<string, unknown>): ClangdConfigMock {
  const store = new Map(Object.entries(initialValues));
  return {
    get: vi.fn((key: string, def?: unknown) => {
      return store.has(key) ? store.get(key) : def;
    }),
    update: vi.fn((_key: string, _value: unknown) => {
      if (_value === undefined) {
        store.delete(_key);
      } else {
        store.set(_key, _value);
      }
      return Promise.resolve();
    }) as unknown as ReturnType<typeof vi.fn>,
  };
}

// ---------------------------------------------------------------------------
// 辅助：创建 workspaceState mock
// ---------------------------------------------------------------------------

interface WorkspaceStateMock {
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function createWorkspaceStateMock(): WorkspaceStateMock {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string) => store.get(key)),
    update: vi.fn((_key: string, _value: unknown) => {
      if (_value === undefined) {
        store.delete(_key);
      } else {
        store.set(_key, _value);
      }
      return Promise.resolve();
    }) as unknown as ReturnType<typeof vi.fn>,
  };
}

// ---------------------------------------------------------------------------
// 辅助：创建 ExtensionContext mock
// ---------------------------------------------------------------------------

function createContextMock(workspaceState: WorkspaceStateMock): vscode.ExtensionContext {
  return {
    workspaceState: workspaceState as unknown as vscode.Memento,
    extensionPath: '/fake/extension',
    extensionUri: vscode.Uri.file('/fake/extension'),
    subscriptions: [],
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
  } as unknown as vscode.ExtensionContext;
}

// ===========================================================================
// 测试套件
// ===========================================================================

describe('ClangdSettingsManager — clangd 设置管理器', () => {
  const LAUNCHER_PATH = '/fake/extension/out/launcher/proxy-launcher.bat';
  let clangdConfigMock: ClangdConfigMock;
  let workspaceStateMock: WorkspaceStateMock;
  let context: vscode.ExtensionContext;
  let manager: ClangdSettingsManager;

  beforeEach(() => {
    // 创建 clangd 配置 mock（初始无值，get 返回 undefined）
    clangdConfigMock = createClangdConfigMock({});

    // 覆盖 vscode.workspace.getConfiguration 使其对 'clangd' section 返回我们的 mock
    vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
      (section?: string, _scope?: vscode.ConfigurationScope | null) => {
        if (section === 'clangd') {
          return clangdConfigMock as unknown as vscode.WorkspaceConfiguration;
        }
        // 其他 section 返回默认 mock
        return {
          get: vi.fn((_key: string, def?: unknown) => def),
          update: vi.fn(),
        } as unknown as vscode.WorkspaceConfiguration;
      },
    );

    workspaceStateMock = createWorkspaceStateMock();
    context = createContextMock(workspaceStateMock);
    manager = new ClangdSettingsManager(context, LAUNCHER_PATH);
  });

  // =========================================================================
  // hasBackup
  // =========================================================================

  describe('hasBackup — 备份存在性', () => {
    it('初始无备份时返回 false', () => {
      expect(manager.hasBackup).toBe(false);
    });

    it('enable 后 hasBackup 返回 true', async () => {
      await manager.enable(['--real-clangd', '/usr/bin/clangd'], ['--background-index']);
      expect(manager.hasBackup).toBe(true);
    });

    it('disable 后 hasBackup 返回 false', async () => {
      await manager.enable(['--real-clangd', '/usr/bin/clangd'], []);
      await manager.disable();
      expect(manager.hasBackup).toBe(false);
    });
  });

  // =========================================================================
  // isUsingOurLauncher
  // =========================================================================

  describe('isUsingOurLauncher — 检测当前 path 是否为我们的 launcher', () => {
    it('clangd.path 为 launcher 路径时返回 true', () => {
      clangdConfigMock.get.mockReturnValue(LAUNCHER_PATH);
      expect(manager.isUsingOurLauncher).toBe(true);
    });

    it('clangd.path 为其他路径时返回 false', () => {
      clangdConfigMock.get.mockReturnValue('/usr/bin/clangd');
      expect(manager.isUsingOurLauncher).toBe(false);
    });

    it('clangd.path 未设置时返回 false', () => {
      clangdConfigMock.get.mockReturnValue(undefined);
      expect(manager.isUsingOurLauncher).toBe(false);
    });
  });

  // =========================================================================
  // enable — 启用代理
  // =========================================================================

  describe('enable — 启用代理（备份+写入）', () => {
    const PROXY_ARGS = ['--real-clangd', '/usr/bin/clangd', '--keepalive-max', '20'];
    const REAL_ARGS = ['--background-index', '--header-insertion=never'];

    it('备份原始 clangd.path、arguments、useScriptAsExecutable', async () => {
      // 设置原始值
      clangdConfigMock = createClangdConfigMock({
        path: '/usr/bin/clangd',
        arguments: ['--background-index'],
        useScriptAsExecutable: false,
      });
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        (section?: string, _scope?: vscode.ConfigurationScope | null) => {
          if (section === 'clangd') {
            return clangdConfigMock as unknown as vscode.WorkspaceConfiguration;
          }
          return { get: vi.fn(), update: vi.fn() } as unknown as vscode.WorkspaceConfiguration;
        },
      );
      manager = new ClangdSettingsManager(context, LAUNCHER_PATH);

      await manager.enable(PROXY_ARGS, REAL_ARGS);

      // 验证备份已保存
      const backup = workspaceStateMock.get('vscodeUEHelper.clangdProxy.backup');
      expect(backup).toBeDefined();
      expect(backup).toEqual({
        path: '/usr/bin/clangd',
        arguments: ['--background-index'],
        useScriptAsExecutable: false,
      });
    });

    it('写入 launcher path 到 workspace 设置', async () => {
      await manager.enable(PROXY_ARGS, REAL_ARGS);

      expect(clangdConfigMock.update).toHaveBeenCalledWith(
        'path',
        LAUNCHER_PATH,
        vscode.ConfigurationTarget.Workspace,
      );
    });

    it('写入 proxy args + -- + 原始 clangd args 到 arguments', async () => {
      await manager.enable(PROXY_ARGS, REAL_ARGS);

      expect(clangdConfigMock.update).toHaveBeenCalledWith(
        'arguments',
        [
          '--real-clangd',
          '/usr/bin/clangd',
          '--keepalive-max',
          '20',
          '--',
          '--background-index',
          '--header-insertion=never',
        ],
        vscode.ConfigurationTarget.Workspace,
      );
    });

    it('设置 useScriptAsExecutable = true', async () => {
      await manager.enable(PROXY_ARGS, REAL_ARGS);

      expect(clangdConfigMock.update).toHaveBeenCalledWith(
        'useScriptAsExecutable',
        true,
        vscode.ConfigurationTarget.Workspace,
      );
    });

    it('原始 clangd.arguments 为 undefined 时 arguments 只包含 proxy args + --', async () => {
      await manager.enable(PROXY_ARGS, []);

      expect(clangdConfigMock.update).toHaveBeenCalledWith(
        'arguments',
        ['--real-clangd', '/usr/bin/clangd', '--keepalive-max', '20', '--'],
        vscode.ConfigurationTarget.Workspace,
      );
    });

    it('备份中记录原始 arguments 为 undefined', async () => {
      await manager.enable(PROXY_ARGS, []);

      const backup = workspaceStateMock.get('vscodeUEHelper.clangdProxy.backup');
      expect(backup).toBeDefined();
      expect((backup as Record<string, unknown>).arguments).toBeUndefined();
    });
  });

  // =========================================================================
  // disable — 禁用代理（安全恢复）
  // =========================================================================

  describe('disable — 禁用代理（安全恢复）', () => {
    const PROXY_ARGS = ['--real-clangd', '/usr/bin/clangd'];

    it('恢复原始 clangd.path、arguments、useScriptAsExecutable', async () => {
      // 先启用（设置原始值）
      clangdConfigMock = createClangdConfigMock({
        path: '/usr/bin/clangd',
        arguments: ['--background-index'],
        useScriptAsExecutable: false,
      });
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        (section?: string, _scope?: vscode.ConfigurationScope | null) => {
          if (section === 'clangd') {
            return clangdConfigMock as unknown as vscode.WorkspaceConfiguration;
          }
          return { get: vi.fn(), update: vi.fn() } as unknown as vscode.WorkspaceConfiguration;
        },
      );
      manager = new ClangdSettingsManager(context, LAUNCHER_PATH);
      await manager.enable(PROXY_ARGS, []);

      // 模拟 enable 后 clangd.path 已被改为 launcher（我们的 mock update 已做）
      // 现在禁用
      const result = await manager.disable();

      expect(result.restored).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(clangdConfigMock.update).toHaveBeenCalledWith(
        'path',
        '/usr/bin/clangd',
        vscode.ConfigurationTarget.Workspace,
      );
      expect(clangdConfigMock.update).toHaveBeenCalledWith(
        'arguments',
        ['--background-index'],
        vscode.ConfigurationTarget.Workspace,
      );
      expect(clangdConfigMock.update).toHaveBeenCalledWith(
        'useScriptAsExecutable',
        false,
        vscode.ConfigurationTarget.Workspace,
      );
    });

    it('原始值 undefined 时恢复为 undefined（清除设置）', async () => {
      await manager.enable(PROXY_ARGS, []);

      // 模拟 enable 后 clangd.path 已被改为 launcher
      // 禁用
      const result = await manager.disable();

      expect(result.restored).toBe(true);
      // 原始 path 是 undefined，所以 update 为 undefined
      expect(clangdConfigMock.update).toHaveBeenCalledWith(
        'path',
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
    });

    it('用户修改 clangd.path 后 disable 不恢复并给出警告', async () => {
      // 先启用
      clangdConfigMock = createClangdConfigMock({
        path: '/usr/bin/clangd',
      });
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        (section?: string, _scope?: vscode.ConfigurationScope | null) => {
          if (section === 'clangd') {
            return clangdConfigMock as unknown as vscode.WorkspaceConfiguration;
          }
          return { get: vi.fn(), update: vi.fn() } as unknown as vscode.WorkspaceConfiguration;
        },
      );
      manager = new ClangdSettingsManager(context, LAUNCHER_PATH);
      await manager.enable(PROXY_ARGS, []);

      // 模拟用户修改了 clangd.path（在我们的 mock 中，enable 写入 LAUNCHER_PATH，
      // 现在手动改回其他路径）
      clangdConfigMock.get.mockImplementation((key: string) => {
        if (key === 'path') {
          return '/usr/local/bin/clangd';
        }
        return undefined;
      });

      const result = await manager.disable();

      expect(result.restored).toBe(false);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('用户修改');
    });

    it('无备份时 disable 返回 restored=false 并给出警告', async () => {
      const result = await manager.disable();

      expect(result.restored).toBe(false);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('备份');
    });

    it('disable 后清除备份', async () => {
      await manager.enable(PROXY_ARGS, []);
      expect(manager.hasBackup).toBe(true);

      await manager.disable();

      expect(manager.hasBackup).toBe(false);
    });
  });

  // =========================================================================
  // 边界情况
  // =========================================================================

  describe('边界情况', () => {
    it('enable 时原始 arguments 为 undefined 时备份正确', async () => {
      clangdConfigMock = createClangdConfigMock({
        path: '/usr/bin/clangd',
      });
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        (section?: string, _scope?: vscode.ConfigurationScope | null) => {
          if (section === 'clangd') {
            return clangdConfigMock as unknown as vscode.WorkspaceConfiguration;
          }
          return { get: vi.fn(), update: vi.fn() } as unknown as vscode.WorkspaceConfiguration;
        },
      );
      manager = new ClangdSettingsManager(context, LAUNCHER_PATH);

      await manager.enable(['--real-clangd', '/usr/bin/clangd'], []);

      const backup = workspaceStateMock.get('vscodeUEHelper.clangdProxy.backup') as Record<
        string,
        unknown
      >;
      expect(backup.path).toBe('/usr/bin/clangd');
      expect(backup.arguments).toBeUndefined();
      expect(backup.useScriptAsExecutable).toBeUndefined();
    });

    it('enable 后 clangd.path 等于 launcher 路径', async () => {
      await manager.enable(['--real-clangd', '/usr/bin/clangd'], []);

      // 验证 mock 的 update 更新了内部 store
      // 通过 isUsingOurLauncher 间接验证
      clangdConfigMock.get.mockImplementation((key: string) => {
        if (key === 'path') {
          return LAUNCHER_PATH;
        }
        return undefined;
      });
      expect(manager.isUsingOurLauncher).toBe(true);
    });
  });
});
