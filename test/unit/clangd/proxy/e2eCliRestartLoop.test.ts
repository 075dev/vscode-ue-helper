/**
 * e2eCliRestartLoop.test.ts —— clangd proxy CLI 假子进程重启回归测试
 *
 * 职责：
 * - 模拟 VS Code clangd 扩展通过 launcher/CLI 启动代理
 * - 使用 fake child 和 fake stdio 验证 initialize 走完整 runProxy/ProcessBridge 管线
 * - 覆盖真实 clangd 在 initialize 前提前 code=0 退出时不得被误报为成功
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { runProxy, type CliIo } from '@clangd/proxy/cli';
import { encodeMessage, LspFramingParser } from '@clangd/proxy/framing';
import { FakeChild, FakeStdio, createFakeSpawn } from './cliFixtures';

function proxyLauncherArgs(): string[] {
  return [
    'node',
    'clangdProxy.js',
    '--keepalive-max',
    '10',
    '--keepalive-ttl-sec',
    '60',
    '--real-clangd',
    '/fake/clangd',
    '--',
    '--background-index',
  ];
}

describe('E2E: CLI fake-child 重启循环回归', () => {
  let fakeChild: FakeChild;
  let stdio: FakeStdio;
  let stderrLines: string[];
  let exitCodes: number[];
  let io: CliIo;

  beforeEach(() => {
    fakeChild = new FakeChild();
    stdio = new FakeStdio();
    stderrLines = [];
    exitCodes = [];
    io = {
      stderrWrite: (message: string) => { stderrLines.push(message); },
      exit: (code: number) => { exitCodes.push(code); },
    };
  });

  it('Given VS Code launcher 启动代理，When 客户端发送 initialize，Then stdout 返回有效 initialize 响应且不提前 code=0 退出', () => {
    const claim = runProxy(proxyLauncherArgs(), io, createFakeSpawn(fakeChild), stdio);

    expect(claim.status).toBe('ok');
    expect(exitCodes).toEqual([]);

    stdio.emitStdinFrame({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { processId: 123, capabilities: {} },
    });

    expect(exitCodes).toEqual([]);
    const forwardedParser = new LspFramingParser();
    const forwarded = forwardedParser.feed(fakeChild.stdinWriteCalls[0] ?? Buffer.alloc(0));
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.method).toBe('initialize');

    fakeChild.stdout.emit('data', encodeMessage({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: { hoverProvider: true } },
    }));

    const stdoutText = Buffer.concat(stdio.stdoutFrames).toString('utf-8');
    expect(stdoutText).toContain('Content-Length:');
    expect(stdoutText).not.toContain('[clangd-proxy]');

    const responses = stdio.parseStdoutMessages();
    expect(responses).toHaveLength(1);
    expect(responses[0]?.id).toBe(1);
    expect(responses[0]?.result).toEqual({ capabilities: { hoverProvider: true } });
    expect(exitCodes).toEqual([]);
  });

  it('Given fake child 在 initialize 前关闭，When close code=0 到达，Then 代理报告非零退出且不挂起', () => {
    runProxy(proxyLauncherArgs(), io, createFakeSpawn(fakeChild), stdio);

    fakeChild.emit('close', 0, null);

    expect(exitCodes).toEqual([1]);
    expect(stderrLines.some((line) => line.includes('before initialize'))).toBe(true);
    expect(stdio.stdoutFrames).toHaveLength(0);
  });
});
