/**
 * task —— UBT 子进程执行 + 参数构建 + 工具链发现
 *
 * 从 `compileCommands.ts` 拆出 (T4.5)，保持原行为 1:1：
 *   - executeShellTask: VS Code Task API 包裹的 shell 执行，AbortSignal 通过参数传入
 *   - getShellQuoting: Windows PowerShell strong 引用 + Unix weak 引用
 *   - buildNativeArgs / buildNonNativeArgs: UBT 命令行参数构造（双路径）
 *   - findClangToolchain: `where clang` → LLVM_PATH 反推
 *   - isClangdAvailable: `which clangd` 检查
 *
 * 模块级 `optsSignal` 全局变量被去除（per 拆分清理），改为函数参数显式传递。
 * 该变量是 module-private，原行为由调用顺序：generateCompileCommands → executeShellTask
 * 同一 Promise tick 内完成，全局变量副作用可忽略，参数化更干净。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import { getUbtPath, getBuildTargetNames } from '../ueHelpers';

/** Windows-only：本插件唯一支持的 Unreal 平台。 */
const WIN64_PLATFORM = 'Win64';

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
/**
 * 跳过 codegen（UHT 之外的编译动作）。GenerateClangDatabase 模式下加此参数，
 * UBT 只生成 compile DB 不继续把 .cpp 编译成 .o，IntelliSense 场景省去无谓 codegen。
 */
const UPDATE_COMPILE_COMMANDS_ARG_NO_CODEGEN = '-NoExecCodeGenActions';

/** Windows PowerShell 可执行文件名 */
const POWERSHELL_FILE_NAME = 'PowerShell.exe';

/** Task 名称 */
const UPDATE_COMPILE_COMMANDS_DBGCFG_NAME = 'unreal-clangd: Update Compile Commands';

/* ------------------------------------------------------------------ */
/*  类型定义                                                            */
/* ------------------------------------------------------------------ */

/** buildNativeArgs / buildNonNativeArgs 的输入参数（来自 GenerateOptions 的子集） */
export interface BuildArgsOptions {
  /** Absolute path to .uproject. */
  project: string;
  /** Absolute path to engine root. */
  engineRoot: string;
  /** [Phase 8] 可选 WorkspaceState 注入。提供时优先用 workspace 派生路径。 */
  workspace?: WorkspaceState;
  /** 目标平台（如 Win64 / Linux / Mac），默认自动检测。 */
  platform?: string;
  /** 目标架构（如 x64 / arm64），可选。 */
  architecture?: string;
  /**
   * UBT buildType（如 Development / DebugGame / Debug），默认 'Development'。
   * 联动 config.configuration。
   */
  buildType?: string;
}

/* ------------------------------------------------------------------ */
/*  Shell 引用辅助                                                      */
/* ------------------------------------------------------------------ */

/**
 * 对齐原版 getShellQuoting（Windows-only）—— Windows 用 Strong 引用包裹 args。
 */
export function getShellQuoting(
  command: string,
  args: string[],
): {
  command: vscode.ShellQuotedString | string;
  args: (vscode.ShellQuotedString | string)[];
} {
  const modArgs: vscode.ShellQuotedString[] = args.map((arg) => ({
    value: arg,
    quoting: vscode.ShellQuoting.Strong,
  }));
  return {
    command: { value: command, quoting: vscode.ShellQuoting.Strong },
    args: modArgs,
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
 * @param signal AbortSignal 触发时立即 disposes listener + reject('Task cancelled')
 * @returns exit code（UBT -projectfiles 和 -mode=GenerateClangDataBase 可能返回 1，视为正常）
 */
export function executeShellTask(
  cmd: string,
  args: ReadonlyArray<string>,
  cwd: string,
  log: Logger,
  env?: Record<string, string>,
  signal?: AbortSignal,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    // [Phase 11 SSoT 包 6] 反查 vscode.WorkspaceFolder 必须用原生 vscode API——vscode.Task(scope:) 签名只接受原生类型
    // eslint-disable-next-line no-restricted-syntax -- vscode.Task(scope:) 签名只接受原生 vscode.WorkspaceFolder
    const unrealFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cwd));
    const scope = unrealFolder;
    if (!scope) {
      reject(new Error('No workspace folder open. Please open a .code-workspace first.'));
      return;
    }

    const task: vscode.Task = new vscode.Task(
      { type: TASK_TYPE },
      scope,
      UPDATE_COMPILE_COMMANDS_DBGCFG_NAME,
      CONFIG_SECTION_UNREAL_CLANGD,
      vscode.ShellExecution,
    );

    task.group = vscode.TaskGroup.Build;
    task.problemMatchers = ['$msCompile'];

    // Shell quoting
    const quoted = getShellQuoting(cmd, [...args]);

    // Windows-only：使用 PowerShell 作为 shell executable
    const shellExec = POWERSHELL_FILE_NAME;

    (task as { execution: vscode.ShellExecution }).execution = new vscode.ShellExecution(
      quoted.command,
      quoted.args,
      { cwd, executable: shellExec, env },
    );

    log.info(`[compileCommands/task] executing: ${cmd} ${[...args].join(' ')}`);
    log.info(`[compileCommands/task] cwd: ${cwd}, shell: ${shellExec ?? 'default'}`);

    vscode.tasks.executeTask(task).then(
      (execution) => {
        const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
          if (e.execution === execution) {
            disposable.dispose();
            if (e.exitCode === 0 || e.exitCode === 1) {
              // UBT -projectfiles 和 -mode=GenerateClangDataBase 都可能返回 exit code 1
              // 在成功场景下，对齐原版行为视为正常完成
              log.info(`[compileCommands/task] task exited with code ${e.exitCode}`);
              resolve(e.exitCode ?? -1);
            } else {
              reject(new Error(`UBT task exited with code ${e.exitCode}`));
            }
          }
        });

        // AbortSignal：参数化（per 拆分清理，去掉模块级全局变量）
        if (signal) {
          const onAbort = (): void => {
            disposable.dispose();
            reject(new Error('Task cancelled'));
          };
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener('abort', onAbort, { once: true });
          }
        }
      },
      (err) => reject(err),
    );
  });
}

/* ------------------------------------------------------------------ */
/*  Non-Native 路径：构造 UBT 参数                                       */
/* ------------------------------------------------------------------ */

/**
 * 构造 Non-Native（GenerateClangDatabase）路径的 UBT 参数：
 *
 *   <buildTargetName> <unrealPlatform> <buildType> <uprojectPath>
 *   -Mode=GenerateClangDatabase [-architecture=<arch>] -NoExecCodeGenActions
 *
 * - buildType 联动 config.configuration（默认 Development）
 * - -NoExecCodeGenActions 跳过 codegen，只产 compile DB（P0-1 提速）
 */
export async function buildNonNativeArgs(opts: BuildArgsOptions): Promise<string[]> {
  const projectDir = opts.workspace?.projectDir ?? path.dirname(opts.project);

  // 1. 查找 build target names
  const targetNames = await getBuildTargetNames(projectDir);
  if (targetNames.length === 0) {
    throw new Error(
      `No *.Target.cs files found in ${path.join(projectDir, 'Source')}. ` +
        'A build target is required for Non-Native compile commands generation.',
    );
  }

  // 取第一个（已按 Editor 后缀优先排序）
  const buildTargetName = targetNames[0];
  if (!buildTargetName) {
    throw new Error('未找到可用的构建目标');
  }

  // 2. Unreal platform（Windows-only）
  const unrealPlatform = opts.platform ?? WIN64_PLATFORM;

  // buildType 联动 config.configuration（默认 Development）
  const buildType = opts.buildType ?? UPDATE_COMPILE_COMMANDS_ARG_DEVELOPMENT;

  const args: string[] = [
    buildTargetName,
    unrealPlatform,
    buildType,
    opts.project,
    UPDATE_COMPILE_COMMANDS_ARG_GEN_CLANGDB,
  ];

  // 3. Architecture（可选）
  if (opts.architecture) {
    args.push(`${UPDATE_COMPILE_COMMANDS_ARG_ARCHITECTURE_EMPTY}${opts.architecture}`);
  }

  // 4. 跳过 codegen：GenerateClangDatabase 模式下只需 compile DB，无需继续编译 .cpp（P0-1）
  args.push(UPDATE_COMPILE_COMMANDS_ARG_NO_CODEGEN);

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
export function buildNativeArgs(opts: Pick<BuildArgsOptions, 'project'>): string[] {
  return ['-projectfiles', `-project=${opts.project}`, '-game', '-engine', '-dotnet'];
}

/* ------------------------------------------------------------------ */
/*  LLVM 工具链发现                                                      */
/* ------------------------------------------------------------------ */

/**
 * 通过 `where clang` 定位 clang.exe，反推 LLVM 根目录。
 * 返回 undefined 表示未找到——调用方应降级处理。
 */
export async function findClangToolchain(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('where', ['clang']);
    const clangPath = stdout.trim().split('\n')[0]?.trim();
    if (!clangPath) {
      return undefined;
    }
    // clang.exe → bin/ → LLVM root
    return path.dirname(path.dirname(clangPath));
  } catch {
    return undefined;
  }
}

/**
 * 检查 clangd 是否在 PATH 中可执行。
 */
export async function isClangdAvailable(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('where', ['clangd']);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// 重新导出 getUbtPath 方便调用方一处 import（公共 API 不变）
export { getUbtPath };
