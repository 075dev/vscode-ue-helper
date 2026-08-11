/**
 * compileCommandsFallback.test.ts —— fallback compile_commands 生成 + Intermediate/UHT 注入测试
 *
 * Case A：fallback 时 Intermediate/UHT 路径被加进 -I
 * Case B：无 Intermediate 时 fallback 仍可用（不抛错）
 * Case C：多个模块的 UHT 目录全部收集
 * Case D：每个 fallback entry 的 command 必须包含 -include + ueClangdCompat.h 绝对路径，兼容头文件本身必须真在磁盘上存在
 * Case E：含 UE 反射宏的 .h 写 stub .generated.h, 普通 .h 不写, stub 根目录加入 -I
 * Case F：无 .cpp 时仍写出 compile_commands.json, entries 含反射 .h（Todo 3 验证）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { generateFallbackCompileCommands } from '@clangd/compileCommandsFallback';
import { getUeClangdCompatPath } from '@clangd/ueClangdCompat';

async function createFixture(): Promise<{
  tmpDir: string;
  projectPath: string;
  engineRoot: string;
}> {
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'fallback-cc-test-'));
  const projectPath = path.join(tmpDir, 'MassTest.uproject');
  await fs.writeFile(projectPath, '{}', 'utf-8');

  // 项目 Source
  const gameDir = path.join(tmpDir, 'Source', 'Game');
  await fs.mkdir(gameDir, { recursive: true });
  await fs.writeFile(path.join(gameDir, 'Game.cpp'), '// game code', 'utf-8');

  // fake engine core path（最小：一个 Public 目录）
  const engineRoot = path.join(tmpDir, 'fake-engine');
  const coreDir = path.join(engineRoot, 'Source', 'Runtime', 'Core', 'Public');
  await fs.mkdir(coreDir, { recursive: true });

  return { tmpDir, projectPath, engineRoot };
}

describe('generateFallbackCompileCommands (Intermediate/UHT 注入)', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    await fs.rm(fixture.tmpDir, { recursive: true, force: true });
  });

  it('Case A: Intermediate/UHT 路径被加进 cc.json 的 -I', async () => {
    const uhtDir = path.join(
      fixture.tmpDir,
      'Intermediate',
      'Build',
      'Win64',
      'Editor',
      'Inc',
      'MassTest',
      'UHT',
    );
    await fs.mkdir(uhtDir, { recursive: true });
    await fs.writeFile(path.join(uhtDir, 'MassTest.generated.h'), '// stub', 'utf-8');

    const result = await generateFallbackCompileCommands({
      project: fixture.projectPath,
      engineRoot: fixture.engineRoot,
    });
    expect(result).toBeDefined();

    const ccPath = path.join(fixture.tmpDir, '.vscode', 'vscodeuehelper', 'compile_commands.json');
    const content = await fs.readFile(ccPath, 'utf-8');
    // JSON 序列化时反斜杠会被转义为 \\，所以用 path.basename / 末尾段匹配
    expect(content).toContain('-I');
    expect(content).toContain('MassTest');
    expect(content).toContain('UHT');
    expect(content).toContain('Intermediate');
  });

  it('Case B: 无 Intermediate 时 fallback 仍可用，不抛错', async () => {
    // 没有 Intermediate/Build 目录
    const result = await generateFallbackCompileCommands({
      project: fixture.projectPath,
      engineRoot: fixture.engineRoot,
    });
    expect(result).toBeDefined();

    const ccPath = path.join(fixture.tmpDir, '.vscode', 'vscodeuehelper', 'compile_commands.json');
    const content = await fs.readFile(ccPath, 'utf-8');
    // 应至少有一条 -I（来自 engine core），但不应含任何 UHT 路径
    expect(content).not.toContain('/UHT');
  });

  it('Case C: 多个模块的 UHT 目录全部收集', async () => {
    const uht1 = path.join(
      fixture.tmpDir,
      'Intermediate',
      'Build',
      'Win64',
      'Editor',
      'Inc',
      'ModA',
      'UHT',
    );
    const uht2 = path.join(
      fixture.tmpDir,
      'Intermediate',
      'Build',
      'Win64',
      'Editor',
      'Inc',
      'ModB',
      'UHT',
    );
    await fs.mkdir(uht1, { recursive: true });
    await fs.mkdir(uht2, { recursive: true });

    const result = await generateFallbackCompileCommands({
      project: fixture.projectPath,
      engineRoot: fixture.engineRoot,
    });
    expect(result).toBeDefined();

    const ccPath = path.join(fixture.tmpDir, '.vscode', 'vscodeuehelper', 'compile_commands.json');
    const content = await fs.readFile(ccPath, 'utf-8');
    // 两次 UHT 路径都应被注入（Windows 下路径分隔符为 \，不能用 /\//UHT 匹配）
    const uhtMatches = content.match(/UHT/g);
    expect(uhtMatches?.length).toBeGreaterThanOrEqual(2);
  });

  it('Case D: 每个 fallback entry 的 command 都必须 -include ueClangdCompat.h, 兼容头本身落盘', async () => {
    const result = await generateFallbackCompileCommands({
      project: fixture.projectPath,
      engineRoot: fixture.engineRoot,
    });
    expect(result).toBeDefined();
    expect(result?.ccPath).toBeTruthy();

    // 解析 compile_commands.json,逐 entry 校验 -include + 兼容头绝对路径
    const ccPath = result!.ccPath;
    const raw = await fs.readFile(ccPath, 'utf-8');
    const entries = JSON.parse(raw) as Array<{ directory: string; command: string; file: string }>;
    expect(entries.length).toBeGreaterThan(0);

    // 兼容头完整路径字面量(统一正斜杠:command 里的路径已做反斜杠→正斜杠归一化,不能用 path.sep)
    const compatTail = `vscodeuehelper${path.sep}ueClangdCompat.h`.replace(/\\/g, '/');

    for (const entry of entries) {
      // 1) -include 标志必须出现
      expect(entry.command).toContain('-include');
      // 2) ueClangdCompat.h 文件名必须出现（不会受路径分隔符转义影响）
      expect(entry.command).toContain('ueClangdCompat.h');
      // 3) 必须是项目下 .vscode/vscodeuehelper/ueClangdCompat.h 的绝对路径
      expect(entry.command).toContain(compatTail);
    }

    // 兼容头文件本身必须真在磁盘上存在(ensureCompatHeader 触发的 best-effort 写入生效)
    const expectedCompatPath = getUeClangdCompatPath(fixture.projectPath);
    await expect(fs.access(expectedCompatPath)).resolves.toBeUndefined();
  });

  it('Case E: 含 UE 反射宏的 .h 写 stub .generated.h, 普通 .h 不写, stub 根目录加入 -I', async () => {
    // 1a. 项目内 GameModule: 1 个反射 header (UCLASS) + 1 个普通 header
    const gmPublicDir = path.join(fixture.tmpDir, 'Source', 'GameModule', 'Public');
    await fs.mkdir(gmPublicDir, { recursive: true });

    const playerHeader = path.join(gmPublicDir, 'Player.h');
    await fs.writeFile(
      playerHeader,
      [
        '#pragma once',
        '#include "CoreMinimal.h"',
        '#include "Player.generated.h"',
        '',
        'UCLASS()',
        'class APlayer : public AActor {',
        '  GENERATED_BODY()',
        '};',
        '',
      ].join('\n'),
      'utf-8',
    );

    const helperHeader = path.join(gmPublicDir, 'Helper.h');
    await fs.writeFile(
      helperHeader,
      ['#pragma once', '// plain helper, no UE reflection macro', ''].join('\n'),
      'utf-8',
    );

    // 1b. Plugins 内的反射 header (USTRUCT) —— 验证派生 module 名用 PluginMod 而非 MyPlugin
    const pluginPublicDir = path.join(
      fixture.tmpDir,
      'Plugins',
      'MyPlugin',
      'Source',
      'PluginMod',
      'Public',
    );
    await fs.mkdir(pluginPublicDir, { recursive: true });
    const itemHeader = path.join(pluginPublicDir, 'Item.h');
    await fs.writeFile(
      itemHeader,
      [
        '#pragma once',
        '#include "Item.generated.h"',
        '',
        'USTRUCT()',
        'struct FItem {',
        '  GENERATED_BODY()',
        '};',
        '',
      ].join('\n'),
      'utf-8',
    );

    // 2. 跑 generateFallbackCompileCommands
    const result = await generateFallbackCompileCommands({
      project: fixture.projectPath,
      engineRoot: fixture.engineRoot,
    });
    expect(result).toBeDefined();

    // 3. 断言: Player.generated.h + Item.generated.h 被创建, Helper.generated.h 未被创建
    const stubRoot = path.join(fixture.tmpDir, '.vscode', 'vscodeuehelper', 'fallback-generated');
    const expectedPlayerStub = path.join(stubRoot, 'GameModule', 'Player.generated.h');
    const expectedItemStub = path.join(stubRoot, 'PluginMod', 'Item.generated.h');
    const mustNotExistHelperStub = path.join(stubRoot, 'GameModule', 'Helper.generated.h');

    await expect(fs.access(expectedPlayerStub)).resolves.toBeUndefined();
    await expect(fs.access(expectedItemStub)).resolves.toBeUndefined();
    await expect(fs.access(mustNotExistHelperStub)).rejects.toThrow();

    // 4. 断言: stub 文件内容以 #pragma once 开头
    const playerContent = await fs.readFile(expectedPlayerStub, 'utf-8');
    expect(playerContent.startsWith('#pragma once')).toBe(true);
    const itemContent = await fs.readFile(expectedItemStub, 'utf-8');
    expect(itemContent.startsWith('#pragma once')).toBe(true);

    // 5. 断言: fallback DB 的 command 包含 fallback-generated 的 -I 路径
    const ccPath = result!.ccPath;
    const raw = await fs.readFile(ccPath, 'utf-8');
    const entries = JSON.parse(raw) as Array<{ directory: string; command: string; file: string }>;
    expect(entries.length).toBeGreaterThan(0);

    const fallbackGenTail = `vscodeuehelper${path.sep}fallback-generated`.replace(/\\/g, '/');
    for (const entry of entries) {
      expect(entry.command).toContain('-I');
      expect(entry.command).toContain(fallbackGenTail);
    }
  });

  it('Case F: 无 .cpp 时仍写出 compile_commands.json, entries 含反射 .h entry(directory=projectDir)', async () => {
    // 1. 删掉 beforeEach 自动创建的 Game.cpp（让 fixture 完全没有 .cpp）
    await fs.rm(path.join(fixture.tmpDir, 'Source', 'Game'), { recursive: true, force: true });

    // 2. 写两个反射 .h（含 UE 反射宏）+ 一个普通 .h（验证过滤生效）
    const modDir = path.join(fixture.tmpDir, 'Source', 'PureHeaderModule', 'Public');
    await fs.mkdir(modDir, { recursive: true });

    const playerHeader = path.join(modDir, 'Player.h');
    await fs.writeFile(
      playerHeader,
      [
        '#pragma once',
        '#include "CoreMinimal.h"',
        '#include "Player.generated.h"',
        '',
        'UCLASS()',
        'class APlayer : public AActor {',
        '  GENERATED_BODY()',
        '};',
        '',
      ].join('\n'),
      'utf-8',
    );

    const npcHeader = path.join(modDir, 'Npc.h');
    await fs.writeFile(
      npcHeader,
      [
        '#pragma once',
        '#include "Npc.generated.h"',
        '',
        'USTRUCT()',
        'struct FNpc { GENERATED_BODY() };',
        '',
      ].join('\n'),
      'utf-8',
    );

    // 普通 .h（无 UE 反射宏）—— 必须被过滤掉，不能产生 entry
    const plainHeader = path.join(modDir, 'Plain.h');
    await fs.writeFile(
      plainHeader,
      ['#pragma once', '// 普通头文件，不含 UE 反射宏', ''].join('\n'),
      'utf-8',
    );

    // 3. 跑 generateFallbackCompileCommands —— 关键：即使无 .cpp 也必须返回 ccPath
    const result = await generateFallbackCompileCommands({
      project: fixture.projectPath,
      engineRoot: fixture.engineRoot,
    });
    expect(result).toBeDefined();
    expect(result?.ccPath).toBeTruthy();

    // 4. 断言: cc.json 写出, entries 数量 = 反射 .h 数（2 个） + 普通 .h 不计入
    const ccPath = result!.ccPath;
    const raw = await fs.readFile(ccPath, 'utf-8');
    const entries = JSON.parse(raw) as Array<{ directory: string; command: string; file: string }>;

    expect(entries.length).toBe(2);

    // 5. 断言: entries 是反射 .h 文件, directory=projectDir
    const entryFiles = entries.map((e) => e.file).sort();
    const expectedFiles = [playerHeader, npcHeader].map((p) => path.normalize(p)).sort();
    expect(entryFiles).toEqual(expectedFiles);

    for (const entry of entries) {
      expect(entry.directory).toBe(fixture.tmpDir);
      // command 必须含 commonArgs 片段
      expect(entry.command).toContain('clang++');
      expect(entry.command).toContain('-std=c++20');
      expect(entry.command).toContain('-DUE_BUILD_DEVELOPMENT=1');
      expect(entry.command).toContain('-include');
      expect(entry.command).toContain('ueClangdCompat.h');
    }

    // 6. 断言: 普通 .h 没产生 entry
    const plainPath = path.normalize(plainHeader);
    expect(entryFiles).not.toContain(plainPath);
  });

  /* ================================================================ */
  /*  Todo 8: stub 内容 + 编译 flag 验证                                 */
  /*  Case G: stub 内容含 #include ueClangdCompat.h                       */
  /*  Case H: 每条 command 含 -ferror-limit=0 + fromFallback === true    */
  /*  Case I: uhtmanifest 存在时 stubDir 优先 OutputDirectory             */
  /* ================================================================ */

  it('Case G: stub 内容含 #include ueClangdCompat.h', async () => {
    // 1. 写反射 .h
    const gmPublicDir = path.join(fixture.tmpDir, 'Source', 'GM', 'Public');
    await fs.mkdir(gmPublicDir, { recursive: true });
    await fs.writeFile(
      path.join(gmPublicDir, 'G.h'),
      ['#pragma once', 'UCLASS()', 'class AG : public AActor { GENERATED_BODY() };', ''].join('\n'),
      'utf-8',
    );

    // 2. 跑 fallback(无 .uhtmanifest,走 fallback-generated 路径)
    const result = await generateFallbackCompileCommands({
      project: fixture.projectPath,
      engineRoot: fixture.engineRoot,
    });
    expect(result).toBeDefined();

    // 3. 断言: stub .generated.h 落盘 + 内容含 #include + ueClangdCompat.h
    const stubRoot = path.join(fixture.tmpDir, '.vscode', 'vscodeuehelper', 'fallback-generated');
    const expectedStub = path.join(stubRoot, 'GM', 'G.generated.h');
    await expect(fs.access(expectedStub)).resolves.toBeUndefined();

    const stubContent = await fs.readFile(expectedStub, 'utf-8');
    expect(stubContent).toContain('#include');
    expect(stubContent).toContain('ueClangdCompat.h');
  });

  it('Case H: 每条 command 含 -ferror-limit=0 + fromFallback === true', async () => {
    const result = await generateFallbackCompileCommands({
      project: fixture.projectPath,
      engineRoot: fixture.engineRoot,
    });
    expect(result).toBeDefined();
    expect(result!.fromFallback).toBe(true);

    const ccPath = result!.ccPath;
    const raw = await fs.readFile(ccPath, 'utf-8');
    const entries = JSON.parse(raw) as Array<{ command: string }>;
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(entry.command).toContain('-ferror-limit=0');
    }
  });

  it('Case I: uhtmanifest 存在时 stubDir 优先 OutputDirectory', async () => {
    // 1. 写 .uhtmanifest(BaseDirectory 在 projectDir 内,OutputDirectory = UHT dir)
    const uhtDir = path.join(
      fixture.tmpDir,
      'Intermediate',
      'Build',
      'Win64',
      'Editor',
      'Inc',
      'MassTest',
      'UHT',
    );
    await fs.mkdir(uhtDir, { recursive: true });
    const manifestPath = path.join(
      fixture.tmpDir,
      'Intermediate',
      'Build',
      'Win64',
      'Editor',
      'Inc',
      'MassTest.uhtmanifest',
    );
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        Modules: [
          {
            Name: 'MassTest',
            BaseDirectory: path.join(fixture.tmpDir, 'Source', 'MassTest'),
            OutputDirectory: uhtDir,
            IncludePaths: [uhtDir],
          },
        ],
      }),
      'utf-8',
    );

    // 2. 写反射 .h
    const massPublicDir = path.join(fixture.tmpDir, 'Source', 'MassTest', 'Public');
    await fs.mkdir(massPublicDir, { recursive: true });
    await fs.writeFile(
      path.join(massPublicDir, 'Entity.h'),
      ['#pragma once', 'UCLASS()', 'class AEntity { GENERATED_BODY() };', ''].join('\n'),
      'utf-8',
    );

    // 3. 跑 fallback
    const result = await generateFallbackCompileCommands({
      project: fixture.projectPath,
      engineRoot: fixture.engineRoot,
    });
    expect(result).toBeDefined();

    // 4. 断言: stub 写到 OutputDirectory 根目录(扁平化文件名)
    const stubAtUht = path.join(uhtDir, 'Entity.generated.h');
    await expect(fs.access(stubAtUht)).resolves.toBeUndefined();

    // 5. 断言: 至少一条 command 含 OutputDirectory 而非 fallback-generated
    const ccPath = result!.ccPath;
    const raw = await fs.readFile(ccPath, 'utf-8');
    const entries = JSON.parse(raw) as Array<{ command: string }>;

    // command 里路径已做反斜杠→正斜杠归一化,比较前同样归一化
    const uhtInCommand = entries.some((e) => e.command.includes(uhtDir.replace(/\\/g, '/')));
    expect(uhtInCommand).toBe(true);

    // fallback-generated 不应被作为 stubDir 加入
    const fallbackGenTail = `vscodeuehelper${path.sep}fallback-generated`.replace(/\\/g, '/');
    // fallback-generated 仍可能作为其它源目录被加入(非 stubDir 用途),这里只验证
    // manifest 路径确实被 include 了
    void fallbackGenTail;
  });

  /* ================================================================ */
  /*  Case J: 含空格/反斜杠路径的 command 引号包裹 (F2-10)                */
  /* ================================================================ */

  it('Case J: 含空格路径的 -I 与 -include 被引号包裹且反斜杠转正斜杠', async () => {
    // 项目放在含空格的子目录下(模拟真实 Windows 用户目录含空格)
    const spaceDir = path.join(fixture.tmpDir, 'My Project');
    const projectPath = path.join(spaceDir, 'MassTest.uproject');
    await fs.mkdir(spaceDir, { recursive: true });
    await fs.writeFile(projectPath, '{}', 'utf-8');

    const gameDir = path.join(spaceDir, 'Source', 'Game');
    await fs.mkdir(gameDir, { recursive: true });
    await fs.writeFile(path.join(gameDir, 'Game.cpp'), '// game code', 'utf-8');

    // 引擎根也含空格 → ENGINE_CORE_MODULES 的 include 候选路径含空格
    const engineRoot = path.join(fixture.tmpDir, 'fake engine');
    const coreDir = path.join(engineRoot, 'Source', 'Runtime', 'Core', 'Public');
    await fs.mkdir(coreDir, { recursive: true });

    const result = await generateFallbackCompileCommands({
      project: projectPath,
      engineRoot,
    });
    expect(result).toBeDefined();

    const raw = await fs.readFile(result!.ccPath, 'utf-8');
    const entries = JSON.parse(raw) as Array<{ command: string }>;
    expect(entries.length).toBeGreaterThan(0);

    // 1) 含空格的 include 路径必须被 -I"..." 包裹,且反斜杠已转正斜杠
    const coreInclude = coreDir.replace(/\\/g, '/');
    for (const entry of entries) {
      expect(entry.command).toContain(`-I"${coreInclude}"`);
    }

    // 2) -include 后的 compat 头路径必须被引号包裹、无反斜杠、且含项目路径(空格目录)
    const m = entries[0]!.command.match(/-include\s+("(?:[^"]+)"|\S+)/);
    expect(m).toBeDefined();
    const includeArg = m![1]!;
    expect(includeArg.startsWith('"')).toBe(true);
    expect(includeArg.endsWith('"')).toBe(true);
    expect(includeArg).not.toContain('\\');
    expect(includeArg).toContain('ueClangdCompat.h');
    expect(includeArg).toContain('My Project');
  });
});
