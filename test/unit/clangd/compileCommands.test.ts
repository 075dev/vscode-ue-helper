/**
 * compileCommands.test.ts —— fillMissingCompileCommands 单元测试
 *
 * TDD: 红测阶段，先写断言再实现。
 * 覆盖插件源码补齐、Windows 大小写规范化、模板选择、结构化结果。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fillMissingCompileCommands } from '@clangd/compileCommands';

/**
 * 创建临时 UE 项目夹具：
 *
 * MassTest.uproject
 * Source/
 *   Game/
 *     Game.cpp
 * Plugins/
 *   MyPlugin/
 *     Source/
 *       MyPlugin/
 *         Private/
 *           MyPlugin.cpp
 *         Public/
 *           MyPluginComponent.h
 * compile_commands.json (含 Game.cpp, MyPlugin.cpp 但不含 MyPluginComponent.h)
 */
async function createFixture(): Promise<{
  tmpDir: string;
  projectPath: string;
  jsonPath: string;
}> {
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'compile-commands-test-'));
  const projectPath = path.join(tmpDir, 'MassTest.uproject');
  await fs.writeFile(projectPath, '{}', 'utf-8');

  // 项目 Source
  const gameCppDir = path.join(tmpDir, 'Source', 'Game');
  await fs.mkdir(gameCppDir, { recursive: true });
  await fs.writeFile(path.join(gameCppDir, 'Game.cpp'), '// game code', 'utf-8');

  // 插件 Source
  const pluginPrivateDir = path.join(tmpDir, 'Plugins', 'MyPlugin', 'Source', 'MyPlugin', 'Private');
  const pluginPublicDir = path.join(tmpDir, 'Plugins', 'MyPlugin', 'Source', 'MyPlugin', 'Public');
  await fs.mkdir(pluginPrivateDir, { recursive: true });
  await fs.mkdir(pluginPublicDir, { recursive: true });
  await fs.writeFile(path.join(pluginPrivateDir, 'MyPlugin.cpp'), '// plugin code', 'utf-8');
  await fs.writeFile(path.join(pluginPublicDir, 'MyPluginComponent.h'), '#pragma once', 'utf-8');

  // compile_commands.json — 只含 .cpp 条目，不含插件 header
  const ccDir = path.join(tmpDir, '.vscode', 'vscodeuehelper');
  await fs.mkdir(ccDir, { recursive: true });
  const jsonPath = path.join(ccDir, 'compile_commands.json');

  const entries = [
    {
      directory: tmpDir,
      file: path.join(tmpDir, 'Source', 'Game', 'Game.cpp'),
      arguments: ['clang-cl.exe', '-DGAME_TEMPLATE', '-c', path.join(tmpDir, 'Source', 'Game', 'Game.cpp')],
    },
    {
      directory: tmpDir,
      file: path.join(tmpDir, 'Plugins', 'MyPlugin', 'Source', 'MyPlugin', 'Private', 'MyPlugin.cpp'),
      arguments: ['clang-cl.exe', '-DPLUGIN_TEMPLATE', '-c', path.join(tmpDir, 'Plugins', 'MyPlugin', 'Source', 'MyPlugin', 'Private', 'MyPlugin.cpp')],
    },
  ];

  await fs.writeFile(jsonPath, JSON.stringify(entries, null, 2), 'utf-8');

  return { tmpDir, projectPath, jsonPath };
}

describe('fillMissingCompileCommands (插件源码补齐)', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    await fs.rm(fixture.tmpDir, { recursive: true, force: true });
  });

  /* ================================================================ */
  /*  红测：当前实现不会为插件 header 补条目                              */
  /* ================================================================ */

  it('RED: 当前实现不会为插件 header 补条目（测试应失败直到实现）', async () => {
    const result = await fillMissingCompileCommands(fixture.jsonPath, fixture.projectPath);

    // 当前 fillMissingCompileCommands 返回 void，所以 result 是 undefined
    // 实现后应返回 FillResult，且 added 包含插件 header
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');

    // 断言 added 中包含 MyPluginComponent.h
    const r = result as { added: string[] };
    const hasPluginHeader = r.added.some(
      (f) => f.endsWith('MyPluginComponent.h'),
    );
    expect(hasPluginHeader).toBe(true);
  });

  /* ================================================================ */
  /*  绿测：插件 header 被添加                                           */
  /* ================================================================ */

  it('插件 header 被添加到 compile_commands.json', async () => {
    await fillMissingCompileCommands(fixture.jsonPath, fixture.projectPath);

    // 读取写回的文件
    const content = await fs.readFile(fixture.jsonPath, 'utf-8');
    const entries = JSON.parse(content) as { file: string }[];

    const hasPluginHeader = entries.some(
      (e) => e.file.endsWith('MyPluginComponent.h'),
    );
    expect(hasPluginHeader).toBe(true);
  });

  /* ================================================================ */
  /*  绿测：roots 包含 project Source 和 plugin Source                  */
  /* ================================================================ */

  it('roots 包含 project Source 和 plugin Source', async () => {
    const result = await fillMissingCompileCommands(fixture.jsonPath, fixture.projectPath);

    const r = result as { roots: string[] };
    const normalizedRoots = r.roots.map((p) => path.resolve(p));

    const projectSource = path.resolve(path.join(fixture.tmpDir, 'Source'));
    const pluginSource = path.resolve(path.join(fixture.tmpDir, 'Plugins', 'MyPlugin', 'Source'));

    expect(normalizedRoots).toContain(projectSource);
    expect(normalizedRoots).toContain(pluginSource);
  });

  /* ================================================================ */
  /*  绿测：Windows 大小写路径不重复添加                                  */
  /* ================================================================ */

  it('Windows 大小写路径不重复添加且可找到模板', async () => {
    const jsonPath = fixture.jsonPath;

    // 用大写盘符重写 compile_commands.json 的 file 路径
    const gameCpp = path.join(fixture.tmpDir, 'Source', 'Game', 'Game.cpp');
    const pluginCpp = path.join(fixture.tmpDir, 'Plugins', 'MyPlugin', 'Source', 'MyPlugin', 'Private', 'MyPlugin.cpp');

    // 构造大写盘符版本
    const driveUpper = fixture.tmpDir[0]!.toUpperCase() + fixture.tmpDir.slice(1);
    const gameCppUpper = path.join(driveUpper, 'Source', 'Game', 'Game.cpp');
    const pluginCppUpper = path.join(driveUpper, 'Plugins', 'MyPlugin', 'Source', 'MyPlugin', 'Private', 'MyPlugin.cpp');

    const entries = [
      {
        directory: fixture.tmpDir,
        file: gameCppUpper,
        arguments: ['clang-cl.exe', '-DGAME_TEMPLATE', '-c', gameCpp],
      },
      {
        directory: fixture.tmpDir,
        file: pluginCppUpper,
        arguments: ['clang-cl.exe', '-DPLUGIN_TEMPLATE', '-c', pluginCpp],
      },
    ];
    await fs.writeFile(jsonPath, JSON.stringify(entries, null, 2), 'utf-8');

    await fillMissingCompileCommands(jsonPath, fixture.projectPath);

    // 读取写回的文件
    const content = await fs.readFile(jsonPath, 'utf-8');
    const finalEntries = JSON.parse(content) as { file: string }[];

    // Game.cpp 不应重复（大小写不敏感匹配）
    const gameCppMatches = finalEntries.filter(
      (e) => e.file.replace(/\\/g, '/').toLowerCase().includes('game.cpp'),
    );
    expect(gameCppMatches).toHaveLength(1);

    // 插件 header 应被添加
    const pluginHeaderMatches = finalEntries.filter(
      (e) => e.file.replace(/\\/g, '/').toLowerCase().includes('myplugincomponent.h'),
    );
    expect(pluginHeaderMatches).toHaveLength(1);
  });

  /* ================================================================ */
  /*  绿测：插件 header 使用插件模板                                     */
  /* ================================================================ */

  it('插件 header 使用插件模板（-DPLUGIN_TEMPLATE）而非游戏模板', async () => {
    await fillMissingCompileCommands(fixture.jsonPath, fixture.projectPath);

    const content = await fs.readFile(fixture.jsonPath, 'utf-8');
    const entries = JSON.parse(content) as { file: string; arguments?: string[] }[];

    const pluginHeaderEntry = entries.find(
      (e) => e.file.endsWith('MyPluginComponent.h'),
    );
    expect(pluginHeaderEntry).toBeDefined();

    const args = pluginHeaderEntry!.arguments ?? [];
    const argsJoined = args.join(' ');
    expect(argsJoined).toContain('-DPLUGIN_TEMPLATE');
    expect(argsJoined).not.toContain('-DGAME_TEMPLATE');
  });

  /* ================================================================ */
  /*  绿测：无模板时返回 skippedReason                                    */
  /* ================================================================ */

  it('无模板时返回 skippedReason', async () => {
    // 清空 compile_commands.json 使其不含任何 .cpp 条目
    await fs.writeFile(fixture.jsonPath, JSON.stringify([
      {
        directory: fixture.tmpDir,
        file: path.join(fixture.tmpDir, 'Source', 'Game', 'Game.h'),
        arguments: ['clang-cl.exe', '-DGAME_TEMPLATE', '-c', path.join(fixture.tmpDir, 'Source', 'Game', 'Game.h')],
      },
    ], null, 2), 'utf-8');

    const result = await fillMissingCompileCommands(fixture.jsonPath, fixture.projectPath);

    const r = result as { skippedReason?: string };
    expect(r.skippedReason).toBeDefined();
    expect(r.skippedReason!.length).toBeGreaterThan(0);
  });

  /* ================================================================ */
  /*  绿测：无效/空 JSON 跳过不报错                                      */
  /* ================================================================ */

  it('无效 JSON 跳过不报错', async () => {
    await fs.writeFile(fixture.jsonPath, 'not json', 'utf-8');
    const result = await fillMissingCompileCommands(fixture.jsonPath, fixture.projectPath);
    // 应返回 undefined（void）或 skippedReason
    expect(result).toBeUndefined();
  });

  it('空 JSON 数组跳过不报错', async () => {
    await fs.writeFile(fixture.jsonPath, '[]', 'utf-8');
    const result = await fillMissingCompileCommands(fixture.jsonPath, fixture.projectPath);
    expect(result).toBeUndefined();
  });

  /* ================================================================ */
  /*  绿测：不存在的目录不报错                                            */
  /* ================================================================ */

  it('不存在的 Source 目录不报错', async () => {
    // 删除 Source 目录（Plugins 目录仍在，所以 scanned 来自插件源）
    await fs.rm(path.join(fixture.tmpDir, 'Source'), { recursive: true, force: true });
    const result = await fillMissingCompileCommands(fixture.jsonPath, fixture.projectPath);
    // 不应抛出，应正常返回
    expect(result).toBeDefined();
    const r = result as { scanned: number; added: string[] };
    // 插件源中有 2 个文件（MyPlugin.cpp + MyPluginComponent.h），MyPlugin.cpp 已在 JSON 中
    expect(r.scanned).toBe(2);
    expect(r.added).toHaveLength(1);
  });
});
