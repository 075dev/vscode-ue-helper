/**
 * formatTidyFiles 测试 —— .clang-format / .clang-tidy 脚手架(真实 fs + 临时目录)
 *
 * 覆盖:
 *   - 启用 + 文件缺失 → 创建
 *   - 文件已存在 → 跳过且不覆盖内容
 *   - 配置关闭 → 标记 disabled
 *   - 模板内容包含关键检查项(含 Lyra 崩溃检查的显式禁用)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  scaffoldClangFormatAndTidy,
  CLANG_FORMAT_TEMPLATE,
  CLANG_TIDY_TEMPLATE,
} from '@clangd/formatTidyFiles';

let tmpDir = '';

async function makeTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'uehelper-scaffold-'));
}

describe('scaffoldClangFormatAndTidy', () => {
  beforeEach(async () => {
    tmpDir = await makeTmp();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  });

  it('两项都启用 → 创建两个文件,内容为模板', async () => {
    const result = await scaffoldClangFormatAndTidy(tmpDir, {
      clangFormat: true,
      clangTidy: true,
    });

    expect(result.clangFormat.created).toBe(true);
    expect(result.clangTidy.created).toBe(true);
    expect(await fs.readFile(path.join(tmpDir, '.clang-format'), 'utf8')).toBe(
      CLANG_FORMAT_TEMPLATE,
    );
    expect(await fs.readFile(path.join(tmpDir, '.clang-tidy'), 'utf8')).toBe(CLANG_TIDY_TEMPLATE);
  });

  it('已存在时不覆盖用户文件', async () => {
    await fs.writeFile(path.join(tmpDir, '.clang-format'), '# my custom config', 'utf8');

    const result = await scaffoldClangFormatAndTidy(tmpDir, {
      clangFormat: true,
      clangTidy: false,
    });

    expect(result.clangFormat.created).toBe(false);
    expect(result.clangFormat.skippedReason).toBe('already exists');
    expect(await fs.readFile(path.join(tmpDir, '.clang-format'), 'utf8')).toBe(
      '# my custom config',
    );
  });

  it('配置关闭 → skippedReason 为 disabled', async () => {
    const result = await scaffoldClangFormatAndTidy(tmpDir, {
      clangFormat: false,
      clangTidy: false,
    });

    expect(result.clangFormat.created).toBe(false);
    expect(result.clangFormat.skippedReason).toBe('disabled by setting');
    expect(result.clangTidy.created).toBe(false);
    // 不产生任何文件
    const entries = await fs.readdir(tmpDir);
    expect(entries).toHaveLength(0);
  });

  it('目标目录不存在时自动创建', async () => {
    const nested = path.join(tmpDir, 'proj', 'sub');

    const result = await scaffoldClangFormatAndTidy(nested, {
      clangFormat: true,
      clangTidy: true,
    });

    expect(result.clangFormat.created).toBe(true);
    expect(await fs.access(path.join(nested, '.clang-format'))).toBeUndefined();
  });

  it('模板显式禁用 Lyra 崩溃检查 readability-static-accessed-through-instance', () => {
    expect(CLANG_TIDY_TEMPLATE).toContain('-readability-static-accessed-through-instance');
    // UE 基础格式化要点
    expect(CLANG_FORMAT_TEMPLATE).toContain('IndentWidth: 4');
  });
});
