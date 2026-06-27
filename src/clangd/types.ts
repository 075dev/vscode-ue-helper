/**
 * clangd 层共享类型定义
 *
 * 设计原则：仅暴露 clangd 22.1.0 已确认支持的配置。
 * 移除 Preamble/Hover/Completion 等 clangd 22.x 不识别或会报警告的配置。
 */

export type CompletionMode = 'fast' | 'slow';

export interface CompileCommandsEntry {
  directory: string;
  file: string;
  /** ⚠️ clangd 22.x 推荐使用 arguments 数组（而非 command 字符串） */
  arguments?: string[];
  command?: string;
  output?: string;
}

export interface PrepareIncludesList {
  /** Engine version this list targets (e.g., "5.4"). */
  engineVersion: string;
  /** Mode this list is curated for. */
  mode: CompletionMode;
  /** Absolute paths to headers to inject as `-include <header>` flags. */
  headers: string[];
}

/**
 * If-block: clangd 条件配置块
 *
 * 已知限制（clangd 22.1.0）：
 * - ✅ PathMatch / CompileFlags.Add / CompileFlags.Remove / Diagnostics.Suppress
 * - ❌ Index（22.x 仍报 "Unknown If key 'Index'"，等后续版本）
 */
export interface IfBlock {
  PathMatch?: string;
  CompileFlags?: {
    Add?: string[];
    Remove?: string[];
  };
  Diagnostics?: {
    Suppress?: string[];
  };
}

/**
 * ClangdConfig: 与 .clangd YAML 结构一一对应
 *
 * 只包含 clangd 22.x 已确认支持的字段，避免 "Unknown Config key" 警告。
 */
export interface ClangdConfig {
  CompileFlags?: {
    Remove?: string[];
    Add?: string[];
    /**
     * 指向 compile_commands.json 所在目录（相对于 .clangd 所在位置）。
     * clangd 22.x 明确要求放在 CompileFlags 内部，不能在根级别。
     */
    CompilationDatabase?: string;
  };

  Diagnostics?: {
    Suppress?: string[];
    /**
     * - Strict: warn on all unused includes
     * - None: don't warn about unused includes
     * UE 项目头文件依赖复杂，推荐 None。
     */
    UnusedIncludes?: 'Strict' | 'None';
    /**
     * - Strict: warn if a file uses a symbol but doesn't include its header
     * - None: don't warn about missing includes
     */
    MissingIncludes?: 'Strict' | 'None';
  };

  InlayHints?: {
    Enabled?: 'Yes' | 'No';
    ParameterNames?: 'Yes' | 'No';
    DeducedTypes?: 'Yes' | 'No';
    Designators?: 'Yes' | 'No';
  };

  Index?: {
    Background?: 'Build' | 'Skip';
    /**
     * 限制后台索引中的符号名数量。默认 0（无限）。
     * 大型 UE 项目可设 5000000 等以降低内存占用。
     */
    StandardIndexCapacity?: number;
  };

  /** 条件块。⚠️ 22.x 不支持 Index 在 If 块中 */
  If?: IfBlock[];
}
