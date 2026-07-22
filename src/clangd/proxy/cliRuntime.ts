/**
 * cliRuntime.ts —— clangd LSP 代理 CLI 运行时 I/O 适配
 *
 * 职责：
 * - 定义可注入的 stderr/exit 与 stdio 协议通道
 * - 提供真实 process I/O 适配
 * - 创建只写 stderr/logPath 的日志函数
 * - 连接客户端 stdio 与 LSP 桥接器
 *
 * 设计原则：stdout 只承载 LSP 协议帧，日志永不写入 stdout。
 */

import { appendFileSync } from 'node:fs';
import type { LspBridge } from './bridge';

/** 可注入的 I/O 接口（用于测试，避免直接调用 process.stderr/exit） */
export interface CliIo {
  /** 写入 stderr */
  stderrWrite: (message: string) => void;
  /** 退出进程 */
  exit: (code: number) => void;
}

/** 可注入的 stdio 协议通道，stdout 只允许写 LSP 帧 */
export interface CliStdio {
  /** 客户端输入流 */
  readonly stdin: {
    on(event: 'data', handler: (chunk: Buffer | string) => void): unknown;
  };
  /** 客户端输出流 */
  readonly stdout: {
    write(chunk: Buffer): unknown;
  };
}

/** 真实 stdio 协议通道 */
export const realStdio: CliStdio = {
  stdin: process.stdin,
  stdout: process.stdout,
};

/** 真实 stderr/exit 实现 */
export const realIo: CliIo = {
  stderrWrite: (message: string) => process.stderr.write(message + '\n'),
  exit: (code: number) => process.exit(code),
};

/**
 * 创建 CLI 日志函数。
 *
 * 优先写入日志文件，日志文件不可写时回退 stderr；绝不写 stdout。
 */
export function createProxyLogFn(
  logPathOption: string | undefined,
  io: CliIo,
): (message: string) => void {
  let activeLogPath: string | null = null;

  if (logPathOption) {
    try {
      appendFileSync(logPathOption, '', { flag: 'a' });
      activeLogPath = logPathOption;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      io.stderrWrite(`[clangd-proxy] cannot open log file: ${msg}, falling back to stderr\n`);
    }
  }

  return (message: string): void => {
    if (activeLogPath) {
      try {
        appendFileSync(activeLogPath, message + '\n');
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        io.stderrWrite(`[clangd-proxy] log file write error: ${msg}, falling back to stderr\n`);
        activeLogPath = null;
      }
    }
    io.stderrWrite(message);
  };
}

/** 将注入 stdio 与 LSP 桥接器连接起来。 */
export function wireBridgeStdio(stdio: CliStdio, bridge: LspBridge): void {
  stdio.stdin.on('data', (chunk: Buffer | string) => {
    bridge.feedClientFrame(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  bridge.onClientOutput((frame: Buffer) => {
    stdio.stdout.write(frame);
  });
}
