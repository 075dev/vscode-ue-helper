/**
 * dbFile —— `compile_commands.json` 的读写原语（[D14]）
 *
 * ## 为什么单独抽出来
 *
 * 旧实现有**两处**各自 `JSON.parse` 整份文件再 `JSON.stringify(entries, null, 2)`
 * 整体 `writeFile` 覆盖：
 *
 *   - `src/clangd/compileCommands/fillMissing.ts:284`（补全缺失条目）
 *   - `src/clangd/completionFiles.ts:559`（注入 completionHelper 条目）
 *
 * 三个问题：
 *
 *   1. **非原子**：`writeFile` 直接覆盖，中途失败（磁盘满 / 进程被杀）会留下
 *      **半截 JSON** —— clangd 读到坏文件就整个编译数据库失效。
 *   2. **同一次刷新写两遍**：fillMissing 写一次、helper 注入再写一次；
 *      两次之间 clangd 可能读到中间态。
 *   3. **体积膨胀**：`null, 2` 的缩进把几 MB 的 compile_commands.json 放大数倍
 *      （实测常见 3~5 倍），读写都变慢。
 *
 * 本模块提供：
 *   - `readCompileCommands` —— 读 + 解析（失败返回 undefined，不抛）
 *   - `writeCompileCommandsAtomic` —— temp + rename 原子替换 + 紧凑序列化
 *
 * 原子写照抄 `ClangdOps._atomicWrite` 的模式（temp 文件 + rename）。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** compile_commands.json 的单条条目（clangd 的标准形状 + 允许额外字段） */
export interface CompileCommandEntry {
  /** 源文件绝对路径 —— clangd 用它作为 TU 的主键 */
  file: string;
  /** 编译工作目录 */
  directory: string;
  /** 命令行字符串（与 arguments 二选一） */
  command?: string;
  /** 命令行参数数组（clangd 优先用它） */
  arguments?: string[];
  /** 其它字段原样保留 */
  [key: string]: unknown;
}

/**
 * 读取 compile_commands.json。
 *
 * @returns 条目数组；文件不存在 / JSON 非法 / 顶层不是数组 → undefined（不抛）
 */
export async function readCompileCommands(
  jsonPath: string,
): Promise<CompileCommandEntry[] | undefined> {
  let text: string;
  try {
    text = await fs.readFile(jsonPath, 'utf-8');
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as CompileCommandEntry[];
  } catch {
    return undefined;
  }
}

/**
 * 解析 compile_commands.json 的**真实写入目标**。
 *
 * ## 为什么需要它（[MAJOR-2]）
 *
 * helper 目录里的 `compile_commands.json`（clangd 通过
 * `.clangd` 的 `CompilationDatabase: .vscode/vscodeuehelper` 读的就是它）有两种形态：
 *
 * | 形态 | 产生条件 | 写 jsonPath 的后果 |
 * |---|---|---|
 * | **符号链接** | `fs.symlink` 成功（Windows 开了开发者模式） | ✅ 链接指向 jsonPath，写 jsonPath 等于写它 |
 * | **独立副本** | `fs.symlink` 失败 → `linkToWorkspaceRoot` 回退 `fs.copyFile`（**Windows 默认状态**） | ❌ 副本与 jsonPath 各写各的，clangd 读到的是旧内容 |
 *
 * copy 退化时若只写 jsonPath，D1 补齐的条目与注入的 completionHelper 条目
 * **对 clangd 完全不可见**，且全程无任何报错 —— 静默失效。
 *
 * 所以写入前先解析出真实目标：
 * - 是符号链接 → 返回链接指向的文件（原子 rename 替换它，链接仍然有效）
 * - 是普通文件（copy 退化）→ 返回它自己
 *
 * 用 `readlink` 而不是 `realpath`：后者在 Windows 上会返回 `\\?\` 扩展长度前缀路径，
 * 混进后续路径比较会造成误判。
 *
 * @returns 真实写入目标；路径不存在或读取失败时原样返回（调用方按普通文件处理）
 */
export async function resolveCompileCommandsWriteTarget(linkPath: string): Promise<string> {
  try {
    const stat = await fs.lstat(linkPath);
    if (stat.isSymbolicLink()) {
      const raw = await fs.readlink(linkPath);
      return path.isAbsolute(raw) ? raw : path.resolve(path.dirname(linkPath), raw);
    }
  } catch {
    /* 目标不存在 —— 退回原路径，由写入方按普通文件创建 */
  }
  return linkPath;
}

/**
 * 原子写入 compile_commands.json。
 *
 * - 先写同目录下的临时文件，再 `rename` 覆盖目标 —— rename 在同一卷内是原子的，
 *   读者要么看到旧内容要么看到新内容，**不会看到半截 JSON**。
 * - 紧凑序列化（无缩进）：compile_commands.json 常有几 MB，缩进会放大数倍。
 * - rename 失败时清理临时文件并把错误抛给调用方（原文件保持不变）。
 */
export async function writeCompileCommandsAtomic(
  jsonPath: string,
  entries: readonly CompileCommandEntry[],
): Promise<void> {
  const dir = path.dirname(jsonPath);
  const tmp = path.join(dir, `.${path.basename(jsonPath)}.tmp-${process.pid}-${Date.now()}`);
  // 紧凑格式：JSON.stringify(entries, null, 2) 会把体积放大 3~5 倍
  const content = JSON.stringify(entries);
  await fs.writeFile(tmp, content, 'utf-8');
  try {
    await fs.rename(tmp, jsonPath);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      /* ignore —— 临时文件清理失败不影响主流程 */
    }
    throw err;
  }
}
