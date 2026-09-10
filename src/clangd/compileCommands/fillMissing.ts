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
 *   - `fillMissingCompileCommands`：读 JSON → 扫描 → 规范化集合相减 → 模板克隆 → 写回
 *
 * 不变量：
 *   - 不依赖 `vscode` / 主文件（单向依赖 `@core/logger` / `@core/workspace` + node fs/path）
 *   - 不反向导入 `@clangd/compileCommands`、不导入 `@clangd/fingerprint`、不创建
 *     `compileCommands/fingerprint.ts`（避免与既有的 `src/clangd/fingerprint.ts` 职责重复）
 *   - 4 个 helper 保持 module-private，仅导出 `fillMissingCompileCommands` 与 `FillResult`
 *     类型；公共 `@clangd/compileCommands` 主入口继续 re-export 让 caller 零感知
 *   - 扫描范围限定为项目 `Source` 与 `Plugins/<PluginName>/Source`；不扫描 Engine/Intermediate/
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';

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
  entries: { file: string; directory: string; command?: string; arguments?: string[] }[],
  sourceRoots: string[],
  projectDir: string,
): { file: string; directory: string; command?: string; arguments?: string[] } | undefined {
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
  let entries: { file: string; directory: string; command?: string; arguments?: string[] }[];
  try {
    const content = await fs.readFile(jsonPath, 'utf-8');
    entries = JSON.parse(content) as {
      file: string;
      directory: string;
      command?: string;
      arguments?: string[];
    }[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.error(`[fillMissingCompileCommands] failed to read existing JSON: ${msg}`);
    return undefined;
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    logger?.warn(
      '[fillMissingCompileCommands] existing JSON is empty or not an array, skip filling',
    );
    return undefined;
  }

  // 2. 构建规范化（大小写不敏感）的已存在文件集合
  const existingFileKeys = new Set(entries.map((e) => normalizeComparableKey(e.file)));
  logger?.info(`[fillMissingCompileCommands] existing entries: ${existingFileKeys.size}`);

  // 3. 发现源码根目录
  const sourceRoots = await discoverSourceRoots(projectDir, logger);
  logger?.info(`[fillMissingCompileCommands] source roots: ${JSON.stringify(sourceRoots)}`);

  // 4. 递归扫描所有源码根目录
  const allSourceFiles: string[] = [];
  for (const root of sourceRoots) {
    const files = await scanDirRecursive(root, logger);
    allSourceFiles.push(...files);
  }
  logger?.info(
    `[fillMissingCompileCommands] found ${allSourceFiles.length} source files across ${sourceRoots.length} roots`,
  );

  // 5. 找出缺失的文件（用规范化键比较）
  const missingFiles = allSourceFiles.filter(
    (f) => !existingFileKeys.has(normalizeComparableKey(f)),
  );
  logger?.info(`[fillMissingCompileCommands] missing entries: ${missingFiles.length}`);

  if (missingFiles.length === 0) {
    logger?.info('[fillMissingCompileCommands] all files already have entries, nothing to do');
    return {
      roots: sourceRoots,
      scanned: allSourceFiles.length,
      missing: [],
      added: [],
    };
  }

  // 6. 为每个缺失文件找到模板并创建新条目
  const added: string[] = [];
  for (const missingFile of missingFiles) {
    const templateEntry = findNearestTemplate(missingFile, entries, sourceRoots, projectDir);
    if (!templateEntry) {
      logger?.warn(
        `[fillMissingCompileCommands] no suitable template for: ${missingFile}, skipping`,
      );
      continue;
    }

    const newEntry = {
      ...templateEntry,
      file: missingFile,
    };
    entries.push(newEntry);
    added.push(missingFile);
    logger?.debug(`[fillMissingCompileCommands] added entry for: ${missingFile}`);
  }

  if (added.length === 0) {
    const reason = 'no suitable project/plugin .cpp template found for any missing file';
    logger?.warn(`[fillMissingCompileCommands] ${reason}`);
    return {
      roots: sourceRoots,
      scanned: allSourceFiles.length,
      missing: missingFiles,
      added: [],
      skippedReason: reason,
    };
  }

  // 7. 写回文件
  try {
    await fs.writeFile(jsonPath, JSON.stringify(entries, null, 2), 'utf-8');
    logger?.info(
      `[fillMissingCompileCommands] SUCCESS: added ${added.length} entries, total now ${entries.length}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.error(`[fillMissingCompileCommands] failed to write JSON: ${msg}`);
  }

  return {
    roots: sourceRoots,
    scanned: allSourceFiles.length,
    missing: missingFiles,
    added,
  };
}
