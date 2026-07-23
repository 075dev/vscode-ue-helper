/**
 * uhtGeneration.ts —— UHT pre-codegen 工具（纯 Node，零 vscode 依赖）
 *
 * ## 职责
 *
 * 主动跑一次 UBT `-Mode=UnrealHeaderTool`，把所有模块的 `.generated.h` 写出来。
 * 即使项目存在 build 错误（unresolved symbol / 缺类型），仍可先完成 UHT codegen，
 * 让 fallback compile_commands / 兼容头 / stub 头分工兜底，最终 clangd 仍能给出基本提示。
 *
 * 导出：
 *   - `runUhtCodegen(opts): Promise<UhtResult>` —— 主入口
 *   - `UhtResult` —— 返回结构
 *   - `MinimalLogger` —— 解耦的最小 logger 接口（避免本模块引入 vscode 依赖）
 *
 * ## 设计原则
 *
 * - 零 vscode 依赖（与 `src/clangd/proxy/*` 同性质，可被 extension 主进程和 proxy CLI 共享）
 * - spawn 模式完全对齐 `src/clangd/proxy/ueDiagnosticWatcher.ts:339-414` 已验证的
 *   dotnet + UnrealBuildTool.dll + `-Target="..." -waitmutex` argv 结构
 * - UBT 退出码非 0 也算 `ran: true`（UHT 在 fatal 错误前可能已写完 `.generated.h`，
 *   partial 结果对 fallback 仍有价值）
 * - AbortSignal 中途取消：先 SIGTERM，500ms 后升级 SIGKILL，不抛错，返回已扫到的
 *   `generatedHeaderCount`
 * - 默认 5 分钟超时（300000ms），可通过 `timeoutMs` 覆盖
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { validateUbtArgs } from './proxy/ueDiagnosticWatcher';
import { collectIntermediateUhtDirs } from './intermediateUhtCollector';

/** 最小 logger 接口 — 与 `src/core/logger` 解耦，零 vscode 依赖 */
export type MinimalLogger = {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

/** 默认超时：5 分钟 */
const DEFAULT_TIMEOUT_MS = 300000;

/** SIGTERM 后升级到 SIGKILL 的等待时间（毫秒） */
const SIGKILL_DELAY_MS = 500;

/** UBT 进程输出日志最大长度（避免 logger.warn 撑爆） */
const UBT_OUTPUT_LOG_HEAD = 2000;
const UBT_OUTPUT_LOG_TAIL = 500;

/**
 * `runUhtCodegen` 入参。
 *
 * 注意：`project` 是 `.uproject` 文件的绝对路径，不是项目目录。
 * 与 `ueDiagnosticWatcher.findUprojectFile()` 的输出一致——上游调用者解析好传入。
 */
export interface RunUhtCodegenOptions {
  /** `.uproject` 文件绝对路径（由调用方从 detection 解析后传入） */
  project: string;
  /** UE 引擎根目录 */
  engineRoot: string;
  /** Build target 名称（如 `XianDreamwalkingEditor`） */
  buildTargetName: string;
  /** Build type / Configuration（如 `Development` / `DebugGame` / `Shipping`） */
  buildType: string;
  /** 日志接收器（自定义 MinimalLogger，零 vscode 依赖） */
  logger: MinimalLogger;
  /** 中止信号（可选） */
  signal?: AbortSignal;
  /** 超时毫秒（默认 300000 = 5 min） */
  timeoutMs?: number;
  /**
   * 内部测试钩子：替换 `spawn` 实现，便于 fake 子进程单元测试。
   * 公开字段，生产代码不传。
   */
  spawnFn?: typeof spawn;
}

/** `runUhtCodegen` 返回值。 */
export interface UhtResult {
  /** UBT 子进程是否成功 spawn（即使被 abort 或 exit code !== 0 仍 `ran: true`） */
  ran: boolean;
  /** UBT 退出码（`null` 表示 spawn 失败或被 signal 终止） */
  exitCode: number | null;
  /** 实际生成的 `.generated.h` 文件数（`size > 0` 过滤后） */
  generatedHeaderCount: number;
  /** 实际生成的 `.generated.h` 绝对路径列表 */
  generatedHeaderPaths: string[];
  /** 错误描述。UBT 退出码非 0 不算错；只有 spawn 抛错 / dotnet 缺失 / abort 时设置 */
  errorMessage?: string;
}

/**
 * `process.platform` → UE 平台字符串。Windows-only：本插件仅服务 Win64。
 */
function platformString(): string {
  return 'Win64';
}

/**
 * 定位 bundled dotnet。
 *
 * 沿用 `ueDiagnosticWatcher.runUbt` 的扫描策略：依次读
 * `<engineRoot>/Engine/Binaries/ThirdParty/DotNet/<version>/win-x64/dotnet.exe`，
 * 找到任一版本即返回该版本目录（用于设置 `DOTNET_ROOT` / `PATH` 前缀）。
 *
 * @throws {Error} 找不到任何 dotnet.exe 时抛错（含扫描基路径，便于诊断）
 */
async function resolveDotnet(
  engineRoot: string,
): Promise<{ dotnetExe: string; dotnetVersionDir: string }> {
  const dotnetBaseDir = path.join(engineRoot, 'Engine', 'Binaries', 'ThirdParty', 'DotNet');
  let versions: string[];
  try {
    versions = await fs.readdir(dotnetBaseDir);
  } catch {
    throw new Error(`bundled dotnet not found under ${dotnetBaseDir}`);
  }
  for (const v of versions) {
    const candidate = path.join(dotnetBaseDir, v, 'win-x64', 'dotnet.exe');
    try {
      await fs.access(candidate);
      return { dotnetExe: candidate, dotnetVersionDir: path.dirname(candidate) };
    } catch {
      /* 该版本目录无 dotnet.exe，继续下一个 */
    }
  }
  throw new Error(`bundled dotnet not found under ${dotnetBaseDir}`);
}

/**
 * 扫描 `projectDir` 下所有 `Intermediate/Build/<PlatformCfg>/<Target>/Inc/<Module>/UHT/*.generated.h`。
 *
 * 复用 `collectIntermediateUhtDirs()` 找到所有 UHT 目录；再在每个目录里过滤
 * `.generated.h` 后缀且 `size > 0`（空文件可能是 UHT 启动瞬间留下的占位符）。
 */
async function scanGeneratedHeaders(projectDir: string): Promise<string[]> {
  const uhtDirs = await collectIntermediateUhtDirs({ projectDir });
  const result: string[] = [];
  for (const dir of uhtDirs) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile()) {
        continue;
      }
      if (!e.name.endsWith('.generated.h')) {
        continue;
      }
      const full = path.join(dir, e.name);
      try {
        const stat = await fs.stat(full);
        if (stat.size > 0) {
          result.push(full);
        }
      } catch {
        /* 文件中途被删除或权限丢失，跳过 */
      }
    }
  }
  return result;
}

/** 渲染 abort / 退出原因（用于 `UhtResult.errorMessage`） */
function describeExit(exitCode: number | null, aborted: boolean): string | undefined {
  if (aborted) {
    return 'UBT aborted by signal or timeout';
  }
  if (exitCode === null) {
    return undefined;
  }
  return undefined;
}

/**
 * 运行 UBT `-Mode=UnrealHeaderTool` codegen。
 *
 * 行为契约：
 * - UBT 退出码非 0 也算 `ran: true` —— UHT 在 fatal 错误前可能已写完 `.generated.h`，
 *   partial 结果对 fallback 仍有价值；
 * - AbortSignal 中途 abort：先 `SIGTERM`，500ms 内未退出升级 `SIGKILL`，**不抛错**，
 *   返回 `ran: true` + 已扫到的 `generatedHeaderCount`；
 * - 无 dotnet 路径时 throw `Error('bundled dotnet not found under ...')`。
 *
 * @throws {Error} 找不到 bundled dotnet 时
 * @throws {import('./proxy/ueDiagnosticWatcher').UBTArgsValidationError} buildTargetName / project 白名单校验失败时
 */
export async function runUhtCodegen(opts: RunUhtCodegenOptions): Promise<UhtResult> {
  const { project, engineRoot, buildTargetName, buildType, logger, signal, timeoutMs } = opts;
  const spawnFn: typeof spawn = opts.spawnFn ?? spawn;

  // [T5.2] UBT 参数白名单校验 —— 防止 UBT ParseCommandLine 被恶意值诱导
  validateUbtArgs(buildTargetName, project);

  // dotnet 解析（找不到直接 throw，对应 Case (d)）
  const { dotnetExe, dotnetVersionDir } = await resolveDotnet(engineRoot);

  const platform = platformString();
  const ubtDll = path.join(
    engineRoot,
    'Engine',
    'Binaries',
    'DotNET',
    'UnrealBuildTool',
    'UnrealBuildTool.dll',
  );
  const engineSourceDir = path.join(engineRoot, 'Engine', 'Source');
  const projectDir = path.dirname(project);

  // argv 结构对齐 ueDiagnosticWatcher.runUbt 的 args 构造（line 359-368）
  // - UHT 模式只把 `-Target=...` 这一个 argv 传给 ParseCommandLine，
  //   内部 Split 空格 → Name / Platform / Config / `-Project=...`。
  // - `-Project=` 必须在 `-Target=` 值里，否则 ProjectFile=null → 找不到 target rules。
  //
  // H1-P0 REVERTED：之前尝试加 -EnableInputCacheRead/Write + -NoGoWide 加速 UHT，
  //   真实 XianDreamwalking 项目（10206 源文件）实测发现 InputCache 反而**慢 3-7 倍**：
  //     A 基线（无 cache） warm=3.94s（UHT 检测 manifest 未变 → 直接跳 codegen）
  //     B H1-P0  cold=19.6s（10206 文件全 parse + 写 652 cache entry）
  //         B warm=11.1s（10206 文件 cache hit + 652 cache 读，仍要 11s 启动 + 校验）
  //   UHT 启动本身（dotnet + UnrealBuildTool.dll 加载 + 10206 文件 hash 校验）就是大头，
  //   启用 cache 让 UHT 做更多工作。Rider 体感"无延迟"来自 IPC 复用 UE Editor 进程
  //   内嵌 UHT，我们 fork 新 dotnet 进程是物理限制，无法走 IPC 路径。
  //   结论：保留 UHT 子进程调用，但只跑必要工作（manifest hash 检测）—— 3-4s 已是最优。
  const args: string[] = [
    ubtDll,
    '-Mode=UnrealHeaderTool',
    `-Target=${buildTargetName} ${platform} ${buildType} -Project=${project}`,
    '-waitmutex',
  ];

  // bundled dotnet 需要的环境变量（per GetDotnetPath.bat）
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dotnetVersionDir}${path.delimiter}${process.env.PATH ?? ''}`,
    DOTNET_ROOT: dotnetVersionDir,
    DOTNET_MULTILEVEL_LOOKUP: '0',
    DOTNET_ROLL_FORWARD: 'LatestMajor',
  };

  logger.info(`[uhtGeneration] running UBT: dotnet ${args.join(' ')}`);

  const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // ── 启动 UBT 子进程 ────────────────────────────────────────
  const exitInfo = await new Promise<{
    exitCode: number | null;
    aborted: boolean;
    spawnError: string | null;
  }>((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnFn(dotnetExe, args, {
        cwd: engineSourceDir,
        env,
        windowsHide: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resolve({ exitCode: null, aborted: false, spawnError: `UBT spawn failed: ${msg}` });
      return;
    }

    let aborted = false;
    let stdoutBuf = '';
    let stderrBuf = '';

    const cleanupHandles = (): void => {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (sigkillHandle !== null) {
        clearTimeout(sigkillHandle);
        sigkillHandle = null;
      }
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    const killChild = (sig: NodeJS.Signals): void => {
      try {
        child.kill(sig);
      } catch {
        /* child 已退出，kill 抛错忽略 */
      }
    };

    let timeoutHandle: NodeJS.Timeout | null = null;
    let sigkillHandle: NodeJS.Timeout | null = null;
    let abortHandler: (() => void) | null = null;

    const triggerAbort = (reason: string): void => {
      if (aborted) {
        return;
      }
      aborted = true;
      logger.warn(`[uhtGeneration] ${reason}, killing UBT (SIGTERM)`);
      killChild('SIGTERM');
      // 500ms 后没退出就 SIGKILL
      sigkillHandle = setTimeout(() => {
        logger.warn(
          `[uhtGeneration] SIGTERM did not exit within ${SIGKILL_DELAY_MS}ms, escalating to SIGKILL`,
        );
        killChild('SIGKILL');
      }, SIGKILL_DELAY_MS);
    };

    // AbortSignal 监听
    if (signal) {
      if (signal.aborted) {
        triggerAbort('abort signal already fired');
      } else {
        abortHandler = (): void => {
          triggerAbort('abort signal received');
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    // 超时
    timeoutHandle = setTimeout(() => {
      triggerAbort(`timeout (${effectiveTimeout}ms) reached`);
    }, effectiveTimeout);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf-8');
    });

    child.on('error', (err) => {
      cleanupHandles();
      resolve({
        exitCode: null,
        aborted,
        spawnError: `UBT spawn error: ${err.message}`,
      });
    });

    child.on('close', (code) => {
      cleanupHandles();
      if (code !== 0 && !aborted) {
        const combined = stdoutBuf + stderrBuf;
        // 错误细节常在输出开头（末尾是 usage/总结）—— 截取头 + 尾便于诊断
        logger.warn(
          `[uhtGeneration] UBT exited with code ${code}. Output head:\n${combined.slice(0, UBT_OUTPUT_LOG_HEAD)}`,
        );
        logger.warn(`[uhtGeneration] UBT output tail:\n${combined.slice(-UBT_OUTPUT_LOG_TAIL)}`);
      }
      resolve({ exitCode: code, aborted, spawnError: null });
    });
  });

  // ── 扫描 Intermediate/UHT 目录，统计生成的 .generated.h ───────────────
  const generatedHeaderPaths = await scanGeneratedHeaders(projectDir);
  const generatedHeaderCount = generatedHeaderPaths.length;

  const result: UhtResult = {
    ran: true,
    exitCode: exitInfo.exitCode,
    generatedHeaderCount,
    generatedHeaderPaths,
  };

  // 错误信息优先级：spawn error > abort > 正常退出（exit code !== 0 不算错）
  if (exitInfo.spawnError) {
    result.errorMessage = exitInfo.spawnError;
  } else {
    const desc = describeExit(exitInfo.exitCode, exitInfo.aborted);
    if (desc) {
      result.errorMessage = desc;
    }
  }

  return result;
}

// 抑制 noUnusedLocals（ChildProcessWithoutNullStreams 仅在类型注解引用，避免重复 import）
export type { Readable };
