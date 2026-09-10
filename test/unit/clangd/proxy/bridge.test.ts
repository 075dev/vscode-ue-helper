/**
 * bridge.test.ts —— LSP 代理桥接 单元测试
 *
 * 测试策略：
 * - 使用 FakeTransport 模拟 clangd 子进程，不依赖真实 clangd/UE
 * - 覆盖 client→server 路径：initialize 透传、hover 请求关联、didClose 保活
 * - 覆盖 server→client 路径：响应透传、通知透传、关联钩子
 * - 覆盖 keepalive 集成：延迟 didClose、LRU/TTL 刷新、child close/error 刷新
 * - 覆盖 stdout 不被协议日志污染
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LspFramingParser, encodeMessage } from '@clangd/proxy/framing';
import { LspBridge, type ServerTransport } from '@clangd/proxy/bridge';
import type { JsonRpcMessage } from '@clangd/proxy/framing';

// ---------------------------------------------------------------------------
// FakeTransport —— 模拟 clangd 子进程的 ServerTransport
// ---------------------------------------------------------------------------
class FakeTransport implements ServerTransport {
  /** 发送给 "服务器" 的帧（原始 Buffer） */
  public sent: Buffer[] = [];
  private dataHandler: ((data: Buffer) => void) | null = null;
  public closed = false;

  send(data: Buffer): void {
    this.sent.push(Buffer.from(data)); // 拷贝，防止后续修改
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

/** 解析 Buffer 数组中的帧 */
function parseFrames(buffers: Buffer[]): JsonRpcMessage[] {
  const parser = new LspFramingParser();
  const all: JsonRpcMessage[] = [];
  for (const buf of buffers) {
    all.push(...parser.feed(buf));
  }
  return all;
}

/** 创建 didClose params */
function didCloseParams(uri: string): unknown {
  return { textDocument: { uri } };
}

/** 创建 didOpen params（含 text/version） */
function didOpenParams(uri: string, text: string, version = 1): unknown {
  return {
    textDocument: { uri, languageId: 'cpp', version, text },
  };
}

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------

describe('LspBridge — 代理桥接', () => {
  let transport: FakeTransport;
  let bridge: LspBridge;
  let clientOutput: Buffer[];

  beforeEach(() => {
    transport = new FakeTransport();
    bridge = new LspBridge(transport);
    clientOutput = [];
    bridge.onClientOutput((frame) => clientOutput.push(frame));
  });

  // ─── client→server 路径 ──────────────────────────────────────

  it('initialize 请求透传到服务器并记录关联', () => {
    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    bridge.feedClientFrame(encodeMessage(initialize));

    expect(transport.sent).toHaveLength(1);
    const msgs = parseFrames(transport.sent);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe('initialize');
    expect(msgs[0]?.id).toBe(1);
  });

  it('hover 请求透传并记录关联，服务器响应后关联可查', () => {
    const hover = {
      jsonrpc: '2.0',
      id: 7,
      method: 'textDocument/hover',
      params: { textDocument: { uri: 'file:///test.cpp' }, position: { line: 10, character: 5 } },
    };
    bridge.feedClientFrame(encodeMessage(hover));

    // 服务器响应
    const response = {
      jsonrpc: '2.0',
      id: 7,
      result: { contents: [{ kind: 'markdown', value: 'hover info' }] },
    };
    transport.receiveFromServer(encodeMessage(response));

    // 客户端收到响应
    expect(clientOutput).toHaveLength(1);
    const msgs = parseFrames(clientOutput);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.id).toBe(7);
    const result = (msgs[0] as Record<string, unknown>)?.result as
      | Record<string, unknown>
      | undefined;
    expect(result).toBeDefined();
  });

  it('多个请求各自独立关联', () => {
    bridge.feedClientFrame(
      encodeMessage({ jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params: {} }),
    );
    bridge.feedClientFrame(
      encodeMessage({ jsonrpc: '2.0', id: 2, method: 'textDocument/codeAction', params: {} }),
    );

    expect(transport.sent).toHaveLength(2);

    // 服务器依次响应
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', id: 1, result: { contents: [] } }));
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', id: 2, result: { actions: [] } }));

    expect(clientOutput).toHaveLength(2);
  });

  // ─── keepalive 集成 ──────────────────────────────────────────

  it('didClose 进入保活，不立即转发到服务器', () => {
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: didCloseParams('file:///foo.cpp'),
      }),
    );

    // 没有转发到服务器
    expect(transport.sent).toHaveLength(0);
  });

  it('didOpen 命中保活 URI 时转发 didChange（全量文本）', () => {
    // 先关闭文件
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: didCloseParams('file:///foo.cpp'),
      }),
    );

    // 重新打开
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: didOpenParams('file:///foo.cpp', 'int main() {}', 2),
      }),
    );

    // 应该转发 didChange（不是 didOpen）
    expect(transport.sent).toHaveLength(1);
    const msgs = parseFrames(transport.sent);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe('textDocument/didChange');
  });

  it('LRU 淘汰：超过 keepaliveMax 时转发最旧 didClose', () => {
    bridge = new LspBridge(transport, { keepaliveMax: 2 });
    clientOutput = [];
    bridge.onClientOutput((frame) => clientOutput.push(frame));

    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: didCloseParams('file:///a.cpp'),
      }),
    );
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: didCloseParams('file:///b.cpp'),
      }),
    );

    // 第三个 didClose → 淘汰 a.cpp
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: didCloseParams('file:///c.cpp'),
      }),
    );

    expect(transport.sent).toHaveLength(1);
    const msgs = parseFrames(transport.sent);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe('textDocument/didClose');
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const td = params?.textDocument as Record<string, unknown> | undefined;
    expect(td?.uri).toBe('file:///a.cpp');
  });

  it('flush 刷新所有待处理 didClose', () => {
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: didCloseParams('file:///a.cpp'),
      }),
    );
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: didCloseParams('file:///b.cpp'),
      }),
    );

    bridge.flush();

    expect(transport.sent).toHaveLength(2);
    const msgs = parseFrames(transport.sent);
    expect(msgs).toHaveLength(2);
    expect(
      msgs.map((m) => {
        const p = m.params as Record<string, unknown> | undefined;
        const td = p?.textDocument as Record<string, unknown> | undefined;
        return td?.uri;
      }),
    ).toEqual(['file:///a.cpp', 'file:///b.cpp']);
  });

  // ─── server→client 路径 ──────────────────────────────────────

  it('服务器通知透传到客户端', () => {
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: 'file:///test.cpp', diagnostics: [] },
      }),
    );

    expect(clientOutput).toHaveLength(1);
    const msgs = parseFrames(clientOutput);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe('textDocument/publishDiagnostics');
  });

  it('服务器响应透传到客户端', () => {
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        id: 5,
        method: 'textDocument/completion',
        params: {},
      }),
    );

    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 5,
        result: { items: [] },
      }),
    );

    expect(clientOutput).toHaveLength(1);
    const msgs = parseFrames(clientOutput);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.id).toBe(5);
  });

  it('服务器错误响应透传到客户端', () => {
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'textDocument/hover',
        params: {},
      }),
    );

    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 3,
        error: { code: -32601, message: 'Method not found' },
      }),
    );

    expect(clientOutput).toHaveLength(1);
    const msgs = parseFrames(clientOutput);
    expect(msgs).toHaveLength(1);
    expect((msgs[0] as Record<string, unknown>)?.error).toBeDefined();
  });

  // ─── 关联钩子 ────────────────────────────────────────────────

  it('关联钩子在服务器响应时被调用', () => {
    const hookMethods: string[] = [];
    bridge = new LspBridge(transport, {
      hooks: {
        onServerResponse: (_msg, method) => {
          if (method) {
            hookMethods.push(method);
          }
        },
      },
    });
    clientOutput = [];
    bridge.onClientOutput((frame) => clientOutput.push(frame));

    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        id: 7,
        method: 'textDocument/hover',
        params: {},
      }),
    );

    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 7,
        result: { contents: [] },
      }),
    );

    expect(hookMethods).toEqual(['textDocument/hover']);
  });

  it('关联钩子在服务器通知时被调用', () => {
    const notifications: string[] = [];
    bridge = new LspBridge(transport, {
      hooks: {
        onServerNotification: (msg) => {
          const m = msg.method;
          if (m) {
            notifications.push(m);
          }
        },
      },
    });
    clientOutput = [];
    bridge.onClientOutput((frame) => clientOutput.push(frame));

    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: 'file:///test.cpp', diagnostics: [] },
      }),
    );

    expect(notifications).toEqual(['textDocument/publishDiagnostics']);
  });

  // ─── 子进程关闭刷新 ──────────────────────────────────────────

  it('close 时刷新待处理 didClose', () => {
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: didCloseParams('file:///pending.cpp'),
      }),
    );

    bridge.close();

    // 刷新了待处理的 didClose
    expect(transport.sent).toHaveLength(1);
    const msgs = parseFrames(transport.sent);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe('textDocument/didClose');

    // transport 被关闭
    expect(transport.closed).toBe(true);
  });

  // ─── 信号刷新 ────────────────────────────────────────────────

  it('handleSignal 刷新所有待处理 didClose', () => {
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: didCloseParams('file:///sig.cpp'),
      }),
    );
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: didCloseParams('file:///sig2.cpp'),
      }),
    );

    bridge.handleSignal();

    expect(transport.sent).toHaveLength(2);
    const msgs = parseFrames(transport.sent);
    expect(msgs).toHaveLength(2);
    expect(
      msgs.map((m) => {
        const p = m.params as Record<string, unknown> | undefined;
        const td = p?.textDocument as Record<string, unknown> | undefined;
        return td?.uri;
      }),
    ).toEqual(['file:///sig.cpp', 'file:///sig2.cpp']);
  });

  it('handleSignal 无待处理时不做任何事', () => {
    bridge.handleSignal();
    expect(transport.sent).toHaveLength(0);
  });

  // ─── TTL 过期刷新（桥接器集成） ─────────────────────────────

  it('TTL 过期后 feedClientFrame 触发过期 didClose 转发', () => {
    // 使用极短 TTL 的桥接器
    bridge = new LspBridge(transport, { keepaliveTtlSec: 0 });
    clientOutput = [];
    bridge.onClientOutput((frame) => clientOutput.push(frame));

    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: didCloseParams('file:///ttl-test.cpp'),
      }),
    );

    // 初始没有转发
    expect(transport.sent).toHaveLength(0);

    // 模拟时间推移：feedClientFrame 内部调用 keepalive.tick()
    // 由于 keepaliveTtlSec=0，tick() 会立即过期
    // 但 tick() 只在 feedClientFrame 时被调用（通过 processClientMessage）
    // 需要发送一条任意消息触发 tick
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: 'file:///trigger.cpp', version: 1 },
          contentChanges: [{ text: '' }],
        },
      }),
    );

    // TTL=0 的条目应该在 tick 时过期并转发
    expect(transport.sent).toHaveLength(2); // didChange + 过期的 didClose
    const msgs = parseFrames(transport.sent);
    const didCloseMsgs = msgs.filter((m) => m.method === 'textDocument/didClose');
    expect(didCloseMsgs).toHaveLength(1);
    const params = didCloseMsgs[0]?.params as Record<string, unknown> | undefined;
    const td = params?.textDocument as Record<string, unknown> | undefined;
    expect(td?.uri).toBe('file:///ttl-test.cpp');
  });

  // ─── 其他通知透传 ────────────────────────────────────────────

  it('非 didClose/didOpen 通知直接透传', () => {
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: 'file:///test.cpp', version: 2 },
          contentChanges: [{ text: 'x' }],
        },
      }),
    );

    expect(transport.sent).toHaveLength(1);
    const msgs = parseFrames(transport.sent);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe('textDocument/didChange');
  });

  it('initialized 通知直接透传', () => {
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'initialized',
        params: {},
      }),
    );

    expect(transport.sent).toHaveLength(1);
    const msgs = parseFrames(transport.sent);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.method).toBe('initialized');
  });

  // ─── 分块输入 ────────────────────────────────────────────────

  it('分块喂入客户端数据正确累积解析', () => {
    const frame = encodeMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'textDocument/hover',
      params: {},
    });
    const part1 = frame.subarray(0, 15);
    const part2 = frame.subarray(15);

    bridge.feedClientFrame(part1);
    expect(transport.sent).toHaveLength(0); // 还不完整

    bridge.feedClientFrame(part2);
    expect(transport.sent).toHaveLength(1); // 现在完整了
  });

  // ─── stdout 不被污染 ─────────────────────────────────────────

  it('bridge 不向 stdout 写入任何内容（仅通过回调输出）', () => {
    // 模拟 stdout write 监控
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    );

    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 1,
        result: { capabilities: {} },
      }),
    );

    // bridge 不应直接写入 stdout
    expect(stdoutWrite).not.toHaveBeenCalled();

    stdoutWrite.mockRestore();
  });
});
