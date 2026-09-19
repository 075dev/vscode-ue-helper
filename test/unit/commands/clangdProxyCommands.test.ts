/**
 * clangdProxyCommands.test.ts —— Clangd Proxy 命令单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { executeEnableClangdProxy } from '@commands/enableClangdProxy';
import { executeDisableClangdProxy } from '@commands/disableClangdProxy';
import { executeShowClangdProxyStatus } from '@commands/showClangdProxyStatus';
import { t } from '@i18n';
import { type Config } from '@core/config';
import { type Logger } from '@core/logger';

function createLoggerMock(): Logger {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const debug = vi.fn();
  const show = vi.fn();
  return {
    info,
    warn,
    error,
    debug,
    show,
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
        active: o.isActive ?? false,
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
    const env = await executeEnableClangdProxy(config, logger, clangd as never);
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('reapply'));
    expect(clangd.proxyManager.reapply).toHaveBeenCalledOnce();
    expect(clangd.proxyManager.enable).not.toHaveBeenCalled();
    // [envelope 对齐] 成功路径返回 ok envelope,摘要复用现有启用成功文案
    expect(env.ok).toBe(true);
    expect(env.error).toBeUndefined();
    expect(env.summary).toBe(t('proxy.enable.success'));
  });

  it('Given 默认 disabled When 首次启用 Then 不再写 enabled toggle，直接调 proxyManager.enable', async () => {
    // Given: F-fix 后解耦 Config.clangdProxyEnabled。
    // 用户点 "启用 proxy" 命令不再要求先在 settings.json 写 clangdProxy.enabled=true。
    const clangd = createClangdHandlesMock({ config });

    // When
    const env = await executeEnableClangdProxy(config, logger, clangd as never);

    // Then
    expect(clangd.proxyManager.enable).toHaveBeenCalledOnce();
    // 不再触碰 clangdProxy.enabled toggle —— 这是用户配置，不该被命令悄悄改写
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(config.update as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('proxy enabled successfully'));
    // [envelope 对齐] 成功路径返回 ok envelope
    expect(env.ok).toBe(true);
    expect(env.error).toBeUndefined();
  });

  it('Given proxyManager 启用失败 When 首次启用 Then 弹错误，不回滚 enabled toggle', async () => {
    // Given: F-fix 后失败路径不回滚 clangdProxy.enabled（因为我们从不主动改它）。
    const clangd = createClangdHandlesMock({ config });
    clangd.proxyManager.enable = vi.fn<[], Promise<void>>(() =>
      Promise.reject(new Error('mock failure')),
    );

    // When
    const env = await executeEnableClangdProxy(config, logger, clangd as never);

    // Then
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(config.update as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(errorMock).toHaveBeenCalledWith(expect.stringContaining('failed'), expect.any(Error));
    expect(
      vscode.window.showErrorMessage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalled();
    // [envelope 对齐] 失败路径返回 err envelope,错误码 CLANGD_NOT_AVAILABLE(映射表直配)
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('CLANGD_NOT_AVAILABLE');
    expect(env.error?.message).toBe(t('proxy.enable.failed'));
  });
});

describe('executeDisableClangdProxy', () => {
  let config: Config;
  let logger: Logger;
  let infoMock: ReturnType<typeof vi.fn>;
  let warnMock: ReturnType<typeof vi.fn>;
  let errorMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = createConfigMock();
    logger = createLoggerMock();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    infoMock = logger.info as unknown as ReturnType<typeof vi.fn>;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    warnMock = logger.warn as unknown as ReturnType<typeof vi.fn>;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    errorMock = logger.error as unknown as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  it('禁用成功时恢复设置并显示成功消息', async () => {
    const clangd = createClangdHandlesMock();
    const env = await executeDisableClangdProxy(config, logger, clangd as never);
    expect(clangd.proxyManager.disable).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(config.update as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'clangdProxy.enabled',
      false,
    );
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('settings restored'));
    // [envelope 对齐] 成功路径返回 ok envelope,摘要复用现有禁用成功文案
    expect(env.ok).toBe(true);
    expect(env.error).toBeUndefined();
    expect(env.summary).toBe(t('proxy.disable.success'));
  });

  it('禁用失败时显示错误消息', async () => {
    const clangd = createClangdHandlesMock();
    clangd.proxyManager.disable = vi.fn<[], Promise<void>>(() =>
      Promise.reject(new Error('mock failure')),
    );
    const env = await executeDisableClangdProxy(config, logger, clangd as never);
    expect(errorMock).toHaveBeenCalledWith(expect.stringContaining('failed'), expect.any(Error));
    expect(
      vscode.window.showErrorMessage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalled();
    // [envelope 对齐] 失败路径返回 err envelope,错误码 CLANGD_NOT_AVAILABLE(最接近的 clangd 域码)
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('CLANGD_NOT_AVAILABLE');
  });

  it('restart 失败但设置已恢复时，不弹"禁用失败"、弹成功提示', async () => {
    // Given: clangd 扩展未激活 → clangd.restart 命令未注册，调用 reject；
    // 但 proxyManager.disable + config.update 已成功完成（设置已恢复）。
    const clangd = createClangdHandlesMock();
    (vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      t('proxy.disable.restartClangd'),
    );
    (vscode.commands.executeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('command not found'),
    );

    // When
    const env = await executeDisableClangdProxy(config, logger, clangd as never);

    // Then: 主流程按"设置恢复成功"收尾——弹成功提示，不弹失败
    expect(clangd.proxyManager.disable).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(config.update as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'clangdProxy.enabled',
      false,
    );
    expect(
      vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith(t('proxy.disable.success'), expect.any(String));
    expect(
      vscode.window.showErrorMessage as unknown as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();
    // clangd.restart 失败仅 warn，且不记录为禁用失败
    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining('clangd.restart'),
      expect.any(Error),
    );
    expect(errorMock).not.toHaveBeenCalled();
    // [envelope 对齐] restart 失败不影响 ok 结果(设置已恢复语义,与原行为一致)
    expect(env.ok).toBe(true);
    expect(env.error).toBeUndefined();
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
      enabled: true,
      isActive: true,
      hasBackup: true,
      launcherPath: '/fake/extension/out/launcher/proxy-launcher.bat',
      logPath: '/tmp/clangd-proxy.log',
      realClangdPath: '/usr/bin/clangd',
    });
    const env = executeShowClangdProxyStatus(config, logger, clangd as never);
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
    expect(
      vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalled();
    // [envelope 对齐] 只读命令恒成功,摘要复用现有状态弹窗文案
    expect(env.ok).toBe(true);
    expect(env.error).toBeUndefined();
    expect(env.summary).toBe(
      t('proxy.status.summary', { enabled: t('common.yes'), active: t('common.yes') }),
    );
  });

  it('未配置路径时显示自动检测', () => {
    const configNoPath = createConfigMock({
      clangdProxyRealClangdPath: undefined,
      clangdProxyLogPath: undefined,
    });
    const clangd = createClangdHandlesMock({
      enabled: false,
      isActive: false,
      hasBackup: false,
      logPath: undefined,
    });
    const env = executeShowClangdProxyStatus(configNoPath, logger, clangd as never);
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('auto-detect'));
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('not set'));
    // [envelope 对齐] 只读命令恒成功
    expect(env.ok).toBe(true);
  });

  it('配置未启用但已激活时，enabled 与 active 两行文案各自正确', () => {
    // F1-6：enableClangdProxy 命令故意不写 clangdProxy.enabled 配置，
    // 但 clangd.path 已指向 launcher → 实际激活。enabled 行必须显示 No，
    // active 行必须显示 Yes，不能再用 enabled 顶替 active。
    const configDisabled = createConfigMock({ clangdProxyEnabled: false });
    const clangd = createClangdHandlesMock({
      enabled: false,
      isActive: true,
      hasBackup: true,
    });
    const env = executeShowClangdProxyStatus(configDisabled, logger, clangd as never);
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Config Enabled:  No'));
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('Currently Active: Yes'));
    // 汇总弹窗同样区分 enabled 与 active
    expect(
      vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith(expect.stringContaining('enabled=No, active=Yes'));
    // [envelope 对齐] 摘要与弹窗文案一致,区分 enabled 与 active
    expect(env.summary).toEqual(expect.stringContaining('enabled=No, active=Yes'));
  });
});

describe('package.json manifest', () => {
  it('包含三个 proxy 命令', async () => {
    const pkg = (await import('../../../package.json')) as unknown as {
      contributes: { commands: Array<{ command: string }> };
    };
    const cmds = pkg.contributes.commands;
    const ids = cmds.map((c) => c.command);
    expect(ids).toContain('vscodeUEHelper.enableClangdProxy');
    expect(ids).toContain('vscodeUEHelper.disableClangdProxy');
    expect(ids).toContain('vscodeUEHelper.showClangdProxyStatus');
  });

  it('commandPalette 包含三个 proxy 命令', async () => {
    const pkg = (await import('../../../package.json')) as unknown as {
      contributes: { menus: { commandPalette: Array<{ command: string }> } };
    };
    const palette = pkg.contributes.menus.commandPalette;
    const ids = palette.map((c) => c.command);
    expect(ids).toContain('vscodeUEHelper.enableClangdProxy');
    expect(ids).toContain('vscodeUEHelper.disableClangdProxy');
    expect(ids).toContain('vscodeUEHelper.showClangdProxyStatus');
  });
});
