/**
 * compileCommands/symlink.test.ts —— Phase 3.3 symlink 子模块行为测试
 *
 * 覆盖 linkToWorkspaceRoot 在不同 fs 路径下的契约：
 *   1. 目标路径派生正确 + 同路径短路（source 已在 target 位置）
 *   2. symlink 成功 → 返回 target,succeeded=true,无 copyFile 调用
 *   3. symlink 抛 Windows 权限类错误 → 自动转 copyFile 成功
 *   4. symlink + copyFile 都失败 → throw,错误包含 source/target + errno
 *   5. 既有 symlink 指向其他位置 → 被替换为新 symlink
 *   6. 既有 symlink 已指向 source → 跳过 (已有正确 symlink 短路)
 *
 * 由于 node:fs/promises 的导出是只读属性,通过 vi.mock 整体替换模块
 * (参考 test/unit/commands/firstRunInit.test.ts 既有做法),
 * 让 symlink/copyFile/lstat/unlink/readlink/access/mkdir 均可独立控制。
 * vitest 的 vi.mock 会被编译时提升到 import 之前,因此静态 import 可用。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { Stats } from 'node:fs';
import { linkToWorkspaceRoot } from '@clangd/compileCommands/symlink';
const {
  symlinkMock,
  copyFileMock,
  lstatMock,
  unlinkMock,
  readlinkMock,
  accessMock,
  mkdirMock,
  readFileMock,
  writeFileMock,
  rmMock,
} = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    symlinkMock: fn(),
    copyFileMock: fn(),
    lstatMock: fn(),
    unlinkMock: fn(),
    readlinkMock: fn(),
    accessMock: fn(),
    mkdirMock: fn(),
    readFileMock: fn(),
    writeFileMock: fn(),
    rmMock: fn(),
  };
});

// node:fs/promises 的导出是 read-only 属性，必须用 vi.mock 整体替换
vi.mock('node:fs/promises', () => ({
  symlink: symlinkMock,
  copyFile: copyFileMock,
  lstat: lstatMock,
  unlink: unlinkMock,
  readlink: readlinkMock,
  access: accessMock,
  mkdir: mkdirMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
  rm: rmMock,
  default: {
    symlink: symlinkMock,
    copyFile: copyFileMock,
    lstat: lstatMock,
    unlink: unlinkMock,
    readlink: readlinkMock,
    access: accessMock,
    mkdir: mkdirMock,
    readFile: readFileMock,
    writeFile: writeFileMock,
    rm: rmMock,
  },
}));

/** 捕获所有 perfLog.record 调用 */
const recordCalls: Array<{ event: string; elapsedMs: number; meta?: Record<string, unknown> }> = [];

vi.mock('@clangd/perfLog', () => ({
  perfLog: {
    record: (ev: { event: string; elapsedMs: number; meta?: Record<string, unknown> }) => {
      recordCalls.push({ event: ev.event, elapsedMs: ev.elapsedMs, meta: ev.meta });
    },
    recordPreparseResult: vi.fn(),
    recordIncrementalScan: vi.fn(),
    getCompileCommandsLastMs: () => 0,
    getPreparseHitRate: () => ({ hits: 0, misses: 0, rate: 0 }),
    getLastIncrementalScanMs: () => 0,
    onMetricUpdate: () => ({ dispose: vi.fn() }),
    flushToDisk: () => Promise.resolve(),
  },
}));

describe('compileCommands/symlink 子模块（Phase 3.3）', () => {
  const projectDir = 'C:\\fake\\MyProject';
  const projectPath = `${projectDir}\\MyProject.uproject`;
  const ccDir = `${projectDir}\\.vscode\\vscodeuehelper`;
  const targetPath = `${ccDir}\\compile_commands.json`;
  const ccOutputPath = `${projectDir}\\compile_commands.json`;

  function resetFsMocks() {
    symlinkMock.mockReset().mockResolvedValue(undefined);
    copyFileMock.mockReset().mockResolvedValue(undefined);
    lstatMock.mockReset();
    unlinkMock.mockReset().mockResolvedValue(undefined);
    readlinkMock.mockReset();
    accessMock.mockReset().mockResolvedValue(undefined);
    mkdirMock.mockReset().mockResolvedValue(undefined);
    readFileMock.mockReset();
    writeFileMock.mockReset();
    rmMock.mockReset().mockResolvedValue(undefined);
  }

  function makeStats(isSymbolicLink: boolean, isFile: boolean, size = 0): Stats {
    return {
      isSymbolicLink: () => isSymbolicLink,
      isFile: () => isFile,
      isDirectory: () => false,
      size,
    } as Stats;
  }

  beforeEach(() => {
    recordCalls.length = 0;
    resetFsMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /* ==================== 1. 目标派生 + 同路径短路 ==================== */

  it('派生目标 = <projectDir>/.vscode/vscodeuehelper/compile_commands.json;同路径短路', async () => {
    // source === target,应走 path.resolve 相等早返,不应调用任何 fs 操作
    const result = await linkToWorkspaceRoot(targetPath, projectPath);

    expect(result).toBe(targetPath);
    // 同路径短路根本不调 fs.mkdir/symlink/copyFile
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(symlinkMock).not.toHaveBeenCalled();
    expect(copyFileMock).not.toHaveBeenCalled();

    const lwsEvents = recordCalls.filter((c) => c.event === 'compileCommands.linkToWorkspaceRoot');
    expect(lwsEvents.length).toBe(1);
    expect(lwsEvents[0]!.meta?.['skipped']).toBe(true);
    expect(lwsEvents[0]!.meta?.['target']).toBe(targetPath);
  });

  /* ==================== 2. symlink 成功 ==================== */

  it('symlink 成功时返回 target,记录 succeeded=true,不触发 copyFile', async () => {
    // lstat throw (目标不存在) → 走 symlink 分支
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    lstatMock.mockRejectedValue(enoent);

    const result = await linkToWorkspaceRoot(ccOutputPath, projectPath);

    expect(result).toBe(targetPath);
    expect(mkdirMock).toHaveBeenCalledWith(ccDir, { recursive: true });
    expect(symlinkMock).toHaveBeenCalledWith(ccOutputPath, targetPath, 'file');
    // copyFile 未被调用(symlink 一次就成功)
    expect(copyFileMock).not.toHaveBeenCalled();

    const lwsEvents = recordCalls.filter((c) => c.event === 'compileCommands.linkToWorkspaceRoot');
    expect(lwsEvents.length).toBe(1);
    expect(lwsEvents[0]!.meta?.['succeeded']).toBe(true);
    expect(lwsEvents[0]!.meta?.['target']).toBe(targetPath);
  });

  /* ==================== 3. symlink 失败 → copy 成功 ==================== */

  it('symlink 抛 Windows EPERM 后 copyFile 成功,记录 succeeded=true', async () => {
    // 模拟 Windows 非 Developer Mode:fs.symlink 抛 EPERM
    const symlinkErr = Object.assign(new Error('EPERM: operation not permitted'), {
      code: 'EPERM',
    });
    symlinkMock.mockRejectedValue(symlinkErr);
    // lstat 抛 ENOENT(目标不存在)→ 走 try symlink 分支
    lstatMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await linkToWorkspaceRoot(ccOutputPath, projectPath);

    expect(result).toBe(targetPath);
    expect(symlinkMock).toHaveBeenCalledWith(ccOutputPath, targetPath, 'file');
    expect(copyFileMock).toHaveBeenCalledWith(ccOutputPath, targetPath);

    const lwsEvents = recordCalls.filter((c) => c.event === 'compileCommands.linkToWorkspaceRoot');
    expect(lwsEvents.length).toBe(1);
    expect(lwsEvents[0]!.meta?.['succeeded']).toBe(true);
    expect(lwsEvents[0]!.meta?.['target']).toBe(targetPath);
  });

  /* ==================== 4. symlink + copy 都失败 → throw ==================== */

  it('symlink 和 copy 都失败时 throw,错误包含 source/target + errno', async () => {
    const symlinkErr = Object.assign(new Error('EPERM: operation not permitted'), {
      code: 'EPERM',
    });
    const copyErr = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    symlinkMock.mockRejectedValue(symlinkErr);
    copyFileMock.mockRejectedValue(copyErr);
    lstatMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await expect(linkToWorkspaceRoot(ccOutputPath, projectPath)).rejects.toThrow(
      /linkToWorkspaceRoot: both symlink and copy failed/,
    );

    // 单调用验证错误消息包含 source= 与 target= 字段（一次性 promise 复用会触发重复 mock）
    const err = await linkToWorkspaceRoot(ccOutputPath, projectPath).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).not.toBeNull();
    expect(err!.message).toContain(`source=${ccOutputPath}`);
    expect(err!.message).toContain(`target=${targetPath}`);
    expect(err!.message).toContain('symlink errno=EPERM');
    expect(err!.message).toContain('copy errno=ENOENT');

    // 失败时不应再记录 succeeded=true 的 perf 事件(流程中断前未到达成功埋点)
    const lwsEvents = recordCalls.filter((c) => c.event === 'compileCommands.linkToWorkspaceRoot');
    expect(lwsEvents.length).toBe(0);
  });

  /* ==================== 5. 既有 symlink 指向其他位置 → 被替换 ==================== */

  it('目标已存在且指向其他位置时,先 unlink 再 symlink', async () => {
    // lstat 返回 symlink 状态
    lstatMock.mockResolvedValue(makeStats(true, false));
    // readlink 返回别的路径(不等于 ccOutputPath)
    readlinkMock.mockResolvedValue('C:\\somewhere\\else.json');

    const result = await linkToWorkspaceRoot(ccOutputPath, projectPath);

    expect(result).toBe(targetPath);
    expect(readlinkMock).toHaveBeenCalledWith(targetPath);
    expect(unlinkMock).toHaveBeenCalledWith(targetPath);
    expect(symlinkMock).toHaveBeenCalledWith(ccOutputPath, targetPath, 'file');

    const lwsEvents = recordCalls.filter((c) => c.event === 'compileCommands.linkToWorkspaceRoot');
    expect(lwsEvents.length).toBe(1);
    expect(lwsEvents[0]!.meta?.['succeeded']).toBe(true);
  });

  /* ==================== 6. 既有 symlink 已指向 source → 跳过 ==================== */

  it('目标已是正确 symlink 时,不重新创建', async () => {
    lstatMock.mockResolvedValue(makeStats(true, false));
    // readlink 已返回 jsonPath,无需 unlink/symlink
    readlinkMock.mockResolvedValue(ccOutputPath);

    const result = await linkToWorkspaceRoot(ccOutputPath, projectPath);

    expect(result).toBe(targetPath);
    expect(unlinkMock).not.toHaveBeenCalled();
    expect(symlinkMock).not.toHaveBeenCalled();
    expect(copyFileMock).not.toHaveBeenCalled();
  });
});
