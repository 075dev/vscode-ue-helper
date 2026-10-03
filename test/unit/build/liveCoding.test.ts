/**
 * liveCoding 测试
 *
 * 1. resolveLiveCodingCmd(bugfix-001 回归锁定):
 *   Bug 现象:点击 Live Coding 按钮后启动了一个不带 -Project 的全新
 *   UnrealEditor.exe 实例(UE 弹出项目管理器,表现为"打开一个新的项目"),
 *   而不是连接已运行的编辑器实例触发热重载。
 *
 *   契约(UE 官方等价于编辑器内 Live Coding 按钮的方式):
 *     Build.bat <Target> <Platform> <Config> -Project="<uproject>" -waitmutex -LiveCoding
 *     —— UBT -LiveCoding 连接正在运行的编辑器 Live Coding server,
 *     不启动新实例;编辑器未运行时 UBT 回退为普通构建。
 *
 * 2. executeLiveCoding(Wave2 envelope 对齐,决策 D5/C8):
 *   不可用/失败 → errEnvelope(LIVE_CODING_UNAVAILABLE / BUILD_FAILED / ...);
 *   成功 → okEnvelope(summary 复用现有文案);UI 弹窗行为保持原样。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import type { Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import type { Logger } from '@core/logger';
import { resolveLiveCodingCmd } from '@build/ubt';
import { initI18n } from '@i18n';
import { executeLiveCoding } from '@commands/liveCoding';

describe('resolveLiveCodingCmd(bugfix-001: 连接现有项目热重载)', () => {
  const UBT_PATH = 'E:/UE_5.3/Engine/Build/BatchFiles/Build.bat';

  const baseArgs = {
    project: 'D:/MyGame/MyGame.uproject',
    target: 'MyGameEditor',
    platform: 'Win64' as const,
    configuration: 'Development' as const,
    ubtPath: UBT_PATH,
  };

  it('命令入口必须是 Build.bat(UBT),而非启动新的 UnrealEditor 实例', () => {
    const cmd = resolveLiveCodingCmd(baseArgs);
    expect(cmd.file).toBe(UBT_PATH);
    expect(cmd.file).not.toContain('UnrealEditor');
  });

  it('必须带 -Project 参数连接现有项目(路径含空格时整体加引号)', () => {
    const cmd = resolveLiveCodingCmd(baseArgs);
    expect(cmd.args.join(' ')).toContain('-Project="D:/MyGame/MyGame.uproject"');
  });

  it('必须带 -LiveCoding 标志(连接已运行编辑器的 Live Coding server)', () => {
    const cmd = resolveLiveCodingCmd(baseArgs);
    expect(cmd.args).toContain('-LiveCoding');
  });

  it('命令参数顺序与 UBT 构建命令一致,且不残留旧的 ExecCmds 方式', () => {
    const cmd = resolveLiveCodingCmd(baseArgs);
    expect(cmd.args.slice(0, 5)).toEqual([
      'MyGameEditor',
      'Win64',
      'Development',
      '-Project="D:/MyGame/MyGame.uproject"',
      '-waitmutex',
    ]);
    expect(cmd.args.join(' ')).not.toContain('ExecCmds');
  });
});

// ============ executeLiveCoding(Wave2 envelope 对齐,决策 D5/C8) ============

const mockTriggerLiveCoding = vi.fn<unknown[], Promise<unknown>>();
const mockIsLiveCodingSupported = vi.fn<unknown[], boolean>();
const mockResolveProjectOrPick = vi.fn<unknown[], Promise<unknown>>();
const mockResolveEngineOrPick = vi.fn<unknown[], Promise<unknown>>();
const mockPersistSelection = vi.fn<unknown[], Promise<unknown>>();
const mockWithProgress = vi.fn<unknown[], Promise<unknown>>();

vi.mock('@build', () => ({
  triggerLiveCoding: (...args: unknown[]) => mockTriggerLiveCoding(...args),
  isLiveCodingSupported: (...args: unknown[]) => mockIsLiveCodingSupported(...args),
}));

vi.mock('@commands/_resolve', () => ({
  resolveProjectOrPick: (...args: unknown[]) => mockResolveProjectOrPick(...args),
  resolveEngineOrPick: (...args: unknown[]) => mockResolveEngineOrPick(...args),
  persistSelection: (...args: unknown[]) => mockPersistSelection(...args),
}));

vi.mock('@ui/notifications', () => ({
  withProgress: (...args: unknown[]) => mockWithProgress(...args),
}));

describe('executeLiveCoding(envelope 对齐)', () => {
  const config = {
    target: 'Editor',
    platform: 'Win64',
    configuration: 'Development',
  } as unknown as Config;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
  const detection = {} as unknown as DetectionHandles;

  /** 让被 withProgress 包裹的 task 立即执行(镜像 src/ui/notifications 语义) */
  function runTaskImmediately(): void {
    (mockWithProgress as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_title: unknown, task: (report: unknown, token: unknown) => Promise<unknown>) =>
        task(
          vi.fn(),
          { isCancellationRequested: false, onCancellationRequested: vi.fn() },
        ),
    );
  }

  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
    runTaskImmediately();
    mockIsLiveCodingSupported.mockReturnValue(true);
    mockResolveProjectOrPick.mockResolvedValue({ path: 'D:/MyGame/MyGame.uproject', name: 'MyGame' });
    mockResolveEngineOrPick.mockResolvedValue({ path: 'E:/UE_5.3', version: '5.3' });
    mockPersistSelection.mockResolvedValue(undefined);
  });

  it('触发成功(exitCode 0)→ ok:true,summary 复用现有成功文案', async () => {
    mockTriggerLiveCoding.mockResolvedValue({
      ok: true,
      value: { cancelled: false, exitCode: 0, output: [], durationMs: 50 },
    });

    const env = await executeLiveCoding(config, logger, detection);

    expect(env).toMatchObject({ ok: true });
    expect(env.error).toBeUndefined();
    expect(env.summary).toBeTruthy();
  });

  it('触发失败(outcome.ok=false,控制台未连接)→ LIVE_CODING_UNAVAILABLE(契约 409 语义)', async () => {
    mockTriggerLiveCoding.mockResolvedValue({
      ok: false,
      error: { message: 'Live Coding console not connected' },
    });

    const env = await executeLiveCoding(config, logger, detection);

    expect(env).toMatchObject({
      ok: false,
      error: { code: 'LIVE_CODING_UNAVAILABLE' },
    });
  });

  it('用户取消 → OPERATION_CANCELLED', async () => {
    mockTriggerLiveCoding.mockResolvedValue({
      ok: true,
      value: { cancelled: true, exitCode: null, output: [], durationMs: 0 },
    });

    const env = await executeLiveCoding(config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'OPERATION_CANCELLED' } });
  });

  it('UBT 退出码非 0 → BUILD_FAILED', async () => {
    mockTriggerLiveCoding.mockResolvedValue({
      ok: true,
      value: { cancelled: false, exitCode: 2, output: ['err line'], durationMs: 50 },
    });

    const env = await executeLiveCoding(config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'BUILD_FAILED' } });
  });

  it('平台不支持(非 Windows)→ LIVE_CODING_UNAVAILABLE,不触发 UBT', async () => {
    mockIsLiveCodingSupported.mockReturnValue(false);

    const env = await executeLiveCoding(config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'LIVE_CODING_UNAVAILABLE' } });
    expect(mockTriggerLiveCoding).not.toHaveBeenCalled();
  });

  it('未选项目 → PROJECT_NOT_DETECTED', async () => {
    mockResolveProjectOrPick.mockResolvedValue(undefined);

    const env = await executeLiveCoding(config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_DETECTED' } });
    expect(mockTriggerLiveCoding).not.toHaveBeenCalled();
  });

  it('未选引擎 → UBT_NOT_FOUND', async () => {
    mockResolveEngineOrPick.mockResolvedValue(undefined);

    const env = await executeLiveCoding(config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'UBT_NOT_FOUND' } });
    expect(mockTriggerLiveCoding).not.toHaveBeenCalled();
  });

  it('UI 弹窗行为保持原样:成功仍弹 triggered 信息提示', async () => {
    mockTriggerLiveCoding.mockResolvedValue({
      ok: true,
      value: { cancelled: false, exitCode: 0, output: [], durationMs: 50 },
    });

    await executeLiveCoding(config, logger, detection);

    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });
});
