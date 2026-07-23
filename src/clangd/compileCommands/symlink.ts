/**
 * symlink —— compileCommands 的 symlink/copy 子模块（per Phase 3.3）
 *
 * 把 `linkToWorkspaceRoot` 从主入口 1:1 迁出，专注本地文件系统契约：
 *   - 派生目标路径（WorkspaceState 优先，回退 projectDir/.vscode/vscodeuehelper/）
 *   - 同路径短路（旧 .clangd 直接落在 helper 目录时无需操作）
 *   - 旧目标清理：lstat → readlink → 若已指向源则跳过，否则 unlink
 *   - 先 symlink，Windows 非 Developer Mode 失败 → copy 回退
 *   - copy 也失败则 throw（包含 source/target + errno 详情）
 *
 * 不变量：
 *   - 不依赖 `vscode` / 主文件（单向依赖 `@core/logger`、`@core/workspace`、`@clangd/perfLog`）
 *   - 阶段 4 两个 perfLog.record 调用点（skipped=true / succeeded=...）必须在 try/catch 内
 *     且保持事件名 `compileCommands.linkToWorkspaceRoot`
 *   - 错误传播契约不变：symlink/copy 都失败 → throw，让 createProject step 2 知道这是真失败
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import { perfLog } from '@clangd/perfLog';

/** compile_commands.json 文件名（本模块独立负责，candidates 路径由主文件派生） */
const FILE_NAME_COMPILE_COMMANDS = 'compile_commands.json';

/**
 * 将 compile_commands.json 复制/链接到 CompilationDatabase 指向的目录。
 *
 * 对齐 .clangd 中的 CompilationDatabase: .vscode/vscodeuehelper 指令。
 * 优先 symlink，Windows 上 symlink 失败时回退为 copy。
 */
export async function linkToWorkspaceRoot(
  jsonPath: string,
  projectPath: string,
  logger?: Logger,
  workspace?: WorkspaceState,
): Promise<string> {
  // [Phase 7 PLAN B / per D-03] 阶段 4：linkToWorkspaceRoot — 入口 timing 测量
  const lwsStart = performance.now();
  let lwsSucceeded = false;
  const projectDir = workspace?.projectDir ?? path.dirname(projectPath);
  const ccDir = workspace?.clangdHelperDir ?? path.join(projectDir, '.vscode', 'vscodeuehelper');
  const target = path.join(ccDir, FILE_NAME_COMPILE_COMMANDS);
  logger?.info(
    `[linkToWorkspaceRoot] ENTRY jsonPath=${jsonPath}, projectPath=${projectPath}, ` +
      `projectDir=${projectDir}, target=${target}`,
  );

  // 如果生成的已经在目标位置，无需操作
  if (path.resolve(jsonPath) === path.resolve(target)) {
    logger?.info(`[linkToWorkspaceRoot] already at target, skip`);
    lwsSucceeded = true;
    try {
      perfLog.record({
        event: 'compileCommands.linkToWorkspaceRoot',
        elapsedMs: performance.now() - lwsStart,
        meta: { skipped: true, target },
      });
    } catch (err) {
      logger?.warn(
        `[perf] instrumentation linkToWorkspaceRoot skipped failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return target;
  }

  // 确保目标目录存在
  await fs.mkdir(ccDir, { recursive: true });
  logger?.info(`[linkToWorkspaceRoot] ensured ccDir exists: ${ccDir}`);

  // 如果目标已存在，清理
  try {
    const stat = await fs.lstat(target);
    logger?.info(
      `[linkToWorkspaceRoot] existing target: isSymbolicLink=${stat.isSymbolicLink()}, ` +
        `isFile=${stat.isFile()}, size=${stat.size}`,
    );
    if (stat.isSymbolicLink() || stat.isFile()) {
      const existing = await fs.readlink(target).catch(() => null);
      logger?.info(`[linkToWorkspaceRoot] existing readlink → ${existing ?? '(not a symlink)'}`);
      if (existing === jsonPath) {
        logger?.info(`[linkToWorkspaceRoot] symlink already correct, skip`);
        return target;
      }
      await fs.unlink(target);
      logger?.info(`[linkToWorkspaceRoot] removed existing target`);
    }
  } catch (err) {
    // 不存在，继续
    logger?.info(
      `[linkToWorkspaceRoot] no existing target (lstat failed: ${err instanceof Error ? err.message : String(err)})`,
    );
  }

  // 先尝试 symlink
  try {
    logger?.info(`[linkToWorkspaceRoot] trying fs.symlink(${jsonPath}, ${target}, 'file')`);
    await fs.symlink(jsonPath, target, 'file');
    logger?.info(`[linkToWorkspaceRoot] fs.symlink SUCCEEDED → ${target}`);
    lwsSucceeded = true;
  } catch (symlinkErr) {
    const symlinkMsg = symlinkErr instanceof Error ? symlinkErr.message : String(symlinkErr);
    const errno =
      typeof (symlinkErr as NodeJS.ErrnoException)?.code === 'string'
        ? (symlinkErr as NodeJS.ErrnoException).code
        : 'UNKNOWN';
    logger?.info(
      `[linkToWorkspaceRoot] fs.symlink FAILED errno=${errno} msg=${symlinkMsg}; ` +
        `falling back to fs.copyFile`,
    );

    // Symlink 在 Windows 非 Developer Mode 下可能失败，回退 copy。
    // copyFile 必须独立 try-catch —— 如果它也失败（比如 jsonPath 不存在），整个
    // linkToWorkspaceRoot 不应静默吞错：把错误信息打到日志并重新抛出，让上层
    // createProject step 2 知道这是真的失败。
    try {
      logger?.info(`[linkToWorkspaceRoot] trying fs.copyFile(${jsonPath}, ${target})`);
      await fs.copyFile(jsonPath, target);
      logger?.info(`[linkToWorkspaceRoot] fs.copyFile SUCCEEDED → ${target}`);
      lwsSucceeded = true;
    } catch (copyErr) {
      const copyMsg = copyErr instanceof Error ? copyErr.message : String(copyErr);
      const copyErrno =
        typeof (copyErr as NodeJS.ErrnoException)?.code === 'string'
          ? (copyErr as NodeJS.ErrnoException).code
          : 'UNKNOWN';
      logger?.error(
        `[linkToWorkspaceRoot] fs.copyFile FAILED errno=${copyErrno} msg=${copyMsg}; ` +
          `giving up. source exists?=${await fs
            .access(jsonPath)
            .then(() => 'yes')
            .catch(() => 'no')}`,
      );
      throw new Error(
        `linkToWorkspaceRoot: both symlink and copy failed. ` +
          `symlink errno=${errno} (${symlinkMsg}), copy errno=${copyErrno} (${copyMsg}). ` +
          `source=${jsonPath}, target=${target}`,
      );
    }
  }
  logger?.info(`[linkToWorkspaceRoot] done: ${target}`);
  // [Phase 7 PLAN B / per D-03] 阶段 4 收尾：linkToWorkspaceRoot — 末尾 timing 测量
  try {
    perfLog.record({
      event: 'compileCommands.linkToWorkspaceRoot',
      elapsedMs: performance.now() - lwsStart,
      meta: { succeeded: lwsSucceeded, target },
    });
  } catch (err) {
    logger?.warn(
      `[perf] instrumentation linkToWorkspaceRoot done failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return target;
}
