/**
 * preparseIncludes —— 管理 clangd 的 preparse-include 列表(UE 宏)
 *
 * UE 的 UCLASS / UPROPERTY / UFUNCTION 宏生成隐藏的 .generated.h 文件,
 * clangd 默认看不到。preparse 功能告诉 clangd 把特定头文件当作已包含,
 * 这样这些宏的补全能正常工作。
 *
 * 两种模式:
 *   - fast: 5 个 SharedPCH 头文件,轻量快速
 *   - slow: 同 fast（SharedPCH 已覆盖全部核心模块）,addMacroCompletions.h 提供额外宏补全
 *
 * 列表从 resources/preparse-includes/ue5-{fast,slow}.json 加载,
 * 用户自定义从 Project/.vscode/vscodeuehelper/addCompletions.h 合并。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PerfSession } from './perfLog';
import { perfLog } from './perfLog';
import { CompletionMode, PrepareIncludesList } from './types';

/**
 * Get the bundled preparse list for the given mode. Reads from
 * resources/preparse-includes at runtime — esbuild copies these
 * because of `"files": ["resources/**"]` in package.json.
 */
export async function loadBundledList(mode: CompletionMode): Promise<string[]> {
  const resourcePath = path.join(
    __dirname,
    '..',
    '..',
    'resources',
    'preparse-includes',
    `ue5-${mode}.json`,
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
 * `.vscode/vscodeuehelper/` directory. Any `.h` file there is appended.
 */
export async function mergeUserCustomizations(
  projectPath: string,
  baseList: string[],
): Promise<string[]> {
  const dir = path.join(path.dirname(projectPath), '.vscode', 'vscodeuehelper');
  try {
    const entries = await fs.readdir(dir);
    const headers: string[] = [];
    for (const entry of entries) {
      if (entry.endsWith('.h')) {
        headers.push(path.join(dir, entry));
      }
    }
    return [...baseList, ...headers];
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
export function resolvePreparseHeaders(
  headers: string[],
  engineRoot: string,
): string[] {
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
 * Render a list of headers as a `compile_commands.json` patch entry.
 * Each header becomes a `-include <header>` flag prepended to every
 * compile command. This is the mechanism clangd understands.
 *
 * Returns an array of strings (one per header) ready to splice.
 */
export function toIncludeFlags(headers: string[]): string[] {
  const flags: string[] = [];
  for (const header of headers) {
    flags.push(`-include`, header);
  }
  return flags;
}
