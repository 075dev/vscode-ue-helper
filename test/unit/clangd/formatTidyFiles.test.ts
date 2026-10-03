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

describe('.clang-format 模板内容符合 UE5 C++ 风格(add-001 契约)', () => {
  // 契约:模板须对齐 Epic UE 编码标准与社区验证配置(TensorWorks/UE-Clang-Format, MIT)
  it('识别 UE 反射宏(StatementMacros),避免 GENERATED_BODY/UPROPERTY 后代码错乱', () => {
    for (const macro of ['UPROPERTY', 'UFUNCTION', 'UCLASS', 'USTRUCT', 'UENUM', 'GENERATED_BODY']) {
      expect(CLANG_FORMAT_TEMPLATE).toContain(macro);
    }
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/StatementMacros:\s*\[/);
  });

  it('Allman 大括号:控制语句/while/case 的大括号换行(UE 官方代码风格)', () => {
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/AfterControlStatement:\s*true/);
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/BeforeWhile:\s*true/);
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/AfterCaseLabel:\s*true/);
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/BreakBeforeBraces:\s*Custom/);
  });

  it('UE 枚举不折行、case 标签缩进、预处理指令缩进、命名空间内容缩进', () => {
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/AllowShortEnumsOnASingleLine:\s*false/);
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/IndentCaseLabels:\s*true/);
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/IndentPPDirectives:\s*BeforeHash/);
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/NamespaceIndentation:\s*All/);
  });

  it('UE 编码标准缩进:Tab(4 字符宽)', () => {
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/UseTab:\s*Always/);
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/TabWidth:\s*4/);
  });

  it('不强制折行(ColumnLimit: 0)且不自动排序 include(UE include 顺序有自身规范)', () => {
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/ColumnLimit:\s*0/);
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/SortIncludes:\s*false/);
  });

  it('指针靠左 + 构造函数初始化列表逗号前置(引擎源码风格)', () => {
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/PointerAlignment:\s*Left/);
    expect(CLANG_FORMAT_TEMPLATE).toMatch(/BreakConstructorInitializers:\s*BeforeComma/);
  });
});
