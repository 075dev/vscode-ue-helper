/**
 * workspaceFolders —— 项目 + 引擎路径的单一信息源
 *
 * .code-workspace 的 folders[] 是权威数据源。约定:
 *   - folders[0] 是项目(其 name 与 .uproject 文件名一致)
 *   - folders[1] 是引擎(其 path 指向 UE 安装根目录)
 *
 * 我们不做文件系统扫描去"发现"任何东西,只信任声明的路径。
 * 如果声明的路径里没有期望的文件(.uproject 或 Build.version),
 * detection 层会 log error,把问题暴露给 UI。
 *
 * 主要导出:
 *   - readWorkspaceEntries: 读 .code-workspace 返回 [{name, path}]
 *   - readWorkspaceFolders: 只返回路径数组(兼容旧 API)
 *   - readBuildVersion: 解析 Build.version 返回 5.8.0 字符串
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface WorkspaceFolder {
  path: string;
  name?: string;
}

interface WorkspaceFile {
  folders?: WorkspaceFolder[];
}

export async function readWorkspaceFolders(workspaceFile: string): Promise<string[]> {
  try {
    const text = await fs.readFile(workspaceFile, 'utf-8');
    const parsed = JSON.parse(text) as WorkspaceFile;
    if (!Array.isArray(parsed.folders)) return [];
    const workspaceRoot = path.dirname(workspaceFile);
    const out: string[] = [];
    for (const folder of parsed.folders) {
      if (!folder?.path) continue;
      const resolved = path.isAbsolute(folder.path)
        ? folder.path
        : path.resolve(workspaceRoot, folder.path);
      out.push(resolved);
    }
    return out;
  } catch {
    return [];
  }
}

export interface ClassifiedFolder {
  path: string;
  isProject: boolean;
  isEngine: boolean;
  uprojectPath?: string;
}

export async function classifyFolders(folderPaths: string[]): Promise<ClassifiedFolder[]> {
  const results: ClassifiedFolder[] = [];
  for (const folder of folderPaths) {
    const uprojectPath = await findUProjectIn(folder);
    const isEngine = await hasBuildVersion(folder);
    results.push({
      path: folder,
      isProject: !!uprojectPath,
      isEngine,
      uprojectPath: uprojectPath ?? undefined,
    });
  }
  return results;
}

/** Find a .uproject file directly inside `folder`. */
async function findUProjectIn(folder: string): Promise<string | undefined> {
  try {
    const entries = await fs.readdir(folder);
    const uproject = entries.find((e) => e.endsWith('.uproject'));
    return uproject ? path.join(folder, uproject) : undefined;
  } catch {
    return undefined;
  }
}

/** True if `folder/Engine/Build/Build.version` exists. */
async function hasBuildVersion(folder: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(folder, 'Engine', 'Build', 'Build.version'));
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Read Engine/Build/Build.version and return the engine version as
 * "Major.Minor.Patch" (e.g. "5.8.0"). Returns null if the file is missing
 * or unparseable.
 */
export async function readBuildVersion(engineRoot: string): Promise<string | null> {
  try {
    const text = await fs.readFile(
      path.join(engineRoot, 'Engine', 'Build', 'Build.version'),
      'utf-8',
    );
    const v = JSON.parse(text) as {
      MajorVersion: number;
      MinorVersion: number;
      PatchVersion: number;
    };
    return `${v.MajorVersion}.${v.MinorVersion}.${v.PatchVersion}`;
  } catch {
    return null;
  }
}
