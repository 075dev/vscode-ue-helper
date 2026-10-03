/**
 * compileCommandsHint 测试 —— 新增源文件时提示刷新编译数据库
 *
 * 模式借鉴 boocs/unreal-clangd "自动检测何时需更新编译命令"。
 * notify / execute / now 全部注入,不触碰真实 vscode UI 与命令。
 */

import { describe, it, expect, vi } from 'vitest';
import { CompileCommandsRefreshHint, DEFAULT_HINT_INTERVAL_MS } from '@clangd/compileCommandsHint';
import type { IncrementalBatch } from '@clangd/fileWatcher';

function batch(addedFiles: string[], files = addedFiles): IncrementalBatch {
  return { files, addedFiles, totalLatencyMs: 100, headerCount: 0, sourceCount: 0 };
}

function noopLogger(): {
  info: (msg: string, ...rest: unknown[]) => void;
  warn: (msg: string, ...rest: unknown[]) => void;
} {
  return { info: vi.fn(), warn: vi.fn() };
}

describe('CompileCommandsRefreshHint', () => {
  it('默认节流间隔为 10 分钟', () => {
    expect(DEFAULT_HINT_INTERVAL_MS).toBe(10 * 60 * 1000);
  });

  it('新增 C++ 文件命中 → 弹提示,用户点更新 → 执行刷新', async () => {
    const notify = vi
      .fn<unknown[], Promise<string | undefined>>()
      .mockResolvedValue('Update compile_commands.json');
    const execute = vi.fn<unknown[], Promise<unknown>>().mockResolvedValue(undefined);
    const hint = new CompileCommandsRefreshHint({ notify, execute, logger: noopLogger() });

    await hint.onBatch(batch(['/proj/Source/NewClass.cpp']));

    expect(notify).toHaveBeenCalledWith(['/proj/Source/NewClass.cpp']);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('批次中没有新增文件(change/unlink)→ 不提示', async () => {
    const notify = vi.fn<unknown[], Promise<string | undefined>>();
    const hint = new CompileCommandsRefreshHint({ notify, logger: noopLogger() });

    await hint.onBatch({
      files: ['/a.cpp', '/b.h'],
      addedFiles: [],
      totalLatencyMs: 1,
      headerCount: 1,
      sourceCount: 1,
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it('新增的是非 C++ 文件(.txt/.cs)→ 不提示', async () => {
    const notify = vi.fn<unknown[], Promise<string | undefined>>();
    const hint = new CompileCommandsRefreshHint({ notify, logger: noopLogger() });

    await hint.onBatch(batch(['/a.txt', '/b.cs']));

    expect(notify).not.toHaveBeenCalled();
  });

  it('节流窗口内第二次新增 → 静默跳过', async () => {
    let now = 0;
    const notify = vi.fn<unknown[], Promise<string | undefined>>().mockResolvedValue(undefined);
    const hint = new CompileCommandsRefreshHint({
      notify,
      now: () => now,
      intervalMs: 10_000,
      logger: noopLogger(),
    });

    await hint.onBatch(batch(['/a.cpp']));
    expect(notify).toHaveBeenCalledTimes(1);

    now = 5_000; // 窗口内
    await hint.onBatch(batch(['/b.cpp']));
    expect(notify).toHaveBeenCalledTimes(1);

    now = 20_000; // 超出窗口 → 再次提示
    await hint.onBatch(batch(['/c.cpp']));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('reset 重置节流状态', async () => {
    const notify = vi.fn<unknown[], Promise<string | undefined>>().mockResolvedValue(undefined);
    const now = 0;
    const hint = new CompileCommandsRefreshHint({
      notify,
      now: () => now,
      intervalMs: 10_000,
      logger: noopLogger(),
    });

    await hint.onBatch(batch(['/a.cpp']));
    hint.reset();
    await hint.onBatch(batch(['/b.cpp'])); // now 未变,但已 reset → 仍提示

    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('用户 Esc 关闭(undefined)→ 不执行刷新', async () => {
    const notify = vi.fn<unknown[], Promise<string | undefined>>().mockResolvedValue(undefined);
    const execute = vi.fn<unknown[], Promise<unknown>>();
    const hint = new CompileCommandsRefreshHint({ notify, execute, logger: noopLogger() });

    await hint.onBatch(batch(['/a.cpp']));

    expect(execute).not.toHaveBeenCalled();
  });

  it('notify 抛错被吞噬,不影响调用方(watcher onBatch 链路)', async () => {
    const notify = vi
      .fn<unknown[], Promise<string | undefined>>()
      .mockRejectedValue(new Error('ui gone'));
    const hint = new CompileCommandsRefreshHint({ notify, logger: noopLogger() });

    // 不应抛出
    await expect(hint.onBatch(batch(['/a.cpp']))).resolves.toBeUndefined();
  });
});
