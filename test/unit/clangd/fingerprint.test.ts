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
    await fs.writeFile(
      path.join(sourceDir, 'Game.Build.cs'),
      'public class GameTarget : TargetRules { }',
      'utf-8',
    );

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
    await fs.writeFile(
      buildCs,
      'public class GameTarget : TargetRules { /* comment change */ }',
      'utf-8',
    );

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

  it('[W11/F2-5] Plugins/**/*.uplugin 递归收集且内容变更触发 fingerprint 变化', async () => {
    // 插件放在嵌套目录，验证 Plugins/**/*.uplugin 递归（不只是 Plugins/*/）
    const pluginUprojectPath = path.join(tmpDir, 'Plugins', 'Shared', 'MyPlugin', 'MyPlugin.uplugin');
    await fs.mkdir(path.dirname(pluginUprojectPath), { recursive: true });
    await fs.writeFile(pluginUprojectPath, '{"Version": 1}', 'utf-8');

    const fp1 = await computeFingerprint(tmpDir);
    // .uplugin 参与哈希
    expect(fp1.files.some((f) => f.path.endsWith('MyPlugin.uplugin'))).toBe(true);

    // 修改 .uplugin 内容 → fingerprint 变化（否则缓存命中陈旧 DB）
    await fs.writeFile(pluginUprojectPath, '{"Version": 2}', 'utf-8');
    const fp2 = await computeFingerprint(tmpDir);
    expect(fp2.fingerprint).not.toBe(fp1.fingerprint);
  });

  it('[W11/F2-5] 引擎 Build.version 内容变更触发 fingerprint 变化（engineRoot 参数）', async () => {
    // 模拟引擎根目录（fixture 外，含 Engine/Build/Build.version）
    const engineRoot = await fs.mkdtemp(path.join(tmpdir(), 'fp-engine-'));
    const buildVersion = path.join(engineRoot, 'Engine', 'Build', 'Build.version');
    await fs.mkdir(path.dirname(buildVersion), { recursive: true });
    await fs.writeFile(buildVersion, '{"MajorVersion":5,"MinorVersion":4}', 'utf-8');

    try {
      const fp1 = await computeFingerprint(tmpDir, engineRoot);
      // Build.version 参与哈希
      expect(fp1.files.some((f) => f.path.endsWith('Build.version'))).toBe(true);

      // 修改 Build.version（如引擎补丁更新）→ fingerprint 变化
      await fs.writeFile(buildVersion, '{"MajorVersion":5,"MinorVersion":5}', 'utf-8');
      const fp2 = await computeFingerprint(tmpDir, engineRoot);
      expect(fp2.fingerprint).not.toBe(fp1.fingerprint);

      // 不传 engineRoot → Build.version 不参与（向后兼容旧行为）
      const fpNoEngine = await computeFingerprint(tmpDir);
      expect(fpNoEngine.files.some((f) => f.path.endsWith('Build.version'))).toBe(false);
    } finally {
      await fs.rm(engineRoot, { recursive: true, force: true });
    }
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

  it('[W11/F2-5] .uplugin 新增/变更触发 light fingerprint 变化', async () => {
    const pluginDir = path.join(tmpDir, 'Plugins', 'MyPlugin');
    await fs.mkdir(pluginDir, { recursive: true });
    const uplugin = path.join(pluginDir, 'MyPlugin.uplugin');

    // 新增 .uplugin → light 指纹变化（文件集合扩展）
    await fs.writeFile(uplugin, '{"Version": 1}', 'utf-8');
    const fp1 = await computeLightFingerprint(tmpDir);

    await fs.writeFile(uplugin, '{"Version": 2}', 'utf-8');
    const fp2 = await computeLightFingerprint(tmpDir);
    expect(fp2).not.toBe(fp1);
  });

  it('[W11/F2-5] 引擎 Build.version 变更触发 light fingerprint 变化（engineRoot 参数）', async () => {
    const engineRoot = await fs.mkdtemp(path.join(tmpdir(), 'fp-engine-light-'));
    const buildVersion = path.join(engineRoot, 'Engine', 'Build', 'Build.version');
    await fs.mkdir(path.dirname(buildVersion), { recursive: true });
    await fs.writeFile(buildVersion, '{"MajorVersion":5}', 'utf-8');

    try {
      const fp1 = await computeLightFingerprint(tmpDir, engineRoot);
      await fs.writeFile(buildVersion, '{"MajorVersion":6}', 'utf-8');
      const fp2 = await computeLightFingerprint(tmpDir, engineRoot);
      expect(fp2).not.toBe(fp1);
    } finally {
      await fs.rm(engineRoot, { recursive: true, force: true });
    }
  });
});
