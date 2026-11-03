/**
 * writeTargetE2e.test.ts —— 编译数据库写盘目标的**真实链路**端到端回归
 *
 * ## 为什么需要这个文件
 *
 * 评审第 4 / 5 轮都指出：单元测试层面，copy 回退场景的回归网只靠
 * `createProject.test.ts` 里的一条 mock 实参断言（传的是不是 linkPath）；
 * 「从建立链接 → 补齐 → 注入 helper → clangd 读到的那份是否最新」这条
 * **真实链路**没有一条端到端用例。
 *
 * 本文件补上这条链路，并且**用真实文件系统**跑：
 *   1. `linkToWorkspaceRoot` —— 真实执行，但把 `fs.symlink` 强制成 EPERM，
 *      逼它走 `fs.copyFile` 回退分支（**Windows 未开开发者模式时的默认形态**）
 *   2. `addCompletionHelperToCompileCommands` —— 真实执行
 *   3. 断言：**clangd 实际读的那份**（helper 目录里的 `compile_commands.json`）
 *      拿到了 helper 条目，而**项目本地副本**没有 —— 两者不再分叉。
 *
 * ## 这条用例能抓住什么
 *
 * 若把 `addCompletionHelperToCompileCommands` 改回「直接写传入路径」
 * 或「读传入路径、写解析目标」：
 *   · 直接写传入路径 → 符号链接被 `rename` 换成普通文件 → 用例红
 *   · 读 A 写 B → 读到的内容与写入的内容来自不同文件 → 用例红
 *
 * [MAJOR-2 残留] 详见 `.qiling/planning/bugfix/004-audit-19-defects.md`
 * 与 `src/clangd/AGENTS.md` 的「全部 DB 写入点」对照表。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import type * as FsPromises from 'node:fs/promises';

// ---- 强制 symlink 失败:逼 linkToWorkspaceRoot 走 copy 回退分支 ----

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof FsPromises>('node:fs/promises');
  return {
    ...actual,
    default: actual,
    // 不用 async:没有 await 会触发 @typescript-eslint/require-await
    symlink: vi.fn(() =>
      Promise.reject(
        Object.assign(new Error('EPERM: operation not permitted, symlink'), { code: 'EPERM' }),
      ),
    ),
  };
});

import { linkToWorkspaceRoot } from '@clangd/compileCommands/symlink';
import { addCompletionHelperToCompileCommands } from '@clangd/completionFiles';
import { getCompletionHelperPath } from '@clangd/completionFiles';
import type { Logger } from '@core/logger';

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('编译数据库写盘目标 —— 真实链路端到端(copy 回退形态)', () => {
  let tmpDir: string;
  let projectPath: string;
  /** UBT 产出的项目本地副本 */
  let localDbPath: string;
  /** helper 目录里的那份 —— clangd 的 CompilationDatabase 实际位置 */
  let helperDbPath: string;
  let sourceFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'cc-write-target-e2e-'));
    projectPath = path.join(tmpDir, 'MyGame.uproject');
    await fs.writeFile(projectPath, '{}', 'utf-8');

    localDbPath = path.join(tmpDir, 'compile_commands.json');
    helperDbPath = path.join(tmpDir, '.vscode', 'vscodeuehelper', 'compile_commands.json');

    sourceFile = path.join(tmpDir, 'Source', 'MyGame', 'Private', 'MyActor.cpp');
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    await fs.writeFile(sourceFile, '// source', 'utf-8');

    await fs.writeFile(
      localDbPath,
      JSON.stringify([
        { directory: tmpDir, file: sourceFile, command: `clang-cl.exe /c ${sourceFile}` },
      ]),
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('copy 回退后:helper 条目落在 clangd 读的那份,项目本地副本不受污染', async () => {
    // When: 真实建立链接(symlink 被强制失败 → copy 回退)
    const linkPath = await linkToWorkspaceRoot(localDbPath, projectPath, makeLogger());

    // 确认确实是「独立副本」形态而不是符号链接
    expect(linkPath).toBe(helperDbPath);
    const stat = await fs.lstat(helperDbPath);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isFile()).toBe(true);

    // When: 注入 completionHelper 条目(真实实现)
    const added = await addCompletionHelperToCompileCommands(projectPath, linkPath);
    expect(added).toBe(true);

    // Then: clangd 实际读的那份拿到了 helper 条目
    const helperEntries = JSON.parse(await fs.readFile(helperDbPath, 'utf-8')) as {
      file: string;
    }[];
    expect(helperEntries.map((e) => e.file)).toContain(getCompletionHelperPath(projectPath));

    // And: 项目本地副本**没有**被写入 helper 条目 —— 两份各写各的,不互相污染
    const localEntries = JSON.parse(await fs.readFile(localDbPath, 'utf-8')) as { file: string }[];
    expect(localEntries.map((e) => e.file)).not.toContain(getCompletionHelperPath(projectPath));
    expect(localEntries).toHaveLength(1);
  });

  it('copy 回退后:helper 条目落进 clangd 读的那份,重复注入不产生第二条', async () => {
    const linkPath = await linkToWorkspaceRoot(localDbPath, projectPath, makeLogger());

    expect(await addCompletionHelperToCompileCommands(projectPath, linkPath)).toBe(true);
    expect(await addCompletionHelperToCompileCommands(projectPath, linkPath)).toBe(true);

    const helperEntries = JSON.parse(await fs.readFile(helperDbPath, 'utf-8')) as {
      file: string;
    }[];
    const helperCount = helperEntries.filter((e) =>
      e.file.endsWith('completionHelper.cpp'),
    ).length;
    expect(helperCount).toBe(1);
  });
});
