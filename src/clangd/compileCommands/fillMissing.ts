/**
 * fillMissing —— compileCommands 的「补全缺失条目」子模块（per Phase 3.4）
 *
 * 把 `fillMissingCompileCommands` 及其四个私有 helper 从主入口 1:1 迁出，专注本地源码扫描
 * 与 compile_commands.json 增量补全：
 *   - `normalizeComparableKey`：统一正斜杠 + 小写（Windows 大小写不敏感）
 *   - `discoverSourceRoots`：项目 `Source/` + `Plugins/<PluginName>/Source/`
 *   - `scanDirRecursive`：递归扫描 `.cpp`/`.c`（**实测只匹配这两个扩展名，header 历史
 *     注释与现状不符，提取必须保留实测行为**）
 *   - `findNearestTemplate`：同 root .cpp 优先 → 项目 .cpp 回退
 *   - `computeMissingEntries`：算补齐后的条目数组（**不写盘**）
 *   - `fillMissingCompileCommands`：读 + 算 + 原子写（向后兼容的独立入口）
 *
 * ## [D1] 克隆条目必须同步改命令串
 *
 * 旧实现只改 `file` 字段，`command` / `arguments` 照抄模板：
 *
 *   { ...templateEntry, file: missingFile }
 *
 * clangd 的 TU 主文件取自**命令行参数** —— 于是新文件的内容被挂在模板文件的
 * 路径上：clangd 打开 missingFile 时用的是**模板文件**的编译参数，所有
 * #include 解析、宏定义、宏开关全部错位，诊断结果完全不对。
 *
 * 现在克隆时同步替换命令串里的源文件参数：
 *   - 有 `arguments` 数组 → 替换源文件所在的那一项（约定为末元素）
 *   - 只有 `command` 字符串 → 定位并替换模板的源文件路径；替换不到就退回到
 *     「只保留 flag、丢弃文件参数」，**宁可缺条目也不产生错条目**
 *
 * ## [D14] 原子写 + 计算/写盘分离
 *
 * 写盘改用 `writeCompileCommandsAtomic`（temp + rename）。旧实现直接
 * `writeFile` 覆盖，中途失败会留下**半截 JSON** —— clangd 读到坏文件就整个
 * 编译数据库失效。序列化同时改成紧凑格式（`null, 2` 会把几 MB 的文件放大数倍）。
 *
 * 不变量：
 *   - 不依赖 `vscode` / 主文件（单向依赖 `@core/logger` / `@core/workspace` + node fs/path）
 *   - 不反向导入 `@clangd/compileCommands`、不导入 `@clangd/fingerprint`、不创建
 *     `compileCommands/fingerprint.ts`（避免与既有的 `src/clangd/fingerprint.ts` 职责重复）
 *   - helper 保持 module-private，仅导出 `fillMissingCompileCommands` / `FillResult`
 *     / `computeMissingEntries`；公共 `@clangd/compileCommands` 主入口继续 re-export
 *   - 扫描范围限定为项目 `Source` 与 `Plugins/<PluginName>/Source`；不扫描 Engine/Intermediate/
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
// [D14] DB 读写原语（原子写 + 紧凑序列化）
import {
  readCompileCommands,
  writeCompileCommandsAtomic,
  resolveCompileCommandsWriteTarget,
  type CompileCommandEntry,
} from '@clangd/compileCommands/dbFile';

/**
 * fillMissingCompileCommands 的结构化返回结果
 */
export interface FillResult {
  /** 扫描的源码根目录列表（项目 Source + Plugins/PluginName/Source） */
  roots: string[];
  /** 扫描到的源文件总数 */
  scanned: number;
  /** 缺失条目的文件路径列表 */
  missing: string[];
  /** 实际添加的文件路径列表 */
  added: string[];
  /** 跳过原因（无模板等），成功时为 undefined */
  skippedReason?: string;
}

/** 内部使用的条目形状 */
type Entry = CompileCommandEntry;

/**
 * 规范化路径为可比较的键：
 * - 统一为正斜杠
 * - 转小写（Windows 大小写不敏感）
 */
function normalizeComparableKey(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/').toLowerCase();
}

/**
 * 发现项目源码根目录：
 * - 项目根下的 Source/
 * - 项目根下 Plugins/<PluginName>/Source/（每个插件直接子目录）
 *
 * 不会扫描 Engine/Plugins、Intermediate、Binaries、Saved、.vs、.git。
 */
async function discoverSourceRoots(projectDir: string, logger?: Logger): Promise<string[]> {
  const roots: string[] = [];

  // 项目 Source
  const projectSource = path.join(projectDir, 'Source');
  roots.push(projectSource);

  // Plugins/*/Source
  const pluginsDir = path.join(projectDir, 'Plugins');
  try {
    const pluginEntries = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const entry of pluginEntries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const pluginSource = path.join(pluginsDir, entry.name, 'Source');
        try {
          const stat = await fs.stat(pluginSource);
          if (stat.isDirectory()) {
            roots.push(pluginSource);
            logger?.debug(
              `[fillMissingCompileCommands] discovered plugin source root: ${pluginSource}`,
            );
          }
        } catch {
          // 插件没有 Source 目录，跳过
        }
      }
    }
  } catch {
    // Plugins 目录不存在或不可读，跳过
    logger?.warn(
      '[fillMissingCompileCommands] Plugins directory not found or not readable, skipping plugin source discovery',
    );
  }

  return roots;
}

/**
 * 递归扫描目录下所有源文件（.cpp/.h/.hpp/.c）
 */
async function scanDirRecursive(dir: string, logger?: Logger): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await scanDirRecursive(fullPath, logger);
        files.push(...subFiles);
      } else if (entry.isFile() && /\.(cpp|c)$/i.test(entry.name)) {
        files.push(path.normalize(fullPath));
      }
    }
  } catch (err) {
    logger?.warn(
      `[fillMissingCompileCommands] scan failed for ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return files;
}

/**
 * 为缺失文件选择最近的模板条目。
 *
 * 策略：
 * 1. 从与缺失文件同 source root 的 .cpp 条目中找模板
 * 2. 如果找不到，回退到项目 Source 的 .cpp 条目
 * 3. 如果还找不到，返回 undefined
 */
function findNearestTemplate(
  missingFile: string,
  entries: Entry[],
  sourceRoots: string[],
  projectDir: string,
): Entry | undefined {
  const missingKey = normalizeComparableKey(missingFile);

  // 找出缺失文件所属的 source root
  const missingRoot = sourceRoots.find((root) => {
    const rootKey = normalizeComparableKey(root);
    return (
      missingKey.startsWith(rootKey + '/') ||
      missingKey.startsWith(rootKey.replace(/\\/g, '/').toLowerCase() + '/')
    );
  });

  // 优先从同 root 的 .cpp 条目中找模板
  if (missingRoot) {
    const sameRootEntry = entries.find((e) => {
      const eKey = normalizeComparableKey(e.file);
      const rootKey = normalizeComparableKey(missingRoot);
      return eKey.startsWith(rootKey + '/') && eKey.endsWith('.cpp');
    });
    if (sameRootEntry) {
      return sameRootEntry;
    }
  }

  // 回退：项目中的任意 .cpp 条目
  const projectKey = normalizeComparableKey(projectDir);
  const fallbackEntry = entries.find((e) => {
    const eKey = normalizeComparableKey(e.file);
    return eKey.startsWith(projectKey + '/') && eKey.endsWith('.cpp');
  });

  return fallbackEntry;
}

/**
 * [D1] 在命令串里定位并替换源文件路径。
 *
 * @returns 替换后的命令串；定位不到源文件 → undefined
 */
function replaceSourceInCommand(
  command: string,
  oldFile: string,
  newFile: string,
): string | undefined {
  if (!oldFile) {
    return undefined;
  }
  const variants = [oldFile, oldFile.replace(/\\/g, '/'), oldFile.replace(/\//g, '\\')];
  for (const variant of variants) {
    const idx = command.indexOf(variant);
    if (idx >= 0) {
      return command.slice(0, idx) + newFile + command.slice(idx + variant.length);
    }
  }
  return undefined;
}

/**
 * [D1] 退化路径：从命令串里**丢掉**源文件参数，只保留 flag。
 *
 * 用于「命令串里定位不到模板源文件」的情况 —— 与其产出一个指向模板文件的
 * 错条目，不如产出一个只有 flag 的条目（clangd 至少拿到正确的编译选项）。
 *
 * 两种做法：
 *   1. 命令串里能找到源文件路径 → 去掉那一个 token（含引号）
 *   2. 找不到 → 丢掉**末位** token（编译命令的约定：源文件在最后）
 *
 * @returns 去掉源文件后的命令串；去掉后为空 → undefined
 */
function stripSourceFromCommand(command: string, oldFile: string): string | undefined {
  const variants = [oldFile, oldFile.replace(/\\/g, '/'), oldFile.replace(/\//g, '\\')];
  for (const variant of variants) {
    const idx = command.indexOf(variant);
    if (idx < 0) {
      continue;
    }
    let start = idx;
    let end = idx + variant.length;
    // 连同紧邻的引号一起去掉
    if (start > 0 && command[start - 1] === '"') {
      start -= 1;
    }
    if (end < command.length && command[end] === '"') {
      end += 1;
    }
    const stripped = `${command.slice(0, start)} ${command.slice(end)}`
      .replace(/\s+/g, ' ')
      .trim();
    return stripped.length > 0 ? stripped : undefined;
  }

  // 定位不到 → 丢掉末位 token（编译命令约定：源文件在最后）
  const trimmed = command.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace <= 0) {
    return undefined;
  }
  const stripped = trimmed.slice(0, lastSpace).trim();
  return stripped.length > 0 ? stripped : undefined;
}

/**
 * [D1] 把模板条目克隆成「缺失文件」的条目 —— 命令串里的源文件参数必须同步替换。
 *
 * @returns 克隆出的条目；模板既无 arguments 也无 command（或退化后为空）→ undefined
 *          （宁可不加条目，也不产生错条目）
 */
function cloneEntryForFile(template: Entry, missingFile: string): Entry | undefined {
  const clone: Entry = { ...template, file: missingFile };

  const args = template.arguments;
  if (Array.isArray(args) && args.length > 0) {
    const next = [...args];
    const templateKey = normalizeComparableKey(template.file);
    // 源文件通常在末元素；先精确定位，定位不到再退回末元素（clangd 的约定）
    let targetIndex = next.findIndex(
      (a) => typeof a === 'string' && normalizeComparableKey(a) === templateKey,
    );
    if (targetIndex < 0) {
      targetIndex = next.length - 1;
    }
    next[targetIndex] = missingFile;
    clone.arguments = next;

    // command 若存在也不能再指向模板文件（部分工具读 command）
    if (typeof template.command === 'string') {
      const replaced = replaceSourceInCommand(template.command, template.file, missingFile);
      if (replaced !== undefined) {
        clone.command = replaced;
      } else {
        delete clone.command;
      }
    }
    return clone;
  }

  if (typeof template.command === 'string') {
    const replaced = replaceSourceInCommand(template.command, template.file, missingFile);
    if (replaced !== undefined) {
      clone.command = replaced;
      return clone;
    }
    // 定位不到源文件 → 退回到「只保留 flag、丢弃文件参数」
    const stripped = stripSourceFromCommand(template.command, template.file);
    if (!stripped) {
      return undefined;
    }
    clone.command = stripped;
    return clone;
  }

  // 模板既没有 arguments 也没有 command → 无法构造可用的编译命令
  return undefined;
}

/**
 * [D14] 计算补齐后的条目数组 —— **不写盘**。
 *
 * 拆出来是为了让调用方把「补齐缺失条目」与「注入 completionHelper 条目」
 * 合并成**一次**原子写（同一次刷新里原来写两遍）。
 *
 * @param entries - 现有条目数组（调用方负责读取）
 * @returns 补齐后的条目数组 + 结构化结果
 */
export async function computeMissingEntries(
  entries: Entry[],
  projectPath: string,
  logger?: Logger,
  workspace?: WorkspaceState,
): Promise<{ result: FillResult; entries: Entry[] }> {
  const projectDir = workspace?.projectDir ?? path.dirname(projectPath);

  // 1. 构建规范化（大小写不敏感）的已存在文件集合
  const existingFileKeys = new Set(entries.map((e) => normalizeComparableKey(e.file)));
  logger?.info(`[fillMissingCompileCommands] existing entries: ${existingFileKeys.size}`);

  // 2. 发现源码根目录
  const sourceRoots = await discoverSourceRoots(projectDir, logger);
  logger?.info(`[fillMissingCompileCommands] source roots: ${JSON.stringify(sourceRoots)}`);

  // 3. 递归扫描所有源码根目录
  const allSourceFiles: string[] = [];
  for (const root of sourceRoots) {
    const files = await scanDirRecursive(root, logger);
    allSourceFiles.push(...files);
  }
  logger?.info(
    `[fillMissingCompileCommands] found ${allSourceFiles.length} source files across ${sourceRoots.length} roots`,
  );

  // 4. 找出缺失的文件（用规范化键比较）
  const missingFiles = allSourceFiles.filter(
    (f) => !existingFileKeys.has(normalizeComparableKey(f)),
  );
  logger?.info(`[fillMissingCompileCommands] missing entries: ${missingFiles.length}`);

  if (missingFiles.length === 0) {
    logger?.info('[fillMissingCompileCommands] all files already have entries, nothing to do');
    return {
      result: { roots: sourceRoots, scanned: allSourceFiles.length, missing: [], added: [] },
      entries,
    };
  }

  // 5. 为每个缺失文件找到模板并创建新条目
  const next = [...entries];
  const added: string[] = [];
  for (const missingFile of missingFiles) {
    const templateEntry = findNearestTemplate(missingFile, next, sourceRoots, projectDir);
    if (!templateEntry) {
      logger?.warn(
        `[fillMissingCompileCommands] no suitable template for: ${missingFile}, skipping`,
      );
      continue;
    }

    // [D1] 克隆时同步替换命令串里的源文件参数
    const newEntry = cloneEntryForFile(templateEntry, missingFile);
    if (!newEntry) {
      logger?.warn(
        `[fillMissingCompileCommands] template command has no usable source argument for: ${missingFile}, skipping`,
      );
      continue;
    }

    next.push(newEntry);
    added.push(missingFile);
    logger?.debug(`[fillMissingCompileCommands] added entry for: ${missingFile}`);
  }

  if (added.length === 0) {
    const reason = 'no suitable project/plugin .cpp template found for any missing file';
    logger?.warn(`[fillMissingCompileCommands] ${reason}`);
    return {
      result: {
        roots: sourceRoots,
        scanned: allSourceFiles.length,
        missing: missingFiles,
        added: [],
        skippedReason: reason,
      },
      entries: next,
    };
  }

  return {
    result: {
      roots: sourceRoots,
      scanned: allSourceFiles.length,
      missing: missingFiles,
      added,
    },
    entries: next,
  };
}

/**
 * 扫描项目 Source 和 Plugins/PluginName/Source 目录下所有的 .cpp 和 .h 文件，
 * 对于不在 compile_commands.json 中的文件，从已有条目中复制一个作为模板。
 *
 * **为什么需要这个？**
 * UBT 生成的 compile_commands.json 只包含实际被编译的文件。
 * 新创建的文件、被条件编译排除的文件、以及头文件不会有条目，
 * 导致 clangd 无法获取正确的编译 flag，只能使用 .clangd 中的简化配置。
 *
 * **效果：**
 * - 所有源文件都有完整的 UE 头文件路径
 * - clangd 可以正确解析所有文件，定义跳转正常工作
 * - 新创建的文件无需重新生成 compile_commands.json
 *
 * [D14] 写盘走 `writeCompileCommandsAtomic`（temp + rename 原子替换 + 紧凑序列化）。
 *
 * @returns 结构化结果 FillResult，包含 roots/scanned/missing/added/skippedReason
 */
export async function fillMissingCompileCommands(
  jsonPath: string,
  projectPath: string,
  logger?: Logger,
  workspace?: WorkspaceState,
): Promise<FillResult | undefined> {
  const projectDir = workspace?.projectDir ?? path.dirname(projectPath);

  logger?.info(`[fillMissingCompileCommands] ENTRY jsonPath=${jsonPath}, projectDir=${projectDir}`);

  // 1. 读取现有的 compile_commands.json
  const entries = await readCompileCommands(jsonPath);
  if (!entries) {
    logger?.error('[fillMissingCompileCommands] failed to read existing JSON');
    return undefined;
  }

  if (entries.length === 0) {
    logger?.warn(
      '[fillMissingCompileCommands] existing JSON is empty or not an array, skip filling',
    );
    return undefined;
  }

  const { result, entries: next } = await computeMissingEntries(
    entries,
    projectPath,
    logger,
    workspace,
  );

  // 2. 原子写回（仅在真的补出了条目时写）
  if (result.added.length > 0) {
    try {
      // [MAJOR-2] 写入**真实目标** —— 调用方传进来的可能是 helper 目录里的
      // 符号链接（指向项目本地副本），也可能是 symlink 失败后的独立副本。
      //   · 符号链接 → 解析到它指向的文件；原子 rename 替换目标文件，链接保持有效
      //     （直接 rename 覆盖链接路径会把符号链接换成普通文件，之后两边就分叉了）
      //   · 独立副本 → 就是它自己，clangd 直接读它
      const writeTarget = await resolveCompileCommandsWriteTarget(jsonPath);
      await writeCompileCommandsAtomic(writeTarget, next);
      logger?.info(
        `[fillMissingCompileCommands] SUCCESS: added ${result.added.length} entries, total now ${next.length}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger?.error(`[fillMissingCompileCommands] failed to write JSON: ${msg}`);
    }
  }

  return result;
}
