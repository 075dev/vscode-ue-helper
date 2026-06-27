/**
 * clangdConfig —— 在项目根写 .clangd 文件
 *
 * 设计原则（参照 unreal-clangd v3 + engine-link）：
 * 1. **极简默认**：默认 .clangd 只包含必要的 CompileFlags.CompilationDatabase +
 *    Diagnostics.Suppress（4 行）。其他高级配置（InlayHints、Index）作为可选注入。
 * 2. **begin/end 标记**：用 `# <<< vscodeuehelper-managed >>>` 和
 *    `# <<< end-vscodeuehelper-managed >>>` 标记我们管理的配置块，保留用户已有内容。
 * 3. **不破坏用户文件**：再次调用 writeClangdConfig 时，只替换 managed block 内部，
 *    用户自己写的 .clangd 内容（如 custom PathMatch 规则）完全保留。
 * 4. **clangd 22.x 兼容**：
 *    - CompilationDatabase 必须放在 CompileFlags 内部
 *    - 移除 Preamble/Hover/Completion（22.x 不支持，会报 Unknown Config key）
 *    - If 块不包含 Index（22.x 仍报 Unknown If key 'Index'）
 *
 * ## 典型生成的 .clangd
 *
 * ```yaml
 * # <<< vscodeuehelper-managed >>>
 * # 编辑上方/下方内容可保留，但请勿修改此标记块。
 * CompileFlags:
 *   CompilationDatabase: .vscode/vscodeuehelper
 * Diagnostics:
 *   Suppress:
 *     - builtin_definition
 *     - unknown-warning-option
 *     - deprecated-declarations
 *     - unused-includes
 *     - builtin-macro-redefinition
 *   UnusedIncludes: None
 *   MissingIncludes: None
 * InlayHints:
 *   Enabled: Yes
 * Index:
 *   Background: Build
 * # <<< end-vscodeuehelper-managed >>>
 * ```
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ClangdConfig, IfBlock } from './types';

// ===== Managed block 标记 =====
export const MANAGED_BEGIN = '# <<< vscodeuehelper-managed >>>';
export const MANAGED_END = '# <<< end-vscodeuehelper-managed >>>';

// ===== 默认 .clangd 内容 =====

/** 默认 ClangdConfig: 极简模板 + 按需注入 */
export function defaultClangdConfig(opts: ClangdConfigOptions = {}): ClangdConfig {
  const addFlags: string[] = [];

  // ========== Windows SDK + MSVC 系统头文件 ==========
  // 由 detectSystemIncludes() 生成，包含 /X + /imsvc + -fms-compatibility-version
  // 仅当用户主动触发 setSystemIncludes 命令时传入，初始 creatProject 不自动注入
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

  // ========== SharedPCH preparse headers ==========
  // 注入 UE 核心头文件路径，让 clangd 能识别 UCLASS / UPROPERTY 宏
  if (opts.preparseHeaders && opts.preparseHeaders.length > 0) {
    for (const header of opts.preparseHeaders) {
      addFlags.push('-include', header);
    }
  }

  // ========== Slow 模式宏补全 ==========
  // 预包含 macroCompletionHelper.h，让 clangd 能补全 UE 宏
  if (opts.completionMode === 'slow' && opts.macroHelperPath) {
    addFlags.push('-include');
    addFlags.push(opts.macroHelperPath);
  }

  return {
    CompileFlags: {
      Remove: addFlags.length > 0 ? ['-FI*', '-Wno-*'] : undefined,
      Add: addFlags.length > 0 ? addFlags : undefined,
      // clangd 22.x 要求：放在 CompileFlags 内部，不能在根级别
      CompilationDatabase: '.vscode/vscodeuehelper',
    },
    Diagnostics: {
      Suppress: [
        // MSVC 头文件定义了 Clang 也认作 builtin 的符号，触发 builtin_definition
        'builtin_definition',
        // MSVC 的 /W4 警告 Clang 认作未知警告
        'unknown-warning-option',
        // UE 自有 deprecation 宏
        'deprecated-declarations',
        // UE 头文件 include 链复杂，unused-includes 误报率高
        'unused-includes',
        // MSVC 设置 _MSC_VER；Clang 的 builtin_macro_redefinition 误报
        'builtin-macro-redefinition',
      ],
      // UE 头文件依赖复杂，关闭严格检查避免误报
      UnusedIncludes: 'None',
      MissingIncludes: 'None',
    },
    InlayHints: {
      Enabled: 'Yes',
      ParameterNames: 'Yes',
      DeducedTypes: 'Yes',
      Designators: 'Yes',
    },
    Index: {
      Background: 'Build',
    },
    // If 块必须为空（clangd 22.x 不支持 Index 在 If 块中）
    If: [],
  };
}

/** Options for building the default `.clangd` config. */
export interface ClangdConfigOptions {
  completionMode?: 'fast' | 'slow';
  macroHelperPath?: string;
  preparseHeaders?: string[];
  /**
   * 系统头文件 flag（/X + /imsvc + -fms-compatibility-version）。
   * 仅 Windows，由 setSystemIncludes 命令注入。
   * 不参与默认模板生成，避免破坏 UE 头文件路径。
   */
  systemIncludeFlags?: string[];
}

// ===== 渲染：把 ClangdConfig 对象 → YAML 文本 =====

/**
 * 把 ClangdConfig 对象渲染为 YAML 文本（极简格式，不含注释）。
 * 注意：实际写入 .clangd 时使用 renderManagedBlock()，包含 begin/end 标记。
 * 导出供测试使用。
 */
export function renderYaml(config: ClangdConfig): string {
  const lines: string[] = [];

  if (config.CompileFlags) {
    lines.push('CompileFlags:');
    if (config.CompileFlags.Remove?.length) {
      lines.push('  Remove:');
      for (const item of config.CompileFlags.Remove) {
        lines.push(`    - ${yamlString(item)}`);
      }
    }
    if (config.CompileFlags.Add?.length) {
      lines.push('  Add:');
      for (const item of config.CompileFlags.Add) {
        lines.push(`    - ${yamlString(item)}`);
      }
    }
    if (config.CompileFlags.CompilationDatabase) {
      lines.push(`  CompilationDatabase: ${config.CompileFlags.CompilationDatabase}`);
    }
  }

  if (config.Diagnostics) {
    lines.push('Diagnostics:');
    if (config.Diagnostics.Suppress?.length) {
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

  if (config.InlayHints) {
    lines.push('InlayHints:');
    if (config.InlayHints.Enabled) lines.push(`  Enabled: ${config.InlayHints.Enabled}`);
    if (config.InlayHints.ParameterNames) lines.push(`  ParameterNames: ${config.InlayHints.ParameterNames}`);
    if (config.InlayHints.DeducedTypes) lines.push(`  DeducedTypes: ${config.InlayHints.DeducedTypes}`);
    if (config.InlayHints.Designators) lines.push(`  Designators: ${config.InlayHints.Designators}`);
  }

  if (config.Index) {
    lines.push('Index:');
    if (config.Index.Background) lines.push(`  Background: ${config.Index.Background}`);
    if (config.Index.StandardIndexCapacity !== undefined) {
      lines.push(`  StandardIndexCapacity: ${config.Index.StandardIndexCapacity}`);
    }
  }

  if (config.If && config.If.length > 0) {
    for (const block of config.If) {
      lines.push(...renderIfBlock(block));
    }
  }

  return lines.join('\n');
}

function renderIfBlock(block: IfBlock): string[] {
  const lines: string[] = ['If:'];
  if (block.PathMatch) lines.push(`  PathMatch: ${block.PathMatch}`);
  if (block.CompileFlags) {
    lines.push('  CompileFlags:');
    if (block.CompileFlags.Add?.length) {
      lines.push('    Add:');
      for (const item of block.CompileFlags.Add) {
        lines.push(`      - ${yamlString(item)}`);
      }
    }
    if (block.CompileFlags.Remove?.length) {
      lines.push('    Remove:');
      for (const item of block.CompileFlags.Remove) {
        lines.push(`      - ${yamlString(item)}`);
      }
    }
  }
  if (block.Diagnostics) {
    lines.push('  Diagnostics:');
    if (block.Diagnostics.Suppress?.length) {
      lines.push('    Suppress:');
      for (const item of block.Diagnostics.Suppress) {
        lines.push(`      - ${yamlString(item)}`);
      }
    }
  }
  return lines;
}

/** 把字符串安全地放入 YAML（必要时加引号、转义） */
function yamlString(s: string): string {
  if (/[:#&*!|>'"%@`{}\[\],\n]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

// ===== Managed block =====

/**
 * 构造带 begin/end 标记的 managed block 文本。
 * 用户自己写的 .clangd 内容（标记外）会保留下来。
 */
export function renderManagedBlock(config: ClangdConfig = defaultClangdConfig()): string {
  return [
    MANAGED_BEGIN,
    '# 此块由 VSCode UE Helper 自动管理，请勿手动编辑。',
    '# 若需自定义配置，请在下方（本块之外）添加。',
    renderYaml(config),
    MANAGED_END,
  ].join('\n');
}

/**
 * 在已有 .clangd 内容中 upsert managed block。
 * - 已有 managed block：替换块内内容，保留块外用户内容
 * - 无 managed 标记：无论有无内容，替换整个文件为 managed block（避免重复键）
 * - 完全空：写入 managed block
 */
export function upsertManagedBlock(existing: string, config: ClangdConfig = defaultClangdConfig()): string {
  const newBlock = renderManagedBlock(config);
  const beginIdx = existing.indexOf(MANAGED_BEGIN);
  const endIdx = existing.indexOf(MANAGED_END);

  // 已有完整的 managed block → 替换块内，保留块外用户内容
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx).replace(/\s+$/, '');
    const afterStart = endIdx + MANAGED_END.length;
    const after = existing.slice(afterStart).replace(/^\s+/, '');

    const parts: string[] = [];
    if (before) parts.push(before);
    parts.push(newBlock);
    if (after) parts.push(after);
    return parts.join('\n\n') + '\n';
  }

  // 完全没有 managed block：
  // ⚠️ 关键：替换整个文件为 managed block，而不是追加！
  // 这样做避免了已有内容（CompileFlags/Diagnostics等）与 managed block 重复的问题。
  // 用户自定义配置应放在结束标记 # <<< end-vscodeuehelper-managed >>> 之后。
  return newBlock + '\n';
}

// ===== 写文件 =====

/**
 * 把 .clangd 写到项目根目录。保留用户已有内容，upsert managed block。
 * @returns 写入的文件路径
 */
export async function writeClangdConfig(
  projectPath: string,
  opts: ClangdConfigOptions = {},
): Promise<string> {
  const target = path.join(path.dirname(projectPath), '.clangd');
  const config = defaultClangdConfig(opts);

  let existing = '';
  try {
    existing = await fs.readFile(target, 'utf-8');
  } catch {
    // 文件不存在，正常
  }

  const newContent = upsertManagedBlock(existing, config);
  await fs.writeFile(target, newContent, 'utf-8');
  return target;
}

/** 找到 .clangd 的绝对路径。如果不存在返回 null。 */
export async function findClangdConfig(projectPath: string): Promise<string | null> {
  const target = path.join(path.dirname(projectPath), '.clangd');
  try {
    await fs.access(target);
    return target;
  } catch {
    return null;
  }
}

// ===== 系统头文件注入（setSystemIncludes 用）=====

/**
 * 过滤前缀：用于识别 system include 相关的 flag
 * 匹配 /X, /imsvc*, -fms-compatibility-version=, /std:*
 */
export const SYSTEM_INCLUDE_FILTER_PREFIXES = [
  '/X',
  '/imsvc',
  '-fms-compatibility-version=',
  '/std:',
];

/**
 * 在 .clangd 的 CompileFlags.Add 中替换/注入系统头文件 flag。
 *
 * 设计：
 * 1. 把 Add 中的旧 system include flag 全部移除（按前缀）
 * 2. 把 newFlags 插入到 Add 顶部（system includes 优先于其他 flag）
 * 3. 保留其他用户添加的 flag
 *
 * ⚠️ 必须先用 writeClangdConfig 写入默认配置（确保有 managed block 结构）。
 */
export function replaceSystemIncludeBlock(yaml: string, newFlags: string[]): string {
  const lines = yaml.split(/\r?\n/);
  let managedBegin = -1;
  let managedEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() === MANAGED_BEGIN) managedBegin = i;
    if (lines[i]?.trim() === MANAGED_END) managedEnd = i;
  }

  if (managedBegin === -1 || managedEnd === -1) {
    // 没有 managed block → 走老的 upsertManagedBlock 逻辑
    const newYaml = upsertManagedBlock(yaml, {
      CompileFlags: {
        Add: newFlags,
        CompilationDatabase: '.vscode/vscodeuehelper',
      },
    });
    return newYaml;
  }

  // 在 managed block 内找到 CompileFlags.Add
  const before = lines.slice(0, managedBegin + 1);
  const after = lines.slice(managedEnd);
  const inner = lines.slice(managedBegin + 1, managedEnd);

  // 在 inner 中找 Add: 块
  let inCompileFlags = false;
  let addIdx = -1;
  for (let i = 0; i < inner.length; i++) {
    const line = inner[i] ?? '';
    if (/^CompileFlags:\s*$/.test(line)) {
      inCompileFlags = true;
      continue;
    }
    if (inCompileFlags && /^[A-Za-z]/.test(line) && /:\s*$/.test(line)) {
      inCompileFlags = false;
      continue;
    }
    if (inCompileFlags && /^\s+Add:\s*$/.test(line)) {
      addIdx = i;
      break;
    }
  }

  if (addIdx === -1) {
    // 没有 Add: 块 → 在 CompileFlags: 后插入
    const newInner: string[] = [];
    let inserted = false;
    for (let i = 0; i < inner.length; i++) {
      newInner.push(inner[i] ?? '');
      if (/^CompileFlags:\s*$/.test(inner[i] ?? '') && !inserted) {
        newInner.push('  Add:');
        for (const f of newFlags) {
          newInner.push(`    - ${yamlString(f)}`);
        }
        inserted = true;
      }
    }
    if (!inserted) {
      // 完全没找到 CompileFlags: → 追加
      newInner.push('CompileFlags:');
      newInner.push('  Add:');
      for (const f of newFlags) {
        newInner.push(`    - ${yamlString(f)}`);
      }
    }
    return [...before, ...newInner, ...after].join('\n');
  }

  // 找到 Add:，替换其中的 system include flag
  const keptLines: string[] = [];
  let i = addIdx + 1;
  while (i < inner.length) {
    const line = inner[i] ?? '';
    const m = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!m) break; // Add 块结束
    const value = (m[1] ?? '').replace(/^["'](.*)["']$/, '$1');
    const isSysInc = SYSTEM_INCLUDE_FILTER_PREFIXES.some((p) => value.startsWith(p));
    if (!isSysInc) keptLines.push(line);
    i++;
  }

  // 重组：CompileFlags: → Add: → 新 system include flags → 用户 flag
  const newInner: string[] = [];
  for (let j = 0; j < inner.length; j++) {
    if (j === addIdx) {
      // Add: 这一行
      newInner.push(inner[j] ?? '  Add:');
      // 插入新 system include flags
      for (const f of newFlags) {
        newInner.push(`    - ${yamlString(f)}`);
      }
      // 跳过原有的 system include flag（已过滤）
      i = addIdx + 1;
      while (i < inner.length) {
        const line = inner[i] ?? '';
        const m = line.match(/^\s*-\s+(.+?)\s*$/);
        if (!m) break;
        if (keptLines.includes(line)) {
          newInner.push(line);
        }
        i++;
      }
      // 跳过原始 inner 中已处理的部分
      j = i - 1; // 循环会 j++
    } else if (j > addIdx && j < i) {
      // 跳过原 Add 块内容
      continue;
    } else {
      newInner.push(inner[j] ?? '');
    }
  }

  return [...before, ...newInner, ...after].join('\n');
}
