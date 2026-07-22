/**
 * clangd 层共享类型定义
 *
 * 设计原则：仅暴露 clangd 22.1.0 已确认支持的配置。
 * 移除 Preamble/Hover/Completion 等 clangd 22.x 不识别或会报警告的配置。
 *
 * T2.1 / H4-B 决策：fast/slow 模式已合并，CompletionMode 仅剩 slow 字面量。
 * 保留类型别名供内部 API（preparseIncludes、completionMode 等）继续使用，
 * 避免一次性大面积改动函数签名。
 */

export type CompletionMode = 'slow';

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
  PathMatch?: string | string[];
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
  /** 条件块。⚠️ 22.x 不支持 Index 在 If 块中 */
  If?: IfBlock;

  CompileFlags?: {
    Remove?: string[];
    Add?: string[];
    /**
     * 指向 compile_commands.json 所在目录（相对于 .clangd 所在位置）。
     * clangd 22.x 明确要求放在 CompileFlags 内部，不能在根级别。
     */
    CompilationDatabase?: string;
    /** 编译器路径（模板风格，如 D:/scoop/apps/llvm/22.1.8/bin/clang-cl.exe） */
    Compiler?: string;
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
}

/**
 * Phase 7 性能埋点事件
 *
 * 各模块通过 perfLog.record(...) 推送：
 * - event: 事件名（如 'compileCommands.cacheHit'、'preparse.listBuilt'）
 * - elapsedMs: 阶段耗时
 * - timestamp: ISO 时间戳
 * - meta: 附带元数据（hit/miss 标志、文件数等）
 */
export interface PerfEvent {
  event: string;
  elapsedMs: number;
  timestamp: string;
  meta?: Record<string, unknown>;
}

/**
 * 持久化缓存条目：compile_commands.json 生成结果。
 *
 * 写入到 .vscode/clangd-perf-cache/compile-commands-cache.json。
 * 二次激活时若 fingerprint 命中且 ccPath 存在 → 跳过 UBT 子进程调用。
 */
export interface CachedCompileCommands {
  fingerprint: string;
  ccPath: string;
  linkTarget: string;
  savedAt: string;
  fileCount: number;
  /**
   * P1-3: 标记此缓存条目来自 fallback 降级 DB（UBT 失败时生成）。
   * 命中检查时 fallback 条目不走快路径 -> 下次仍重试 UBT（避免永久降级）。
   * UBT 成功后覆盖为 undefined。
   */
  fallback?: boolean;
}

/**
 * 指纹计算结果
 *
 * fingerprint: SHA256 拼接的 64 字符 hex 串
 * files: 参与哈希的文件列表（含元数据，便于诊断）
 * computedMs: 指纹计算耗时（毫秒）
 */
export interface FingerprintResult {
  fingerprint: string;
  files: { path: string; size: number; mtimeMs: number }[];
  computedMs: number;
}

/**
 * 头文件 SHA256 + mtime 缓存条目
 *
 * 仅当 compile_commands 缓存命中（fingerprint 一致）时此缓存生效，
 * 避免 fingerprint 错误时给出过期数据。
 */
export interface HeaderCacheEntry {
  headerPath: string;
  sha256: string;
  mtimeMs: number;
  sizeBytes: number;
  recordedAt: string;
}

/**
 * 性能指标快照（推送给状态栏使用）
 *
 * 任意字段缺失时不更新对应段。
 */
export interface PerfMetricSnapshot {
  genMs?: number;
  hitRate?: number;
  incrMs?: number;
  ts: string;
}
