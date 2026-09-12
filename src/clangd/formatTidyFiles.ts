/**
 * formatTidyFiles —— createProject 的可选脚手架:.clang-format / .clang-tidy
 *
 * 模式借鉴 boocs/unreal-clangd 的 creation.tidy / .clang-format 基础文件生成:
 *   - .clang-format:Epic 官方风格基础(UCppType 风格要点:4 空格缩进、
 *     指针左对齐、120 列宽、模板声明折行)
 *   - .clang-tidy:启用 bugprone / performance / readability 三族常用检查,
 *     并**默认禁用 readability-static-accessed-through-instance** ——
 *     boocs 项目记录的已知问题:该检查会让 clang-tidy 在 Lyra 类项目上崩溃
 *
 * 只创建缺失项:目标文件已存在时跳过,绝不覆盖用户自己的格式化配置。
 */

import * as path from 'node:path';
import { access, writeFile, mkdir } from 'node:fs/promises';

/** 单个脚手架文件的结果 */
export interface FileScaffoldResult {
  /** 目标文件绝对路径 */
  path: string;
  /** 是否新建(false = 已存在跳过) */
  created: boolean;
  /** 跳过原因(未启用 / 已存在) */
  skippedReason?: string;
}

export interface ScaffoldFormatTidyResult {
  clangFormat: FileScaffoldResult;
  clangTidy: FileScaffoldResult;
}

export interface ScaffoldFormatTidyOptions {
  /** 是否生成 .clang-format(对应 config.scaffoldClangFormat,默认 true) */
  clangFormat: boolean;
  /** 是否生成 .clang-tidy(对应 config.scaffoldClangTidy,默认 false) */
  clangTidy: boolean;
  /** 注入 fs 便于测试;默认 node:fs/promises */
  fsImpl?: Pick<typeof import('node:fs/promises'), 'access' | 'writeFile' | 'mkdir'>;
}

/**
 * .clang-format 基础模板 —— UE C++ 官方风格要点
 *
 * 说明:UE 自带 Epic 的定制 clang-format 配置随引擎分发
 * (Engine/Build/Tools/等),这里给不依赖引擎路径的"够用"基础版;
 * 已有引擎配置的用户文件不会被覆盖。
 */
export const CLANG_FORMAT_TEMPLATE = `# Unreal Engine C++ 基础格式化配置(vscode-ue-helper 生成,可自由修改)
---
BasedOnStyle: LLVM
Language: Cpp
IndentWidth: 4
UseTab: Never
ColumnLimit: 120
AccessModifierOffset: -4
PointerAlignment: Left
AllowShortFunctionsOnASingleLine: None
AllowShortIfStatementsOnASingleLine: Never
AlwaysBreakTemplateDeclarations: Yes
BreakBeforeBraces: Custom
BraceWrapping:
  AfterClass: true
  AfterFunction: true
  AfterNamespace: false
  AfterStruct: true
  BeforeCatch: false
  BeforeElse: false
SortIncludes: CaseSensitive
IncludeBlocks: Preserve
`;

/**
 * .clang-tidy 基础模板
 *
 * 特意禁用 readability-static-accessed-through-instance:
 * boocs/unreal-clangd 记录该检查在 Lyra 等大型 UE 项目上会让 clang-tidy 崩溃。
 * cppcoreguidelines-* 与 modrenize(readability-implicit-bool-conversion 等)
 * 在 UE 代码库噪音过大,不默认开启。
 */
export const CLANG_TIDY_TEMPLATE = `# Unreal Engine C++ 基础 clang-tidy 配置(vscode-ue-helper 生成,可自由修改)
---
Checks: >
  -*,
  bugprone-*,
  performance-*,
  readability-*,
  -readability-static-accessed-through-instance,
  -readability-magic-numbers,
  -readability-identifier-length,
  -bugprone-easily-swappable-parameters
WarningsAsErrors: ''
HeaderFilterRegex: 'Source/[^/]+/.*'
FormatStyle: file
`;

/**
 * 在 projectDir 下生成 .clang-format / .clang-tidy(只创建缺失项)。
 *
 * @param projectDir 项目根目录(.uproject 所在目录)
 */
export async function scaffoldClangFormatAndTidy(
  projectDir: string,
  options: ScaffoldFormatTidyOptions,
): Promise<ScaffoldFormatTidyResult> {
  const fs = options.fsImpl ?? { access, writeFile, mkdir };
  const clangFormat = await writeIfMissing(
    fs,
    projectDir,
    '.clang-format',
    CLANG_FORMAT_TEMPLATE,
    options.clangFormat,
  );
  const clangTidy = await writeIfMissing(
    fs,
    projectDir,
    '.clang-tidy',
    CLANG_TIDY_TEMPLATE,
    options.clangTidy,
  );
  return { clangFormat, clangTidy };
}

async function writeIfMissing(
  fs: NonNullable<ScaffoldFormatTidyOptions['fsImpl']>,
  dir: string,
  fileName: string,
  content: string,
  enabled: boolean,
): Promise<FileScaffoldResult> {
  const target = path.join(dir, fileName);
  if (!enabled) {
    return { path: target, created: false, skippedReason: 'disabled by setting' };
  }
  try {
    await fs.access(target);
    return { path: target, created: false, skippedReason: 'already exists' };
  } catch {
    // not exists → 继续创建
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  return { path: target, created: true };
}
