/**
 * intermediateUhtCollector.test.ts —— Intermediate/UHT 目录收集器单元测试
 *
 * 覆盖：典型三层结构、无 Intermediate、缺一层目录、多模块、UHT 目录不存在。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { collectIntermediateUhtDirs } from '@clangd/intermediateUhtCollector';

describe('collectIntermediateUhtDirs (Intermediate/UHT 收集)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'intermediate-uht-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('典型三层结构下找到所有 UHT 目录', async () => {
    const uht1 = path.join(
      tmpDir,
      'Intermediate',
      'Build',
      'Win64',
      'Editor',
      'Inc',
      'MassTest',
      'UHT',
    );
    const uht2 = path.join(
      tmpDir,
      'Intermediate',
      'Build',
      'Win64',
      'Editor',
      'Inc',
      'MassBattle',
      'UHT',
    );
    await fs.mkdir(uht1, { recursive: true });
    await fs.mkdir(uht2, { recursive: true });

    const dirs = await collectIntermediateUhtDirs({ projectDir: tmpDir });
    expect(dirs.sort()).toEqual([uht1, uht2].sort());
  });

  it('无 Intermediate/Build 时返回空数组（项目未构建）', async () => {
    const dirs = await collectIntermediateUhtDirs({ projectDir: tmpDir });
    expect(dirs).toEqual([]);
  });

  it('Intermediate/Build 存在但无 Inc 目录时返回空数组', async () => {
    await fs.mkdir(path.join(tmpDir, 'Intermediate', 'Build', 'Win64'), { recursive: true });
    const dirs = await collectIntermediateUhtDirs({ projectDir: tmpDir });
    expect(dirs).toEqual([]);
  });

  it('Inc 下模块没有 UHT 子目录时跳过', async () => {
    const modNoUht = path.join(
      tmpDir,
      'Intermediate',
      'Build',
      'Win64',
      'Editor',
      'Inc',
      'NoUhtMod',
    );
    await fs.mkdir(modNoUht, { recursive: true });
    // 不创建 UHT 子目录

    const dirs = await collectIntermediateUhtDirs({ projectDir: tmpDir });
    expect(dirs).toEqual([]);
  });

  it('混合：一个模块有 UHT、另一个没有 → 只返回有的', async () => {
    const uht = path.join(tmpDir, 'Intermediate', 'Build', 'Win64', 'Editor', 'Inc', 'ModA', 'UHT');
    const noUht = path.join(tmpDir, 'Intermediate', 'Build', 'Win64', 'Editor', 'Inc', 'ModB');
    await fs.mkdir(uht, { recursive: true });
    await fs.mkdir(noUht, { recursive: true });

    const dirs = await collectIntermediateUhtDirs({ projectDir: tmpDir });
    expect(dirs).toEqual([uht]);
  });

  it('多 PlatformCfg 同时存在 → 全部返回', async () => {
    const win64 = path.join(
      tmpDir,
      'Intermediate',
      'Build',
      'Win64',
      'Editor',
      'Inc',
      'ModA',
      'UHT',
    );
    const mac = path.join(tmpDir, 'Intermediate', 'Build', 'Mac', 'Editor', 'Inc', 'ModA', 'UHT');
    await fs.mkdir(win64, { recursive: true });
    await fs.mkdir(mac, { recursive: true });

    const dirs = await collectIntermediateUhtDirs({ projectDir: tmpDir });
    expect(dirs.sort()).toEqual([win64, mac].sort());
  });
});
