/**
 * headerCache.test.ts —— HeaderCache 单元测试
 *
 * 覆盖：
 *   - getCachedHeader miss（文件不存在）
 *   - recordHeader 后 read 命中
 *   - mtime 增量判断（isMtimeUnchanged）
 *   - 跨 ueVersion 隔离
 *   - 原子写入（不留 .tmp）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { HeaderCache } from '@clangd/headerCache';
import type { HeaderCacheEntry } from '@clangd/types';

async function createProjectDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'header-cache-test-'));
  await fs.mkdir(path.join(dir, '.vscode', 'clangd-perf-cache', 'headers'), { recursive: true });
  return dir;
}

function makeEntry(headerPath: string, sha = 'abc123'): HeaderCacheEntry {
  return {
    headerPath,
    sha256: sha,
    mtimeMs: 1234567890,
    sizeBytes: 1024,
    recordedAt: new Date().toISOString(),
  };
}

describe('HeaderCache', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await createProjectDir();
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('getCachedHeader 返回 undefined 当 entry 不存在', async () => {
    const cache = new HeaderCache({ projectDir, ueVersion: '5.4' });
    const result = await cache.getCachedHeader('missing-key');
    expect(result).toBeUndefined();
  });

  it('recordHeader 后 getCachedHeader 命中', async () => {
    const cache = new HeaderCache({ projectDir, ueVersion: '5.4' });
    const entry = makeEntry('/path/to/Core.h');

    await cache.recordHeader(entry);
    const result = await cache.getCachedHeader(entry.sha256);
    expect(result).toEqual(entry);
  });

  it('recordHeader 使用 temp + rename 原子写入（不留 .tmp）', async () => {
    const cache = new HeaderCache({ projectDir, ueVersion: '5.4' });
    const entry = makeEntry('/path/to/Core.h');

    await cache.recordHeader(entry);

    // 验证 .tmp 文件不存在（已被 rename）
    const cacheDir = path.join(projectDir, '.vscode', 'clangd-perf-cache', 'headers', '5.4');
    const entries = await fs.readdir(cacheDir);
    const tmpFiles = entries.filter((f) => f.endsWith('.tmp'));
    expect(tmpFiles.length).toBe(0);
  });

  it('不同 ueVersion 隔离', async () => {
    const cache54 = new HeaderCache({ projectDir, ueVersion: '5.4' });
    const cache55 = new HeaderCache({ projectDir, ueVersion: '5.5' });

    const entry54 = makeEntry('/path/to/Core.h', 'sha-54');
    const entry55 = makeEntry('/path/to/Core.h', 'sha-55');

    await cache54.recordHeader(entry54);
    await cache55.recordHeader(entry55);

    // 不同 ueVersion 不应共享
    expect(await cache54.getCachedHeader(entry55.sha256)).toBeUndefined();
    expect(await cache55.getCachedHeader(entry54.sha256)).toBeUndefined();
  });

  it('损坏 JSON 返回 undefined（不抛错）', async () => {
    const cache = new HeaderCache({ projectDir, ueVersion: '5.4' });
    const entryPath = (cache as unknown as { entryPath: (k: string) => string }).entryPath(
      'corrupt-key',
    );

    await fs.mkdir(path.dirname(entryPath), { recursive: true });
    await fs.writeFile(entryPath, '{ invalid json }', 'utf-8');

    const result = await cache.getCachedHeader('corrupt-key');
    expect(result).toBeUndefined();
  });
});

describe('HeaderCache.isMtimeUnchanged 静态工具', () => {
  it('完全相同 mtime → true', () => {
    expect(HeaderCache.isMtimeUnchanged(1000, 1000)).toBe(true);
  });

  it('mtime 差异 < 1ms → true（容差）', () => {
    expect(HeaderCache.isMtimeUnchanged(1000, 1000.5)).toBe(true);
  });

  it('mtime 差异 > 1ms → false', () => {
    expect(HeaderCache.isMtimeUnchanged(1000, 1010)).toBe(false);
  });
});
