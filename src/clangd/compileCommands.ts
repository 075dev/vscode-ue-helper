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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { getUbtPath, getUnrealPlatform, getBuildTargetNames } from './ueHelpers';
import { computeFingerprint } from './fingerprint';
import { CompileCommandsCache } from './compileCommandsCache';
import { perfLog } from './perfLog';
import type { CachedCompileCommands } from './types';

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/*  常量（对齐原版 consts.ts）                                          */
/* ------------------------------------------------------------------ */

/** VS Code Task 类型 */
const TASK_TYPE = 'shell';

/** 配置 section */
const CONFIG_SECTION_UNREAL_CLANGD = 'unreal-clangd';

/** Non-Native 路径的 UBT 参数 */
const UPDATE_COMPILE_COMMANDS_ARG_DEVELOPMENT = 'Development';
const UPDATE_COMPILE_COMMANDS_ARG_GEN_CLANGDB = '-Mode=GenerateClangDatabase';
const UPDATE_COMPILE_COMMANDS_ARG_ARCHITECTURE_EMPTY = '-architecture=';

/** Windows PowerShell 可执行文件名 */
const POWERSHELL_FILE_NAME = 'PowerShell.exe';

/** compile_commands.json 文件名 */
const FILE_NAME_COMPILE_COMMANDS = 'compile_commands.json';

/** Task 名称 */
const UPDATE_COMPILE_COMMANDS_DBGCFG_NAME = 'unreal-clangd: Update Compile Commands';

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
}

/* ------------------------------------------------------------------ */
/*  Shell 引用辅助                                                      */
/* ------------------------------------------------------------------ */

/** 对齐原版 getShellQuoting — Windows 用 Strong 引用包裹 args。 */
function getShellQuoting(
  command: string,
  args: string[],
): {
  command: vscode.ShellQuotedString | string;
  args: (vscode.ShellQuotedString | string)[];
} {
  if (process.platform === 'win32') {
    const modArgs: vscode.ShellQuotedString[] = [];
    for (const arg of args) {
      modArgs.push({ value: arg, quoting: vscode.ShellQuoting.Strong });
    }
    return {
      command: { value: command, quoting: vscode.ShellQuoting.Strong },
      args: modArgs,
    };
  }

  return {
    command: { value: command, quoting: vscode.ShellQuoting.Weak },
    args,
  };
}

/* ------------------------------------------------------------------ */
/*  Task 执行                                                           */
/* ------------------------------------------------------------------ */

/**
 * 使用 VS Code Task API 执行一个 shell 任务并等待完成。
 *
 * 对齐原版 runUpdateCompileCommandsWithTask：
 *   - Windows: executable = PowerShell.exe
 *   - cwd = unrealWorkspace（引擎根目录）
 *   - problemMatchers = ['$msCompile']
 *
 * @returns exit code
 */
function executeShellTask(
  cmd: string,
  args: ReadonlyArray<string>,
  cwd: string,
  log: Logger,
  env?: Record<string, string>,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const unrealFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cwd));
    // 如果精确匹配不到 workspace folder，用第一个可用的
    const scope = unrealFolder ?? vscode.workspace.workspaceFolders?.[0];
    if (!scope) {
      reject(new Error('No workspace folder open. Please open a .code-workspace first.'));
      return;
    }

    const source = CONFIG_SECTION_UNREAL_CLANGD;

    const task: vscode.Task = new vscode.Task(
      { type: TASK_TYPE },
      scope,
      UPDATE_COMPILE_COMMANDS_DBGCFG_NAME,
      source,
      vscode.ShellExecution, // <-- 这里的类型断言是 vscode.Task 构造函数签名的一部分
    );

    task.group = vscode.TaskGroup.Build;
    task.problemMatchers = ['$msCompile'];

    // Shell quoting
    const quoted = getShellQuoting(cmd, [...args]);

    // Windows 的 shell executable
    const shellExec: string | undefined = process.platform === 'win32' ? POWERSHELL_FILE_NAME : undefined;

    (task as { execution: vscode.ShellExecution }).execution = new vscode.ShellExecution(
      quoted.command,
      quoted.args,
      { cwd, executable: shellExec, env },
    );

    log.info(`[compileCommands] executing task: ${cmd} ${[...args].join(' ')}`);
    log.info(`[compileCommands] cwd: ${cwd}, shell: ${shellExec ?? 'default'}`);

    vscode.tasks.executeTask(task).then(
      (execution) => {
        const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
          if (e.execution === execution) {
            disposable.dispose();
            if (e.exitCode === 0 || e.exitCode === 1) {
              // UBT -projectfiles 和 -mode=GenerateClangDataBase 都可能返回 exit code 1
              // 在成功场景下，对齐原版行为视为正常完成
              log.info(`[compileCommands] task exited with code ${e.exitCode}`);
              resolve(e.exitCode ?? -1);
            } else {
              reject(new Error(`UBT task exited with code ${e.exitCode}`));
            }
          }
        });

        // 检查 AbortSignal
        if (optsSignal) {
          const onAbort = () => {
            disposable.dispose();
            reject(new Error('Task cancelled'));
          };
          if (optsSignal.aborted) {
            onAbort();
          } else {
            optsSignal.addEventListener('abort', onAbort, { once: true });
          }
        }
      },
      (err) => reject(err),
    );
  });
}

/** capture the signal from the outer scope for use in executeShellTask */
let optsSignal: AbortSignal | undefined;

/* ------------------------------------------------------------------ */
/*  Non-Native 路径：构造 UBT 参数                                       */
/* ------------------------------------------------------------------ */

/**
 * 对齐原版 getUpdateCCArgs：
 *
 *   <buildTargetName> <unrealPlatform> Development <uprojectPath>
 *   -Compiler=Clang -mode=GenerateClangDataBase [-architecture=<arch>]
 */
async function buildNonNativeArgs(opts: GenerateOptions): Promise<string[]> {
  const projectDir = path.dirname(opts.project);

  // 1. 查找 build target names
  const targetNames = await getBuildTargetNames(projectDir);
  if (targetNames.length === 0) {
    throw new Error(
      `No *.Target.cs files found in ${path.join(projectDir, 'Source')}. ` +
      'A build target is required for Non-Native compile commands generation.',
    );
  }

  // 取第一个（已按 Editor 后缀优先排序）
  const buildTargetName = targetNames[0]!;

  // 2. Unreal platform
  const unrealPlatform = opts.platform ?? getUnrealPlatform(process.platform);
  if (!unrealPlatform) {
    throw new Error(`Unsupported platform: ${process.platform}. ` +
      'Please specify "platform" in GenerateOptions.');
  }

  const args: string[] = [
    buildTargetName,
    unrealPlatform,
    UPDATE_COMPILE_COMMANDS_ARG_DEVELOPMENT,
    opts.project,
    UPDATE_COMPILE_COMMANDS_ARG_GEN_CLANGDB,
  ];

  // 3. Architecture（可选）
  if (opts.architecture) {
    args.push(`${UPDATE_COMPILE_COMMANDS_ARG_ARCHITECTURE_EMPTY}${opts.architecture}`);
  }

  return args;
}

/* ------------------------------------------------------------------ */
/*  Native 路径：构造 UBT 参数                                           */
/* ------------------------------------------------------------------ */

/**
 * 对齐原版 Native 路径：
 *
 *   -projectfiles -project=<uprojectPath> -game -engine -dotnet
 */
function buildNativeArgs(opts: GenerateOptions): string[] {
  return [
    '-projectfiles',
    `-project=${opts.project}`,
    '-game',
    '-engine',
    '-dotnet',
  ];
}

/* ------------------------------------------------------------------ */
/*  LLVM 工具链发现                                                      */
/* ------------------------------------------------------------------ */

/**
 * 通过 `where clang` 定位 clang.exe，反推 LLVM 根目录。
 * 返回 undefined 表示未找到——调用方应降级处理。
 */
async function findClangToolchain(): Promise<string | undefined> {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(cmd, ['clang']);
    const clangPath = stdout.trim().split('\n')[0]?.trim();
    if (!clangPath) {return undefined;}
    // clang.exe → bin/ → LLVM root
    return path.dirname(path.dirname(clangPath));
  } catch {
    return undefined;
  }
}

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
  // 将 AbortSignal 暴露给 executeShellTask 内部闭包
  optsSignal = opts.signal;

  const log = opts.logger ?? new Logger('compileCommands');
  const projectName = path.basename(opts.project, '.uproject');
  const engineUri = vscode.Uri.file(opts.engineRoot);

  // [LOG] 函数入口：明确打印输入参数，便于诊断 linkToWorkspaceRoot 后续找不到源文件
  log.info(
    `[generateCompileCommands] ENTRY project=${opts.project}, engineRoot=${opts.engineRoot}, ` +
      `isNative=${opts.isNative === true}, platform=${opts.platform ?? '(auto)'}`
  );

  // [Phase 7 D-08/D-09] 指纹快路径：若 fingerprint 命中 + ccPath 存在 → 跳过 UBT 子进程
  const projectDir = path.dirname(opts.project);
  const cache = new CompileCommandsCache({ logger: log });
  let cachedEntry: CachedCompileCommands | undefined;
  try {
    const fpStart = performance.now();
    const fp = await computeFingerprint(projectDir);
    cachedEntry = await cache.tryRead(projectDir);
    const fpMs = performance.now() - fpStart;

    // 命中条件：cache 存在 + fingerprint 完全一致 + ccPath 仍存在
    if (cachedEntry && cachedEntry.fingerprint === fp.fingerprint) {
      const ccExists = await fs
        .access(cachedEntry.ccPath)
        .then(() => true)
        .catch(() => false);
      if (ccExists) {
        perfLog.record({
          event: 'compileCommands.cacheHit',
          elapsedMs: fpMs,
          meta: { fingerprint: fp.fingerprint, ccPath: cachedEntry.ccPath },
        });
        log.info(
          `[perf] compileCommands cache HIT (fp ${fpMs.toFixed(1)}ms), skip UBT → ${cachedEntry.ccPath}`,
        );
        return cachedEntry.ccPath;
      }
    }
    perfLog.record({
      event: 'compileCommands.cacheMiss',
      elapsedMs: fpMs,
      meta: { fingerprint: fp.fingerprint, hadCache: !!cachedEntry },
    });
    log.info(`[perf] compileCommands cache MISS (fp ${fpMs.toFixed(1)}ms), running UBT`);
  } catch (err) {
    // 指纹或缓存 IO 异常：降级到原有 UBT 路径（per T-7-04 防御原则）
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[perf] fingerprint/cache fast-path failed, fallback to UBT: ${msg}`);
    perfLog.record({
      event: 'compileCommands.fastPathError',
      elapsedMs: 0,
      meta: { error: msg },
    });
  }

  // 1. 查找 UBT 路径（RunUBT.bat/sh 优先）
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
  await executeShellTask(ubtRelPath, args, opts.engineRoot, log, taskEnv);

  // 6. 定位输出文件
  //
  // GenerateClangDatabase (-Mode=GenerateClangDatabase): 写到引擎根目录
  //   <EngineRoot>/compile_commands.json
  // Native (-projectfiles): 只生成 .vcxproj，**不**生成 compile_commands.json
  //
  const candidates = [
    // 优先：UE 5.x GenerateClangDatabase 默认输出到引擎根目录
    path.join(opts.engineRoot, FILE_NAME_COMPILE_COMMANDS),
    // 备选：项目目录的 .vscode/vscodeuehelper/（linkToWorkspaceRoot 目标位置）
    path.join(projectDir, '.vscode', 'vscodeuehelper', FILE_NAME_COMPILE_COMMANDS),
    // 备选：项目目录根
    path.join(projectDir, FILE_NAME_COMPILE_COMMANDS),
    // 备选：引擎根目录的 .vscode/<项目名>/（旧版 Native 模式可能）
    path.join(opts.engineRoot, '.vscode', projectName, FILE_NAME_COMPILE_COMMANDS),
    // 兼容 unreal-clangd 的输出目录名
    path.join(opts.engineRoot, '.vscode', 'unreal-clangd', FILE_NAME_COMPILE_COMMANDS),
  ];

  log.info(`[generateCompileCommands] searching compile_commands.json in candidates: ${JSON.stringify(candidates)}`);

  // 找到**第一个存在且非空**的文件
  for (const p of candidates) {
    try {
      const stat = await fs.stat(p);
      if (stat.size > 2) {
        // > 2 字节：避免空数组 []
        log.info(`[generateCompileCommands] found compile_commands.json at: ${p} (${stat.size} bytes)`);

        // [Phase 7 D-08] 写入缓存，供下次快速命中
        if (cachedEntry?.ccPath !== p) {
          try {
            // 重新计算一次以获取稳定 fingerprint（含 computedMs 用于诊断）
            const fp = await computeFingerprint(path.dirname(opts.project));
            await cache.write(path.dirname(opts.project), {
              fingerprint: fp.fingerprint,
              ccPath: p,
              linkTarget: p,
              savedAt: new Date().toISOString(),
              fileCount: 0,
            });
            log.info(
              `[perf] compileCommands cache WRITTEN (fingerprint=${fp.fingerprint.slice(0, 12)}...)`,
            );
          } catch (cacheErr) {
            // 写缓存失败：不阻塞主流程（per T-7-04 防御原则）
            const msg = cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
            log.warn(`[perf] failed to write compileCommands cache: ${msg}`);
          }
        }

        return p;
      } else {
        log.warn(`[generateCompileCommands] ${p} exists but is empty (${stat.size} bytes), continuing search`);
      }
    } catch {
      // not here
    }
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

/* ------------------------------------------------------------------ */
/*  linkToWorkspaceRoot                                                  */
/* ------------------------------------------------------------------ */

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
): Promise<string> {
  const projectDir = path.dirname(projectPath);
  const ccDir = path.join(projectDir, '.vscode', 'vscodeuehelper');
  const target = path.join(ccDir, FILE_NAME_COMPILE_COMMANDS);
  logger?.info(
    `[linkToWorkspaceRoot] ENTRY jsonPath=${jsonPath}, projectPath=${projectPath}, ` +
      `projectDir=${projectDir}, target=${target}`
  );

  // 如果生成的已经在目标位置，无需操作
  if (path.resolve(jsonPath) === path.resolve(target)) {
    logger?.info(`[linkToWorkspaceRoot] already at target, skip`);
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
        `isFile=${stat.isFile()}, size=${stat.size}`
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
      `[linkToWorkspaceRoot] no existing target (lstat failed: ${err instanceof Error ? err.message : String(err)})`
    );
  }

  // 先尝试 symlink
  try {
    logger?.info(`[linkToWorkspaceRoot] trying fs.symlink(${jsonPath}, ${target}, 'file')`);
    await fs.symlink(jsonPath, target, 'file');
    logger?.info(`[linkToWorkspaceRoot] fs.symlink SUCCEEDED → ${target}`);
  } catch (symlinkErr) {
    const symlinkMsg = symlinkErr instanceof Error ? symlinkErr.message : String(symlinkErr);
    const errno =
      typeof (symlinkErr as NodeJS.ErrnoException)?.code === 'string'
        ? (symlinkErr as NodeJS.ErrnoException).code
        : 'UNKNOWN';
    logger?.info(
      `[linkToWorkspaceRoot] fs.symlink FAILED errno=${errno} msg=${symlinkMsg}; ` +
        `falling back to fs.copyFile`
    );

    // Symlink 在 Windows 非 Developer Mode 下可能失败，回退 copy。
    // copyFile 必须独立 try-catch —— 如果它也失败（比如 jsonPath 不存在），整个
    // linkToWorkspaceRoot 不应静默吞错：把错误信息打到日志并重新抛出，让上层
    // createProject step 2 知道这是真的失败。
    try {
      logger?.info(`[linkToWorkspaceRoot] trying fs.copyFile(${jsonPath}, ${target})`);
      await fs.copyFile(jsonPath, target);
      logger?.info(`[linkToWorkspaceRoot] fs.copyFile SUCCEEDED → ${target}`);
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
            .catch(() => 'no')}`
      );
      throw new Error(
        `linkToWorkspaceRoot: both symlink and copy failed. ` +
          `symlink errno=${errno} (${symlinkMsg}), copy errno=${copyErrno} (${copyMsg}). ` +
          `source=${jsonPath}, target=${target}`
      );
    }
  }
  logger?.info(`[linkToWorkspaceRoot] done: ${target}`);
  return target;
}

/* ------------------------------------------------------------------ */
/*  isClangdAvailable                                                    */
/* ------------------------------------------------------------------ */

/**
 * 检查 clangd 是否在 PATH 中可执行。
 */
export async function isClangdAvailable(): Promise<boolean> {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(cmd, ['clangd']);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  补全缺失的 compile_commands.json 条目                                */
/* ------------------------------------------------------------------ */

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
async function discoverSourceRoots(
  projectDir: string,
  logger?: Logger,
): Promise<string[]> {
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
            logger?.debug(`[fillMissingCompileCommands] discovered plugin source root: ${pluginSource}`);
          }
        } catch {
          // 插件没有 Source 目录，跳过
        }
      }
    }
  } catch {
    // Plugins 目录不存在或不可读，跳过
    logger?.warn('[fillMissingCompileCommands] Plugins directory not found or not readable, skipping plugin source discovery');
  }

  return roots;
}

/**
 * 递归扫描目录下所有源文件（.cpp/.h/.hpp/.c）
 */
async function scanDirRecursive(
  dir: string,
  logger?: Logger,
): Promise<string[]> {
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
    logger?.warn(`[fillMissingCompileCommands] scan failed for ${dir}: ${err instanceof Error ? err.message : String(err)}`);
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
    return missingKey.startsWith(rootKey + '/') || missingKey.startsWith(rootKey.replace(/\\/g, '/').toLowerCase() + '/');
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
): Promise<FillResult | undefined> {
  const projectDir = path.dirname(projectPath);

  logger?.info(`[fillMissingCompileCommands] ENTRY jsonPath=${jsonPath}, projectDir=${projectDir}`);

  // 1. 读取现有的 compile_commands.json
  let entries: { file: string; directory: string; command?: string; arguments?: string[] }[];
  try {
    const content = await fs.readFile(jsonPath, 'utf-8');
    entries = JSON.parse(content) as { file: string; directory: string; command?: string; arguments?: string[] }[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.error(`[fillMissingCompileCommands] failed to read existing JSON: ${msg}`);
    return undefined;
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    logger?.warn('[fillMissingCompileCommands] existing JSON is empty or not an array, skip filling');
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
  logger?.info(`[fillMissingCompileCommands] found ${allSourceFiles.length} source files across ${sourceRoots.length} roots`);

  // 5. 找出缺失的文件（用规范化键比较）
  const missingFiles = allSourceFiles.filter((f) => !existingFileKeys.has(normalizeComparableKey(f)));
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
      logger?.warn(`[fillMissingCompileCommands] no suitable template for: ${missingFile}, skipping`);
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
      `[fillMissingCompileCommands] SUCCESS: added ${added.length} entries, total now ${entries.length}`
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
