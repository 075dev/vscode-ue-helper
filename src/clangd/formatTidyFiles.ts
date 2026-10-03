/**
 * formatTidyFiles —— createProject 的可选脚手架:.clang-format / .clang-tidy
 *
 * 模式借鉴 boocs/unreal-clangd 的 creation.tidy / .clang-format 基础文件生成:
 *   - .clang-format:UE5 C++ 编码标准(Tab 缩进 4 宽、Allman 大括号、UE 反射宏
 *     识别;取值对齐 TensorWorks/UE-Clang-Format,见 add-001)
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
 * .clang-format 模板 —— UE5 C++ 编码标准风格(add-001)
 *
 * 基于 Epic UE 编码标准:Tab 缩进(4 宽)、Allman 大括号、UE 反射宏识别;
 * 具体取值对齐社区验证配置 TensorWorks/UE-Clang-Format(MIT)。
 * UE 自带 Epic 定制 clang-format 配置随引擎分发(非官方完整版),
 * 这里给不依赖引擎路径的"开箱即用"版;已有用户文件不会被覆盖。
 */
export const CLANG_FORMAT_TEMPLATE = `# Unreal Engine C++ 格式化配置(vscode-ue-helper 生成,可自由修改)
# 基于 Epic UE 编码标准:Tab 缩进(4 宽)、Allman 大括号、UE 反射宏识别。
# 需要 clang-format/clangd >= 13(StatementMacros/BeforeLambdaBody 等选项),更旧版本会静默回退内置风格。
---
Language: Cpp
BasedOnStyle: LLVM

# UE 反射宏按语句宏处理,避免 GENERATED_BODY()/UPROPERTY 等宏后的代码被错误缩进折行
StatementMacros: ['UPROPERTY', 'UFUNCTION', 'UCLASS', 'USTRUCT', 'UENUM', 'UINTERFACE', 'GENERATED_BODY']

# 缩进:UE 编码标准使用 Tab(4 字符宽);case 标签、预处理指令、命名空间内容跟随缩进
UseTab: Always
TabWidth: 4
IndentWidth: 4
AccessModifierOffset: -4
IndentCaseLabels: true
IndentPPDirectives: BeforeHash
NamespaceIndentation: All

# 大括号:Allman 风格(类/函数/控制语句大括号均换行,大括号本身不缩进)
BreakBeforeBraces: Custom
BraceWrapping:
  AfterCaseLabel: true
  AfterClass: true
  AfterControlStatement: true
  AfterEnum: true
  AfterFunction: true
  AfterNamespace: true
  AfterStruct: true
  AfterUnion: true
  AfterExternBlock: true
  BeforeCatch: true
  BeforeElse: true
  BeforeLambdaBody: false
  BeforeWhile: true
  IndentBraces: false

# 行宽 0 = 不强制折行:UE_LOG/Slate 长表达式被硬折可读性差;120 列软标准自行把握
ColumnLimit: 0

# 短语句:UE 枚举成员独立成行;函数体不并入单行;空块与单行 lambda 保持紧凑
AllowShortBlocksOnASingleLine: Empty
AllowShortEnumsOnASingleLine: false
AllowShortFunctionsOnASingleLine: Inline
AllowShortIfStatementsOnASingleLine: false
AllowShortLambdasOnASingleLine: All

# 指针/引用靠左(int* Ptr)——UE 编码标准
PointerAlignment: Left

# 换行细节:构造函数初始化列表逗号前置、二元运算符换行在赋值号前,贴近引擎源码风格
AlignAfterOpenBracket: DontAlign
AlignOperands: DontAlign
AlignTrailingComments: true
AlignEscapedNewlines: Left
BreakBeforeBinaryOperators: NonAssignment
BreakBeforeTernaryOperators: true
BreakConstructorInitializers: BeforeComma
BreakInheritanceList: AfterColon
BreakStringLiterals: false
ConstructorInitializerAllOnOneLineOrOnePerLine: true
Cpp11BracedListStyle: false
EmptyLineBeforeAccessModifier: LogicalBlock
SpaceBeforeCaseColon: false

# include 不自动排序:UE 工程的 include 顺序有自身规范,自动排序可能破坏编译语义
SortIncludes: false
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
