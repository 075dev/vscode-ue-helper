/**
 * compileCommandsCache.test.ts —— CompileCommandsCache 单元测试
 *
 * 覆盖 CLANGD-01-01 缓存层：
 *   - tryRead miss（文件不存在）
 *   - write 后 read 命中
 *   - 5MB 大小限制
 *   - temp + rename 原子写入（不留 .tmp）
 *   - invalidate 后 read miss
 *   - [Phase 3.2] cache 编排子模块:tryCompileCommandsFastPath / writeCompileCommandsCache
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { CompileCommandsCache } from '@clangd/compileCommandsCache';
import {
  tryCompileCommandsFastPath,
  writeCompileCommandsCache,
} from '@clangd/compileCommands/cache';
import { computeFingerprint } from '@clangd/fingerprint';
import type { CachedCompileCommands } from '@clangd/types';

function createCachePath(projectDir: string): string {
  return path.join(projectDir, '.vscode', 'clangd-perf-cache', 'compile-commands-cache.json');
}

describe('CompileCommandsCache', () => {
  let projectDir: string;
  let ccFile: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(tmpdir(), 'cc-cache-test-'));
    ccFile = createCachePath(projectDir);
    // 预备 ccPath
    await fs.mkdir(path.dirname(ccFile), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('tryRead 返回 undefined 当 cache 文件不存在', async () => {
    const cache = new CompileCommandsCache();
    const result = await cache.tryRead(projectDir);
    expect(result).toBeUndefined();
  });

  it('write 后 tryRead 能读回相同数据', async () => {
    const cache = new CompileCommandsCache();
    const ccPath = path.join(projectDir, 'compile_commands.json');
    await fs.writeFile(ccPath, '[]', 'utf-8');

    const entry: CachedCompileCommands = {
      fingerprint: 'abc123def456',
      ccPath,
      linkTarget: ccPath,
      savedAt: new Date().toISOString(),
      fileCount: 100,
    };

    await cache.write(projectDir, entry);
    const result = await cache.tryRead(projectDir);
    expect(result).toEqual(entry);
  });

  it('write 使用 temp + rename 避免半写入（不留 .tmp）', async () => {
    const cache = new CompileCommandsCache();
    const ccPath = path.join(projectDir, 'compile_commands.json');
    await fs.writeFile(ccPath, '[]', 'utf-8');

    await cache.write(projectDir, {
      fingerprint: 'test-fp',
      ccPath,
      linkTarget: ccPath,
      savedAt: new Date().toISOString(),
      fileCount: 0,
    });

    // cache 文件存在
    const stat = await fs.stat(ccFile);
    expect(stat.isFile()).toBe(true);

    // .tmp 文件不存在（已被 rename）
    const tmpExists = await fs
      .access(`${ccFile}.tmp`)
      .then(() => true)
      .catch(() => false);
    expect(tmpExists).toBe(false);
  });

  it('ccPath 不存在时 tryRead 返回 undefined', async () => {
    const cache = new CompileCommandsCache();
    await cache.write(projectDir, {
      fingerprint: 'test-fp',
      ccPath: path.join(projectDir, 'NONEXISTENT.json'),
      linkTarget: path.join(projectDir, 'NONEXISTENT.json'),
      savedAt: new Date().toISOString(),
      fileCount: 0,
    });

    const result = await cache.tryRead(projectDir);
    expect(result).toBeUndefined();
  });

  it('写入超大 entry 拒绝（5MB 软上限）', async () => {
    const cache = new CompileCommandsCache();
    const ccPath = path.join(projectDir, 'compile_commands.json');
    await fs.writeFile(ccPath, '[]', 'utf-8');

    // 构造超过 5MB 的 fingerprint 字符串
    const hugeFp = 'a'.repeat(6 * 1024 * 1024);

    await expect(
      cache.write(projectDir, {
        fingerprint: hugeFp,
        ccPath,
        linkTarget: ccPath,
        savedAt: new Date().toISOString(),
        fileCount: 0,
      }),
    ).rejects.toThrow(/too large/);
  });

  it('invalidate 后再 read 返回 undefined', async () => {
    const cache = new CompileCommandsCache();
    const ccPath = path.join(projectDir, 'compile_commands.json');
    await fs.writeFile(ccPath, '[]', 'utf-8');

    await cache.write(projectDir, {
      fingerprint: 'test-fp',
      ccPath,
      linkTarget: ccPath,
      savedAt: new Date().toISOString(),
      fileCount: 0,
    });
    expect(await cache.tryRead(projectDir)).toBeDefined();

    await cache.invalidate(projectDir);
    expect(await cache.tryRead(projectDir)).toBeUndefined();
  });

  it('JSON 解析失败时 tryRead 返回 undefined（不抛错）', async () => {
    // 手动写入非法 JSON
    await fs.mkdir(path.dirname(ccFile), { recursive: true });
    await fs.writeFile(ccFile, '{ invalid json }', 'utf-8');

    const cache = new CompileCommandsCache();
    const result = await cache.tryRead(projectDir);
    expect(result).toBeUndefined();
  });

  it('CCPath 字节长度 < 2 时视为 miss', async () => {
    const cache = new CompileCommandsCache();
    const ccPath = path.join(projectDir, 'compile_commands.json');
    // 写入空文件 [] 大小为 2 字节，等于阈值边界
    await fs.writeFile(ccPath, '[]', 'utf-8');

    // 但 fingerprint 为空字符串 → 视为无效
    await cache.write(projectDir, {
      fingerprint: '', // empty fingerprint
      ccPath,
      linkTarget: ccPath,
      savedAt: new Date().toISOString(),
      fileCount: 0,
    });

    const result = await cache.tryRead(projectDir);
    expect(result).toBeUndefined();
  });
});

describe('CompileCommandsCache.cachePath (静态方法)', () => {
  it('返回正确路径', () => {
    // Windows 上 path.resolve 会把 /tmp/test 转成盘符绝对路径
    const input = tmpdir();
    const result = CompileCommandsCache.cachePath(input);
    // 不依赖操作系统路径转换，直接验证目录名
    expect(result).toContain('.vscode');
    expect(result).toContain('clangd-perf-cache');
    expect(result).toContain('compile-commands-cache.json');
  });
});

/* ------------------------------------------------------------------ */
/*  [Phase 3.2] cache 编排子模块测试(包裹 fingerprint + ccPath 访问性) */
/* ------------------------------------------------------------------ */

describe('tryCompileCommandsFastPath', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(tmpdir(), 'cc-fastpath-orch-'));
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('fingerprint 一致 + 非 fallback + ccPath 存在 → hit', async () => {
    const ccPath = path.join(projectDir, 'compile_commands.json');
    await fs.writeFile(ccPath, '[]', 'utf-8');

    const fp = await computeFingerprint(projectDir);
    const cache = new CompileCommandsCache();
    await cache.write(projectDir, {
      fingerprint: fp.fingerprint,
      ccPath,
      linkTarget: ccPath,
      savedAt: new Date().toISOString(),
      fileCount: 0,
    });

    const result = await tryCompileCommandsFastPath(projectDir);
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.ccPath).toBe(ccPath);
      expect(result.fingerprint).toBe(fp.fingerprint);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('fingerprint 不一致 → miss 且 hadCache=true', async () => {
    const ccPath = path.join(projectDir, 'compile_commands.json');
    await fs.writeFile(ccPath, '[]', 'utf-8');

    const cache = new CompileCommandsCache();
    await cache.write(projectDir, {
      fingerprint: 'STALE_FINGERPRINT',
      ccPath,
      linkTarget: ccPath,
      savedAt: new Date().toISOString(),
      fileCount: 0,
    });

    const result = await tryCompileCommandsFastPath(projectDir);
    expect(result.hit).toBe(false);
    if (!result.hit && !('error' in result)) {
      expect(result.hadCache).toBe(true);
      expect(result.cachedCcPath).toBe(ccPath);
      expect(result.fingerprint).not.toBe('STALE_FINGERPRINT');
    }
  });

  it('fallback entry → miss(per P1-3 防永久降级)', async () => {
    const ccPath = path.join(projectDir, 'compile_commands.json');
    await fs.writeFile(ccPath, '[]', 'utf-8');

    const fp = await computeFingerprint(projectDir);
    const cache = new CompileCommandsCache();
    await cache.write(projectDir, {
      fingerprint: fp.fingerprint,
      ccPath,
      linkTarget: ccPath,
      savedAt: new Date().toISOString(),
      fileCount: 5,
      fallback: true,
    });

    const result = await tryCompileCommandsFastPath(projectDir);
    expect(result.hit).toBe(false);
    if (!result.hit && !('error' in result)) {
      expect(result.hadCache).toBe(true);
    }
  });

  it('ccPath 缺失 → miss 且 hadCache=false（cache.tryRead 内部已过滤）', async () => {
    // 写 cache 条目指向一个不存在的 ccPath
    const fp = await computeFingerprint(projectDir);
    const cache = new CompileCommandsCache();
    const ccPath = path.join(projectDir, 'non-existent.json');
    await cache.write(projectDir, {
      fingerprint: fp.fingerprint,
      ccPath,
      linkTarget: ccPath,
      savedAt: new Date().toISOString(),
      fileCount: 0,
    });

    const result = await tryCompileCommandsFastPath(projectDir);
    expect(result.hit).toBe(false);
    // CompileCommandsCache.tryRead 内部已过滤 ccPath 缺失（per D-08），
    // 所以 fastPath 看到 hadCache=false，但 fingerprint 已算
    if (!result.hit && !('error' in result)) {
      expect(result.hadCache).toBe(false);
      expect(result.fingerprint).toBe(fp.fingerprint);
    }
  });

  it('cache 文件不存在 → miss 且 hadCache=false', async () => {
    const result = await tryCompileCommandsFastPath(projectDir);
    expect(result.hit).toBe(false);
    if (!result.hit && !('error' in result)) {
      expect(result.hadCache).toBe(false);
      expect(result.cachedCcPath).toBeUndefined();
    }
  });
});

describe('writeCompileCommandsCache', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(tmpdir(), 'cc-write-orch-'));
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('正常路径写入保留 ccPath / linkTarget / fingerprint / fileCount=0', async () => {
    const ccPath = path.join(projectDir, 'compile_commands.json');
    await fs.writeFile(ccPath, '[]', 'utf-8');

    await writeCompileCommandsCache(projectDir, ccPath, { logger: undefined });

    const cache = new CompileCommandsCache();
    const entry = await cache.tryRead(projectDir);
    expect(entry).toBeDefined();
    expect(entry?.ccPath).toBe(ccPath);
    expect(entry?.linkTarget).toBe(ccPath);
    expect(entry?.fileCount).toBe(0);
    expect(entry?.fallback).toBe(false);
    expect(entry?.fingerprint).toBeTruthy();
  });

  it('fallback 写入保留 fallback=true + 自定义 fileCount', async () => {
    const ccPath = path.join(projectDir, 'compile_commands.json');
    await fs.writeFile(ccPath, '[]', 'utf-8');

    await writeCompileCommandsCache(projectDir, ccPath, {
      fallback: true,
      fileCount: 42,
      logger: undefined,
    });

    const cache = new CompileCommandsCache();
    const entry = await cache.tryRead(projectDir);
    expect(entry).toBeDefined();
    expect(entry?.ccPath).toBe(ccPath);
    expect(entry?.fallback).toBe(true);
    expect(entry?.fileCount).toBe(42);
  });
});
