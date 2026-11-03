/**
 * clearClangdIndex.test.ts —— 清理 clangd 索引缓存命令接线测试
 *
 * [借鉴 Incanta/vscode-cpp-unreal 的 "Clear clangd Index"]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import { executeClearClangdIndex } from '@commands/clearClangdIndex';
import type { IndexCacheFs } from '@clangd/clangdIndexCache';

function createLoggerMock(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    show: vi.fn(),
  } as unknown as Logger;
}

/** 内存文件系统假实现:仅包含一个索引目录 */
function createFakeFs(
  indexDir: string,
  failOnRemove = false,
): IndexCacheFs & {
  readonly removed: string[];
} {
  const removed: string[] = [];
  const store = new Map<string, { isDir: boolean; size: number }>([
    [path.normalize(indexDir), { isDir: true, size: 0 }],
    [path.normalize(path.join(indexDir, 'a.bin')), { isDir: false, size: 100 }],
    [path.normalize(path.join(indexDir, 'b.bin')), { isDir: false, size: 100 }],
  ]);
  return {
    removed,
    stat(target: string) {
      const node = store.get(path.normalize(target));
      if (!node) {
        return Promise.reject(new Error(`ENOENT: ${target}`));
      }
      return Promise.resolve({ size: node.size, isDirectory: () => node.isDir });
    },
    readdir(target: string) {
      const dir = path.normalize(target);
      const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
      const children: string[] = [];
      for (const key of store.keys()) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const rest = key.slice(prefix.length);
        if (rest.length === 0 || rest.includes(path.sep)) {
          continue;
        }
        children.push(rest);
      }
      return Promise.resolve(children);
    },
    rm(target: string) {
      if (failOnRemove) {
        return Promise.reject(new Error('EPERM'));
      }
      const normalized = path.normalize(target);
      removed.push(normalized);
      for (const key of [...store.keys()]) {
        if (key === normalized || key.startsWith(normalized + path.sep)) {
          store.delete(key);
        }
      }
      return Promise.resolve();
    },
  };
}

const INDEX_DIR = path.join('C:/Local', 'clangd', 'index');
const ENV = { LOCALAPPDATA: 'C:/Local' };

describe('executeClearClangdIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Given 未找到索引缓存 When 执行 Then 报告未找到且不删除任何目录', async () => {
    const logger = createLoggerMock();
    const fs = createFakeFs(INDEX_DIR);
    // 让候选目录全部不存在
    const emptyFs: IndexCacheFs = {
      stat() {
        return Promise.reject(new Error('ENOENT'));
      },
      readdir() {
        return Promise.reject(new Error('ENOENT'));
      },
      rm() {
        return Promise.resolve();
      },
    };
    const notify = vi.fn();

    const envelope = await executeClearClangdIndex(logger, undefined, {
      fs: emptyFs,
      env: ENV,
      notify,
      confirm: vi.fn(),
    });

    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ cleared: [], freedBytes: 0 });
    expect(notify).toHaveBeenCalledOnce();
    expect(fs.removed).toEqual([]);
  });

  it('Given 找到索引缓存 When 用户确认 Then 清理目录并回报释放体积', async () => {
    const logger = createLoggerMock();
    const fs = createFakeFs(INDEX_DIR);
    const notify = vi.fn();

    const envelope = await executeClearClangdIndex(logger, undefined, {
      fs,
      env: ENV,
      notify,
      confirm: vi.fn(() => Promise.resolve(true)),
    });

    expect(envelope.ok).toBe(true);
    const data = envelope.data as { cleared: readonly string[]; freedBytes: number };
    expect(data.cleared).toEqual([path.normalize(INDEX_DIR)]);
    expect(data.freedBytes).toBe(200);
    expect(fs.removed).toEqual([path.normalize(INDEX_DIR)]);
  });

  it('Given 用户取消确认 When 执行 Then 返回 OPERATION_CANCELLED 且不删除', async () => {
    const logger = createLoggerMock();
    const fs = createFakeFs(INDEX_DIR);

    const envelope = await executeClearClangdIndex(logger, undefined, {
      fs,
      env: ENV,
      notify: vi.fn(),
      confirm: vi.fn(() => Promise.resolve(false)),
    });

    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('OPERATION_CANCELLED');
    expect(fs.removed).toEqual([]);
  });

  it('Given 删除失败 When 执行 Then 记 error 日志并返回失败摘要', async () => {
    const logger = createLoggerMock();
    const fs = createFakeFs(INDEX_DIR, true);

    const envelope = await executeClearClangdIndex(logger, undefined, {
      fs,
      env: ENV,
      notify: vi.fn(),
      confirm: vi.fn(() => Promise.resolve(true)),
    });

    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ cleared: [], freedBytes: 0 });
    const loggerMock = logger as unknown as { readonly error: ReturnType<typeof vi.fn> };
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it('Given workspace 有项目目录 When 执行 Then 额外探测项目内索引路径', async () => {
    const logger = createLoggerMock();
    const workspace = { projectDir: 'D:/Proj' } as unknown as WorkspaceState;
    const probed: string[] = [];
    const fs: IndexCacheFs = {
      stat(target: string) {
        probed.push(target);
        return Promise.reject(new Error('ENOENT'));
      },
      readdir() {
        return Promise.resolve([]);
      },
      rm() {
        return Promise.resolve();
      },
    };

    await executeClearClangdIndex(logger, workspace, {
      fs,
      env: ENV,
      notify: vi.fn(),
      confirm: vi.fn(),
    });

    expect(probed.some((p) => p.includes(path.join('.cache', 'clangd', 'index')))).toBe(true);
  });
});
