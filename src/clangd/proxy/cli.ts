/**
 * cli.ts —— clangd LSP 代理 CLI 入口
 *
 * 职责：
 * - 解析 CLI 参数（代理参数 + -- 分隔符 + 真实 clangd 参数）
 * - 验证 --real-clangd 必填
 * - 创建 ProcessBridge 连接真实 clangd
 * - 创建 LspBridge 处理 LSP 消息
 * - 注册信号处理器
 * - 返回 DoneClaim JSON 摘要
 *
 * 设计原则：
 * - parseArgs 为纯函数，不依赖 I/O
 * - runProxy 通过 CliIo 接口注入 stderr/exit，可测试
 * - 不依赖 vscode
 * - 不写入 stdout（stdout 是 LSP 协议通道）
 * - 日志通过 stderr 或日志文件
 */

import { spawn } from 'node:child_process';
import { ProcessBridge } from './processBridge';
import { LspBridge, type LocalizationOptions } from './bridge';
import { createProxyLogFn, realIo, realStdio, wireBridgeStdio } from './cliRuntime';
import { parseArgs } from './cliArgs';
import { loadLocalizationFromSettings } from './settingsReader';
import { UeDocLookup } from './ueDocLookup';
import { setDocLookup } from './localization';
import { GeneratedHeaderWatcher } from './generatedHeaderWatcher';
import { UeDiagnosticWatcher } from './ueDiagnosticWatcher';
import type { Logger } from '@core/logger';
import type { CliIo, CliStdio } from './cliRuntime';

export { parseArgs } from './cliArgs';
export type { CliIo, CliStdio } from './cliRuntime';
export type { CliOptions, ParseArgsResult } from './cliArgs';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** DoneClaim —— 任务完成声明 */
export interface DoneClaim {
  /** 状态 */
  status: 'ok' | 'error';
  /** 修改的文件列表 */
  changedFiles: string[];
  /** 执行的命令/函数列表 */
  commands: string[];
  /** 证据文件路径 */
  evidence: string;
  /** 清理操作列表 */
  cleanup: string[];
  /** 风险列表 */
  risks: string[];
}

/** CLI 入口自启动选项（测试注入用） */
export interface EntrypointOptions {
  /** 是否作为可执行入口启动 */
  readonly isEntrypoint?: boolean;
  /** 启动参数 */
  readonly argv?: string[];
  /** 代理运行函数 */
  readonly run?: (argv: string[]) => DoneClaim;
}

// ---------------------------------------------------------------------------
// runProxy —— 代理入口
// ---------------------------------------------------------------------------

/**
 * 运行 clangd LSP 代理。
 *
 * 解析参数、创建 ProcessBridge + LspBridge、注册信号处理器。
 * 通过 CliIo 接口注入 I/O，便于测试。
 *
 * @param argv - 命令行参数
 * @param io - I/O 接口（默认 process.stderr/exit）
 * @param spawnFn - 可选的 spawn 函数（用于测试注入）
 * @returns DoneClaim 完成声明
 */
export function runProxy(
  argv: string[],
  io: CliIo = realIo,
  spawnFn: typeof spawn = spawn,
  stdio: CliStdio = realStdio,
): DoneClaim {
  const { options, errors } = parseArgs(argv);

  if (errors.length > 0) {
    for (const err of errors) {
      io.stderrWrite(`[clangd-proxy] ERROR: ${err}`);
    }
    io.exit(2);
    return {
      status: 'error',
      changedFiles: ['src/clangd/proxy/cli.ts'],
      commands: ['parseArgs'],
      evidence: '',
      cleanup: [],
      risks: ['Missing --real-clangd argument'],
    };
  }

  const logFn = createProxyLogFn(options.logPath, io);

  logFn(`[clangd-proxy] argv: ${JSON.stringify(argv)}`);
  logFn(`[clangd-proxy] parsed: localizationEnabled=${options.localizationEnabled}, mode=${options.localizationMode}, realClangd=${options.realClangd}`);

  // 构造本地化选项：优先级 CLI 参数 > settings.json > 不启用
  const localization: LocalizationOptions | undefined = options.localizationEnabled
    ? { enabled: true, mode: options.localizationMode }
    : loadLocalizationFromSettings(logFn);

  logFn(`[clangd-proxy] localization ${localization ? `ENABLED (mode=${localization.mode})` : 'DISABLED'}`);

  // 加载 UE 文档词典
  if (options.dictionaryPath) {
    try {
      const lookup = new UeDocLookup();
      lookup.load(options.dictionaryPath);
      setDocLookup(lookup);
      logFn(`[clangd-proxy] UE docs dictionary loaded: ${lookup.size()} entries from ${options.dictionaryPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logFn(`[clangd-proxy] WARNING: failed to load dictionary from ${options.dictionaryPath}: ${msg}`);
    }
  }

  // 信号处理器清理
  let cleanupSignalHandlers: (() => void) | null = null;

  // initialize 响应是 CLI 是否真正进入 LSP 会话的边界。
  // 如果子进程在此之前 code=0 关闭，VS Code 会看到“正常退出”并进入重启循环，必须改报失败。
  let initializeCompleted = false;

  // 子进程关闭/错误时的清理函数
  const onChildEvent = (): void => {
    if (cleanupSignalHandlers) {
      cleanupSignalHandlers();
    }
  };

  // 创建 ProcessBridge（子进程适配器）
  const processBridge = new ProcessBridge({
    clangdPath: options.realClangd,
    clangdArgs: options.realClangdArgs,
    log: logFn,
    spawnFn,
    onChildClose: (code, signal) => {
      const exitCode = code === 0 && !initializeCompleted ? 1 : code ?? 1;
      if (code === 0 && !initializeCompleted) {
        logFn('[clangd-proxy] clangd exited before initialize response; reporting failure to prevent restart loop');
      }
      logFn(`[clangd-proxy] clangd exited (code=${code}, signal=${signal ?? 'none'})`);
      onChildEvent();
      io.exit(exitCode);
    },
    onChildError: (error) => {
      logFn(`[clangd-proxy] clangd error: ${error.message}`);
      onChildEvent();
      io.exit(1);
    },
  });

  // 创建 LspBridge（LSP 代理桥接）
  // ProcessBridge 已实现 ServerTransport 接口，直接传递
  const bridge = new LspBridge(processBridge, {
    keepaliveMax: options.keepaliveMax,
    keepaliveTtlSec: options.keepaliveTtlSec,
    localization,
    log: logFn,
    hooks: {
      onServerResponse: (msg, method) => {
        if (method === 'initialize' && msg.error === undefined) {
          initializeCompleted = true;
        }
      },
      // [Phase 8] 转发诊断给 UE 诊断监听器
      onPublishDiagnostics: (params) => {
        void ueDiagnosticWatcher?.handleDiagnostics(params);
      },
    },
  });

  wireBridgeStdio(stdio, bridge);

  // [Phase 8] 创建 UE 诊断监听器（被动响应模式：诊断到 UE 报错 → 触发 UBT）
  let ueDiagnosticWatcher: UeDiagnosticWatcher | null = null;
  if (options.projectDir && options.engineRoot) {
    ueDiagnosticWatcher = new UeDiagnosticWatcher(
      bridge,
      {
        info: logFn,
        warn: logFn,
        error: logFn,
        debug: logFn,
      } as Logger,
      {
        projectDir: options.projectDir,
        engineRoot: options.engineRoot,
        triggerThreshold: options.ueDiagnosticTriggerThreshold,
        minUbtIntervalMs: options.ueDiagnosticMinUbtIntervalMs,
        maxRetries: options.ueDiagnosticMaxRetries,
      },
    );
    logFn(`[clangd-proxy] UeDiagnosticWatcher started for ${options.projectDir}`);
  }

  // [Phase 8] 启动 .generated.h 变化监听器 + clangd 主动通知（主动模式，可选）
  let generatedHeaderWatcher: GeneratedHeaderWatcher | null = null;
  if (options.projectDir && options.enableGeneratedHeaderWatcher) {
    generatedHeaderWatcher = new GeneratedHeaderWatcher(bridge, {
      info: logFn,
      warn: logFn,
      error: logFn,
      debug: logFn,
    } as Logger);
    generatedHeaderWatcher.start(options.projectDir);
    logFn(`[clangd-proxy] GeneratedHeaderWatcher started for ${options.projectDir}`);
  }

  // 注册信号处理器
  const handleSignal = (): void => {
    logFn('[clangd-proxy] received signal, flushing...');
    generatedHeaderWatcher?.dispose();
    ueDiagnosticWatcher?.dispose();
    bridge.handleSignal();
    bridge.close();
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  cleanupSignalHandlers = (): void => {
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
  };

  logFn(`[clangd-proxy] started (pid=${processBridge.pid ?? 'unknown'})`);

  return {
    status: 'ok',
    changedFiles: ['src/clangd/proxy/cli.ts', 'src/clangd/proxy/status.ts'],
    commands: ['parseArgs', 'runProxy', 'ProcessBridge', 'LspBridge'],
    evidence: '.omo/evidence/task-13-clangd-lsp-proxy-localization.log',
    cleanup: [
      'process.off SIGINT/SIGTERM handlers',
      'bridge.close() on child exit',
    ],
    risks: [
      'ProcessBridge spawn failure if clangd not found',
      'LspBridge keepalive memory usage under high document churn',
      'Log file unwritable falls back to stderr, does not corrupt stdout',
    ],
  };
}

/**
 * 在 CommonJS bundle 作为 launcher 目标执行时自动启动代理。
 */
export function runProxyWhenExecutedAsEntrypoint(options?: EntrypointOptions): void {
  const isEntrypoint = options?.isEntrypoint ?? require.main === module;
  if (!isEntrypoint) {
    return;
  }

  const argv = options?.argv ?? process.argv.slice(2);
  const run = options?.run ?? runProxy;
  run(argv);
}

runProxyWhenExecutedAsEntrypoint();
