/**
 * compileCommandsFallback.test.ts —— fallback compile_commands 生成 + Intermediate/UHT 注入测试
 *
 * Case A：fallback 时 Intermediate/UHT 路径被加进 -I
 * Case B：无 Intermediate 时 fallback 仍可用（不抛错）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { generateFallbackCompileCommands } from '@clangd/compileCommandsFallback';

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
    const uhtDir = path.join(fixture.tmpDir, 'Intermediate', 'Build', 'Win64', 'Editor', 'Inc', 'MassTest', 'UHT');
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
    const uht1 = path.join(fixture.tmpDir, 'Intermediate', 'Build', 'Win64', 'Editor', 'Inc', 'ModA', 'UHT');
    const uht2 = path.join(fixture.tmpDir, 'Intermediate', 'Build', 'Win64', 'Editor', 'Inc', 'ModB', 'UHT');
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
});