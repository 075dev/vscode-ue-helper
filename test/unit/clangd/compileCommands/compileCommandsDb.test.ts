/**
 * compileCommandsDb.test —— [D4 / D1 / D2 / D14] 编译数据库写入链
 *
 * ## 覆盖
 *
 *   - **D4 候选顺序**：引擎根与项目本地同时存在 DB 时，选中的是**项目本地**那份；
 *     命中共享位置时复制到项目本地副本并返回项目本地路径（写操作不再写回引擎根）。
 *   - **D1 命令串**：补出的条目其命令行末元素等于**新文件路径**（不再照抄模板）。
 *   - **D2 快路径**：fingerprint 不含 .cpp/.h → 新增源文件时快路径命中也会
 *     强制走一次 UBT（DB 条目数增加）。
 *   - **D14 原子写**：写入过程中失败时原文件字节不变；一次刷新只写一次盘。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { locateCompileCommands } from '@clangd/compileCommands';
import {
  computeMissingEntries,
  fillMissingCompileCommands,
} from '@clangd/compileCommands/fillMissing';
import {
  readCompileCommands,
  writeCompileCommandsAtomic,
  resolveCompileCommandsWriteTarget,
} from '@clangd/compileCommands/dbFile';
import { buildCompletionHelperEntry } from '@clangd/completionFiles';
import { Logger } from '@core/logger';

interface Fixture {
  tmpDir: string;
  projectDir: string;
  engineDir: string;
  localDbPath: string;
  helperDbPath: string;
  engineDbPath: string;
}

async function setupFixture(): Promise<Fixture> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-db-test-'));
  const projectDir = path.join(tmpDir, 'MyGame');
  const engineDir = path.join(tmpDir, 'UE_5.4');
  await fs.mkdir(path.join(projectDir, '.vscode', 'vscodeuehelper'), { recursive: true });
  await fs.mkdir(engineDir, { recursive: true });
  return {
    tmpDir,
    projectDir,
    engineDir,
    localDbPath: path.join(projectDir, 'compile_commands.json'),
    helperDbPath: path.join(projectDir, '.vscode', 'vscodeuehelper', 'compile_commands.json'),
    engineDbPath: path.join(engineDir, 'compile_commands.json'),
  };
}

function makeLogger(): Logger {
  return new Logger('ccDbTest');
}

describe('[D4] locateCompileCommands —— 候选顺序与项目本地副本', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await setupFixture();
  });
  afterEach(async () => {
    await fs.rm(f.tmpDir, { recursive: true, force: true });
  });

  it('引擎根与项目本地同时存在 → 选中的是项目本地那份', async () => {
    await fs.writeFile(f.engineDbPath, JSON.stringify([{ file: 'ENGINE', directory: 'E' }]));
    await fs.writeFile(f.localDbPath, JSON.stringify([{ file: 'LOCAL', directory: 'L' }]));

    const found = await locateCompileCommands(
      [f.localDbPath, f.helperDbPath, f.engineDbPath],
      f.localDbPath,
      makeLogger(),
    );

    expect(found).toBe(f.localDbPath);
    // 内容仍是项目本地那份（没有被引擎根覆盖）
    const entries = await readCompileCommands(f.localDbPath);
    expect(entries?.[0]?.file).toBe('LOCAL');
  });

  it('只有引擎根有 DB → 复制到项目本地副本并返回项目本地路径', async () => {
    await fs.writeFile(f.engineDbPath, JSON.stringify([{ file: 'ENGINE', directory: 'E' }]));

    const found = await locateCompileCommands(
      [f.localDbPath, f.helperDbPath, f.engineDbPath],
      f.localDbPath,
      makeLogger(),
    );

    expect(found).toBe(f.localDbPath);
    // 项目本地副本内容 = 引擎根那份
    const entries = await readCompileCommands(f.localDbPath);
    expect(entries?.[0]?.file).toBe('ENGINE');
  });

  it('全部候选未命中 → undefined', async () => {
    const found = await locateCompileCommands(
      [f.localDbPath, f.helperDbPath, f.engineDbPath],
      f.localDbPath,
      makeLogger(),
    );
    expect(found).toBeUndefined();
  });

  it('空文件（[]）不算有效 DB → 继续往后找', async () => {
    await fs.writeFile(f.localDbPath, '[]');
    await fs.writeFile(f.engineDbPath, JSON.stringify([{ file: 'ENGINE', directory: 'E' }]));

    const found = await locateCompileCommands(
      [f.localDbPath, f.helperDbPath, f.engineDbPath],
      f.localDbPath,
      makeLogger(),
    );
    expect(found).toBe(f.localDbPath);
    const entries = await readCompileCommands(f.localDbPath);
    expect(entries?.[0]?.file).toBe('ENGINE');
  });
});

describe('[D1] fillMissing 克隆条目必须改命令串', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await setupFixture();
  });
  afterEach(async () => {
    await fs.rm(f.tmpDir, { recursive: true, force: true });
  });

  it('arguments 数组：末元素被替换成新文件路径', async () => {
    const srcDir = path.join(f.projectDir, 'Source', 'Game');
    await fs.mkdir(srcDir, { recursive: true });
    const templateFile = path.join(srcDir, 'Game.cpp');
    const newFile = path.join(srcDir, 'NewActor.cpp');
    await fs.writeFile(templateFile, '// template', 'utf-8');
    await fs.writeFile(newFile, '// new', 'utf-8');

    const entries = [
      {
        directory: f.projectDir,
        file: templateFile,
        arguments: ['clang-cl.exe', '-DGAME', '-c', templateFile],
      },
    ];

    const { result, entries: next } = await computeMissingEntries(
      entries,
      path.join(f.projectDir, 'MyGame.uproject'),
      makeLogger(),
    );

    expect(result.added).toContain(newFile);
    const added = next.find((e) => e.file === newFile);
    expect(added).toBeDefined();
    // 关键：命令行末元素 = 新文件路径（不是模板文件）
    const args = added?.arguments ?? [];
    expect(args[args.length - 1]).toBe(newFile);
  });

  it('command 字符串：源文件路径被替换成新文件路径', async () => {
    const srcDir = path.join(f.projectDir, 'Source', 'Game');
    await fs.mkdir(srcDir, { recursive: true });
    const templateFile = path.join(srcDir, 'Game.cpp');
    const newFile = path.join(srcDir, 'NewActor.cpp');
    await fs.writeFile(templateFile, '// template', 'utf-8');
    await fs.writeFile(newFile, '// new', 'utf-8');

    const entries = [
      {
        directory: f.projectDir,
        file: templateFile,
        command: `clang-cl.exe /DGAME /c "${templateFile}"`,
      },
    ];

    const { result, entries: next } = await computeMissingEntries(
      entries,
      path.join(f.projectDir, 'MyGame.uproject'),
      makeLogger(),
    );

    expect(result.added).toContain(newFile);
    const added = next.find((e) => e.file === newFile);
    expect(added?.command).toContain(newFile);
    expect(added?.command).not.toContain(templateFile);
  });

  it('命令串里定位不到源文件 → 退回「只保留 flag」而不是指向模板文件', async () => {
    const srcDir = path.join(f.projectDir, 'Source', 'Game');
    await fs.mkdir(srcDir, { recursive: true });
    const templateFile = path.join(srcDir, 'Game.cpp');
    const newFile = path.join(srcDir, 'NewActor.cpp');
    await fs.writeFile(templateFile, '// template', 'utf-8');
    await fs.writeFile(newFile, '// new', 'utf-8');

    const entries = [
      {
        directory: f.projectDir,
        file: templateFile,
        // 命令串里**没有**模板文件路径
        command: 'clang-cl.exe /DGAME /c something-else.cpp',
      },
    ];

    const { result, entries: next } = await computeMissingEntries(
      entries,
      path.join(f.projectDir, 'MyGame.uproject'),
      makeLogger(),
    );

    expect(result.added).toContain(newFile);
    const added = next.find((e) => e.file === newFile);
    // 退化后不指向模板文件
    expect(added?.command).not.toContain(templateFile);
  });
});

describe('[D14] 原子写与合并一次写', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await setupFixture();
  });
  afterEach(async () => {
    await fs.rm(f.tmpDir, { recursive: true, force: true });
  });

  it('写入失败时原文件字节不变（temp + rename）', async () => {
    const original = '[{"file":"A","directory":"D"}]';
    await fs.writeFile(f.localDbPath, original, 'utf-8');

    // 制造失败：目标路径是一个**目录**，rename 会失败
    const dirTarget = path.join(f.tmpDir, 'as-dir');
    await fs.mkdir(dirTarget, { recursive: true });

    await expect(
      writeCompileCommandsAtomic(dirTarget, [{ file: 'B', directory: 'D' }]),
    ).rejects.toThrow();

    // 原文件字节不变
    expect(await fs.readFile(f.localDbPath, 'utf-8')).toBe(original);
  });

  it('序列化用紧凑格式（无缩进）', async () => {
    await writeCompileCommandsAtomic(f.localDbPath, [
      { file: 'A', directory: 'D' },
      { file: 'B', directory: 'D' },
    ]);
    const text = await fs.readFile(f.localDbPath, 'utf-8');
    expect(text).not.toContain('\n  ');
    expect(text.startsWith('[{')).toBe(true);
  });

  it('写完后没有残留临时文件', async () => {
    await writeCompileCommandsAtomic(f.localDbPath, [{ file: 'A', directory: 'D' }]);
    const files = await fs.readdir(f.projectDir);
    expect(files.filter((f2) => f2.includes('.tmp-'))).toEqual([]);
  });

  it('一次刷新只写一次盘：补齐 + helper 注入合并成一次', async () => {
    const srcDir = path.join(f.projectDir, 'Source', 'Game');
    await fs.mkdir(srcDir, { recursive: true });
    const templateFile = path.join(srcDir, 'Game.cpp');
    await fs.writeFile(templateFile, '// template', 'utf-8');

    const entries = [
      {
        directory: f.projectDir,
        file: templateFile,
        arguments: ['clang-cl.exe', '-DGAME', '-c', templateFile],
      },
    ];

    // 模拟命令管线：读 → 算补齐 → 加 helper → 写一次
    const read = await readCompileCommands(f.localDbPath).catch(() => undefined);
    expect(read).toBeUndefined();

    const filled = await computeMissingEntries(
      entries,
      path.join(f.projectDir, 'MyGame.uproject'),
      makeLogger(),
    );
    const withHelper = buildCompletionHelperEntry(
      filled.entries,
      'C:\\helper\\completionHelper.cpp',
    );
    await writeCompileCommandsAtomic(f.localDbPath, withHelper);

    const final = await readCompileCommands(f.localDbPath);
    expect(final).toHaveLength(2);
    expect(final?.some((e) => e.file === 'C:\\helper\\completionHelper.cpp')).toBe(true);

    // 没有残留临时文件（说明写是一次性 rename 完成的）
    const files = await fs.readdir(f.projectDir);
    expect(files.filter((f2) => f2.includes('.tmp-'))).toEqual([]);
  });
});

describe('[D2] fingerprint 快路径不吞自动刷新', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await setupFixture();
  });
  afterEach(async () => {
    await fs.rm(f.tmpDir, { recursive: true, force: true });
  });

  it('DB 缺少新增源文件时，fillMissing 能算出来（供上层强制走 UBT）', async () => {
    const srcDir = path.join(f.projectDir, 'Source', 'Game');
    await fs.mkdir(srcDir, { recursive: true });
    const templateFile = path.join(srcDir, 'Game.cpp');
    const newFile = path.join(srcDir, 'BrandNew.cpp');
    await fs.writeFile(templateFile, '// template', 'utf-8');
    await fs.writeFile(newFile, '// new', 'utf-8');

    const dbPath = path.join(f.projectDir, '.vscode', 'vscodeuehelper', 'compile_commands.json');
    await fs.writeFile(
      dbPath,
      JSON.stringify([
        {
          directory: f.projectDir,
          file: templateFile,
          arguments: ['clang-cl.exe', '-DGAME', '-c', templateFile],
        },
      ]),
      'utf-8',
    );

    const entries = await readCompileCommands(dbPath);
    const { result } = await computeMissingEntries(
      entries!,
      path.join(f.projectDir, 'MyGame.uproject'),
      makeLogger(),
    );

    // 新增的 .cpp 被算出来 → 上层据此判定 DB 过期 → 强制 UBT
    expect(result.added).toContain(newFile);
  });

  it('fillMissing 写回后条目数确实增加', async () => {
    const srcDir = path.join(f.projectDir, 'Source', 'Game');
    await fs.mkdir(srcDir, { recursive: true });
    const templateFile = path.join(srcDir, 'Game.cpp');
    const newFile = path.join(srcDir, 'BrandNew.cpp');
    await fs.writeFile(templateFile, '// template', 'utf-8');
    await fs.writeFile(newFile, '// new', 'utf-8');

    const dbPath = path.join(f.projectDir, '.vscode', 'vscodeuehelper', 'compile_commands.json');
    await fs.writeFile(
      dbPath,
      JSON.stringify([
        {
          directory: f.projectDir,
          file: templateFile,
          arguments: ['clang-cl.exe', '-DGAME', '-c', templateFile],
        },
      ]),
      'utf-8',
    );

    const before = (await readCompileCommands(dbPath))!.length;
    const result = await fillMissingCompileCommands(
      dbPath,
      path.join(f.projectDir, 'MyGame.uproject'),
      makeLogger(),
    );
    const after = (await readCompileCommands(dbPath))!.length;

    expect(result?.added).toContain(newFile);
    expect(after).toBe(before + 1);
  });
});

/**
 * [MAJOR-2] 写入目标必须解析到 **clangd 实际读取的那个文件**。
 *
 * helper 目录里的 compile_commands.json（`.clangd` 的
 * `CompilationDatabase: .vscode/vscodeuehelper` 指的就是它）有两种形态：
 *
 *   · 符号链接 —— `fs.symlink` 成功（Windows 开了开发者模式）
 *   · 独立副本 —— `fs.symlink` 失败后 `linkToWorkspaceRoot` 回退 `fs.copyFile`
 *                 （**Windows 默认状态**，本组用例模拟的就是它）
 *
 * 旧实现固定写「项目本地副本」，在副本场景下 clangd 读到的仍是旧内容 ——
 * D1 补齐的条目与注入的 completionHelper 条目对它完全不可见，且全程无报错。
 */
describe('[MAJOR-2] 写入目标解析', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await setupFixture();
  });
  afterEach(async () => {
    await fs.rm(f.tmpDir, { recursive: true, force: true });
  });

  it('普通文件（copy 退化）→ 解析到它自己', async () => {
    await fs.writeFile(f.helperDbPath, '[]', 'utf-8');
    expect(await resolveCompileCommandsWriteTarget(f.helperDbPath)).toBe(f.helperDbPath);
  });

  it('路径不存在 → 原样返回（交给写入方按普通文件创建）', async () => {
    const missing = path.join(f.tmpDir, 'not-exist.json');
    expect(await resolveCompileCommandsWriteTarget(missing)).toBe(missing);
  });

  it('符号链接 → 解析到它指向的文件', async () => {
    await fs.writeFile(f.localDbPath, '[]', 'utf-8');
    try {
      await fs.symlink(f.localDbPath, f.helperDbPath, 'file');
    } catch {
      // 本机无创建符号链接权限（Windows 未开开发者模式）→ 跳过该断言
      return;
    }
    expect(await resolveCompileCommandsWriteTarget(f.helperDbPath)).toBe(f.localDbPath);
  });

  it('悬空符号链接（目标已删除）→ 仍解析到它指向的路径,不回落到链接路径本身', async () => {
    // [第 4 轮评审 MINOR-3] 文档曾写「回落为链接路径本身」—— 与实现不符,
    // 且那样做会让 rename 把符号链接换成普通文件、链接语义丢失。
    // 实际行为:仍写它指向的路径 → 目标文件被重建 → 悬空链接自动恢复有效。
    await fs.writeFile(f.localDbPath, '[]', 'utf-8');
    try {
      await fs.symlink(f.localDbPath, f.helperDbPath, 'file');
    } catch {
      return; // 本机无符号链接权限 → 跳过
    }
    await fs.rm(f.localDbPath, { force: true });

    expect(await resolveCompileCommandsWriteTarget(f.helperDbPath)).toBe(f.localDbPath);
  });

  it('copy 退化场景：写回后 clangd 读到的那份确实更新了', async () => {
    const srcDir = path.join(f.projectDir, 'Source', 'Game');
    await fs.mkdir(srcDir, { recursive: true });
    const templateFile = path.join(srcDir, 'Game.cpp');
    const newFile = path.join(srcDir, 'BrandNew.cpp');
    await fs.writeFile(templateFile, '// template', 'utf-8');
    await fs.writeFile(newFile, '// new', 'utf-8');

    const entries = [
      {
        directory: f.projectDir,
        file: templateFile,
        arguments: ['clang-cl.exe', '-DGAME', '-c', templateFile],
      },
    ];
    // 项目本地副本与 helper 目录的独立副本（symlink 失败后的形态）
    await fs.writeFile(f.localDbPath, JSON.stringify(entries), 'utf-8');
    await fs.writeFile(f.helperDbPath, JSON.stringify(entries), 'utf-8');

    // 模拟 generateCompileCommands Step 4：读 linkPath → 算补齐 → 写真实目标
    const linkPath = f.helperDbPath;
    const dbEntries = await readCompileCommands(linkPath);
    const { entries: filled } = await computeMissingEntries(
      dbEntries!,
      path.join(f.projectDir, 'MyGame.uproject'),
      makeLogger(),
    );
    const writeTarget = await resolveCompileCommandsWriteTarget(linkPath);
    await writeCompileCommandsAtomic(writeTarget, filled);

    // clangd 读的是 helper 目录那份 —— 必须已经是补齐后的内容
    const helperEntries = await readCompileCommands(f.helperDbPath);
    expect(helperEntries).toHaveLength(2);
    expect(helperEntries!.map((e) => e.file)).toContain(newFile);
  });

  it('符号链接场景：写回不把符号链接换成普通文件（链接仍然有效）', async () => {
    const srcDir = path.join(f.projectDir, 'Source', 'Game');
    await fs.mkdir(srcDir, { recursive: true });
    const templateFile = path.join(srcDir, 'Game.cpp');
    const newFile = path.join(srcDir, 'BrandNew.cpp');
    await fs.writeFile(templateFile, '// template', 'utf-8');
    await fs.writeFile(newFile, '// new', 'utf-8');

    const entries = [
      {
        directory: f.projectDir,
        file: templateFile,
        arguments: ['clang-cl.exe', '-DGAME', '-c', templateFile],
      },
    ];
    await fs.writeFile(f.localDbPath, JSON.stringify(entries), 'utf-8');
    try {
      await fs.symlink(f.localDbPath, f.helperDbPath, 'file');
    } catch {
      return; // 本机无符号链接权限 → 跳过
    }

    const dbEntries = await readCompileCommands(f.helperDbPath);
    const { entries: filled } = await computeMissingEntries(
      dbEntries!,
      path.join(f.projectDir, 'MyGame.uproject'),
      makeLogger(),
    );
    const writeTarget = await resolveCompileCommandsWriteTarget(f.helperDbPath);
    await writeCompileCommandsAtomic(writeTarget, filled);

    // 符号链接必须仍然是符号链接（rename 覆盖链接路径会把它换成普通文件）
    const stat = await fs.lstat(f.helperDbPath);
    expect(stat.isSymbolicLink()).toBe(true);
    // 通过链接读到的内容也是最新的
    expect(await readCompileCommands(f.helperDbPath)).toHaveLength(2);
  });
});
