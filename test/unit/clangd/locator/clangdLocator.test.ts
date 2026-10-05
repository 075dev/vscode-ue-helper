/**
 * clangdLocator.test.ts —— clangd 路径统一解析服务单元测试（add-003 / D8）
 *
 * 测试策略：
 * - 全部 IO（execFile / fileExists / PATH / 默认目录）内存 fake，不依赖本机 clangd。
 * - 覆盖验收清单核心条目：懒探测（构造零 IO）、探测缓存（同输入只探测一次）、
 *   invalidate 失效、launcher 排除、两个视图语义、findClangdShared 短路与退化链。
 */

import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import {
  ClangdLocator,
  findClangdShared,
  type ClangdLocatorIo,
} from '@clangd/locator/clangdLocator';

const LAUNCHER = 'C:/ext/out/launcher/proxy-launcher.bat';
const CONFIG_CLANGD = 'C:/llvm/config/clangd.exe';
const BACKUP_CLANGD = 'C:/llvm/backup/clangd.exe';
const WHERE_CLANGD = 'C:/Program Files/LLVM/bin/clangd.exe';
const PATH_CLANGD = 'C:/tools/LLVM/bin/clangd.exe';
const DEFAULT_CLANGD = 'C:/Program Files/LLVM/bin/clangd.exe';

interface IoCalls {
  execFile: number;
  fileExists: number;
  /** 每次 execFile 收到的 timeout(ms),用于锁定 where / --version 的 5s 超时。 */
  readonly execFileTimeouts: number[];
}

interface IoOptions {
  readonly existingPaths?: readonly string[];
  readonly whereStdout?: string;
  readonly versionStdout?: string;
}

function makeIo(options: IoOptions = {}): { io: ClangdLocatorIo; calls: IoCalls } {
  const existing = new Set(options.existingPaths ?? []);
  const calls: IoCalls = { execFile: 0, fileExists: 0, execFileTimeouts: [] };
  const io: ClangdLocatorIo = {
    execFile: (file, args, opts) => {
      calls.execFile += 1;
      calls.execFileTimeouts.push(opts.timeout);
      if (file === 'where') {
        return Promise.resolve({ stdout: options.whereStdout ?? '', stderr: '' });
      }
      if (args.includes('--version')) {
        return Promise.resolve({ stdout: options.versionStdout ?? '', stderr: '' });
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    },
    fileExists: (candidate) => {
      calls.fileExists += 1;
      return existing.has(candidate);
    },
    envPath: 'C:/tools/LLVM/bin',
    pathDelimiter: ';',
    defaultSearchRoots: () => ['C:/Program Files/LLVM/bin'],
  };
  return { io, calls };
}

describe('ClangdLocator — 懒探测与缓存', () => {
  it('Given 构造完成 When 未调用视图 Then 零 IO（无子进程、无文件访问）', () => {
    // Given
    const { io, calls } = makeIo({ existingPaths: [CONFIG_CLANGD] });

    // When — 仅构造
    new ClangdLocator({ getConfiguredClangdPath: () => CONFIG_CLANGD, io });

    // Then
    expect(calls.execFile).toBe(0);
    expect(calls.fileExists).toBe(0);
  });

  it('Given 同输入两次调用视图 When 解析 Then 共享一次探测（where 只跑一次）', async () => {
    // Given
    const { io, calls } = makeIo({ existingPaths: [CONFIG_CLANGD] });
    const locator = new ClangdLocator({ getConfiguredClangdPath: () => CONFIG_CLANGD, io });

    // When
    const first = await locator.resolveRealClangd();
    const second = await locator.resolveRealClangd();

    // Then
    expect(first).toEqual({ kind: 'found', path: CONFIG_CLANGD, source: 'configuredClangdPath' });
    expect(second).toEqual(first);
    expect(calls.execFile).toBe(1);
  });

  it('Given 并发调用视图 When 解析 Then 并发共享同一次探测', async () => {
    // Given
    const { io, calls } = makeIo({ existingPaths: [BACKUP_CLANGD] });
    const locator = new ClangdLocator({ getBackupClangdPath: () => BACKUP_CLANGD, io });

    // When
    const [a, b] = await Promise.all([locator.resolveRealClangd(), locator.resolveRealClangd()]);

    // Then
    expect(a).toEqual(b);
    expect(calls.execFile).toBe(1);
  });

  it('Given invalidate 之后调用视图 When 解析 Then 重新探测', async () => {
    // Given
    const { io, calls } = makeIo({ existingPaths: [CONFIG_CLANGD] });
    const locator = new ClangdLocator({ getConfiguredClangdPath: () => CONFIG_CLANGD, io });
    await locator.resolveRealClangd();

    // When
    locator.invalidate();
    await locator.resolveRealClangd();

    // Then
    expect(calls.execFile).toBe(2);
  });

  it('Given 探测执行子进程 When where/--version 调用 Then 携带 5s 超时', async () => {
    // Given
    const installedDir = 'C:/llvm/bin';
    const { io, calls } = makeIo({
      whereStdout: `${WHERE_CLANGD}\n`,
      versionStdout: `InstalledDir: ${installedDir}\n`,
      existingPaths: [WHERE_CLANGD],
    });
    const locator = new ClangdLocator({ launcherPath: LAUNCHER, io });

    // When
    await locator.locateClangDriver();

    // Then — where 与 clangd --version 两次子进程调用均为 5s 超时
    expect(calls.execFile).toBe(2);
    expect(calls.execFileTimeouts).toEqual([5_000, 5_000]);
  });
});

describe('ClangdLocator — resolveRealClangd 视图（launcher 排除）', () => {
  it('Given 第三方 clangd.path 当前值等于 launcher When 解析 Then 排除 launcher 回退备份', async () => {
    // Given
    const { io } = makeIo({ existingPaths: [LAUNCHER, BACKUP_CLANGD] });
    const locator = new ClangdLocator({
      getCurrentClangdExtensionPath: () => LAUNCHER,
      getBackupClangdPath: () => BACKUP_CLANGD,
      launcherPath: LAUNCHER,
      io,
    });

    // When / Then
    await expect(locator.resolveRealClangd()).resolves.toEqual({
      kind: 'found',
      path: BACKUP_CLANGD,
      source: 'backupClangdPath',
    });
  });

  it('Given launcher 候选被拒且其余缺失 When 解析 Then notFound 携带 proxyLauncher 与 missing', async () => {
    // Given — clangd.path 当前值 = launcher（proxy 激活态），配置路径不存在
    const { io } = makeIo({ existingPaths: [LAUNCHER] });
    const locator = new ClangdLocator({
      getCurrentClangdExtensionPath: () => LAUNCHER,
      getConfiguredClangdPath: () => 'C:/missing/config/clangd.exe',
      launcherPath: LAUNCHER,
      io,
    });

    // When
    const result = await locator.resolveRealClangd();

    // Then
    expect(result.kind).toBe('notFound');
    if (result.kind === 'notFound') {
      const reasons = result.checkedCandidates.map((c) => c.reason);
      expect(reasons).toContain('proxyLauncher');
      expect(reasons).toContain('missing');
    }
  });

  it('Given 备份缺失而 where 有结果 When 解析 Then whereCommand 级生效', async () => {
    // Given
    const { io } = makeIo({
      whereStdout: `${WHERE_CLANGD}\n`,
      existingPaths: [WHERE_CLANGD],
    });
    const locator = new ClangdLocator({
      getBackupClangdPath: () => 'C:/missing/backup/clangd.exe',
      launcherPath: LAUNCHER,
      io,
    });

    // When / Then
    await expect(locator.resolveRealClangd()).resolves.toEqual({
      kind: 'found',
      path: WHERE_CLANGD,
      source: 'whereCommand',
    });
  });
});

describe('ClangdLocator — locateClangDriver 视图', () => {
  it('Given clangd 存在且 --version 报告 InstalledDir When 定位 Then 返回 clangd 与 clang++ 驱动器', async () => {
    // Given — 期望值用与实现相同的 path.join 生成，避免斜杠方向的平台差异
    const installedDir = 'C:/llvm/bin';
    const expectedDriver = path.join(installedDir, 'clang++.exe');
    const { io } = makeIo({
      whereStdout: `${WHERE_CLANGD}\n`,
      versionStdout: `clangd version 19.1.0\nInstalledDir: ${installedDir}\n`,
      existingPaths: [WHERE_CLANGD, expectedDriver],
    });
    const locator = new ClangdLocator({ launcherPath: LAUNCHER, io });

    // When
    const result = await locator.locateClangDriver();

    // Then
    expect(result).toEqual({
      clangdPath: WHERE_CLANGD,
      source: 'whereCommand',
      driverPath: expectedDriver,
    });
  });

  it('Given clangd 未找到 When 定位 Then 返回 null 且不运行 --version', async () => {
    // Given
    const { io, calls } = makeIo({ existingPaths: [] });
    const locator = new ClangdLocator({ launcherPath: LAUNCHER, io });

    // When
    const result = await locator.locateClangDriver();

    // Then
    expect(result).toBeNull();
    expect(calls.execFile).toBe(1); // 仅 where 探测,无 --version
  });
});

describe('findClangdShared — windowsSdk 共享查找', () => {
  it('Given 显式配置存在 When 查找 Then 零子进程短路返回（原 windowsSdk 语义）', async () => {
    // Given
    const { io, calls } = makeIo({ existingPaths: [CONFIG_CLANGD] });

    // When
    const result = await findClangdShared({ configuredPath: CONFIG_CLANGD, io });

    // Then
    expect(result).toEqual({ path: CONFIG_CLANGD, source: 'configuredClangdPath' });
    expect(calls.execFile).toBe(0);
  });

  it('Given 配置缺失 When 查找 Then 退化 where → PATH → 默认目录', async () => {
    // Given
    const { io } = makeIo({ existingPaths: [PATH_CLANGD, DEFAULT_CLANGD] });

    // When
    const result = await findClangdShared({ io });

    // Then
    expect(result).toEqual({ path: PATH_CLANGD, source: 'pathEnv' });
  });

  it('Given 全部缺失 When 查找 Then 返回 null', async () => {
    // Given
    const { io } = makeIo({ existingPaths: [] });

    // When
    const result = await findClangdShared({ io });

    // Then
    expect(result).toBeNull();
  });
});
