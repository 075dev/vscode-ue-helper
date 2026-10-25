/**
 * clangdIndexCache.test.ts —— clangd 索引缓存定位/量算/清理单测
 *
 * [借鉴 Incanta/vscode-cpp-unreal 的 "Clear clangd Index"]
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  clangdIndexCacheCandidates,
  inspectIndexCache,
  discoverIndexCaches,
  clearIndexCache,
  formatIndexCacheSize,
  type IndexCacheFs,
} from '@clangd/clangdIndexCache';

/** 假 fs 的节点描述 */
interface FakeNode {
  readonly isDir: boolean;
  readonly size: number;
}

/**
 * 构造一个内存文件系统假实现。
 *
 * 用「扁平路径 → 节点」描述树,readdir 由路径前缀推导子项,
 * 这样嵌套目录与文件体积都能被真实还原。
 */
function createFakeFs(
  nodes: Record<string, FakeNode>,
  failPaths: readonly string[] = [],
): IndexCacheFs & { readonly removed: string[] } {
  const removed: string[] = [];
  const store = new Map<string, FakeNode>();
  for (const [key, value] of Object.entries(nodes)) {
    store.set(path.normalize(key), value);
  }
  const failSet = new Set(failPaths.map((p) => path.normalize(p)));

  return {
    removed,
    stat(target: string) {
      const normalized = path.normalize(target);
      if (failSet.has(normalized)) {
        return Promise.reject(new Error(`EACCES: ${target}`));
      }
      const node = store.get(normalized);
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

describe('clangdIndexCacheCandidates', () => {
  it('Given Windows 环境变量 When 列举候选 Then 含 LOCALAPPDATA 下的 clangd/index', () => {
    const candidates = clangdIndexCacheCandidates('D:/Proj', {
      LOCALAPPDATA: 'C:/Users/u/AppData/Local',
    });
    expect(candidates).toContain(path.join('C:/Users/u/AppData/Local', 'clangd', 'index'));
  });

  it('Given 项目目录 When 列举候选 Then 含项目内的 .cache/clangd/index', () => {
    const candidates = clangdIndexCacheCandidates('D:/Proj', {});
    expect(candidates).toContain(path.join('D:/Proj', '.cache', 'clangd', 'index'));
  });

  it('Given 无项目目录 When 列举候选 Then 不产生项目内路径', () => {
    const candidates = clangdIndexCacheCandidates(null, { LOCALAPPDATA: 'C:/L' });
    expect(candidates.every((c) => !c.includes('.cache'))).toBe(true);
  });

  it('Given HOME 与 USERPROFILE 指向同一目录 When 列举候选 Then 去重', () => {
    const candidates = clangdIndexCacheCandidates(null, {
      USERPROFILE: 'C:/Users/u',
      HOME: 'C:/Users/u',
    });
    const unique = new Set(candidates.map((c) => path.normalize(c).toLowerCase()));
    expect(unique.size).toBe(candidates.length);
  });

  it('Given 空环境 When 列举候选 Then 返回空数组', () => {
    expect(clangdIndexCacheCandidates(null, {})).toEqual([]);
  });
});

describe('inspectIndexCache', () => {
  it('Given 目录不存在 When 量算 Then 返回 exists=false 且不抛错', async () => {
    const fs = createFakeFs({});
    const result = await inspectIndexCache('D:/missing', fs);
    expect(result.exists).toBe(false);
    expect(result.sizeBytes).toBe(0);
    expect(result.fileCount).toBe(0);
  });

  it('Given 目录含嵌套文件 When 量算 Then 递归累计字节与文件数', async () => {
    const fs = createFakeFs({
      'D:/idx': { isDir: true, size: 0 },
      'D:/idx/a.bin': { isDir: false, size: 100 },
      'D:/idx/sub': { isDir: true, size: 0 },
      'D:/idx/sub/b.bin': { isDir: false, size: 50 },
      'D:/idx/sub/c.bin': { isDir: false, size: 25 },
    });
    const result = await inspectIndexCache('D:/idx', fs);
    expect(result.exists).toBe(true);
    expect(result.sizeBytes).toBe(175);
    expect(result.fileCount).toBe(3);
  });

  it('Given 路径是文件而非目录 When 量算 Then 返回 exists=false', async () => {
    const fs = createFakeFs({ 'D:/f.bin': { isDir: false, size: 10 } });
    const result = await inspectIndexCache('D:/f.bin', fs);
    expect(result.exists).toBe(false);
  });

  it('Given 单个条目读取失败 When 量算 Then 跳过该条目不中断', async () => {
    const fs = createFakeFs(
      {
        'D:/idx': { isDir: true, size: 0 },
        'D:/idx/good.bin': { isDir: false, size: 10 },
        'D:/idx/bad.bin': { isDir: false, size: 999 },
      },
      ['D:/idx/bad.bin'],
    );
    const result = await inspectIndexCache('D:/idx', fs);
    expect(result.fileCount).toBe(1);
    expect(result.sizeBytes).toBe(10);
  });
});

describe('discoverIndexCaches', () => {
  it('Given 多个候选 When 探测 Then 只返回实际存在的', async () => {
    const fs = createFakeFs({
      'D:/idx': { isDir: true, size: 0 },
      'D:/idx/a.bin': { isDir: false, size: 10 },
    });
    const found = await discoverIndexCaches(['D:/idx', 'D:/nope'], fs);
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('D:/idx');
  });

  it('Given 候选全不存在 When 探测 Then 返回空数组', async () => {
    const fs = createFakeFs({});
    expect(await discoverIndexCaches(['D:/a', 'D:/b'], fs)).toEqual([]);
  });
});

describe('clearIndexCache', () => {
  it('Given 存在的索引目录 When 清理 Then 以 recursive+force 调用 rm', async () => {
    const removed: string[] = [];
    const fs: IndexCacheFs = {
      stat() {
        return Promise.resolve({ size: 0, isDirectory: () => true });
      },
      readdir() {
        return Promise.resolve([]);
      },
      rm(target, options) {
        removed.push(`${target}|${options.recursive}|${options.force}`);
        return Promise.resolve();
      },
    };
    await clearIndexCache('D:/idx', fs);
    expect(removed).toEqual(['D:/idx|true|true']);
  });
});

describe('formatIndexCacheSize', () => {
  it('Given 字节数 When 格式化 Then 输出可读体积', () => {
    expect(formatIndexCacheSize(0)).toBe('0 B');
    expect(formatIndexCacheSize(512)).toBe('512 B');
    expect(formatIndexCacheSize(1024)).toBe('1.0 KB');
    expect(formatIndexCacheSize(1024 * 1024 * 12.5)).toBe('12.5 MB');
  });

  it('Given 负数/NaN When 格式化 Then 回落到 0 B', () => {
    expect(formatIndexCacheSize(-1)).toBe('0 B');
    expect(formatIndexCacheSize(Number.NaN)).toBe('0 B');
  });
});
