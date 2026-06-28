/**
 * processBridge.ts —— 子进程适配器（ServerTransport 实现）
 *
 * 职责：
 * - 实现 ServerTransport 接口，包装真实 clangd 子进程
 * - 从 CLI args/options 获取 clangd 路径和参数
 * - 连接子进程 stdin/stdout
 * - 日志仅输出到 stderr 或配置文件（绝不写入 stdout）
 * - 子进程 close/error 和进程信号时刷新待处理 didClose
 *
 * 设计原则：
 * - 不依赖 vscode
 * - 不写入 stdout（stdout 是 LSP 协议通道）
 * - 日志通过 stderr 或配置的日志文件
 * - 可注入 spawn 函数以便测试
 */

import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ServerTransport } from './bridge';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 日志函数 */
export type LogFn = (message: string) => void;

/** 进程桥接选项 */
export interface ProcessBridgeOptions {
  /** clangd 可执行文件路径 */
  clangdPath: string;
  /** clangd 命令行参数 */
  clangdArgs: string[];
  /** 日志函数（写入 stderr 或日志文件） */
  log?: LogFn;
  /** 可选的 spawn 函数（用于测试注入） */
  spawnFn?: typeof spawn;
  /** 子进程关闭回调（触发 bridge.flush()） */
  onChildClose?: (code: number | null, signal: string | null) => void;
  /** 子进程错误回调（触发 bridge.flush()） */
  onChildError?: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// ProcessBridge
// ---------------------------------------------------------------------------

/**
 * 子进程桥接器。
 *
 * 实现 ServerTransport 接口，通过子进程 stdin/stdout 与 clangd 通信。
 * 日志仅输出到 stderr 或配置的日志函数，绝不写入 stdout。
 */
export class ProcessBridge implements ServerTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private dataHandler: ((data: Buffer) => void) | null = null;
  private readonly log: LogFn;
  private readonly spawnFn: typeof spawn;
  private readonly onChildCloseCb: ((code: number | null, signal: string | null) => void) | undefined;
  private readonly onChildErrorCb: ((error: Error) => void) | undefined;
  private closed = false;

  constructor(options: ProcessBridgeOptions) {
    this.log = options.log ?? (() => { /* 默认无日志 */ });
    this.spawnFn = options.spawnFn ?? spawn;
    this.onChildCloseCb = options.onChildClose;
    this.onChildErrorCb = options.onChildError;
    this.spawnChild(options.clangdPath, options.clangdArgs);
  }

  /**
   * 生成子进程。
   */
  private spawnChild(clangdPath: string, clangdArgs: string[]): void {
    try {
      this.child = this.spawnFn(clangdPath, clangdArgs, {
        windowsHide: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[processBridge] spawn failed: ${msg}`);
      return;
    }

    const child = this.child;

    // stdout → 原始字节转发给桥接器（桥接器有自己的帧解析器）
    child.stdout.on('data', (chunk: Buffer) => {
      this.dataHandler?.(chunk);
    });

    // stderr → 日志（clangd 的日志输出）
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trimEnd();
      if (text.length > 0) {
        this.log(`[clangd:stderr] ${text}`);
      }
    });

    // 子进程错误
    child.on('error', (err) => {
      this.log(`[processBridge] child error: ${err.message}`);
      this.onChildErrorCb?.(err);
    });

    // 子进程关闭
    child.on('close', (code, signal) => {
      this.log(
        `[processBridge] child closed (code=${code}, signal=${signal ?? 'none'})`,
      );
      this.onChildCloseCb?.(code, signal);
    });
  }

  // ─── ServerTransport 实现 ────────────────────────────────────

  /**
   * 向子进程 stdin 发送数据。
   *
   * @param data - 要发送的帧字节
   */
  send(data: Buffer): void {
    if (this.closed || !this.child || !this.child.stdin.writable) {
      this.log('[processBridge] cannot send: child not available');
      return;
    }
    try {
      this.child.stdin.write(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[processBridge] stdin write error: ${msg}`);
    }
  }

  /**
   * 注册子进程 stdout 数据回调。
   *
   * @param handler - 收到数据时调用
   */
  onData(handler: (data: Buffer) => void): void {
    this.dataHandler = handler;
  }

  /**
   * 关闭子进程。
   *
   * 先尝试优雅关闭（SIGTERM），超时后强制杀死。
   */
  close(): void {
    if (this.closed) {return;}
    this.closed = true;

    const child = this.child;
    if (!child) {return;}

    // 关闭 stdin，让 clangd 知道没有更多输入
    try {
      child.stdin.end();
    } catch {
      // 可能已经关闭
    }

    // 尝试优雅终止
    const killTimeout = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // 可能已经退出
      }
    }, 5000);

    // 如果子进程已经退出，清除超时
    const onExit = (): void => {
      clearTimeout(killTimeout);
    };
    child.on('exit', onExit);

    // 发送 SIGTERM
    try {
      child.kill('SIGTERM');
    } catch {
      // 可能已经退出
    }
  }

  /**
   * 子进程是否已关闭。
   */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * 子进程的 pid（可能为 undefined）。
   */
  get pid(): number | undefined {
    return this.child?.pid;
  }
}
