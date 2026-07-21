/**
 * modifyRspFiles —— 从响应文件中移除 PCH 预编译头引用，加速 clangd 补全
 *
 * UnrealBuildTool (UBT) 生成的 compile_commands.json 引用的 .rsp 文件中
 * 包含 `/FI "path/to/SharedPCH.XXX.h"` 条目，指向庞大的 PCH 预编译头。
 * clangd 在索引时加载这些 PCH，大幅拖慢代码补全速度。
 *
 * 本模块扫描项目的 .vscode/<项目名>/*.rsp 文件，移除包含 "PCH" 的
 * `/FI` 和 `-include` 行。这不影响实际构建——只影响 clangd 的代码补全。
 *
 * 参考 unreal-clangd (boocs/unreal-clangd v3) 的 src/modules/modifyRspFiles.ts。
 *
 * 主要导出：
 *   - startModifyResponseFiles: 扫描并修改所有 rsp 文件
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EOL } from 'node:os';
import type { WorkspaceState } from '@core/workspace';

/**
 * 扫描 .vscode/<项目名>/*.rsp 文件，移除每行中包含 "PCH" 的
 * `/FI "..."` 或 `-include "..."` 条目。
 *
 * 项目名从 compile_commands.json 的文件名推断，
 * 或在 .vscode 下查找包含 .rsp 文件的子目录。
 *
 * @param projectPath .uproject 文件的绝对路径
 * @param logger 可选的日志记录器
 * @returns { replaced: 修改的文件数, unchanged: 未修改的文件数 }
 */
export async function startModifyResponseFiles(
  projectPath: string,
  logger?: { info: (msg: string) => void; warn: (msg: string) => void },
  workspace?: WorkspaceState,
): Promise<{ replaced: number; unchanged: number }> {
  const projectDir = workspace?.projectDir ?? path.dirname(projectPath);

  // 步骤 1：找到 rsp 文件目录。
  // UBT 把 rsp 放在 .vscode/<项目名>/ 下。
  // 项目名通常来自 compile_commands.json 文件名（去掉 .json 扩展名）。
  const rspDir = await findRspDirectory(projectDir);
  if (!rspDir) {
    logger?.warn('[modifyRspFiles] 未找到 .rsp 目录（.vscode/<项目名>/*.rsp）');
    return { replaced: 0, unchanged: 0 };
  }

  // 步骤 2：扫描所有 .rsp 文件。
  let dirContents: string[];
  try {
    dirContents = await fs.readdir(rspDir);
  } catch {
    logger?.warn(`[modifyRspFiles] 无法读取目录: ${rspDir}`);
    return { replaced: 0, unchanged: 0 };
  }

  const rspFiles: string[] = [];
  for (const name of dirContents) {
    if (name.endsWith('.rsp')) {
      const fullPath = path.join(rspDir, name);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {rspFiles.push(fullPath);}
      } catch {
        // 无法 stat，跳过
      }
    }
  }

  if (rspFiles.length === 0) {
    logger?.info('[modifyRspFiles] 未找到 .rsp 文件');
    return { replaced: 0, unchanged: 0 };
  }

  // 步骤 3：对每个 rsp 文件，移除 PCH 引用行。
  // rsp 文件每行一个参数。PCH 引用格式：
  //   /FI "C:\UE5\...\SharedPCH.CoreUObject.Cpp20.h"
  //   -include "C:\UE5\...\SharedPCH.Engine.Cpp20.h"
  let replaced = 0;
  let unchanged = 0;

  for (const rspPath of rspFiles) {
    try {
      const raw = await fs.readFile(rspPath, 'utf-8');

      // 按行分割，保留原行尾格式
      const lines = raw.split(/\r?\n/);
      const filtered = lines.filter((line) => {
        const trimmed = line.trim();
        // 检查是否是 /FI 或 -include 且包含 PCH
        if (
          /^\s*(\/FI|-include)\s/.test(trimmed) &&
          /PCH/i.test(trimmed)
        ) {
          return false; // 移除
        }
        return true;
      });

      if (filtered.length === lines.length) {
        unchanged++;
        continue;
      }

      await fs.writeFile(rspPath, filtered.join(EOL), 'utf-8');
      replaced++;
    } catch (err) {
      logger?.warn(
        `[modifyRspFiles] 处理文件失败: ${rspPath} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  logger?.info(
    `[modifyRspFiles] 完成: ${replaced} 个文件已修改, ${unchanged} 个未变化`,
  );
  return { replaced, unchanged };
}

// ---- 内部函数 ----

/**
 * 在项目根目录的 .vscode 下查找包含 .rsp 文件的子目录。
 *
 * 策略：
 *   1. 读 compile_commands.json（如果存在），从第一个条目推断配置名；
 *      配置名通常是文件所在目录名。
 *   2. 如果 compile_commands.json 不存在，遍历 .vscode 下的子目录，
 *      找第一个包含 .rsp 文件的。
 *
 * @returns rsp 目录的绝对路径，或 null
 */
async function findRspDirectory(projectDir: string): Promise<string | null> {
  // [Phase 11 SSoT] 保留 path.join——这是 UBT 工具链生成的 .vscode/<项目名>/ 路径(.rsp 在这里),
  // 不是 vscodeuehelper helper 目录。clangdHelperDir 不适用。
  const vscodeDir = path.join(projectDir, '.vscode');

  // 策略 1：从 compile_commands.json 的第一个条目推断目录名
  const ccPath = path.join(projectDir, 'compile_commands.json');
  try {
    const text = await fs.readFile(ccPath, 'utf-8');
    const entries = JSON.parse(text) as Array<{ arguments?: string[]; command?: string; directory?: string }>;
    if (Array.isArray(entries) && entries.length > 0) {
      const first = entries[0]!;
      const args: string[] =
        first.arguments ?? (first.command ? first.command.split(/\s+/) : []);
      // 在 arguments 中查找 .rsp 文件路径
      for (const arg of args) {
        if (arg.startsWith('@') && arg.endsWith('.rsp')) {
          // @ 前缀后是 rsp 的绝对路径或相对路径
          const rspCandidate = arg.slice(1);
          const dir = path.dirname(rspCandidate);
          if (path.isAbsolute(dir)) {
            return dir;
          }
          // 相对路径：相对于 directory 字段
          const directory: string = first.directory ?? projectDir;
          return path.resolve(directory, dir);
        }
      }
    }
  } catch {
    // compile_commands.json 不存在或解析失败，回退到策略 2
  }

  // 策略 2：遍历 .vscode 下的子目录
  try {
    const vscodeEntries = await fs.readdir(vscodeDir, { withFileTypes: true });
    for (const entry of vscodeEntries) {
      if (!entry.isDirectory()) {continue;}
      const subDir = path.join(vscodeDir, entry.name);
      try {
        const subEntries = await fs.readdir(subDir);
        if (subEntries.some((e) => e.endsWith('.rsp'))) {
          return subDir;
        }
      } catch {
        // 无法读取该子目录
      }
    }
  } catch {
    // .vscode 目录不存在
  }

  return null;
}
