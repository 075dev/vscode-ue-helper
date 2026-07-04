/**
 * fingerprint.test.ts —— computeFingerprint / computeLightFingerprint 单元测试
 *
 * 覆盖 CLANGD-01-01.a（相同输入 → 同 fingerprint）
 *       .b（Build.cs 内容改 → fingerprint 变化）
 *       边界（mtime 变但内容不变 → 同 fingerprint）
 *       边界（空 Source 目录 → 稳定空 fingerprint）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { computeFingerprint, computeLightFingerprint } from '@clangd/fingerprint';

async function createFixture(
  populate: (dir: string) => Promise<void> = async () => {},
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'fp-test-'));
  // 必须有 .uproject，否则 computeFingerprint 返回空指纹
  await fs.writeFile(path.join(dir, 'MyProject.uproject'), '{}', 'utf-8');
  await populate(dir);
  return dir;
}

describe('computeFingerprint', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createFixture();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('相同文件集合产出相同 fingerprint（确定性 per D-09）', async () => {
    // fixture: .uproject + Source/Game/Game.Build.cs
    const sourceDir = path.join(tmpDir, 'Source', 'Game');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'Game.Build.cs'), 'public class GameTarget : TargetRules { }', 'utf-8');

    const fp1 = await computeFingerprint(tmpDir);
    const fp2 = await computeFingerprint(tmpDir);
    expect(fp1.fingerprint).toBe(fp2.fingerprint);
    expect(fp1.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Build.cs 内容变化触发 fingerprint 变化', async () => {
    const sourceDir = path.join(tmpDir, 'Source', 'Game');
    await fs.mkdir(sourceDir, { recursive: true });
    const buildCs = path.join(sourceDir, 'Game.Build.cs');
    await fs.writeFile(buildCs, 'public class GameTarget : TargetRules { }', 'utf-8');

    const fp1 = await computeFingerprint(tmpDir);

    // 修改 Build.cs
    await fs.writeFile(buildCs, 'public class GameTarget : TargetRules { /* comment change */ }', 'utf-8');

    const fp2 = await computeFingerprint(tmpDir);
    expect(fp2.fingerprint).not.toBe(fp1.fingerprint);
  });

  it('mtime 变化但内容不变 → fingerprint 保持稳定（SHA256 内容哈希）', async () => {
    const sourceDir = path.join(tmpDir, 'Source', 'Game');
    await fs.mkdir(sourceDir, { recursive: true });
    const buildCs = path.join(sourceDir, 'Game.Build.cs');
    await fs.writeFile(buildCs, 'public class GameTarget : TargetRules { }', 'utf-8');

    const fp1 = await computeFingerprint(tmpDir);

    // 修改 mtime（不改内容）
    const future = new Date(Date.now() + 10000);
    await fs.utimes(buildCs, future, future);

    const fp2 = await computeFingerprint(tmpDir);
    expect(fp2.fingerprint).toBe(fp1.fingerprint);
  });

  it('空 Source 目录返回稳定 fingerprint（per 空目录容错）', async () => {
    // 只有 .uproject，没有 Source/
    const fp = await computeFingerprint(tmpDir);
    expect(fp.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // .uproject 自身参与哈希（永远存在），files 不为空但应仅含 .uproject
    expect(fp.files.length).toBe(1);
    expect(fp.files[0]?.path).toContain('.uproject');
  });

  it('空 projectDir 返回稳定空 fingerprint（per T-7-02 安全防御）', async () => {
    const fp = await computeFingerprint('');
    expect(fp.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.files).toEqual([]);
  });

  it('包含 Target.cs 文件参与哈希', async () => {
    const sourceDir = path.join(tmpDir, 'Source', 'Game');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'Game.Target.cs'), 'using UnrealBuildTool;', 'utf-8');

    const fp = await computeFingerprint(tmpDir);
    expect(fp.files.length).toBeGreaterThan(0);
    expect(fp.files.some((f) => f.path.endsWith('Game.Target.cs'))).toBe(true);
  });
});

describe('computeLightFingerprint', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createFixture();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('基于 mtime 的轻量指纹不变性', async () => {
    const sourceDir = path.join(tmpDir, 'Source', 'Game');
    await fs.mkdir(sourceDir, { recursive: true });
    const buildCs = path.join(sourceDir, 'Game.Build.cs');
    await fs.writeFile(buildCs, 'public class GameTarget : TargetRules { }', 'utf-8');

    const fp1 = await computeLightFingerprint(tmpDir);

    // mtime 变更 → light fp 变化
    const future = new Date(Date.now() + 10000);
    await fs.utimes(buildCs, future, future);

    const fp2 = await computeLightFingerprint(tmpDir);
    expect(fp2).not.toBe(fp1);
  });

  it('同元数据 → 同 light fingerprint', async () => {
    const sourceDir = path.join(tmpDir, 'Source', 'Game');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'Game.Build.cs'), 'class A {}', 'utf-8');

    const fp1 = await computeLightFingerprint(tmpDir);
    const fp2 = await computeLightFingerprint(tmpDir);
    expect(fp1).toBe(fp2);
  });
});
