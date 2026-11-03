/**
 * liveCoding 命令测试 —— [D16] 与全量构建共用互斥锁
 *
 * ## 背景
 *
 * `build`（全量 / rebuild / clean）与 `liveCoding` 都是 spawn UBT 进程。
 * 旧实现只在 `src/commands/build.ts` 有模块级 `buildInFlight` 标记，
 * liveCoding 路径完全没有守卫 —— 两条路径可以同时跑。
 *
 * 两个 UBT 并发时 UHT 代码生成阶段会交叉写 `Intermediate/Build/` 下的
 * `.generated.h`，表现为随机出现的 "unknown type name 'FID_...'" 假诊断，
 * 用户很难联想到是插件干的。
 *
 * 覆盖:
 *   - 锁被占用 → liveCoding 被拒绝(OPERATION_CANCELLED),且不 spawn UBT
 *   - 正常路径 → 成功,且结束后锁被释放
 *   - alreadyLocked=true → 持锁方转发路径不被自己拒绝
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import { initI18n } from '@i18n';
import { executeLiveCoding } from '@commands/liveCoding';
import { tryLockBuild, unlockBuild, isBuildLocked } from '@build/lock';

const mockTriggerLiveCoding = vi.fn<unknown[], Promise<unknown>>();
const mockResolveProjectOrPick = vi.fn<unknown[], Promise<unknown>>();
const mockResolveEngineOrPick = vi.fn<unknown[], Promise<unknown>>();
const mockPersistSelection = vi.fn<unknown[], Promise<unknown>>();
const mockWithProgress = vi.fn<unknown[], Promise<unknown>>();

vi.mock('@build', () => ({
  triggerLiveCoding: (...args: unknown[]) => mockTriggerLiveCoding(...args),
  isLiveCodingSupported: () => true,
}));

vi.mock('@commands/_resolve', () => ({
  resolveProjectOrPick: (...args: unknown[]) => mockResolveProjectOrPick(...args),
  resolveEngineOrPick: (...args: unknown[]) => mockResolveEngineOrPick(...args),
  persistSelection: (...args: unknown[]) => mockPersistSelection(...args),
}));

vi.mock('@ui/notifications', () => ({
  withProgress: (...args: unknown[]) => mockWithProgress(...args),
}));

describe('executeLiveCoding —— [D16] 构建互斥锁', () => {
  const config = {
    platform: 'Win64',
    configuration: 'Development',
    target: 'Editor',
  } as unknown as Config;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
  const detection = {} as unknown as DetectionHandles;

  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
    // 每个用例结束后锁必须是空的，否则会互相污染
    unlockBuild();
    mockResolveProjectOrPick.mockResolvedValue({
      path: 'D:/MyGame/MyGame.uproject',
      name: 'MyGame',
    });
    mockResolveEngineOrPick.mockResolvedValue({ path: 'E:/UE_5.3', version: '5.3' });
    mockPersistSelection.mockResolvedValue(undefined);
    mockTriggerLiveCoding.mockResolvedValue({
      ok: true,
      value: { exitCode: 0, output: [], diagnostics: [], cancelled: false, durationMs: 1 },
    });
    // withProgress 直接执行回调
    mockWithProgress.mockImplementation(async (_title: unknown, task: unknown) => {
      const fn = task as (report: (s: string) => void, token: unknown) => Promise<unknown>;
      return await fn(() => undefined, {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      });
    });
  });

  it('锁已被占用 → 拒绝,不 spawn UBT', async () => {
    // 模拟另一个构建正在跑
    expect(tryLockBuild()).toBe(true);

    const env = await executeLiveCoding(config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'OPERATION_CANCELLED' } });
    expect(mockTriggerLiveCoding).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('正常路径 → 成功,且结束后释放锁', async () => {
    const env = await executeLiveCoding(config, logger, detection);

    expect(env).toMatchObject({ ok: true });
    expect(mockTriggerLiveCoding).toHaveBeenCalledTimes(1);
    // 关键:结束后锁必须释放，否则后续构建永久被拒
    expect(isBuildLocked()).toBe(false);
  });

  it('alreadyLocked=true(持锁方转发路径)→ 不被自己拒绝', async () => {
    // 调用方已持锁（build 的"编辑器运行中转发 Live Coding"路径）
    expect(tryLockBuild()).toBe(true);

    const env = await executeLiveCoding(config, logger, detection, undefined, false, true);

    expect(env).toMatchObject({ ok: true });
    expect(mockTriggerLiveCoding).toHaveBeenCalledTimes(1);
  });

  it('失败路径同样释放锁', async () => {
    mockTriggerLiveCoding.mockResolvedValue({
      ok: false,
      error: new Error('editor not running'),
    });

    const env = await executeLiveCoding(config, logger, detection);

    expect(env).toMatchObject({ ok: false });
    expect(isBuildLocked()).toBe(false);
  });

  it('锁被占用时不解析项目(快速拒绝)', async () => {
    expect(tryLockBuild()).toBe(true);

    await executeLiveCoding(config, logger, detection);

    // 快速拒绝路径不应该已经去解析项目/引擎
    expect(mockResolveProjectOrPick).not.toHaveBeenCalled();
  });
});
