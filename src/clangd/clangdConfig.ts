/**
 * clangdConfig —— 在项目根写 .clangd 文件
 *
 * 参考 engine-link: 抑制 MSVC 假阳性(builtin_definition 对 _MSC_VER,
 * unknown-warning-option 对 clang 的更严警告),配置 background indexing。
 *
 * .clangd 是 YAML 格式。理想用 js-yaml 写,但避免加依赖,直接输出纯文本。
 *
 * 主要导出:
 *   - renderClangdConfig: ClangdConfig 对象 → YAML 文本
 *   - writeClangdConfig: 写默认 .clangd 到项目根
 *   - defaultClangdConfig: 默认 ClangdConfig 对象
 *   - replaceSystemIncludeBlock: 替换 .clangd 里的 /imsvc 等 SDK 标志块(setSystemIncludes 用)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ClangdConfig, IfBlock } from './types';

/**
 * Render a ClangdConfig object as a `.clangd` YAML string.
 *
 * The format is a small subset of YAML. We deliberately avoid a full
 * YAML library — clangd's `.clangd` only requires strings, arrays of
 * strings, and one level of nesting.
 */
export function renderClangdConfig(config: ClangdConfig): string {
  const lines: string[] = [];

  // ========== CompileFlags ==========
  if (config.CompileFlags) {
    lines.push('CompileFlags:');
    if (config.CompileFlags.Remove && config.CompileFlags.Remove.length > 0) {
      lines.push('  Remove:');
      for (const item of config.CompileFlags.Remove) {
        lines.push(`    - ${yamlString(item)}`);
      }
    }
    if (config.CompileFlags.Add && config.CompileFlags.Add.length > 0) {
      lines.push('  Add:');
      for (const item of config.CompileFlags.Add) {
        lines.push(`    - ${yamlString(item)}`);
      }
    }
    // ✅ clangd 22.x 要求：CompilationDatabase 必须放在 CompileFlags 内部
    if (config.CompileFlags.CompilationDatabase) {
      lines.push(`  CompilationDatabase: ${config.CompileFlags.CompilationDatabase}`);
    }
  }

  // ========== Preamble 缓存优化 ==========
  if (config.Preamble) {
    lines.push('Preamble:');
    if (config.Preamble.Storage) {
      lines.push(`  Storage: ${config.Preamble.Storage}`);
    }
  }

  // ========== Diagnostics ==========
  if (config.Diagnostics) {
    lines.push('Diagnostics:');
    if (config.Diagnostics.Suppress && config.Diagnostics.Suppress.length > 0) {
      lines.push('  Suppress:');
      for (const item of config.Diagnostics.Suppress) {
        lines.push(`    - ${yamlString(item)}`);
      }
    }
    if (config.Diagnostics.UnusedIncludes) {
      lines.push(`  UnusedIncludes: ${config.Diagnostics.UnusedIncludes}`);
    }
    if (config.Diagnostics.MissingIncludes) {
      lines.push(`  MissingIncludes: ${config.Diagnostics.MissingIncludes}`);
    }
  }

  // ========== InlayHints ==========
  if (config.InlayHints) {
    lines.push('InlayHints:');
    if (config.InlayHints.Enabled !== undefined) {
      lines.push(`  Enabled: ${config.InlayHints.Enabled}`);
    }
    if (config.InlayHints.ParameterNames !== undefined) {
      lines.push(`  ParameterNames: ${config.InlayHints.ParameterNames}`);
    }
    if (config.InlayHints.DeducedTypes !== undefined) {
      lines.push(`  DeducedTypes: ${config.InlayHints.DeducedTypes}`);
    }
    if (config.InlayHints.Designators !== undefined) {
      lines.push(`  Designators: ${config.InlayHints.Designators}`);
    }
    if (config.InlayHints.Types !== undefined) {
      lines.push(`  Types: ${config.InlayHints.Types}`);
    }
  }

  // ========== Hover ==========
  if (config.Hover) {
    lines.push('Hover:');
    if (config.Hover.ShowAKA !== undefined) {
      lines.push(`  ShowAKA: ${config.Hover.ShowAKA}`);
    }
  }

  // ========== Completion ==========
  if (config.Completion) {
    lines.push('Completion:');
    if (config.Completion.AllScopes !== undefined) {
      lines.push(`  AllScopes: ${config.Completion.AllScopes}`);
    }
  }

  // ========== Index ==========
  if (config.Index) {
    lines.push('Index:');
    if (config.Index.Background) {
      lines.push(`  Background: ${config.Index.Background}`);
    }
    if (config.Index.StandardIndexCapacity !== undefined) {
      lines.push(`  StandardIndexCapacity: ${config.Index.StandardIndexCapacity}`);
    }
  }

  // ========== If-blocks (render AFTER top-level fields) ==========
  if (config.If && config.If.length > 0) {
    for (const block of config.If) {
      lines.push(...renderIfBlock(block));
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Render a single IfBlock as YAML lines.
 * Each If block is its own mapping with nested CompileFlags / Index / Diagnostics.
 */
function renderIfBlock(block: IfBlock): string[] {
  const lines: string[] = [];
  lines.push('If:');
  if (block.PathMatch) {
    lines.push(`  PathMatch: ${block.PathMatch}`);
  }
  if (block.CompileFlags) {
    lines.push('  CompileFlags:');
    if (block.CompileFlags.Remove && block.CompileFlags.Remove.length > 0) {
      lines.push('    Remove:');
      for (const item of block.CompileFlags.Remove) {
        lines.push(`      - ${yamlString(item)}`);
      }
    }
    if (block.CompileFlags.Add && block.CompileFlags.Add.length > 0) {
      lines.push('    Add:');
      for (const item of block.CompileFlags.Add) {
        lines.push(`      - ${yamlString(item)}`);
      }
    }
  }
  if (block.Index) {
    lines.push('  Index:');
    if (block.Index.Background) {
      lines.push(`    Background: ${block.Index.Background}`);
    }
  }
  if (block.Diagnostics) {
    lines.push('  Diagnostics:');
    if (block.Diagnostics.Suppress && block.Diagnostics.Suppress.length > 0) {
      lines.push('    Suppress:');
      for (const item of block.Diagnostics.Suppress) {
        lines.push(`      - ${yamlString(item)}`);
      }
    }
  }
  return lines;
}

/** Options for building the default `.clangd` config. */
export interface ClangdConfigOptions {
  /**
   * Completion mode — 'fast' omits macro completions, 'slow' adds
   * `-include <macroCompletionHelper.h>` to let clangd index UE macros.
   */
  completionMode?: 'fast' | 'slow';
  /**
   * Absolute path to macroCompletionHelper.h. Required when
   * completionMode === 'slow'. Ignored in fast mode.
   */
  macroHelperPath?: string;
  /**
   * Additional headers (typically from preparseIncludes.ts) to inject as
   * `-include <header>` flags before the macroHelperPath include.
   * These are the SharedPCH headers that tell clangd about UE macros.
   */
  preparseHeaders?: string[];
  /**
   * Windows SDK + MSVC system include flags (Windows only).
   * These are generated by detectSystemIncludes() and injected at the
   * BEGINNING of CompileFlags.Add so clangd finds Windows headers correctly.
   * 
   * ⚠️ Important: Generated ONCE at Step 1 of createProject — NEVER modify
   * .clangd afterwards! That breaks YAML formatting.
   */
  systemIncludeFlags?: string[];
}

/** Default config for UE C++ projects. */
export function defaultClangdConfig(opts: ClangdConfigOptions = {}): ClangdConfig {
  const addFlags: string[] = [];

  // ========== Windows SDK + MSVC 系统头文件（Windows only） ==========
  // ⚠️ 只在 Step 1 注入一次！后续绝不修改 .clangd，避免 YAML 格式破坏！
  // 这些 flag 由 detectSystemIncludes() 自动检测生成，包含：
  //   - /X: 清除 clang 默认的 include 搜索路径
  //   - /imsvc <path>: Windows SDK + MSVC 头文件路径
  //   - -fms-compatibility-version: MSVC 编译器版本
  //
  // 注意：UE 的头文件路径来自 compile_commands.json，不受 /X 影响
  if (opts.systemIncludeFlags && opts.systemIncludeFlags.length > 0) {
    addFlags.push(...opts.systemIncludeFlags);
  }

  // ========== C++ 标准 ==========
  addFlags.push('-std=c++20');

  // ========== 基本警告控制 ==========
  addFlags.push(
    '-Wno-unknown-warning-option',
    '-Wno-deprecated-declarations',
  );

  // SharedPCH preparse headers — both fast and slow modes get these.
  // They tell clangd about UE's generated .generated.h and module PCH.
  if (opts.preparseHeaders && opts.preparseHeaders.length > 0) {
    for (const header of opts.preparseHeaders) {
      addFlags.push('-include', header);
    }
  }

  // Slow 模式：预包含宏补全头文件，让 clangd 能补全 UPROPERTY / UFUNCTION 等 UE 宏
  // (preparseHeaders already injected above, so this appends after them)
  if (opts.completionMode === 'slow' && opts.macroHelperPath) {
    addFlags.push('-include');
    addFlags.push(opts.macroHelperPath);
  }

  return {
    CompileFlags: {
      // UE's UHT emits -FI with absolute paths that clangd can't resolve;
      // drop them so clangd uses its own -include injection.
      Remove: ['-FI*', '-Wno-*'],
      Add: addFlags,
      // ✅ clangd 22.x 要求：CompilationDatabase 必须放在 CompileFlags 内部
      // 不能放在根级别，否则会报错 "Unknown Config key 'CompilationDatabase'"
      CompilationDatabase: '.vscode/vscodeuehelper',
    },
    // Preamble 缓存优化 - 大幅加快文件打开速度（clangd 16+）
    // clangd 会把头文件预编译部分缓存到磁盘，第二次打开同一个文件时速度提升 5-10 倍
    Preamble: {
      Storage: 'Disk',
    },
    Diagnostics: {
      Suppress: [
        'unknown-warning-option',
        'unused-includes',
        'deprecated-declarations',
        // MSVC builds set _MSC_VER; clangd's builtin_definition check
        // incorrectly flags the macro as redefined.
        'builtin-macro-redefinition',
      ],
      // UE 头文件依赖复杂，关闭严格的未使用/缺失头文件检查（clangd 15+ 支持）
      UnusedIncludes: 'None',
      MissingIncludes: 'None',
    },
    // 内嵌提示：让代码更易读 (clangd 14+)
    InlayHints: {
      Enabled: 'Yes',
      ParameterNames: 'Yes',  // 调用函数时显示参数名
      DeducedTypes: 'Yes',    // 显示 auto 变量的实际类型
      Designators: 'Yes',     // 显示 lambda 返回类型和结构体初始化器
    },
    // 悬停显示类型别名 (clangd 14+)
    Hover: {
      ShowAKA: 'Yes',  // 悬停时显示 "also known as" 类型别名
    },
    // 补全配置 (clangd 14+)
    Completion: {
      AllScopes: 'Yes',  // 在所有作用域中搜索补全符号（UE 项目必需）
    },
    Index: {
      Background: 'Build',
    },
    If: defaultIfBlocks(),
  };
}

/**
 * Default UE If-blocks for clangd performance optimisation.
 *
 * ⚠️ clangd 22.x 限制：If 块中不支持 Index 配置！
 * 会报错："Unknown If key 'Index'"
 *
 * 所以目前只能在 If 块中使用：
 * - ✅ PathMatch
 * - ✅ CompileFlags (Add/Remove)
 * - ✅ Diagnostics (Suppress)
 * - ❌ Index（不支持）
 *
 * 等 clangd 后续版本支持 Index 在 If 块中后，可以重新启用引擎跳过优化：
 *   - Engine/Source/.* → skip background indexing (用户通常不修改引擎代码)
 *   - Source/.*         → keep full background indexing for project sources
 *
 * 目前先返回空数组，避免 clangd 22.x 报错。
 */
export function defaultIfBlocks(): IfBlock[] {
  // clangd 22.x does not support Index in If-blocks yet
  // Return empty array to avoid "Unknown If key 'Index'" warnings
  return [];
}

/** Write `.clangd` to project root. Returns the path written. */
export async function writeClangdConfig(
  projectPath: string,
  opts: ClangdConfigOptions = {},
): Promise<string> {
  const target = path.join(path.dirname(projectPath), '.clangd');
  const yaml = renderClangdConfig(defaultClangdConfig(opts));
  await fs.writeFile(target, yaml, 'utf-8');
  return target;
}

/**
 * Filter prefix list for `CompileFlags.Add` items that come from
 * `setSystemIncludes` (MSVC / SDK / `/X`). Used to replace the previous
 * system-include block without disturbing user-added flags.
 */
export const SYSTEM_INCLUDE_FILTER_PREFIXES = [
  '/imsvc',
  '-fms-compatibility-version=',
  '/std:',
];

/**
 * Replace the system-include block inside a .clangd file. Existing flags
 * matching `SYSTEM_INCLUDE_FILTER_PREFIXES` are dropped; the new flags
 * are spliced in at the start of `CompileFlags.Add`. Returns the new file
 * contents. No-op (returns input unchanged) if nothing changed.
 */
export function replaceSystemIncludeBlock(yaml: string, newFlags: string[]): string {
  // Match the Add: array under CompileFlags:
  //   CompileFlags:
  //     Remove:
  //       - ...
  //     Add:
  //       - foo
  //       - /imsvc...
  // We rewrite by lines.
  const lines = yaml.split(/\r?\n/);
  let addIdx = -1;
  let inCompileFlags = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // 检测是否进入 CompileFlags 块（顶级别名）
    if (/^CompileFlags:\s*$/.test(line)) {
      inCompileFlags = true;
      continue;
    }

    // 如果在 CompileFlags 块内，并且检测到非缩进的新顶级块，则退出
    if (inCompileFlags && /^[A-Za-z]+:\s*$/.test(line)) {
      inCompileFlags = false;
      break;
    }

    // 在 CompileFlags 块内找到 Add:
    if (inCompileFlags && /^\s+Add:\s*$/.test(line)) {
      addIdx = i;
      break;
    }
  }

  if (addIdx === -1) {
    // No CompileFlags.Add block found — find existing CompileFlags: and add Add: to it
    let compileFlagsIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^CompileFlags:\s*$/.test(lines[i] ?? '')) {
        compileFlagsIdx = i;
        break;
      }
    }

    if (compileFlagsIdx !== -1) {
      // 找到现有的 CompileFlags:，在其后插入 Add:
      const before = lines.slice(0, compileFlagsIdx + 1);
      const after = lines.slice(compileFlagsIdx + 1);
      const addBlock = ['  Add:', ...newFlags.map((f) => `    - ${yamlString(f)}`)];
      return [...before, ...addBlock, ...after].join('\n');
    }

    // 没有 CompileFlags:，才创建新的
    const compileFlagsBlock = [
      'CompileFlags:',
      '  Add:',
      ...newFlags.map((f) => `    - ${yamlString(f)}`),
      '',
    ].join('\n');

    return `${yaml.trimEnd()}\n${compileFlagsBlock}\n`;
  }

  // Walk the Add: block, collecting non-system-include lines.
  const kept: string[] = [];
  let i = addIdx + 1;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const itemMatch = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!itemMatch) break; // end of Add: block
    const value = itemMatch[1] ?? '';
    // Strip surrounding YAML quotes for the prefix test.
    const unquoted = value.replace(/^["'](.*)["']$/, '$1');
    const isSystemInclude = SYSTEM_INCLUDE_FILTER_PREFIXES.some((p) => unquoted.startsWith(p));
    if (!isSystemInclude) kept.push(line);
    i++;
  }

  // Reconstruct: CompileFlags: \n Add: \n <new> \n <kept> \n <rest>
  const indent = '    ';
  const rebuilt: string[] = [];
  rebuilt.push(lines[addIdx - 1] ?? 'CompileFlags:'); // "CompileFlags:"
  rebuilt.push(lines[addIdx] ?? '  Add:'); // "  Add:"
  for (const f of newFlags) rebuilt.push(`${indent}- ${yamlString(f)}`);
  for (const k of kept) rebuilt.push(k);
  for (; i < lines.length; i++) rebuilt.push(lines[i] ?? '');

  return rebuilt.join('\n');
}

/**
 * Locate the `.clangd` file for a given project (project root = dirname
 * of the .uproject). Returns null if no file exists.
 */
export async function findClangdConfig(projectPath: string): Promise<string | null> {
  const target = path.join(path.dirname(projectPath), '.clangd');
  try {
    await fs.access(target);
    return target;
  } catch {
    return null;
  }
}

/**
 * Quote a string for YAML if it contains characters that need it.
 * Conservative — only quote when definitely needed.
 */
function yamlString(s: string): string {
  if (/[:#&*!|>'"%@`{}\[\],\n]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}
