/**
 * clangdConfig —— 在项目根写 .clangd 文件
 *
 * 设计原则（对齐 unreal-clangd v3 模板）：
 * 1. 使用 yaml 库（而非手写字符串）生成/修改 .clangd
 * 2. 构建 JS 对象 → yaml.stringify() 序列化 → 写入文件
 * 3. 重复写入时覆盖整个文件（不做增量 upsert）
 * 4. 模板风格配置：系统头文件 + C++ 标准 + MSVC 兼容性 flag + If.PathMatch 规则
 *
 * 典型生成的 .clangd:
 *
 * CompileFlags:
 *   CompilationDatabase: .vscode/vscodeuehelper
 *   Compiler: D:/scoop/apps/llvm/22.1.8/bin/clang-cl.exe
 *   Add:
 *     - /X
 *     - /imsvc"..."
 *     - /std:c++20
 *     - /FI.../macroCompletionHelper.h
 *     - /TP
 *     - -mwaitpkg
 *     - ...
 * Diagnostics:
 *   UnusedIncludes: None
 * InlayHints:
 *   Enabled: Yes
 *   ParameterNames: Yes
 *   DeducedTypes: Yes
 *   Designators: Yes
 * If:
 *   - PathMatch:
 *       - .vscode/vscodeuehelper/completionHelper.cpp
 *       - Source/.*\.(cpp|h)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { ClangdConfig, IfBlock } from './types';

// ===== 默认 .clangd 内容 =====

/** 选项 */
export interface ClangdConfigOptions {
  completionMode?: 'fast' | 'slow';
  macroHelperPath?: string;
  /** ueClangdCompat.h 的绝对路径，通过 /FI 强制包含在所有其他头文件之前 */
  compatHeaderPath?: string;
  preparseHeaders?: string[];
  /** 系统头文件 flag（/X + /imsvc + -fms-compatibility-version），由 setSystemIncludes 命令注入 */
  systemIncludeFlags?: string[];
  /** 编译器路径（模板风格，如 D:/scoop/apps/llvm/22.1.8/bin/clang-cl.exe） */
  compilerPath?: string;
  /** 项目路径（用于生成 If.PathMatch 规则） */
  projectPath?: string;
}

/** 默认配置（对齐 unreal-clangd v3 模板风格） */
export function defaultClangdConfig(opts: ClangdConfigOptions = {}): ClangdConfig {
  const addFlags: string[] = [];

  // 0. /FI 强制包含 ueClangdCompat.h（必须位于所有 Add flag 之前，确保 clangd 优先解析兼容宏）
  if (opts.compatHeaderPath) {
    addFlags.push(`/FI${opts.compatHeaderPath}`);
  }

  // 1. 系统头文件（/X + /imsvc，由 setSystemIncludes 注入）
  if (opts.systemIncludeFlags?.length) {
    addFlags.push(...opts.systemIncludeFlags);
  }

  // 2. C++ 标准（Windows 用 /std:c++20，其他用 -std=c++20）
  addFlags.push(process.platform === 'win32' ? '/std:c++20' : '-std=c++20');

  // 3. /FI 强制包含 macroCompletionHelper.h（模板用 /FI 而非 -include）
  if (opts.completionMode === 'slow' && opts.macroHelperPath) {
    addFlags.push(`/FI${opts.macroHelperPath}`);
  }

  // 4. MSVC 兼容性 flag（对齐模板的 WIN_COMPILER_FLAGS_TO_ADD）
  addFlags.push(
    '/TP',
    '-mwaitpkg',
    '/we4668',
    '/wd4244',
    '/wd4838',
    '/W4',
    '/wd5054',
    '-Werror',
    '-Wdelete-non-virtual-dtor',
    '-Wenum-conversion',
    '-Wbitfield-enum-conversion',
    '-Wno-enum-enum-conversion',
    '-Wno-enum-float-conversion',
    '-Wno-ambiguous-reversed-operator',
    '-Wno-deprecated-anon-enum-enum-conversion',
    '-Wno-deprecated-volatile',
    '-Wno-unused-but-set-variable',
    '-Wno-unused-but-set-parameter',
    '-Wno-ordered-compare-function-pointers',
    '-Wno-bitwise-instead-of-logical',
    '-Wno-gnu-string-literal-operator-template',
    '-Wno-inconsistent-missing-override',
    '-Wno-invalid-offsetof',
    '-Wno-switch',
    '-Wno-tautological-compare',
    '-Wno-unknown-pragmas',
    '-Wno-unused-function',
    '-Wno-unused-lambda-capture',
    '-Wno-unused-local-typedef',
    '-Wno-unused-private-field',
    '-Wno-unused-variable',
    '-Wno-undefined-var-template',
    '-Wshadow',
    '-Wundef',
    '-Wno-float-conversion',
    '-Wno-implicit-float-conversion',
    '-Wno-implicit-int-conversion',
    '-Wno-c++11-narrowing',
    '-Wno-microsoft',
    '-Wno-msvc-include',
    '-Wno-pragma-pack',
    '-Wno-inline-new-delete',
    '-Wno-implicit-exception-spec-mismatch',
    '-Wno-undefined-bool-conversion',
    '-Wno-deprecated-writable-strings',
    '-Wno-deprecated-register',
    '-Wno-switch-enum',
    '-Wno-logical-op-parentheses',
    '-Wno-null-arithmetic',
    '-Wno-deprecated-declarations',
    '-Wno-return-type-c-linkage',
    '-Wno-ignored-attributes',
    '-Wno-uninitialized',
    '-Wno-return-type',
    '-Wno-unused-parameter',
    '-Wno-ignored-qualifiers',
    '-Wno-expansion-to-defined',
    '-Wno-sign-compare',
    '-Wno-missing-field-initializers',
    '-Wno-nonportable-include-path',
    '-Wno-invalid-token-paste',
    '-Wno-null-pointer-arithmetic',
    '-Wno-constant-logical-operand',
    '-Wno-unused-value',
    '-Wno-bitfield-enum-conversion',
  );

  // 5. 构建 If.PathMatch 规则（模板风格）
  const pathMatch: string[] = [];
  if (opts.projectPath) {
    pathMatch.push('.vscode/vscodeuehelper/completionHelper.cpp');
    pathMatch.push('Source/.*\\.(cpp|h)');
  }

  // If 块必须放在对象字面量的第一个属性位置，确保 YAML 序列化时 If 在 CompileFlags 之前
  const result: ClangdConfig = {
    ...(pathMatch.length > 0 ? { If: { PathMatch: pathMatch } as IfBlock } : {}),
    CompileFlags: {
      CompilationDatabase: '.vscode/vscodeuehelper',
      Compiler: opts.compilerPath,
      Add: addFlags,
    },
    InlayHints: {
      Enabled: 'Yes',
      ParameterNames: 'Yes',
      DeducedTypes: 'Yes',
      Designators: 'Yes',
    },
    Diagnostics: {
      UnusedIncludes: 'None',
    },
  };

  return result;
}

// ===== 序列化 =====

/** 把 ClangdConfig 对象渲染为 YAML 文本 */
export function renderClangdConfig(config: ClangdConfig): string {
  const doc = new yaml.Document(config);
  return doc.toString({ lineWidth: 0 });  // lineWidth=0 禁止自动折行（防止长路径被 yaml 库折行）
}

// ===== 写文件 =====

/**
 * 把 .clangd 写入项目根目录。
 * 重写整个文件（非增量），保证只有一个 CompileFlags 块。
 */
export async function writeClangdConfig(
  projectPath: string,
  opts: ClangdConfigOptions = {},
): Promise<string> {
  const target = path.join(path.dirname(projectPath), '.clangd');
  const yamlText = renderClangdConfig(defaultClangdConfig(opts));
  await fs.writeFile(target, yamlText, 'utf-8');
  return target;
}

/** 查找 .clangd */
export async function findClangdConfig(projectPath: string): Promise<string | null> {
  const target = path.join(path.dirname(projectPath), '.clangd');
  try {
    await fs.access(target);
    return target;
  } catch {
    return null;
  }
}

// ===== 系统头文件替换（setSystemIncludes 使用）=====

/** 系统头文件 flag 的前缀列表 */
export const SYSTEM_INCLUDE_FILTER_PREFIXES = [
  '/X',
  '/imsvc',
  '-fms-compatibility-version=',
  '/std:',
];

/**
 * 在 .clangd 的 CompileFlags.Add 中替换系统头文件 flag。
 *
 * 使用 yaml 库解析 → 修改 → 写回，避免手写字符串破坏格式。
 *
 * 逻辑（对齐 unreal-clangd setCustomSysInc）：
 * 1. yaml.parse() 解析文件
 * 2. 找到 CompileFlags.Add 序列
 * 3. 按前缀过滤旧 system include flag
 * 4. 新 flag 插入到 Add 顶部
 * 5. yaml.stringify() 写回
 */
export function replaceSystemIncludeBlock(yamlText: string, newFlags: string[]): string {
  // 用 parse 而不是 parseDocument —— parse 返回普通 JS 对象，无类型问题
  let root: unknown;
  try {
    root = yaml.parse(yamlText);
    if (!root || typeof root !== 'object') {return yamlText;}
  } catch {
    return yamlText;
  }

  const doc = root as Record<string, unknown>;
  const cf = doc.CompileFlags;
  if (!cf || typeof cf !== 'object') {return yamlText;}
  const compileFlags = cf as Record<string, unknown>;

  const oldAdd = compileFlags.Add;
  const oldAddItems: string[] = [];
  if (Array.isArray(oldAdd)) {
    for (const item of oldAdd) {
      if (typeof item === 'string') {oldAddItems.push(item);}
    }
  }

  // 筛选：保留非系统头文件 flag
  const kept = oldAddItems.filter((v) => {
    const unquoted = v.replace(/^["'](.*)["']$/, '$1');
    return !SYSTEM_INCLUDE_FILTER_PREFIXES.some((p) => unquoted.startsWith(p));
  });

  // 新 Add = newFlags + kept
  compileFlags.Add = [...newFlags, ...kept];

  return yaml.stringify(doc);
}
