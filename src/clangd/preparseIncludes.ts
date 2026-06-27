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
 */
export async function getPrepareIncludesList(
  mode: CompletionMode,
  projectPath: string,
): Promise<string[]> {
  const base = await loadBundledList(mode);
  return mergeUserCustomizations(projectPath, base);
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
