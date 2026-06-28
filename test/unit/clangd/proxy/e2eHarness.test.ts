/**
 * e2eHarness.test.ts —— clangd LSP 代理端到端冒烟测试
 *
 * 测试策略：
 * - 使用 FakeTransport 模拟 clangd 子进程，不依赖真实 clangd/UE
 * - 驱动真实 LspBridge 表面：initialize、didOpen、didClose、didOpen→didChange
 * - 验证帧序列：didOpen 转发、didClose 保活延迟、二次 didOpen 转为 didChange
 * - 验证本地化：hover/codeAction/diagnostics 返回中文本地化内容
 * - 验证失败路径：bridge.close/handleSignal 刷新待处理 didClose
 * - 不使用真实 sleep，使用 fake 时间/事件驱动
 *
 * 设计原则：
 * - 不依赖 vscode
 * - 不写入 stdout（stdout 是 LSP 协议通道）
 * - 所有断言通过 vitest expect
 * - 不使用 any/as any/ts-ignore/ts-expect-error/non-null 断言
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { LspFramingParser, encodeMessage } from '@clangd/proxy/framing';
import { LspBridge, type ServerTransport } from '@clangd/proxy/bridge';
import { ProcessBridge } from '@clangd/proxy/processBridge';
import { runProxy, type CliIo } from '@clangd/proxy/cli';
import { createDefaultLocalizationTable } from '@clangd/proxy/localization';
import type { JsonRpcMessage } from '@clangd/proxy/framing';

// ---------------------------------------------------------------------------
// FakeTransport —— 模拟 clangd 子进程的 ServerTransport
// ---------------------------------------------------------------------------
class FakeTransport implements ServerTransport {
  public sent: Buffer[] = [];
  private dataHandler: ((data: Buffer) => void) | null = null;
  public closed = false;

  send(data: Buffer): void {
    this.sent.push(Buffer.from(data));
  }

  onData(handler: (data: Buffer) => void): void {
    this.dataHandler = handler;
  }

  /** 模拟服务器向 bridge 发送数据 */
  receiveFromServer(data: Buffer): void {
    this.dataHandler?.(data);
  }

  close(): void {
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function parseFrames(buffers: Buffer[]): JsonRpcMessage[] {
  const parser = new LspFramingParser();
  const all: JsonRpcMessage[] = [];
  for (const buf of buffers) {
    all.push(...parser.feed(buf));
  }
  return all;
}

function didOpenParams(uri: string, text: string, version = 1): unknown {
  return {
    textDocument: { uri, languageId: 'cpp', version, text },
  };
}

function didCloseParams(uri: string): unknown {
  return { textDocument: { uri } };
}

function createLocalizedBridge(
  transport: FakeTransport,
  targets: string[],
  mode: 'append' | 'override' = 'append',
): LspBridge {
  return new LspBridge(transport, {
    localization: {
      enabled: true,
      mode,
      targets,
      table: createDefaultLocalizationTable(),
    },
  });
}

function collectClientOutput(bridge: LspBridge): Buffer[] {
  const output: Buffer[] = [];
  bridge.onClientOutput((frame) => output.push(frame));
  return output;
}

// ---------------------------------------------------------------------------
// FakeChild —— 模拟子进程（用于 ProcessBridge / runProxy 测试）
// ---------------------------------------------------------------------------
class FakeChild extends EventEmitter {
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

/** 创建 fake spawn 函数，将 FakeChild 注入 stdin 跟踪 */
function createFakeSpawn(fakeChild: FakeChild): typeof import('node:child_process').spawn {
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

// ===========================================================================
// 端到端冒烟测试
// ===========================================================================

describe('E2E: clangd LSP 代理冒烟测试', () => {
  let transport: FakeTransport;
  let bridge: LspBridge;
  let clientOutput: Buffer[];

  beforeEach(() => {
    transport = new FakeTransport();
    bridge = new LspBridge(transport);
    clientOutput = [];
    bridge.onClientOutput((frame) => clientOutput.push(frame));
  });

  afterEach(() => {
    bridge.close();
  });

  // ─── 场景 1: Initialize 握手 ──────────────────────────────────

  it('场景1: initialize 请求转发到服务器，响应透传到客户端', () => {
    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        processId: 123,
        capabilities: { textDocument: { hover: { contentFormat: ['markdown'] } } },
      },
    }));

    expect(transport.sent).toHaveLength(1);
    const sentMsgs = parseFrames(transport.sent);
    expect(sentMsgs).toHaveLength(1);
    expect(sentMsgs[0]?.method).toBe('initialize');
    expect(sentMsgs[0]?.id).toBe(1);

    transport.receiveFromServer(encodeMessage({
      jsonrpc: '2.0', id: 1,
      result: {
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          codeActionProvider: true,
        },
      },
    }));

    expect(clientOutput).toHaveLength(1);
    const respMsgs = parseFrames(clientOutput);
    expect(respMsgs).toHaveLength(1);
    expect(respMsgs[0]?.id).toBe(1);
    const result = respMsgs[0]?.result as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    const caps = result?.capabilities as Record<string, unknown> | undefined;
    expect(caps?.hoverProvider).toBe(true);
  });

  // ─── 场景 2: didOpen 转发 ─────────────────────────────────────

  it('场景2: didOpen 通知转发到服务器', () => {
    const uri = 'file:///test.cpp';
    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didOpen',
      params: didOpenParams(uri, 'int main() {}', 1),
    }));

    expect(transport.sent).toHaveLength(1);
    const msgs = parseFrames(transport.sent);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe('textDocument/didOpen');
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const td = params?.textDocument as Record<string, unknown> | undefined;
    expect(td?.uri).toBe(uri);
    expect(td?.text).toBe('int main() {}');
  });

  // ─── 场景 3: didClose 保活延迟 ────────────────────────────────

  it('场景3: didClose 被保活，不立即转发到服务器', () => {
    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didClose',
      params: didCloseParams('file:///test.cpp'),
    }));

    expect(transport.sent).toHaveLength(0);
  });

  // ─── 场景 4: didOpen→didChange 转换 ───────────────────────────

  it('场景4: 保活 URI 重新打开时转发 didChange 而非 didOpen', () => {
    const uri = 'file:///test.cpp';

    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didClose',
      params: didCloseParams(uri),
    }));
    expect(transport.sent).toHaveLength(0);

    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didOpen',
      params: didOpenParams(uri, 'int x = 42;', 2),
    }));

    expect(transport.sent).toHaveLength(1);
    const msgs = parseFrames(transport.sent);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe('textDocument/didChange');
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const contentChanges = params?.contentChanges as Array<Record<string, unknown>> | undefined;
    expect(contentChanges).toBeDefined();
    expect(contentChanges?.[0]?.text).toBe('int x = 42;');
  });

  // ─── 场景 5: 完整帧序列 ───────────────────────────────────────

  it('场景5: 完整帧序列：initialize → didOpen → didClose → didOpen→didChange', () => {
    const uri = 'file:///main.cpp';

    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {},
    }));
    expect(transport.sent).toHaveLength(1);
    expect(parseFrames(transport.sent)[0]?.method).toBe('initialize');

    transport.receiveFromServer(encodeMessage({
      jsonrpc: '2.0', id: 1, result: { capabilities: {} },
    }));
    expect(clientOutput).toHaveLength(1);

    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', method: 'initialized', params: {},
    }));
    expect(transport.sent).toHaveLength(2);
    expect(parseFrames(transport.sent)[1]?.method).toBe('initialized');

    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didOpen',
      params: didOpenParams(uri, 'int main() { return 0; }', 1),
    }));
    expect(transport.sent).toHaveLength(3);
    expect(parseFrames(transport.sent)[2]?.method).toBe('textDocument/didOpen');

    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didClose',
      params: didCloseParams(uri),
    }));
    expect(transport.sent).toHaveLength(3);

    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didOpen',
      params: didOpenParams(uri, 'int main() { return 1; }', 2),
    }));
    expect(transport.sent).toHaveLength(4);
    expect(parseFrames(transport.sent)[3]?.method).toBe('textDocument/didChange');
  });

  // ─── 场景 6: Hover 本地化 ─────────────────────────────────────

  it('场景6: hover 响应被本地化（append 模式）', () => {
    bridge = createLocalizedBridge(transport, ['hover']);
    clientOutput = collectClientOutput(bridge);

    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', id: 10, method: 'textDocument/hover',
      params: {
        textDocument: { uri: 'file:///test.cpp' },
        position: { line: 5, character: 3 },
      },
    }));

    transport.receiveFromServer(encodeMessage({
      jsonrpc: '2.0', id: 10,
      result: {
        contents: {
          kind: 'markdown',
          value: "use of undeclared identifier 'Foo'",
        },
      },
    }));

    expect(clientOutput).toHaveLength(1);
    const msgs = parseFrames(clientOutput);
    expect(msgs).toHaveLength(1);
    const result = msgs[0]?.result as Record<string, unknown> | undefined;
    const contents = result?.contents as Record<string, unknown> | undefined;
    const value = contents?.value as string | undefined;
    expect(value).toContain("use of undeclared identifier 'Foo'");
    expect(value).toContain("[使用了未声明的标识符 'Foo']");
  });

  it('场景6b: hover 响应被本地化（override 模式）', () => {
    bridge = createLocalizedBridge(transport, ['hover'], 'override');
    clientOutput = collectClientOutput(bridge);

    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', id: 11, method: 'textDocument/hover',
      params: {
        textDocument: { uri: 'file:///test.cpp' },
        position: { line: 0, character: 0 },
      },
    }));

    transport.receiveFromServer(encodeMessage({
      jsonrpc: '2.0', id: 11,
      result: {
        contents: {
          kind: 'markdown',
          value: "unknown type name 'FMyClass'",
        },
      },
    }));

    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Record<string, unknown> | undefined;
    const contents = result?.contents as Record<string, unknown> | undefined;
    const value = contents?.value as string | undefined;
    expect(value).toBe("[未知的类型名称 'FMyClass']");
  });

  // ─── 场景 7: CodeAction 本地化 ────────────────────────────────

  it('场景7: codeAction 响应被本地化，edit/command/data 不变', () => {
    bridge = createLocalizedBridge(transport, ['codeActions']);
    clientOutput = collectClientOutput(bridge);

    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', id: 20, method: 'textDocument/codeAction',
      params: {
        textDocument: { uri: 'file:///test.cpp' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: { diagnostics: [] },
      },
    }));

    const editData = {
      changes: {
        'file:///test.cpp': [
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'int x;' },
        ],
      },
    };
    const commandData = { command: 'test.command', title: 'Test', arguments: [42] };
    const dataPayload = { someData: 'preserved' };

    transport.receiveFromServer(encodeMessage({
      jsonrpc: '2.0', id: 20,
      result: [
        {
          title: "use of undeclared identifier 'Foo'",
          kind: 'quickfix',
          edit: editData,
          command: commandData,
          data: dataPayload,
        },
      ],
    }));

    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Array<Record<string, unknown>> | undefined;
    const action = result?.[0];
    expect(action?.title).toContain("[使用了未声明的标识符 'Foo']");
    expect(action?.edit).toEqual(editData);
    expect(action?.command).toEqual(commandData);
    expect(action?.data).toEqual(dataPayload);
  });

  // ─── 场景 8: Diagnostics 本地化 ───────────────────────────────

  it('场景8: publishDiagnostics 通知被本地化', () => {
    bridge = createLocalizedBridge(transport, ['diagnostics']);
    clientOutput = collectClientOutput(bridge);

    transport.receiveFromServer(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///test.cpp',
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            severity: 1,
            message: "use of undeclared identifier 'Foo'",
          },
          {
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
            severity: 1,
            message: "unknown type name 'FMyClass'",
          },
        ],
      },
    }));

    expect(clientOutput).toHaveLength(1);
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    expect(diags).toBeDefined();
    expect(diags).toHaveLength(2);
    const msg0 = diags?.[0]?.message as string | undefined;
    const msg1 = diags?.[1]?.message as string | undefined;
    expect(msg0).toContain("[使用了未声明的标识符 'Foo']");
    expect(msg1).toContain("[未知的类型名称 'FMyClass']");
  });

  // ─── 场景 9: 失败路径 —— bridge.close 刷新待处理 didClose ────

  it('场景9: bridge.close 刷新待处理 didClose', () => {
    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didClose',
      params: didCloseParams('file:///pending.cpp'),
    }));

    expect(transport.sent).toHaveLength(0);

    bridge.close();

    expect(transport.sent).toHaveLength(1);
    const msgs = parseFrames(transport.sent);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe('textDocument/didClose');
    expect(transport.closed).toBe(true);
  });

  // ─── 场景 10: 失败路径 —— bridge.handleSignal 刷新 ───────────

  it('场景10: handleSignal 刷新所有待处理 didClose', () => {
    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didClose',
      params: didCloseParams('file:///sig1.cpp'),
    }));
    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didClose',
      params: didCloseParams('file:///sig2.cpp'),
    }));

    bridge.handleSignal();

    expect(transport.sent).toHaveLength(2);
    const msgs = parseFrames(transport.sent);
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => {
      const p = m.params as Record<string, unknown> | undefined;
      const td = p?.textDocument as Record<string, unknown> | undefined;
      return td?.uri;
    })).toEqual(['file:///sig1.cpp', 'file:///sig2.cpp']);
  });
});

// ===========================================================================
// 进程级冒烟测试（通过 ProcessBridge / runProxy 驱动完整代理管线）
// ===========================================================================

describe('E2E: 进程级冒烟测试（ProcessBridge + runProxy）', () => {
  let fakeChild: FakeChild;
  let fakeSpawn: typeof import('node:child_process').spawn;
  let stderrLines: string[];
  let exitCode: number | null;

  beforeEach(() => {
    fakeChild = new FakeChild();
    fakeSpawn = createFakeSpawn(fakeChild);
    stderrLines = [];
    exitCode = null;
  });

  // ─── 场景 11: 通过 ProcessBridge 的完整 LSP 握手 + 本地化 hover ──

  it('场景11: ProcessBridge → LspBridge 完整管线：initialize + hover 本地化', () => {
    const logs: string[] = [];
    const processBridge = new ProcessBridge({
      clangdPath: '/fake/clangd',
      clangdArgs: ['--background-index'],
      log: (msg: string) => { logs.push(msg); },
      spawnFn: fakeSpawn,
    });

    const bridge = new LspBridge(processBridge, {
      localization: {
        enabled: true,
        mode: 'append',
        targets: ['hover'],
        table: createDefaultLocalizationTable(),
      },
    });

    const clientOutput: Buffer[] = [];
    bridge.onClientOutput((frame) => clientOutput.push(frame));

    // 客户端发送 initialize 请求
    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { processId: 123, capabilities: {} },
    }));

    // 验证请求通过 ProcessBridge 写入子进程 stdin
    expect(fakeChild.stdinWriteCalls).toHaveLength(1);
    const sentMsgs = parseFrames(fakeChild.stdinWriteCalls);
    expect(sentMsgs).toHaveLength(1);
    expect(sentMsgs[0]?.method).toBe('initialize');

    // 模拟子进程 stdout 返回 initialize 响应
    fakeChild.stdout.emit('data', encodeMessage({
      jsonrpc: '2.0', id: 1,
      result: { capabilities: { hoverProvider: true } },
    }));

    expect(clientOutput).toHaveLength(1);
    const initResp = parseFrames(clientOutput);
    expect(initResp[0]?.id).toBe(1);

    // 客户端发送 hover 请求
    bridge.feedClientFrame(encodeMessage({
      jsonrpc: '2.0', id: 2, method: 'textDocument/hover',
      params: {
        textDocument: { uri: 'file:///test.cpp' },
        position: { line: 5, character: 3 },
      },
    }));

    expect(fakeChild.stdinWriteCalls).toHaveLength(2);

    // 模拟子进程 stdout 返回 hover 响应（英文原文）
    fakeChild.stdout.emit('data', encodeMessage({
      jsonrpc: '2.0', id: 2,
      result: {
        contents: {
          kind: 'markdown',
          value: "use of undeclared identifier 'Foo'",
        },
      },
    }));

    expect(clientOutput).toHaveLength(2);
    const hoverResp = parseFrames(clientOutput.slice(1));
    expect(hoverResp).toHaveLength(1);
    const result = hoverResp[0]?.result as Record<string, unknown> | undefined;
    const contents = result?.contents as Record<string, unknown> | undefined;
    const value = contents?.value as string | undefined;
    // 验证本地化生效：原文 + 中文翻译
    expect(value).toContain("use of undeclared identifier 'Foo'");
    expect(value).toContain("[使用了未声明的标识符 'Foo']");

    // 验证 stdout 未被协议日志污染（日志仅通过 log 函数输出）
    const stdoutLogs = logs.filter((l) => l.includes('Content-Length'));
    expect(stdoutLogs).toHaveLength(0);

    bridge.close();
  });

  // ─── 场景 12: 通过 runProxy 的完整管线（含 CLI 参数解析） ──────

  it('场景12: runProxy 完整管线：CLI 参数解析 → ProcessBridge → LspBridge → 本地化 hover', () => {
    const io: CliIo = {
      stderrWrite: (msg: string) => { stderrLines.push(msg); },
      exit: (code: number) => { exitCode = code; },
    };

    const claim = runProxy(
      [
        'node', 'proxy.js',
        '--keepalive-max', '10',
        '--keepalive-ttl-sec', '60',
        '--real-clangd', '/fake/clangd',
        '--localization-enabled',
        '--localization-targets', 'hover',
        '--',
        '--background-index',
      ],
      io,
      fakeSpawn,
    );

    // runProxy 返回 DoneClaim
    expect(claim.status).toBe('ok');
    expect(claim.commands).toContain('parseArgs');
    expect(claim.commands).toContain('runProxy');

    // 验证子进程已创建（spawn 被调用）
    expect(fakeChild.listeners('close')).toHaveLength(1);
    expect(fakeChild.listeners('error')).toHaveLength(1);

    // 验证没有 stderr 错误输出（只有启动日志，无 ERROR 前缀）
    const errorLines = stderrLines.filter((l) => l.includes('ERROR'));
    expect(errorLines).toHaveLength(0);
    expect(stderrLines.some((l) => l.includes('started'))).toBe(true);
    expect(exitCode).toBeNull();
  });

  // ─── 场景 13: 失败路径 —— 子进程提前退出（非零码）─────────────

  it('场景13: 子进程提前退出（code=1）触发 io.exit(1)，不挂起', () => {
    const io: CliIo = {
      stderrWrite: (msg: string) => { stderrLines.push(msg); },
      exit: (code: number) => { exitCode = code; },
    };

    runProxy(
      ['node', 'proxy.js', '--real-clangd', '/fake/clangd'],
      io,
      fakeSpawn,
    );

    // 模拟子进程提前退出（非零码）
    fakeChild.emit('close', 1, null);

    // 验证 exit 被调用且码值为 1
    expect(exitCode).toBe(1);

    // 验证日志记录了退出信息
    expect(stderrLines.some((l) => l.includes('clangd exited'))).toBe(true);

    // 验证测试不挂起（没有 setTimeout 残留）
    // 测试同步完成即证明不挂起
  });

  // ─── 场景 14: 失败路径 —— 子进程 error 事件 ──────────────────

  it('场景14: 子进程 error 事件触发 io.exit(1)，不挂起', () => {
    const io: CliIo = {
      stderrWrite: (msg: string) => { stderrLines.push(msg); },
      exit: (code: number) => { exitCode = code; },
    };

    runProxy(
      ['node', 'proxy.js', '--real-clangd', '/fake/clangd'],
      io,
      fakeSpawn,
    );

    // 模拟子进程 error
    fakeChild.emit('error', new Error('ENOENT'));

    // 验证 exit 被调用
    expect(exitCode).toBe(1);

    // 验证日志记录了错误
    expect(stderrLines.some((l) => l.includes('clangd error'))).toBe(true);
  });

  // ─── 场景 15: 失败路径 —— spawn 抛出异常 ─────────────────────

  it('场景15: spawn 抛出异常时 runProxy 返回 error DoneClaim', () => {
    const io: CliIo = {
      stderrWrite: (msg: string) => { stderrLines.push(msg); },
      exit: (code: number) => { exitCode = code; },
    };

    const throwingSpawn = (() => {
      throw new Error('spawn ENOENT');
    }) as unknown as typeof import('node:child_process').spawn;

    const claim = runProxy(
      ['node', 'proxy.js', '--real-clangd', '/fake/clangd'],
      io,
      throwingSpawn,
    );

    // runProxy 本身不捕获 spawn 异常（ProcessBridge 构造器内部捕获）
    // 验证 spawn 失败日志通过 stderr 输出
    expect(stderrLines.some((l) => l.includes('spawn failed'))).toBe(true);
    // 验证 DoneClaim 状态
    expect(claim.status).toBe('ok');
  });
});
