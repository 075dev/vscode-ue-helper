/**
 * compileCommandsHint 测试 —— 新增源文件时提示刷新编译数据库
 *
 * 模式借鉴 boocs/unreal-clangd "自动检测何时需更新编译命令"。
 * notify / execute / now 全部注入,不触碰真实 vscode UI 与命令。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CompileCommandsRefreshHint,
  DEFAULT_HINT_INTERVAL_MS,
  DEFAULT_AUTO_INTERVAL_MS,
} from '@clangd/compileCommandsHint';
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

describe('CompileCommandsRefreshHint — auto 模式(add-004 / D9)', () => {
  it('自动模式默认节流间隔为 2 分钟', () => {
    expect(DEFAULT_AUTO_INTERVAL_MS).toBe(2 * 60 * 1000);
  });

  it('auto 模式命中 → 不弹提示,直接静默重建(execute 收到 auto)', async () => {
    const notify = vi.fn<unknown[], Promise<string | undefined>>();
    const execute = vi.fn<unknown[], Promise<unknown>>().mockResolvedValue(undefined);
    const hint = new CompileCommandsRefreshHint({
      notify,
      execute,
      mode: () => 'auto',
      logger: noopLogger(),
    });

    await hint.onBatch(batch(['/proj/Source/NewClass.cpp']));

    expect(notify).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('auto');
  });

  it('auto 节流:2 分钟窗内重复批次只触发一次,窗外重新触发', async () => {
    let now = 0;
    const execute = vi.fn<unknown[], Promise<unknown>>().mockResolvedValue(undefined);
    const hint = new CompileCommandsRefreshHint({
      execute,
      mode: () => 'auto',
      now: () => now,
      logger: noopLogger(),
    });

    await hint.onBatch(batch(['/a.cpp']));
    now = 60_000; // 窗口内
    await hint.onBatch(batch(['/b.cpp']));
    expect(execute).toHaveBeenCalledTimes(1);

    now = 130_000; // 超出 2 分钟窗口
    await hint.onBatch(batch(['/c.cpp']));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('inFlight 防重入:执行期间的新批次被跳过,完成后复位可再触发', async () => {
    let now = 0;
    let releaseExecute: (() => void) | null = null;
    // 仅第一次调用返回手动释放的 pending(模拟 UBT 执行中),后续调用立即完成
    const execute = vi
      .fn<unknown[], Promise<unknown>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseExecute = () => resolve(undefined);
          }),
      )
      .mockResolvedValue(undefined);
    const hint = new CompileCommandsRefreshHint({
      execute,
      mode: () => 'auto',
      now: () => now,
      logger: noopLogger(),
    });

    const first = hint.onBatch(batch(['/a.cpp']));
    // 推进到窗外(模拟 UBT 执行期间时间流逝),新批次到达 → 节流已过但 inFlight → skip
    now = 130_000;
    await hint.onBatch(batch(['/b.cpp']));
    expect(execute).toHaveBeenCalledTimes(1);

    // TS 控制流无法追踪闭包内赋值,显式断言绕过 null 收窄
    (releaseExecute as (() => void) | null)?.();
    await first;

    // 完成后节流窗内仍 skip;窗外 → 重新触发(证明 inFlight 已复位)
    now = 140_000; // 距上次触发 10s < 2 分钟
    await hint.onBatch(batch(['/c.cpp']));
    expect(execute).toHaveBeenCalledTimes(1);
    now = 260_000; // 距上次触发 120s ≥ 窗口
    await hint.onBatch(batch(['/d.cpp']));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('模式 getter 现读:同一实例下开关从 auto 切回 notify,窗过后行为即时切换', async () => {
    let mode: 'auto' | 'notify' = 'auto';
    let now = 0;
    const notify = vi.fn<unknown[], Promise<string | undefined>>().mockResolvedValue(undefined);
    const execute = vi.fn<unknown[], Promise<unknown>>().mockResolvedValue(undefined);
    const hint = new CompileCommandsRefreshHint({
      notify,
      execute,
      mode: () => mode,
      now: () => now,
      logger: noopLogger(),
    });

    await hint.onBatch(batch(['/a.cpp']));
    expect(notify).not.toHaveBeenCalled(); // auto:静默
    expect(execute).toHaveBeenCalledWith('auto');

    // 切换配置(getter 现读,无需重建实例);推进时间越过 notify 的 10 分钟节流窗
    mode = 'notify';
    now = DEFAULT_HINT_INTERVAL_MS;
    await hint.onBatch(batch(['/b.cpp']));
    expect(notify).toHaveBeenCalledTimes(1); // notify:弹提示,不自动执行
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('auto 模式 execute 抛错被吞 + inFlight 复位(下窗自动重试)', async () => {
    let now = 0;
    const execute = vi
      .fn<unknown[], Promise<unknown>>()
      .mockRejectedValueOnce(new Error('command missing'))
      .mockResolvedValue(undefined);
    const logger = noopLogger();
    const hint = new CompileCommandsRefreshHint({
      execute,
      mode: () => 'auto',
      now: () => now,
      logger,
    });

    await expect(hint.onBatch(batch(['/a.cpp']))).resolves.toBeUndefined();

    now = 130_000; // 下个节流窗 → 重试成功
    await hint.onBatch(batch(['/b.cpp']));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('auto 模式管线失败(envelope ok:false)→ 失败日志而非虚假成功日志(评审 F-1)', async () => {
    const execute = vi
      .fn<unknown[], Promise<unknown>>()
      .mockResolvedValue({ ok: false, error: { code: 'BUILD_FAILED' } });
    const logger = noopLogger();
    const hint = new CompileCommandsRefreshHint({
      execute,
      mode: () => 'auto',
      logger,
    });

    await hint.onBatch(batch(['/a.cpp']));

    expect(logger.warn).toHaveBeenCalledWith(
      '[compileCommandsHint] auto-refresh failed, will retry next window',
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      '[compileCommandsHint] auto-refresh finished (clangd will hot-reload)',
    );
  });
});
