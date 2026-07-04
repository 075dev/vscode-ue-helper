/**
 * createRspMatchers —— 为 UE 引擎源码创建 rsp 匹配器，支持源码导航
 *
 * 默认情况下 clangd 只能索引项目的 compile_commands.json 中列出的文件。
 * UE 引擎源码（Engine/Source/ 下的 .cpp 文件）不在其中，因此无法导航。
 *
 * 本模块通过扫描项目的 .rsp 文件，从中提取 `-I` 包含路径，
 * 将这些路径匹配到 UE 引擎源码的模块目录，创建映射关系。
 * clangd 利用这些映射为引擎源码文件生成编译上下文。
 *
 * 参考 unreal-clangd (boocs/unreal-clangd v3) 的 src/modules/createRspMatchers.ts。
 *
 * 主要导出：
 *   - startCreateRspMatchers: 扫描 rsp 文件并创建匹配器
 *   - RspMatcher: rsp 匹配器条目类型
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkspaceState } from '@core/workspace';

/**
 * rsp 匹配器条目。
 * 记录一个 rsp 文件与 UE 引擎源码模块目录的映射。
 */
export interface RspMatcher {
  /** rsp 文件相对于项目根目录的路径 */
  rspRelative: string;
  /** UE 引擎源码模块目录相对于 Engine/Source 的路径 */
  ueDirRelative: string;
}

/**
 * 扫描项目的 .rsp 文件，为 UE 引擎源码创建匹配器。
 *
 * 算法：
 *   1. 找到 rsp 文件目录（.vscode/<项目名>/）
 *   2. 对每个 rsp 文件：
 *      a. 提取所有 `-I "..."` 包含路径
 *      b. 过滤掉 Intermediate 目录下的路径
 *      c. 对剩余路径，尝试匹配 UE 引擎的模块目录
 *   3. 返回所有成功的匹配器
 *
 * @param projectPath .uproject 文件的绝对路径
 * @param enginePath UE 引擎根目录的绝对路径
 * @param logger 可选的日志记录器
 * @returns rsp 匹配器数组
 */
export async function startCreateRspMatchers(
  projectPath: string,
  enginePath: string,
  logger?: { info: (msg: string) => void; warn: (msg: string) => void },
  workspace?: WorkspaceState,
): Promise<RspMatcher[]> {
  const projectDir = workspace?.projectDir ?? path.dirname(projectPath);

  // 步骤 1：找到 rsp 目录
  const rspDir = await findRspDirForMatchers(projectDir);
  if (!rspDir) {
    logger?.warn('[createRspMatchers] 未找到 rsp 目录');
    return [];
  }

  // 步骤 2：列出所有 .rsp 文件
  let rspNames: string[];
  try {
    const all = await fs.readdir(rspDir);
    rspNames = all.filter((n) => n.endsWith('.rsp'));
  } catch {
    return [];
  }

  if (rspNames.length === 0) {return [];}

  // 步骤 3：获取 UE 引擎源码的模块目录列表，用于匹配
  const engineSourceDir = path.join(enginePath, 'Engine', 'Source');
  const moduleCandidates = await getEngineModuleCandidates(engineSourceDir, logger);

  if (moduleCandidates.length === 0) {
    logger?.warn('[createRspMatchers] 无法列出引擎源码模块目录');
    return [];
  }

  // 步骤 4：匹配每个 rsp 文件
  const results: RspMatcher[] = [];

  for (const rspName of rspNames) {
    const rspPath = path.join(rspDir, rspName);
    try {
      const content = await fs.readFile(rspPath, 'utf-8');
      const matched = matchRspToEngineModule(
        rspName,
        rspPath,
        content,
        moduleCandidates,
        engineSourceDir,
        projectDir,
      );
      if (matched) {
        results.push(matched);
      }
    } catch {
      // 读取失败，跳过
    }
  }

  logger?.info(
    `[createRspMatchers] 完成: ${results.length} 个匹配器已创建 / ${rspNames.length} 个 rsp 文件`,
  );
  return results;
}

// ---- 内部函数 ----

/**
 * 查找 rsp 文件所在目录。
 */
async function findRspDirForMatchers(projectDir: string): Promise<string | null> {
  const vscodeDir = path.join(projectDir, '.vscode');
  try {
    const entries = await fs.readdir(vscodeDir);
    for (const name of entries) {
      const candidate = path.join(vscodeDir, name);
      try {
        const stat = await fs.stat(candidate);
        if (!stat.isDirectory()) {continue;}
        const subEntries = await fs.readdir(candidate);
        if (subEntries.some((e) => e.endsWith('.rsp'))) {
          return candidate;
        }
      } catch {
        // 跳过
      }
    }
  } catch {
    // .vscode 不存在
  }
  return null;
}

/**
 * 模块候选信息。
 */
interface ModuleCandidate {
  name: string;
  source: string;
}

/**
 * 获取 UE 引擎源码的模块目录列表。
 * 扫描 Engine/Source/Runtime/、Engine/Source/Editor/、Engine/Source/Developer/ 等。
 */
async function getEngineModuleCandidates(
  engineSourceDir: string,
  _logger?: { warn: (msg: string) => void },
): Promise<ModuleCandidate[]> {
  const candidates: ModuleCandidate[] = [];

  // 主要源码分类目录
  const categories = ['Runtime', 'Editor', 'Developer', 'Programs', 'ThirdParty'];

  for (const cat of categories) {
    const catDir = path.join(engineSourceDir, cat);
    try {
      const entries = await fs.readdir(catDir);
      for (const entry of entries) {
        const modDir = path.join(catDir, entry);
        try {
          const stat = await fs.stat(modDir);
          if (stat.isDirectory()) {
            candidates.push({ name: entry, source: cat });
          }
        } catch {
          // 跳过
        }
      }
    } catch {
      // 分类目录不存在
    }
  }

  return candidates;
}

/**
 * 尝试将一个 rsp 文件匹配到引擎模块。
 *
 * 从 rsp 内容中提取所有 `-I "..."` 路径，
 * 去掉 Intermediate 下的路径（构建中间产物），
 * 将剩余路径与引擎模块目录名匹配。
 */
function matchRspToEngineModule(
  _rspName: string,
  rspPath: string,
  content: string,
  moduleCandidates: ModuleCandidate[],
  engineSourceDir: string,
  projectDir: string,
): RspMatcher | null {
  // 提取所有 -I 路径：-I "path" 或 -I"path"
  const includeRe = /-I\s*"([^"]+)"/gi;
  const includePaths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = includeRe.exec(content)) !== null) {
    includePaths.push(match[1] ?? '');
  }

  if (includePaths.length === 0) {return null;}

  // 去掉 Intermediate 路径
  const filtered = includePaths.filter(
    (p) => !/[\\/]Intermediate[\\/]/i.test(p),
  );

  // 对每个候选模块，检查是否有匹配的 include 路径
  for (const candidate of moduleCandidates) {
    for (const incPath of filtered) {
      // 规范化路径分隔符
      const normalized = incPath.replace(/\//g, path.sep);

      // 匹配策略：
      //   路径以 candidate.name 结尾，
      //   且路径在 engineSourceDir 下
      if (
        normalized.endsWith(candidate.name) ||
        normalized.endsWith(candidate.name + path.sep)
      ) {
        if (normalized.includes(engineSourceDir)) {
          const ueDirRelative = path.relative(engineSourceDir, normalized);
          // 确保不在项目目录外且不是绝对路径
          if (
            !ueDirRelative.startsWith('..') &&
            !path.isAbsolute(ueDirRelative)
          ) {
            return {
              rspRelative: path.relative(projectDir, rspPath),
              ueDirRelative,
            };
          }
        }
      }
    }
  }

  return null;
}
