/**
 * cliFixtures.ts —— clangd proxy CLI 测试夹具
 *
 * 职责：
 * - 提供 fake child process、fake stdio 与 spawn 注入
 * - 避免测试触碰真实 stdin/stdout 或真实 clangd
 */

import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { encodeMessage, LspFramingParser } from '@clangd/proxy/framing';
import type { JsonRpcMessage } from '@clangd/proxy/framing';
import type { CliStdio } from '@clangd/proxy/cli';

/** 模拟子进程（复用 processBridge.test.ts 模式）。 */
export class FakeChild extends EventEmitter {
  public stdin = {
    writable: true,
    write: ((..._args: unknown[]) => true) as (...args: unknown[]) => boolean,
    end: (() => {}) as (...args: unknown[]) => void,
    on: () => this,
    once: () => this,
    emit: () => false,
  } as unknown as ChildProcessWithoutNullStreams['stdin'];

  public stdout = new EventEmitter() as ChildProcessWithoutNullStreams['stdout'];
  public stderr = new EventEmitter() as ChildProcessWithoutNullStreams['stderr'];
  public pid: number | undefined = 42;
  public killed = false;
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public stdinWriteCalls: Buffer[] = [];
  public stdinEndCalls = 0;

  kill(_signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    return true;
  }
}

/** 模拟 CLI stdio 协议通道。 */
export class FakeStdio extends EventEmitter implements CliStdio {
  public stdoutFrames: Buffer[] = [];

  readonly stdin = {
    on: (event: 'data', handler: (chunk: Buffer) => void): CliStdio['stdin'] => {
      this.on(event, handler);
      return this.stdin;
    },
  };

  readonly stdout = {
    write: (chunk: Buffer): boolean => {
      this.stdoutFrames.push(Buffer.from(chunk));
      return true;
    },
  };

  emitStdinFrame(message: JsonRpcMessage): void {
    this.emit('data', encodeMessage(message));
  }

  parseStdoutMessages(): JsonRpcMessage[] {
    const parser = new LspFramingParser();
    return parser.feed(Buffer.concat(this.stdoutFrames));
  }
}

/** 创建 fake spawn 函数。 */
export function createFakeSpawn(fakeChild: FakeChild): typeof import('node:child_process').spawn {
  return ((_cmd: string, _args: string[], _options?: unknown) => {
    fakeChild.stdin.write = ((chunk: Buffer) => {
      fakeChild.stdinWriteCalls.push(Buffer.from(chunk));
      return true;
    }) as ChildProcessWithoutNullStreams['stdin']['write'];

    fakeChild.stdin.end = (() => {
      fakeChild.stdinEndCalls++;
    }) as unknown as ChildProcessWithoutNullStreams['stdin']['end'];

    return fakeChild as unknown as ChildProcessWithoutNullStreams;
  }) as unknown as typeof import('node:child_process').spawn;
}
