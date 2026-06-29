/**
 * completionFiles.test.ts —— createCompletionFiles 单元测试
 *
 * TDD: 红测阶段，先写断言再实现。
 * 覆盖 createCompletionFiles 创建 ueClangdCompat.h 的行为。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { createCompletionFiles } from '@clangd/completionFiles';
import {
  FILENAME_UE_CLANGD_COMPAT,
  getUeClangdCompatContent,
} from '@clangd/ueClangdCompat';

describe('createCompletionFiles (ueClangdCompat.h)', () => {
  let tmpDir: string;
  let projectPath: string;

  beforeEach(async () => {
    // 创建临时目录作为项目根
    tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'completion-files-test-'));
    projectPath = path.join(tmpDir, 'MyProject.uproject');
    // 创建 .uproject 文件（空文件即可，仅用于路径解析）
    await fs.writeFile(projectPath, '', 'utf-8');
  });

  afterEach(async () => {
    // 清理临时目录
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('返回数组中包含 ueClangdCompat.h 条目', async () => {
    const results = await createCompletionFiles(projectPath);

    const entry = results.find((r) => r.name === FILENAME_UE_CLANGD_COMPAT);
    expect(entry).toBeDefined();
    expect(entry!.name).toBe(FILENAME_UE_CLANGD_COMPAT);
    expect(entry!.created).toBe(true);
  });

  it('ueClangdCompat.h 路径以 .vscode/vscodeuehelper/ueClangdCompat.h 结尾', async () => {
    const results = await createCompletionFiles(projectPath);

    const entry = results.find((r) => r.name === FILENAME_UE_CLANGD_COMPAT);
    expect(entry).toBeDefined();
    const expectedSuffix = path.join('.vscode', 'vscodeuehelper', FILENAME_UE_CLANGD_COMPAT);
    expect(entry!.path.endsWith(expectedSuffix)).toBe(true);
  });

  it('ueClangdCompat.h 文件实际存在', async () => {
    const results = await createCompletionFiles(projectPath);

    const entry = results.find((r) => r.name === FILENAME_UE_CLANGD_COMPAT);
    expect(entry).toBeDefined();

    const fileExists = await fs.access(entry!.path).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('ueClangdCompat.h 文件内容匹配 getUeClangdCompatContent()', async () => {
    const results = await createCompletionFiles(projectPath);

    const entry = results.find((r) => r.name === FILENAME_UE_CLANGD_COMPAT);
    expect(entry).toBeDefined();

    const content = await fs.readFile(entry!.path, 'utf-8');
    expect(content).toBe(getUeClangdCompatContent());
  });
});
