/**
 * clangd 层共享类型定义
 */

export type CompletionMode = 'fast' | 'slow';

export interface CompileCommandsEntry {
  directory: string;
  file: string;
  arguments?: string[];
  command?: string;
  output?: string;
}

export interface PrepareIncludesList {
  /** Engine version this list targets (e.g., "5.4"). */
  engineVersion: string;
  /** Mode this list is curated for. */
  mode: CompletionMode;
  /** Absolute paths to headers to inject via `-include <header>`. */
  headers: string[];
}

/**
 * An If-block mirrors clangd's conditional config syntax:
 *   If:
 *     PathMatch: Engine/Source/.*
 *     Index:
 *       Background: Skip
 */
export interface IfBlock {
  PathMatch?: string;
  CompileFlags?: {
    Add?: string[];
    Remove?: string[];
  };
  Index?: {
    Background?: 'Build' | 'Skip';
  };
  Diagnostics?: {
    Suppress?: string[];
  };
}

export interface ClangdConfig {
  CompileFlags?: {
    Remove?: string[];
    Add?: string[];
    /** 
     * Path to compile_commands.json directory. 
     * ⚠️ clangd 22.x 要求必须放在 CompileFlags 内部，不能在根级别！
     */
    CompilationDatabase?: string;
  };

  /**
   * Preamble 缓存优化 - 加速文件打开速度
   * 
   * Preamble 是文件中第一个非 include/非注释之前的部分（主要是头文件）。
   * clangd 构建一次后可以在后续解析中重用，大幅加快打开文件的速度。
   */
  Preamble?: {
    /** 
     * 将 preamble 存储在磁盘上，跨 clangd 重启重用（更快的冷启动）
     * 推荐：Disk
     */
    Storage?: 'Disk' | 'None';
  };

  Diagnostics?: {
    Suppress?: string[];
    /**
     * How aggressively to check for unused includes:
     * - Strict: warn on all unused includes
     * - None: don't warn about unused includes
     */
    UnusedIncludes?: 'Strict' | 'None';
    /**
     * How to check for missing includes:
     * - Strict: warn if a file uses a symbol but doesn't include its header
     * - None: don't warn about missing includes
     */
    MissingIncludes?: 'Strict' | 'None';
  };

  InlayHints?: {
    Enabled?: 'Yes' | 'No';
    /** Show parameter names at call sites. */
    ParameterNames?: 'Yes' | 'No';
    /** Show deduced type for `auto` variables. */
    DeducedTypes?: 'Yes' | 'No';
    /** Show return type for lambdas. */
    Designators?: 'Yes' | 'No';
    /** Show type for `auto`, lambdas, and deduced return types. */
    Types?: 'Yes' | 'No';
  };

  Hover?: {
    /** Show the canonical type of an alias when hovering over it. */
    ShowAKA?: 'Yes' | 'No';
  };

  Completion?: {
    /**
     * If true, completion looks for symbols in all scopes, not just the
     * visible ones. This is more expensive but gives better results for
     * large projects.
     */
    AllScopes?: 'Yes' | 'No';
  };

  Index?: {
    Background?: 'Build' | 'Skip';
    /**
     * Limit the number of symbol names tracked in the background index.
     * Default is 0 = unlimited. For UE projects you may want to set this
     * to control memory usage.
     */
    StandardIndexCapacity?: number;
  };

  /** Conditional If-blocks rendered AFTER top-level fields. */
  If?: IfBlock[];
}
