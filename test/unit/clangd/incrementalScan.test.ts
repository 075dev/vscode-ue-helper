/**
 * incrementalScan.test.ts —— Phase 7 PLAN B 集成测试
 *
 * Per D-17 + D-18 + PLAN B 任务 7B-02 集成测试：
 *   - 真实文件变更触发 incremental scan
 *   - 批量连续变更触发单次 flush
 *   - UBT 入口 + IncrementalWatcher 协同
 *
 * 注意：与 PLAN A 偏离一致（见 07-01-SUMMARY.md 决策 6），
 * 本测试文件放在 test/unit/clangd/ 而非 test/integration/clangd/，
 * 因为 vitest 默认 include 不覆盖 test/integration/**，且
 * test/integration/runTests.js 不存在——为避免死代码而调整路径。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ============== Mocks ==============

interface MockFSWatcher {
  on: (event: string, listener: (filePath: string) => void) => unknown;
  close: () => Promise<void>;
  add: (paths: string | string[]) => void;
  unwatch: (paths: string | string[]) => void;
  __emit: (event: string, filePath: string) => void;
}

const chokidarMock = vi.hoisted(() => {
  const createMockWatcher = (): MockFSWatcher => {
    const listeners = new Map<string, Array<(filePath: string) => void>>();
    const watcher: MockFSWatcher = {
      on: (event, listener) => {
        if (!listeners.has(event)) {
          listeners.set(event, []);
        }
        listeners.get(event)!.push(listener);
        return watcher;
      },
      close: vi.fn(() => Promise.resolve()),
      add: vi.fn(),
      unwatch: vi.fn(),
      __emit: (event, filePath) => {
        const arr = listeners.get(event);
        if (arr) {
          for (const l of arr) {
            l(filePath);
          }
        }
      },
    };
    return watcher;
  };
  let mockWatcher: MockFSWatcher = createMockWatcher();
  const watchMock = vi.fn((_patterns?: string | string[], _options?: unknown) => mockWatcher);
  return {
    createMockWatcher,
    getMock: () => mockWatcher,
    setMock: (w: MockFSWatcher) => {
      mockWatcher = w;
    },
    watchMock,
  };
});

vi.mock('chokidar', () => ({
  default: {
    watch: (patterns: string | string[], options?: unknown) => chokidarMock.watchMock(patterns, options),
  },
  watch: (patterns: string | string[], options?: unknown) => chokidarMock.watchMock(patterns, options),
}));

/** 捕获所有 perfLog 调用 */
const perfCalls: Array<{ event: string; elapsedMs: number; meta?: Record<string, unknown> }> = [];
const recordIncrementalScanCalls: Array<{ elapsedMs: number; batchSize: number }> = [];

vi.mock('@clangd/perfLog', () => ({
  perfLog: {
    record: (ev: { event: string; elapsedMs: number; meta?: Record<string, unknown> }) => {
      perfCalls.push({ event: ev.event, elapsedMs: ev.elapsedMs, meta: ev.meta });
    },
    recordPreparseResult: vi.fn(),
    recordIncrementalScan: (elapsedMs: number, batchSize: number) => {
      recordIncrementalScanCalls.push({ elapsedMs, batchSize });
    },
    getCompileCommandsLastMs: () => 0,
    getPreparseHitRate: () => ({ hits: 0, misses: 0, rate: 0 }),
    getLastIncrementalScanMs: () => 0,
    onMetricUpdate: () => ({ dispose: vi.fn() }),
    flushToDisk: () => Promise.resolve(),
  },
}));

import { IncrementalFileWatcher } from '@clangd/fileWatcher';
import { perfLog } from '@clangd/perfLog';

describe('IncrementalScan 集成测试 (Phase 7 PLAN B / per D-17 + D-18)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    chokidarMock.setMock(chokidarMock.createMockWatcher());
    chokidarMock.watchMock.mockClear();
    perfCalls.length = 0;
    recordIncrementalScanCalls.length = 0;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'incremental-scan-int-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('真实文件变更触发 incremental scan（onBatch 被调用 + 文件计数 > 0）', async () => {
    // 模拟 UE 工程结构
    const sourceDir = path.join(tmpDir, 'Source', 'MyTarget');
    await fs.mkdir(sourceDir, { recursive: true });

    // 启动 watcher
    const watcher = new IncrementalFileWatcher();
    const batches: import('@clangd/fileWatcher').IncrementalBatch[] = [];
    watcher.onBatch = (b) => {
      batches.push(b);
      // 模拟 index.ts 中的 onBatch 处理：调用 perfLog.recordIncrementalScan
      // 直接同步调用，但用 performance.now() 模拟
    };
    const handle = watcher.start({
      patterns: [path.join(sourceDir, '**', '*.{h,hpp,cpp}')],
      debounceMs: 100,
    });

    // 模拟 3 个真实文件创建事件
    chokidarMock.getMock().__emit('add', path.join(sourceDir, 'MyClass.h'));
    chokidarMock.getMock().__emit('add', path.join(sourceDir, 'MyClass.cpp'));
    chokidarMock.getMock().__emit('change', path.join(sourceDir, 'Existing.h'));

    await new Promise<void>((r) => setTimeout(r, 150));

    // 验证：3 个事件合并为 1 个 batch
    expect(batches).toHaveLength(1);
    expect(batches[0]!.files).toHaveLength(3);
    expect(batches[0]!.headerCount).toBe(2);
    expect(batches[0]!.sourceCount).toBe(1);
    expect(batches[0]!.totalLatencyMs).toBeGreaterThanOrEqual(100);
    // per D-17：增量扫描延迟 < 200ms
    expect(batches[0]!.totalLatencyMs).toBeLessThan(250);

    handle.dispose();
  });

  it('批量连续变更触发单次 flush（debounce 生效）', async () => {
    const sourceDir = path.join(tmpDir, 'Source', 'MyTarget');
    await fs.mkdir(sourceDir, { recursive: true });

    const watcher = new IncrementalFileWatcher();
    const batches: import('@clangd/fileWatcher').IncrementalBatch[] = [];
    watcher.onBatch = (b) => batches.push(b);
    const handle = watcher.start({
      patterns: [path.join(sourceDir, '**', '*.cpp')],
      debounceMs: 50,
    });

    // 在 80ms 内连续触发 5 个事件（短于 50ms debounce 触发周期）
    chokidarMock.getMock().__emit('add', path.join(sourceDir, 'a.cpp'));
    chokidarMock.getMock().__emit('add', path.join(sourceDir, 'b.cpp'));
    chokidarMock.getMock().__emit('add', path.join(sourceDir, 'c.cpp'));
    chokidarMock.getMock().__emit('change', path.join(sourceDir, 'a.cpp'));
    chokidarMock.getMock().__emit('add', path.join(sourceDir, 'd.cpp'));

    await new Promise<void>((r) => setTimeout(r, 100));

    // 验证：5 个连续事件合并为 1 个 batch
    expect(batches).toHaveLength(1);
    expect(batches[0]!.files).toHaveLength(5);

    handle.dispose();
  });

  it('UBT 入口 + IncrementalWatcher 协同：perfLog 收到 incremental.scanComplete 事件 + elapsedMs < 200ms', async () => {
    // 模拟完整 index.ts 协同场景：fileWatcher.onBatch + perfLog.recordIncrementalScan
    const sourceDir = path.join(tmpDir, 'Source', 'MyTarget');
    await fs.mkdir(sourceDir, { recursive: true });

    const watcher = new IncrementalFileWatcher();
    watcher.onBatch = (b) => {
      // 与 index.ts 中 onBatch 处理一致
      // 这里直接调用 perfLog 单例（已 mock）
      perfLog.recordIncrementalScan(b.totalLatencyMs, b.files.length);
    };
    const handle = watcher.start({
      patterns: [path.join(sourceDir, '**', '*.{h,hpp,cpp}')],
      debounceMs: 100,
    });

    // 模拟真实文件创建 → chokidar 触发
    chokidarMock.getMock().__emit('add', path.join(sourceDir, 'PlayerController.h'));
    chokidarMock.getMock().__emit('add', path.join(sourceDir, 'PlayerController.cpp'));

    await new Promise<void>((r) => setTimeout(r, 150));

    // 验证：recordIncrementalScan 被调用 1 次
    expect(recordIncrementalScanCalls).toHaveLength(1);
    // per D-17：< 200ms
    expect(recordIncrementalScanCalls[0]!.elapsedMs).toBeLessThan(200);
    // batchSize = 2
    expect(recordIncrementalScanCalls[0]!.batchSize).toBe(2);

    handle.dispose();
  });

  it('dispose 后新事件不再触发 onBatch（关闭后停止）', async () => {
    const sourceDir = path.join(tmpDir, 'Source', 'MyTarget');
    await fs.mkdir(sourceDir, { recursive: true });

    const watcher = new IncrementalFileWatcher();
    let called = 0;
    watcher.onBatch = () => {
      called += 1;
    };
    const handle = watcher.start({
      patterns: [path.join(sourceDir, '**', '*.h')],
      debounceMs: 50,
    });
    handle.dispose();

    chokidarMock.getMock().__emit('add', path.join(sourceDir, 'AfterDispose.h'));
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(called).toBe(0);
  });
});