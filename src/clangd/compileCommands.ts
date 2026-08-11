/**
 * compileCommands —— 为 clangd 生成/刷新 compile_commands.json
 *
 * 严格对齐原版 unreal-clangd v3 updateCompileCommands 逻辑：
 *
 *   - 执行方式：vscode.tasks.executeTask + vscode.ShellExecution
 *     （Windows 用 PowerShell.exe）
 *   - 双路径：
 *       默认（GenerateClangDatabase 模式，**实际生成 compile_commands.json**）：
 *         <TargetName> <Platform> Development <uprojectPath>
 *         -mode=GenerateClangDatabase
 *       可选（Native 模式，⚠️ **不**生成 compile_commands.json）：
 *         -projectfiles -project=<uprojectPath> -game -engine -dotnet
 *   - UBT 查找：UE 5.x 优先 UnrealBuildTool.exe，回退 RunUBT.bat/sh
 *   - LLVM_PATH：自动检测 + 注入到 UBT 进程（GenerateClangDatabase 必需）
 *
 * 主要导出:
 *   - generateCompileCommands: 通过 Task API 执行 UBT 生成 compile_commands.json
 *   - linkToWorkspaceRoot: 把生成的 symlink/copy 到项目根
 *   - isClangdAvailable: 检查 clangd 是否在 PATH
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { sharedLogger } from '@core/logger';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import { generateFallbackCompileCommands } from './compileCommandsFallback';
import { perfLog } from './perfLog';
import {
  tryCompileCommandsFastPath,
  writeCompileCommandsCache,
  type FastPathResult,
} from '@clangd/compileCommands/cache';
import { linkToWorkspaceRoot } from '@clangd/compileCommands/symlink';
import {
  buildNativeArgs,
  buildNonNativeArgs,
  executeShellTask,
  findClangToolchain,
  isClangdAvailable,
  getUbtPath,
} from '@clangd/compileCommands/task';
import { fillMissingCompileCommands, type FillResult } from '@clangd/compileCommands/fillMissing';

// re-export 公共 API 让外部 @clangd/compileCommands 用户零感知拆分（per T4.5 拆分策略）
export { isClangdAvailable, linkToWorkspaceRoot };
export { fillMissingCompileCommands, type FillResult };

/* ------------------------------------------------------------------ */
/*  常量（仅保留主文件直接用得到的,其余已迁 task.ts）                     */
/* ------------------------------------------------------------------ */

/** compile_commands.json 文件名（主文件定位 candidates 用） */
const FILE_NAME_COMPILE_COMMANDS = 'compile_commands.json';

/* ------------------------------------------------------------------ */
/*  类型定义                                                            */
/* ------------------------------------------------------------------ */

export interface GenerateOptions {
  /** Absolute path to .uproject. */
  project: string;
  /** Absolute path to engine root. */
  engineRoot: string;
  /** Optional logger. */
  logger?: Logger;
  /** Abort signal (best-effort — Task API doesn't natively support cancellation). */
  signal?: AbortSignal;
  /**
   * Intellisense 类型：
   *   - false / undefined：Non-Native（clangd），用 -Mode=GenerateClangDatabase
   *   - true：Native，用 -projectfiles
   */
  isNative?: boolean;
  /** 目标平台（如 Win64 / Linux / Mac），默认自动检测。 */
  platform?: string;
  /** 目标架构（如 x64 / arm64），可选。 */
  architecture?: string;
  /**
   * UBT buildType（如 Development / DebugGame / Debug），默认 'Development'。
   * 联动 config.configuration，让用户切换构建配置时 compile DB 同步。
   * 注意：Debug 配置生成更慢，IntelliSense 场景建议 Development。
   */
  buildType?: string;
  /**
   * [P2-4] 可选进度回调，长任务阶段细分反馈（fingerprint / UBT / 定位 / fallback）。
   * 调用方从 withProgress 的 callback 传入。
   */
  progress?: vscode.Progress<{ message?: string; increment?: number }>;
  /** [Phase 8] 可选 WorkspaceState 注入。提供时优先用 workspace 派生路径。 */
  workspace?: WorkspaceState;
}

/* ------------------------------------------------------------------ */
/*  task 子模块的导出(已迁到 ./compileCommands/task.ts)                 */
/* ------------------------------------------------------------------ */
//
// getShellQuoting / executeShellTask / buildNativeArgs /
// buildNonNativeArgs / findClangToolchain 全部迁出到 ./compileCommands/task.ts。
// 主文件仅作为入口协调 + re-export,确保 @clangd/compileCommands 用户
// 公共 API 完全不变(per T4.5 拆分策略)。
//

/* ------------------------------------------------------------------ */
/*  主入口                                                              */
/* ------------------------------------------------------------------ */

/**
 * 通过 VS Code Task API 执行 UBT，生成 compile_commands.json。
 *
 * 双路径：
 *   - isNative = true：UBT -projectfiles（产出到 .vscode/<projectName>/compile_commands.json）
 *   - isNative = false / undefined：UBT -Compiler=Clang -mode=GenerateClangDataBase
 *
 * @returns 生成的 compile_commands.json 的绝对路径
 */
export async function generateCompileCommands(opts: GenerateOptions): Promise<string> {
  // [Phase 7 PLAN B / per D-03] 阶段 1：函数入口 — 记录整体起点 + entry 埋点
  const entryStart = performance.now();
  const log = opts.logger ?? sharedLogger;
  const projectName = path.basename(opts.project, '.uproject');
  const engineUri = vscode.Uri.file(opts.engineRoot);

  // [T4.5 拆分] signal 不再走模块级全局变量,直接当参数传给 executeShellTask

  const isNativeAtEntry = opts.isNative === true;
  try {
    perfLog.record({
      event: 'compileCommands.entry',
      elapsedMs: 0,
      meta: { project: opts.project, isNative: isNativeAtEntry },
    });
  } catch (err) {
    log.warn(
      `[perf] instrumentation entry failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // [LOG] 函数入口：明确打印输入参数，便于诊断 linkToWorkspaceRoot 后续找不到源文件
  log.info(
    `[generateCompileCommands] ENTRY project=${opts.project}, engineRoot=${opts.engineRoot}, ` +
      `isNative=${isNativeAtEntry}, platform=${opts.platform ?? '(auto)'}`,
  );

  // [Phase 7 D-08/D-09] 指纹快路径：若 fingerprint 命中 + ccPath 存在 → 跳过 UBT 子进程
  // [Phase 3.2] cache 编排抽到 @clangd/compileCommands/cache,主文件保留 perf 埋点
  // [W11/F2-5] 传 engineRoot：引擎 Build.version 纳入 fingerprint + 共享 DB 内容校验（W10/F2-4）
  const projectDir = opts.workspace?.projectDir ?? path.dirname(opts.project);
  // [P2-4] 阶段反馈：计算指纹
  opts.progress?.report({ message: 'Computing fingerprint...' });
  const fastPath: FastPathResult = await tryCompileCommandsFastPath(projectDir, log, opts.engineRoot);
  if (fastPath.hit) {
    perfLog.record({
      event: 'compileCommands.cacheHit',
      elapsedMs: fastPath.elapsedMs,
      meta: { fingerprint: fastPath.fingerprint, ccPath: fastPath.ccPath },
    });
    log.info(
      `[perf] compileCommands cache HIT (fp ${fastPath.elapsedMs.toFixed(1)}ms), skip UBT → ${fastPath.ccPath}`,
    );
    // [Phase 7 PLAN B / per D-03] 阶段 5：fast-path 命中 — totalElapsed 收尾
    try {
      perfLog.record({
        event: 'compileCommands.totalElapsed',
        elapsedMs: performance.now() - entryStart,
        meta: { hit: true, outcome: 'cacheFastPath' },
      });
    } catch (err) {
      log.warn(
        `[perf] instrumentation totalElapsed (fast-path) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return fastPath.ccPath;
  }
  if ('error' in fastPath) {
    // 指纹或缓存 IO 异常：降级到原有 UBT 路径（per T-7-04 防御原则）
    log.warn(`[perf] fingerprint/cache fast-path failed, fallback to UBT: ${fastPath.error}`);
    perfLog.record({
      event: 'compileCommands.fastPathError',
      elapsedMs: 0,
      meta: { error: fastPath.error },
    });
  } else {
    perfLog.record({
      event: 'compileCommands.cacheMiss',
      elapsedMs: fastPath.elapsedMs,
      meta: { fingerprint: fastPath.fingerprint, hadCache: fastPath.hadCache },
    });
    log.info(
      `[perf] compileCommands cache MISS (fp ${fastPath.elapsedMs.toFixed(1)}ms), running UBT`,
    );
  }

  // 1. 查找 UBT 路径（RunUBT.bat/sh 优先）
  // [P2-4] 阶段反馈：运行 UBT
  opts.progress?.report({ message: 'Running UBT (GenerateClangDatabase)...' });
  const ubtAbsPath = await getUbtPath(engineUri);
  if (!ubtAbsPath) {
    throw new Error(
      `UnrealBuildTool not found under ${opts.engineRoot}. ` +
        'Make sure the engine root directory contains Engine/Build/BatchFiles/RunUBT.bat ' +
        'or Engine/Binaries/DotNET/UnrealBuildTool/.',
    );
  }
  log.info(`[compileCommands] UBT found at: ${ubtAbsPath}`);

  // 2. 转为相对路径（以引擎根目录为 cwd）
  const ubtRelPath = `.${path.sep}${path.relative(opts.engineRoot, ubtAbsPath)}`;

  // 3. 构造参数（双路径）
  //
  // 默认 GenerateClangDatabase 模式（-mode=GenerateClangDataBase）
  // 这是**实际生成 compile_commands.json** 的模式！
  //
  // ⚠️ 注意：-projectfiles（Native）模式**不**生成 compile_commands.json，
  // 它只生成 VS project files (.vcxproj)。如果用户强制使用 Native 模式，
  // compile_commands.json 会保持不变，可能导致 clangd 看到陈旧的内容。
  const isNative = opts.isNative === true; // 只有明确 true 才走 Native，默认 GenerateClangDatabase
  const args = isNative ? buildNativeArgs(opts) : await buildNonNativeArgs(opts);

  if (isNative) {
    log.warn(
      '[compileCommands] ⚠️ Using -projectfiles (Native) mode. ' +
        'This mode generates VS project files but DOES NOT generate compile_commands.json. ' +
        'compile_commands.json will remain unchanged (possibly stale). ' +
        'Consider using the default GenerateClangDatabase mode instead.',
    );
  }
  log.info(`[compileCommands] mode=${isNative ? 'Native' : 'Non-Native'} project=${opts.project}`);

  // 4. 尝试注入 LLVM_PATH（避免 Clang 工具链检查失败）
  //    Native 模式不强制需要，但也注入以防其他子流程需要
  const taskEnv = await (async (): Promise<Record<string, string> | undefined> => {
    // 优先读全局环境变量
    const envLlvm = process.env.LLVM_PATH;
    if (envLlvm) {
      log.info(`[compileCommands] using LLVM_PATH from env: ${envLlvm}`);
      return { LLVM_PATH: envLlvm };
    }
    // 回退：通过 where clang 反推
    const found = await findClangToolchain();
    if (found) {
      log.info(`[compileCommands] auto-detected LLVM_PATH: ${found}`);
      return { LLVM_PATH: found };
    }
    if (!isNative) {
      log.warn(
        '[compileCommands] LLVM_PATH not set and clang not found in PATH. ' +
          'GenerateClangDatabase mode requires clang. Set vscodeUEHelper.clangdPath ' +
          'or LLVM_PATH environment variable.',
      );
    }
    return undefined;
  })();

  log.info(`[compileCommands] LLVM_PATH: ${taskEnv?.LLVM_PATH ?? '(not set)'}`);

  // 5. 通过 Task API 执行
  // [Phase 7 PLAN B / per D-03] 阶段 2：UBT 任务执行 — 包裹 timing 测量
  const ubtStart = performance.now();
  try {
    perfLog.record({
      event: 'compileCommands.ubtStart',
      elapsedMs: 0,
      meta: { isNative, target: args[0] ?? 'unknown' },
    });
  } catch (err) {
    log.warn(
      `[perf] instrumentation ubtStart failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await executeShellTask(ubtRelPath, args, opts.engineRoot, log, taskEnv, opts.signal);
  try {
    perfLog.record({
      event: 'ubt.taskCompleted',
      elapsedMs: performance.now() - ubtStart,
      meta: { isNative, exitCode: 0 },
    });
  } catch (err) {
    log.warn(
      `[perf] instrumentation ubt.taskCompleted failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 6. 定位输出文件
  //
  // GenerateClangDatabase (-Mode=GenerateClangDatabase): 写到引擎根目录
  //   <EngineRoot>/compile_commands.json
  // Native (-projectfiles): 只生成 .vcxproj，**不**生成 compile_commands.json
  //
  // [P2-4] 阶段反馈：定位 compile_commands.json
  opts.progress?.report({ message: 'Locating compile_commands.json...' });
  const candidates = [
    // 优先：UE 5.x GenerateClangDatabase 默认输出到引擎根目录
    path.join(opts.engineRoot, FILE_NAME_COMPILE_COMMANDS),
    // 备选：项目目录的 .vscode/vscodeuehelper/（linkToWorkspaceRoot 目标位置）
    // [Phase 11 SSoT] 走 WorkspaceState.compileCommandsPath（与 linkToWorkspaceRoot 目标对齐）
    opts.workspace?.compileCommandsPath ??
      path.join(projectDir, '.vscode', 'vscodeuehelper', FILE_NAME_COMPILE_COMMANDS),
    // 备选：项目目录根
    path.join(projectDir, FILE_NAME_COMPILE_COMMANDS),
    // 备选：引擎根目录的 .vscode/<项目名>/（旧版 Native 模式可能）
    path.join(opts.engineRoot, '.vscode', projectName, FILE_NAME_COMPILE_COMMANDS),
    // 兼容 unreal-clangd 的输出目录名
    path.join(opts.engineRoot, '.vscode', 'unreal-clangd', FILE_NAME_COMPILE_COMMANDS),
  ];

  log.info(
    `[generateCompileCommands] searching compile_commands.json in candidates: ${JSON.stringify(candidates)}`,
  );

  // 找到**第一个存在且非空**的文件
  // [Phase 7 PLAN B / per D-03] 阶段 3：candidates 文件查找 — 循环前后 timing
  const candStart = performance.now();
  for (const p of candidates) {
    try {
      const stat = await fs.stat(p);
      if (stat.size > 2) {
        // > 2 字节：避免空数组 []
        log.info(
          `[generateCompileCommands] found compile_commands.json at: ${p} (${stat.size} bytes)`,
        );

        // [Phase 7 D-08] 写入缓存，供下次快速命中
        // [Phase 3.2] cache 编排抽到 @clangd/compileCommands/cache,主文件只保留 dedup 守卫 + 日志
        const cachedCcPath = 'cachedCcPath' in fastPath ? fastPath.cachedCcPath : undefined;
        if (cachedCcPath !== p) {
          try {
            await writeCompileCommandsCache(path.dirname(opts.project), p, {
              logger: log,
              engineRoot: opts.engineRoot,
            });
            log.info(
              `[perf] compileCommands cache WRITTEN (path changed: ${cachedCcPath ?? '(none)'} → ${p})`,
            );
          } catch (cacheErr) {
            // 写缓存失败：不阻塞主流程（per T-7-04 防御原则）
            const msg = cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
            log.warn(`[perf] failed to write compileCommands cache: ${msg}`);
          }
        }

        try {
          perfLog.record({
            event: 'compileCommands.candidatesScanned',
            elapsedMs: performance.now() - candStart,
            meta: { candidateCount: candidates.length, hit: true, ccPath: p },
          });
        } catch (err) {
          log.warn(
            `[perf] instrumentation candidatesScanned failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        // [Phase 7 PLAN B / per D-03] 阶段 5：generateCompileCommands 总耗时 — return 前
        try {
          perfLog.record({
            event: 'compileCommands.totalElapsed',
            elapsedMs: performance.now() - entryStart,
            meta: { hit: true, outcome: 'found', ccPath: p },
          });
        } catch (err) {
          log.warn(
            `[perf] instrumentation totalElapsed (return) failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return p;
      } else {
        log.warn(
          `[generateCompileCommands] ${p} exists but is empty (${stat.size} bytes), continuing search`,
        );
      }
    } catch {
      // not here
    }
  }

  // candidates 全部未命中 — 记录扫描耗时（per D-03）
  try {
    perfLog.record({
      event: 'compileCommands.candidatesScanned',
      elapsedMs: performance.now() - candStart,
      meta: { candidateCount: candidates.length, hit: false },
    });
  } catch (err) {
    log.warn(
      `[perf] instrumentation candidatesScanned (miss) failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // [P1-3] candidates 全部未命中 -> 尝试 fallback 降级 DB
  // UBT 失败（UHT 错误等）时生成一份"够用"的 compile_commands.json，让 clangd 能附着
  try {
    // [P2-4] 阶段反馈：UBT 失败，生成降级 DB
    opts.progress?.report({ message: 'UBT failed, generating fallback DB...' });
    const fbResult = await generateFallbackCompileCommands({
      project: opts.project,
      engineRoot: opts.engineRoot,
      logger: log,
      workspace: opts.workspace,
      buildType: opts.buildType,
    });
    if (fbResult) {
      // 写缓存（标记 fallback：命中时不走快路径，下次仍重试 UBT）
      // [Phase 3.2] cache 编排抽到 @clangd/compileCommands/cache
      try {
        await writeCompileCommandsCache(projectDir, fbResult.ccPath, {
          fallback: true,
          fileCount: fbResult.entryCount,
          logger: log,
          engineRoot: opts.engineRoot,
        });
        log.info(`[perf] fallback cache WRITTEN (path=${fbResult.ccPath})`);
      } catch (cacheErr) {
        const msg = cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
        log.warn(`[perf] failed to write fallback cache: ${msg}`);
      }

      // [P0-B / Todo 6] 仅主路径/无 fromFallback 时挂 fillMissingCompileCommands。
      //        fallback DB 已覆盖所有 Source/Plugins .cpp + 反射 .h,fillMissing 重复且无用;
      //        短路避免重复 IO。fromFallback 标记由 generateFallbackCompileCommands 设置。
      //        UHT 错误检测隐式覆盖:candidates 命中 = UBT 成功(无 UHT 错误)→ 走主路径不 fallback;
      //        candidates 未命中 = UBT 失败(可能 UHT 错) → fallback。executeShellTask 只暴露
      //        exit code(vscode.tasks API 无 stdout/stderr),所以无法做 UHT 字面正则匹配。
      try {
        if (fbResult.fromFallback === true) {
          log.info(
            '[compileCommands] skipping fillMissingCompileCommands ' +
              '(fallback DB already covers all Source/Plugins .cpp + reflection .h)',
          );
        } else {
          const fillResult = await fillMissingCompileCommands(
            fbResult.ccPath,
            opts.project,
            log,
            opts.workspace,
          );
          if (fillResult) {
            perfLog.record({
              event: 'compileCommands.fillMissing',
              elapsedMs: performance.now() - entryStart,
              meta: {
                outcome: fillResult.skippedReason ? 'skipped' : 'added',
                added: fillResult.added.length,
              },
            });
          }
        }
      } catch (fillErr) {
        const msg = fillErr instanceof Error ? fillErr.message : String(fillErr);
        log.warn(`[fallback+fill] fillMissingCompileCommands threw: ${msg}`);
      }

      try {
        perfLog.record({
          event: 'compileCommands.totalElapsed',
          elapsedMs: performance.now() - entryStart,
          meta: { hit: false, outcome: 'fallback', ccPath: fbResult.ccPath },
        });
      } catch (err) {
        log.warn(
          `[perf] instrumentation totalElapsed (fallback) failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return fbResult.ccPath;
    }
  } catch (fbErr) {
    const msg = fbErr instanceof Error ? fbErr.message : String(fbErr);
    log.warn(`[fallback] generateFallbackCompileCommands threw: ${msg}`);
  }

  // [Phase 7 PLAN B / per D-03] 阶段 5：generateCompileCommands 总耗时 — throw 前
  try {
    perfLog.record({
      event: 'compileCommands.totalElapsed',
      elapsedMs: performance.now() - entryStart,
      meta: { hit: false, outcome: 'notFound' },
    });
  } catch (err) {
    log.warn(
      `[perf] instrumentation totalElapsed failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  throw new Error(
    `UBT task completed but compile_commands.json not found or empty.\n` +
      `Checked:\n` +
      candidates.map((c) => `  - ${c}`).join('\n') +
      `\n\nPossible causes:\n` +
      `  1. UBT isNative mode (-projectfiles) does not generate compile_commands.json\n` +
      `  2. LLVM/clang not found: set LLVM_PATH env var or vscodeUEHelper.clangdPath setting\n` +
      `  3. Engine version compatibility issue\n` +
      `Check the VSCode UE Helper output channel for UBT logs.`,
  );
}
