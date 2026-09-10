/**
 * fileWatcher.test.ts —— IncrementalFileWatcher 单元测试
 *
 * Phase 7 PLAN B（per D-15/D-16/D-17）：
 *   - chokidar 事件经 100ms debounce 后 flush
 *   - 头文件 vs 源文件分级
 *   - ignored 数组生效
 *   - dispose 关闭 chokidar watcher
 *   - 空 batches 不触发 onBatch
 *
 * Mock 策略：覆盖 setup.ts 的 chokidar mock，提供 on() 实际存储 + 手动 emit 能力。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';

// ============== Mocks ==============

// 用 vi.hoisted 把 mock 状态提升到文件顶部，避免 vi.mock 工厂中引用未初始化变量
const mockState = vi.hoisted(() => {
  /** 模拟 chokidar.FSWatcher：on() 存储 listener，emit() 触发 */
  const createMockWatcher = (): {
    on: (event: string, listener: (filePath: string) => void) => unknown;
    close: () => Promise<void>;
    add: (paths: string | string[]) => void;
    unwatch: (paths: string | string[]) => void;
    __emit: (event: string, filePath: string) => void;
    __listeners: Map<string, Array<(filePath: string) => void>>;
  } => {
    const listeners = new Map<string, Array<(filePath: string) => void>>();
    const watcher = {
      on: (event: string, listener: (filePath: string) => void) => {
        if (!listeners.has(event)) {
          listeners.set(event, []);
        }
        listeners.get(event)!.push(listener);
        return watcher;
      },
      close: vi.fn(() => Promise.resolve()),
      add: vi.fn(),
      unwatch: vi.fn(),
      __emit: (event: string, filePath: string) => {
        const arr = listeners.get(event);
        if (arr) {
          for (const l of arr) {
            l(filePath);
          }
        }
      },
      __listeners: listeners,
    };
    return watcher;
  };

  let mockWatcher: ReturnType<typeof createMockWatcher> = createMockWatcher();
  const watchMock = vi.fn((_patterns?: string | string[], _options?: unknown) => mockWatcher);

  return {
    createMockWatcher,
    getMockWatcher: () => mockWatcher,
    setMockWatcher: (w: ReturnType<typeof createMockWatcher>) => {
      mockWatcher = w;
    },
    watchMock,
  };
});

vi.mock('chokidar', () => ({
  default: {
    watch: (patterns: string | string[], options?: unknown) =>
      mockState.watchMock(patterns, options),
  },
  watch: (patterns: string | string[], options?: unknown) => mockState.watchMock(patterns, options),
}));

import { IncrementalFileWatcher } from '@clangd/fileWatcher';

describe('IncrementalFileWatcher (Phase 7 PLAN B / per D-15/D-16/D-17)', () => {
  beforeEach(() => {
    mockState.setMockWatcher(mockState.createMockWatcher());
    mockState.watchMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * 辅助：从 mockWatcher 启动 IncrementalFileWatcher 并返回 mock 引用
   */
  function startWatcher(
    options: { patterns?: string[]; debounceMs?: number; ignoredPatterns?: string[] } = {},
  ): { watcher: IncrementalFileWatcher; handle: import('vscode').Disposable } {
    const watcher = new IncrementalFileWatcher();
    const handle = watcher.start({
      patterns: options.patterns ?? [path.join('/test', '**', '*.{h,hpp,cpp}')],
      debounceMs: options.debounceMs,
      ignoredPatterns: options.ignoredPatterns,
    });
    return { watcher, handle };
  }

  it('chokidar 事件经 100ms debounce 后 flush（totalLatencyMs ≥ debounceMs）', async () => {
    const { watcher, handle } = startWatcher({ debounceMs: 100 });
    const batches: import('@clangd/fileWatcher').IncrementalBatch[] = [];
    watcher.onBatch = (b) => batches.push(b);

    // 模拟 3 个连续 change 事件
    mockState.getMockWatcher().__emit('change', '/test/foo.h');
    mockState.getMockWatcher().__emit('change', '/test/bar.cpp');
    mockState.getMockWatcher().__emit('change', '/test/baz.h');

    // 等 150ms 让 debounce 触发
    await new Promise<void>((r) => setTimeout(r, 150));

    expect(batches).toHaveLength(1);
    expect(batches[0]!.totalLatencyMs).toBeGreaterThanOrEqual(100);
    expect(batches[0]!.totalLatencyMs).toBeLessThan(250);
    expect(batches[0]!.files).toHaveLength(3);

    handle.dispose();
  });

  it('头文件 vs 源文件分级（headerCount + sourceCount）', async () => {
    const { watcher, handle } = startWatcher({ debounceMs: 50 });
    const batches: import('@clangd/fileWatcher').IncrementalBatch[] = [];
    watcher.onBatch = (b) => batches.push(b);

    mockState.getMockWatcher().__emit('add', '/test/foo.h');
    mockState.getMockWatcher().__emit('add', '/test/foo.cpp');
    mockState.getMockWatcher().__emit('add', '/test/bar.hpp');
    mockState.getMockWatcher().__emit('add', '/test/baz.inl');
    mockState.getMockWatcher().__emit('add', '/test/other.cc');

    await new Promise<void>((r) => setTimeout(r, 100));

    expect(batches).toHaveLength(1);
    // 头文件: foo.h + bar.hpp + baz.inl = 3
    expect(batches[0]!.headerCount).toBe(3);
    // 源文件: foo.cpp + other.cc = 2
    expect(batches[0]!.sourceCount).toBe(2);
    expect(batches[0]!.files).toHaveLength(5);

    handle.dispose();
  });

  it('ignored 数组生效：调用方传入 ignoredPatterns 后该路径被过滤', () => {
    // 文件 watcher 本身不过滤路径 — chokidar 负责过滤
    // 验证 chokidar.watch 收到的 ignored 数组包含我们传入的额外模式
    const extraIgnored = ['**/MyExcludedDir/**'];
    const { handle } = startWatcher({
      patterns: ['/test/**/*.cpp'],
      ignoredPatterns: extraIgnored,
    });

    // 验证 chokidar.watch 第一个参数是 patterns
    expect(mockState.watchMock).toHaveBeenCalledTimes(1);
    const callArgs = mockState.watchMock.mock.calls[0]!;
    expect(callArgs[0]).toEqual(['/test/**/*.cpp']);
    // 验证 options.ignored 包含默认 + 自定义
    const opts = callArgs[1] as {
      ignored: string[];
      awaitWriteFinish: { stabilityThreshold: number };
    };
    expect(opts.ignored).toContain('**/Intermediate/**');
    expect(opts.ignored).toContain('**/Binaries/**');
    expect(opts.ignored).toContain('**/MyExcludedDir/**');
    expect(opts.ignored).toContain('**/.git/**');
    // awaitWriteFinish 配置
    expect(opts.awaitWriteFinish.stabilityThreshold).toBe(100);

    handle.dispose();
  });

  it('dispose 关闭 chokidar watcher', () => {
    const { handle } = startWatcher();
    const closeMock = mockState.getMockWatcher().close as ReturnType<typeof vi.fn>;
    expect(closeMock).not.toHaveBeenCalled();
    handle.dispose();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('空 batches 不触发 onBatch（无任何事件）', async () => {
    const { watcher, handle } = startWatcher({ debounceMs: 50 });
    let called = 0;
    watcher.onBatch = () => {
      called += 1;
    };

    // 不触发任何事件
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(called).toBe(0);
    handle.dispose();
  });

  it('重复 dispose 不抛错（幂等性）', () => {
    const { handle } = startWatcher();
    handle.dispose();
    expect(() => {
      handle.dispose();
    }).not.toThrow();
  });

  it('add/change/unlink 三个事件统一入队（per D-15）', async () => {
    const { watcher, handle } = startWatcher({ debounceMs: 30 });
    const batches: import('@clangd/fileWatcher').IncrementalBatch[] = [];
    watcher.onBatch = (b) => batches.push(b);

    mockState.getMockWatcher().__emit('add', '/test/a.h');
    mockState.getMockWatcher().__emit('change', '/test/b.h');
    mockState.getMockWatcher().__emit('unlink', '/test/c.h');

    await new Promise<void>((r) => setTimeout(r, 80));

    expect(batches).toHaveLength(1);
    expect(batches[0]!.files).toHaveLength(3);
    expect(batches[0]!.headerCount).toBe(3);
    expect(batches[0]!.sourceCount).toBe(0);

    handle.dispose();
  });

  it('多次 debounce 触发多次 flush（连续 3 批事件）', async () => {
    const { watcher, handle } = startWatcher({ debounceMs: 30 });
    const batches: import('@clangd/fileWatcher').IncrementalBatch[] = [];
    watcher.onBatch = (b) => batches.push(b);

    // 第一批
    mockState.getMockWatcher().__emit('add', '/test/a.h');
    await new Promise<void>((r) => setTimeout(r, 60));
    // 第二批
    mockState.getMockWatcher().__emit('add', '/test/b.cpp');
    await new Promise<void>((r) => setTimeout(r, 60));
    // 第三批
    mockState.getMockWatcher().__emit('add', '/test/c.h');
    await new Promise<void>((r) => setTimeout(r, 60));

    expect(batches).toHaveLength(3);
    expect(batches[0]!.files).toEqual(['/test/a.h']);
    expect(batches[1]!.files).toEqual(['/test/b.cpp']);
    expect(batches[2]!.files).toEqual(['/test/c.h']);

    handle.dispose();
  });
});
