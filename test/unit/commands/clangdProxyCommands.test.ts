/**
 * clangdProxyCommands.test.ts —— Clangd Proxy 命令单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { executeEnableClangdProxy } from '@commands/enableClangdProxy';
import { executeDisableClangdProxy } from '@commands/disableClangdProxy';
import { executeShowClangdProxyStatus } from '@commands/showClangdProxyStatus';
import { Config } from '@core/config';
import { Logger } from '@core/logger';

function createLoggerMock(): Logger {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const debug = vi.fn();
  const show = vi.fn();
  return {
    info, warn, error, debug, show,
    channel: {} as never,
    prefix: 'test',
    currentLevel: 'info' as const,
    setLevel: vi.fn(),
    log: vi.fn(),
    getLevel: vi.fn(),
    getOutputChannel: vi.fn(),
    dispose: vi.fn(),
  } as unknown as Logger;
}

function createConfigMock(overrides?: Record<string, unknown>): Config {
  let clangdProxyEnabled =
    typeof overrides?.clangdProxyEnabled === 'boolean' ? overrides.clangdProxyEnabled : false;
  const extraOverrides = { ...overrides };
  delete extraOverrides.clangdProxyEnabled;
  const update = vi.fn<[key: string, value: unknown], Promise<void>>((key, value) => {
    if (key === 'clangdProxy.enabled' && typeof value === 'boolean') {
      clangdProxyEnabled = value;
    }
    return Promise.resolve();
  });
  return {
    get clangdProxyEnabled() {
      return clangdProxyEnabled;
    },
    clangdProxyKeepaliveMax: 20,
    clangdProxyKeepaliveTtlSec: 900,
    clangdProxyRealClangdPath: undefined,
    clangdProxyLogPath: undefined,
    update,
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    ...extraOverrides,
  } as unknown as Config;
}

function createClangdHandlesMock(overrides?: Record<string, unknown>) {
  const o = overrides ?? {};
  const enable = vi.fn<[], Promise<void>>(() => Promise.resolve());
  const disable = vi.fn<[], Promise<void>>(() => Promise.resolve());
  const activeEnabled = () =>
    typeof o.config === 'object' && o.config !== null && 'clangdProxyEnabled' in o.config
      ? (o.config as Config).clangdProxyEnabled
      : (o.enabled ?? false);
  return {
    completionMode: {} as never,
    backup: {} as never,
    proxyManager: {
      get enabled() {
        return activeEnabled();
      },
      isActive: o.isActive ?? false,
      hasBackup: o.hasBackup ?? false,
      launcherPath: o.launcherPath ?? '/fake/extension/out/launcher/proxy-launcher.bat',
      logPath: o.logPath ?? undefined,
      enable,
      disable,
      reapply: vi.fn<[], Promise<void>>(() => Promise.resolve()),
      getStatus: vi.fn(() => ({
        enabled: activeEnabled(),
        launcherPath: o.launcherPath ?? '/fake/extension/out/launcher/proxy-launcher.bat',
        realClangdPath: o.realClangdPath ?? undefined,
        keepaliveMax: 20,
        keepaliveTtlSec: 900,
        localizationEnabled: false,
        localizationMode: 'append',
                logPath: o.logPath ?? undefined,
        backupExists: o.hasBackup ?? false,
        lastKnownProblem: undefined,
      })),
    },
  };
}

describe('executeEnableClangdProxy', () => {
  let config: Config;
  let logger: Logger;
  let infoMock: ReturnType<typeof vi.fn>;
  let errorMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = createConfigMock();
    logger = createLoggerMock();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    infoMock = logger.info as unknown as ReturnType<typeof vi.fn>;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    errorMock = logger.error as unknown as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  it('已激活时重新应用参数并提示重启', async () => {
    const clangd = createClangdHandlesMock({ isActive: true });
    clangd.proxyManager.reapply = vi.fn().mockResolvedValue(undefined) as never;
    await executeEnableClangdProxy(config, logger, clangd as never);
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('reapply'));
    expect(clangd.proxyManager.reapply).toHaveBeenCalledOnce();
    expect(clangd.proxyManager.enable).not.toHaveBeenCalled();
  });

  it('Given 默认 disabled When 首次启用 Then 先写 workspace enabled 再执行代理设置', async () => {
    // Given
    const clangd = createClangdHandlesMock({ config });
    clangd.proxyManager.enable.mockImplementation(() => {
      expect(config.clangdProxyEnabled).toBe(true);
      return Promise.resolve();
    });

    // When
    await executeEnableClangdProxy(config, logger, clangd as never);

    // Then
    expect(clangd.proxyManager.enable).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect((config.update as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('clangdProxy.enabled', true);
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('proxy enabled successfully'));
  });

  it('Given proxyManager 启用失败 When 首次启用 Then 回滚 workspace enabled 并显示错误', async () => {
    // Given
    const clangd = createClangdHandlesMock({ config });
    clangd.proxyManager.enable = vi.fn<[], Promise<void>>(() => Promise.reject(new Error('mock failure')));

    // When
    await executeEnableClangdProxy(config, logger, clangd as never);

    // Then
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect((config.update as unknown as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['clangdProxy.enabled', true],
      ['clangdProxy.enabled', false],
    ]);
    expect(config.clangdProxyEnabled).toBe(false);
    expect(errorMock).toHaveBeenCalledWith(expect.stringContaining('failed'), expect.any(Error));
    expect((vscode.window.showErrorMessage as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});

describe('executeDisableClangdProxy', () => {
  let config: Config;
  let logger: Logger;
  let infoMock: ReturnType<typeof vi.fn>;
  let errorMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = createConfigMock();
    logger = createLoggerMock();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    infoMock = logger.info as unknown as ReturnType<typeof vi.fn>;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    errorMock = logger.error as unknown as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  it('禁用成功时恢复设置并显示成功消息', async () => {
    const clangd = createClangdHandlesMock();
    await executeDisableClangdProxy(config, logger, clangd as never);
    expect(clangd.proxyManager.disable).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect((config.update as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('clangdProxy.enabled', false);
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('settings restored'));
  });

  it('禁用失败时显示错误消息', async () => {
    const clangd = createClangdHandlesMock();
    clangd.proxyManager.disable = vi.fn<[], Promise<void>>(() => Promise.reject(new Error('mock failure')));
    await executeDisableClangdProxy(config, logger, clangd as never);
    expect(errorMock).toHaveBeenCalledWith(expect.stringContaining('failed'), expect.any(Error));
    expect((vscode.window.showErrorMessage as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});

describe('executeShowClangdProxyStatus', () => {
  let config: Config;
  let logger: Logger;
  let showMock: ReturnType<typeof vi.fn>;
  let infoMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = createConfigMock({
      clangdProxyEnabled: true,
      clangdProxyRealClangdPath: '/usr/bin/clangd',
      clangdProxyLogPath: '/tmp/clangd-proxy.log',
    });
    logger = createLoggerMock();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    showMock = logger.show as unknown as ReturnType<typeof vi.fn>;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    infoMock = logger.info as unknown as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  it('显示所有状态字段到 output', () => {
    const clangd = createClangdHandlesMock({
      enabled: true, isActive: true, hasBackup: true,
      launcherPath: '/fake/extension/out/launcher/proxy-launcher.bat',
      logPath: '/tmp/clangd-proxy.log',
      realClangdPath: '/usr/bin/clangd',
    });
    executeShowClangdProxyStatus(config, logger, clangd as never);
    expect(showMock).toHaveBeenCalledOnce();
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Config Enabled'));
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Currently Active'));
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Launcher Path'));
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Real Clangd'));
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Keepalive Max'));
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Keepalive TTL'));
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Log Path'));
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Backup Exists'));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect((vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('未配置路径时显示自动检测', () => {
    const configNoPath = createConfigMock({ clangdProxyRealClangdPath: undefined, clangdProxyLogPath: undefined });
    const clangd = createClangdHandlesMock({ enabled: false, isActive: false, hasBackup: false, logPath: undefined });
    executeShowClangdProxyStatus(configNoPath, logger, clangd as never);
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('auto-detect'));
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('not set'));
  });
});

describe('package.json manifest', () => {
  it('包含三个 proxy 命令', async () => {
    const pkg = (await import('../../../package.json')) as unknown as { contributes: { commands: Array<{ command: string }> } };
    const cmds = pkg.contributes.commands;
    const ids = cmds.map((c) => c.command);
    expect(ids).toContain('vscodeUEHelper.enableClangdProxy');
    expect(ids).toContain('vscodeUEHelper.disableClangdProxy');
    expect(ids).toContain('vscodeUEHelper.showClangdProxyStatus');
  });

  it('commandPalette 包含三个 proxy 命令', async () => {
    const pkg = (await import('../../../package.json')) as unknown as { contributes: { menus: { commandPalette: Array<{ command: string }> } } };
    const palette = pkg.contributes.menus.commandPalette;
    const ids = palette.map((c) => c.command);
    expect(ids).toContain('vscodeUEHelper.enableClangdProxy');
    expect(ids).toContain('vscodeUEHelper.disableClangdProxy');
    expect(ids).toContain('vscodeUEHelper.showClangdProxyStatus');
  });
});
