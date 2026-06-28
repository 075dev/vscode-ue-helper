/**
 * cliStdio.test.ts —— CLI stdio 桥接单元测试
 *
 * 测试策略：
 * - runProxy 使用可注入 I/O 和 spawn，不依赖真实子进程
 * - stdin LSP 帧必须转发到 bridge.feedClientFrame/真实 clangd stdin
 * - bridge 输出只能写入 stdout 协议帧，日志留在 stderr/logPath
 * - 缺失 --real-clangd 时退出码为 2 且 stdout 为空
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { encodeMessage, LspFramingParser } from '@clangd/proxy/framing';
import { runProxy, type CliIo } from '@clangd/proxy/cli';
import { FakeChild, FakeStdio, createFakeSpawn } from './cliFixtures';

describe('runProxy — 代理入口', () => {
  let fakeChild: FakeChild;
  let fakeSpawn: typeof import('node:child_process').spawn;
  let io: CliIo;
  let stderrLines: string[];
  let exitCode: number | null;
  let stdio: FakeStdio;

  beforeEach(() => {
    fakeChild = new FakeChild();
    fakeSpawn = createFakeSpawn(fakeChild);
    stderrLines = [];
    exitCode = null;
    stdio = new FakeStdio();
    io = {
      stderrWrite: (msg: string) => { stderrLines.push(msg); },
      exit: (code: number) => { exitCode = code; },
    };
  });

  it('完整参数启动代理返回 DoneClaim', () => {
    const claim = runProxy(
      [
        'node', 'proxy.js',
        '--keepalive-max', '10',
        '--keepalive-ttl-sec', '60',
        '--real-clangd', '/fake/clangd',
        '--',
        '--background-index',
      ],
      io,
      fakeSpawn,
    );

    expect(claim.status).toBe('ok');
    expect(claim.changedFiles).toContain('src/clangd/proxy/cli.ts');
    expect(claim.commands).toContain('parseArgs');
    expect(claim.evidence).toBeTruthy();
    expect(Array.isArray(claim.cleanup)).toBe(true);
    expect(Array.isArray(claim.risks)).toBe(true);
  });

  it('缺失 --real-clangd 时打印 stderr 并调用 io.exit(2)，且 stdout 保持空协议通道', () => {
    const claim = runProxy(
      ['node', 'proxy.js', '--', '--arg'],
      io,
      fakeSpawn,
      stdio,
    );

    expect(claim.status).toBe('error');
    expect(stderrLines.length).toBeGreaterThan(0);
    expect(stderrLines.some((l) => l.includes('--real-clangd'))).toBe(true);
    expect(exitCode).toBe(2);
    expect(stdio.stdoutFrames).toHaveLength(0);
  });

  it('代理不向 stdout 写入任何内容', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    runProxy(
      [
        'node', 'proxy.js',
        '--real-clangd', '/fake/clangd',
      ],
      io,
      fakeSpawn,
    );

    expect(stdoutWrite).not.toHaveBeenCalled();
    stdoutWrite.mockRestore();
  });

  it('Given 注入 stdin initialize 帧，When runProxy 接收数据，Then 转发到真实 clangd stdin', () => {
    runProxy(
      [
        'node', 'proxy.js',
        '--real-clangd', '/fake/clangd',
      ],
      io,
      fakeSpawn,
      stdio,
    );

    stdio.emitStdinFrame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

    expect(fakeChild.stdinWriteCalls).toHaveLength(1);
    const parser = new LspFramingParser();
    const messages = parser.feed(fakeChild.stdinWriteCalls[0] ?? Buffer.alloc(0));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe('initialize');
    expect(stdio.stdoutFrames).toHaveLength(0);
  });

  it('Given 真实 clangd 返回 initialize 响应，When bridge 收到 stdout，Then 只向注入 stdout 写协议帧', () => {
    runProxy(
      [
        'node', 'proxy.js',
        '--real-clangd', '/fake/clangd',
      ],
      io,
      fakeSpawn,
      stdio,
    );

    stdio.emitStdinFrame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    fakeChild.stdout.emit('data', encodeMessage({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }));

    const messages = stdio.parseStdoutMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe(1);
    expect(messages[0]?.result).toEqual({ capabilities: {} });

    const stdoutText = Buffer.concat(stdio.stdoutFrames).toString('utf-8');
    expect(stdoutText).toContain('Content-Length:');
    expect(stdoutText).not.toContain('[clangd-proxy]');
    expect(stderrLines.some((line) => line.includes('[clangd-proxy] started'))).toBe(true);
  });
});
