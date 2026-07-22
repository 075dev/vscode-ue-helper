/**
 * preparseIncludes —— 管理 clangd 的 preparse-include 列表(UE 宏)
 *
 * UE 的 UCLASS / UPROPERTY / UFUNCTION 宏生成隐藏的 .generated.h 文件,
 * clangd 默认看不到。preparse 功能告诉 clangd 把特定头文件当作已包含,
 * 这样这些宏的补全能正常工作。
 *
 * T2.1 / H4-B 重构后：fast/slow 模式已合并，仅保留 slow 模式。
 * 列表从 resources/preparse-includes/ue5-slow.json 加载（ue5-fast.json 已删除）,
 * 用户自定义从 Project/.vscode/vscodeuehelper/addCompletions.h 合并。
 *
 * 兼容性：
 *   - 旧 API 签名 `mode: CompletionMode` 参数保留，但参数值被忽略（统一走 slow）。
 *   - CompletionMode 类型已收敛为 `'slow'` 字面量。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkspaceState } from '@core/workspace';
import type { PerfSession } from './perfLog';
import { perfLog } from './perfLog';
import type { CompletionMode, PrepareIncludesList } from './types';

/**
 * Get the bundled preparse list. Reads from
 * resources/preparse-includes at runtime — esbuild copies these
 * because of `"files": ["resources/**"]` in package.json.
 *
 * Plan B 重构后 fast/slow 模式已合并：两个 JSON 内容相同，统一读取 ue5-slow.json。
 * 参数 `_mode` 保留仅为兼容现有调用点签名（不破坏 getPrepareIncludesList
 * 的接口契约）；实际始终返回 slow 列表（即全部 SharedPCH 头）。
 */
export async function loadBundledList(_mode: CompletionMode): Promise<string[]> {
  const resourcePath = path.join(
    __dirname,
    '..',
    '..',
    'resources',
    'preparse-includes',
    'ue5-slow.json',
  );
  try {
    const text = await fs.readFile(resourcePath, 'utf-8');
    const parsed = JSON.parse(text) as PrepareIncludesList;
    return parsed.headers ?? [];
  } catch {
    return [];
  }
}

/**
 * Merge in user customizations from the project's
 * `.vscode/vscodeuehelper/` directory.
 *
 * 仅 `addMacroCompletions.h` 通过自动扫描加入 preparse 列表。
 *
 * 排除扩展生成的其他 header 是必要的——它们要么已经被其他机制包含（避免重复），
 * 要么被设计为仅在 `completionHelper.cpp` 这一个 TU 中加载（避免污染所有 .cpp）。
 *
 * 关键风险（已观察到）：若把 `addCompletions.h` 加入 preparse，会通过 `-include`
 * 强制注入到所有 .cpp TU 前。clangd 此时把它视为第二个 source，触发 driver
 * 警告 `drv_out_file_argument_with_multiple_sources`；同时 UE 的
 * `UE_DEFINE_GAMEPLAY_TAG` 宏在被强制包含的 .h 中展开时 `__FILE__` 指向
 * `addCompletions.h`，触发 `static_assert(HasFileExtension(__FILE__), "must be .cpp")`。
 *
 * 修复：`toIncludeFlags` 在 Windows 下改用 `/FI` 而非 `-include`，
 * MSVC 原生强制 include 不被 driver 视为 source，避免与 `/Fo` 多输入校验冲突。
 *
 * Phase 8：[可选] 接受 workspace 注入以使用 workspace.clangdHelperDir 派生路径。
 *           不传时降级到 projectPath + path.dirname（向后兼容）。
 *
 * @see FILENAME_ADD_MACRO_COMPLETIONS in completionFiles.ts
 */
export async function mergeUserCustomizations(
  projectPath: string,
  baseList: string[],
  workspace?: WorkspaceState,
): Promise<string[]> {
  const dir =
    workspace?.clangdHelperDir ?? path.join(path.dirname(projectPath), '.vscode', 'vscodeuehelper');
  const macroFile = path.join(dir, 'addMacroCompletions.h');
  try {
    await fs.access(macroFile);
    return [...baseList, macroFile];
  } catch {
    return baseList;
  }
}

/**
 * Build the final preparse list for the given mode and project.
 * User customizations are appended at the end so they take precedence.
 *
 * 第三个可选参数 options 用于 Phase 7 性能埋点（D-03 / D-13）：
 *   - perfSession: 注入 perfLog，触发 preparse.listBuilt 事件 + hit/miss 计数
 *
 * 默认 undefined → 不做埋点，向后兼容现有调用点。
 */
export async function getPrepareIncludesList(
  mode: CompletionMode,
  projectPath: string,
  options?: { perfSession?: PerfSession },
): Promise<string[]> {
  const base = await loadBundledList(mode);
  const merged = await mergeUserCustomizations(projectPath, base);
  const userCount = merged.length - base.length;

  // Phase 7 性能埋点：仅在显式注入 perfSession 时触发
  // 未注入时回落到 perfLog 单例，保证 hit/miss 统计不断
  const session = options?.perfSession ?? perfLog;
  session.recordPreparseResult(mode, base.length, userCount);

  return merged;
}

/**
 * Phase 7 全局 preparse 统计（per D-13 数据通路）
 *
 * 返回 perfLog 单例的 hit/miss 累加值：
 *   - hit: 至少命中基础列表的次数（baseCount > 0）
 *   - miss: 基础列表为空的次数（一般代表打包 JSON 缺失）
 *   - hitRate: hit / total（无事件时为 0）
 */
export function getPreparseStats(): { hit: number; miss: number; hitRate: number } {
  const r = perfLog.getPreparseHitRate();
  return { hit: r.hits, miss: r.misses, hitRate: r.rate };
}

/**
 * 解析 header 列表中的 $(EngineRoot) 占位符。
 *
 * 将 $(EngineRoot) 替换为实际引擎根路径（统一使用正斜杠）。
 * engineRoot 缺失时，含未解析占位符的 header 会被过滤掉，
 * 避免 clangd 收到无效路径。
 *
 * @param headers - 可能包含 $(EngineRoot) 占位符的 header 路径列表
 * @param engineRoot - 引擎根目录的绝对路径
 * @returns 解析后的有效路径列表（含占位符且无法解析的会被过滤）
 */
export function resolvePreparseHeaders(headers: string[], engineRoot: string): string[] {
  if (headers.length === 0) {
    return [];
  }

  if (!engineRoot) {
    // engineRoot 缺失：仅保留不含占位符的绝对/相对路径
    return headers.filter((h) => !h.includes('$(EngineRoot)'));
  }

  // 统一为正斜杠（Windows 兼容）
  const normalizedRoot = engineRoot.replace(/\\/g, '/');
  return headers.map((h) => h.replace(/\$\(EngineRoot\)/g, normalizedRoot));
}

/**
 * Render a list of headers as clangd `.clangd` Add flags.
 * Each header becomes a forced-include flag prepended to every compile command.
 *
 * Returns an array of strings (one per header on Windows) ready to splice.
 *
 * Windows / clang-cl: use MSVC-style `/FI<path>` (single token), because:
 *   - `-include <path>` is GCC-style and makes clang-cl treat the header as
 *     a second input source, conflicting with `/Fo` when the entry's rsp
 *     already specifies a single `.cpp` input. Symptom:
 *     "Cannot specify '/Fo…obj' when compiling multiple source files".
 *   - `/FI` is the MSVC-native forced-include flag and is intentionally
 *     compatible with `/Fo` (designed to be a header, not a source).
 *
 * Non-Windows: keep `-include <path>` (GCC-style, clang-native).
 */
export function toIncludeFlags(headers: string[]): string[] {
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    return headers.map((h) => `/FI${h}`);
  }
  const flags: string[] = [];
  for (const header of headers) {
    flags.push(`-include`, header);
  }
  return flags;
}
