/**
 * bridgeIdNamespace.test.ts —— [D10] 客户端 / 服务端 request id 空间隔离
 *
 * ## 背景
 *
 * LSP 的 request id 在**两个方向各自独立编号**。客户端发起的请求
 * （hover / definition / …）与服务器发起的请求
 * （workspace/configuration / client/registerCapability /
 * window/workDoneProgress/create）都可能用 id=1、id=2……
 *
 * 旧实现只按"有没有 id"判断响应:`processServerMessage` 查表命中客户端同号的
 * 关联 → 把客户端待响应的关联**删掉** → 真正的响应到达时查不到原 method →
 * hover 汉化被静默丢弃(日志里也看不出异常)。
 *
 * 越靠会话早期(两边 id 计数都从小数字开始)越容易撞上。
 *
 * 覆盖:
 *   - 服务端请求(带 id)不触发 onServerResponse 钩子
 *   - 服务端请求不破坏客户端同号 id 的关联
 *   - 客户端的 hover 响应仍能带上 'textDocument/hover' 的关联
 *   - 服务端请求本身原样透传给客户端（不能丢）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LspFramingParser, encodeMessage } from '@clangd/proxy/framing';
import { LspBridge, type ServerTransport, type LspBridgeOptions } from '@clangd/proxy/bridge';
import type { JsonRpcMessage } from '@clangd/proxy/framing';

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
  receiveFromServer(data: Buffer): void {
    this.dataHandler?.(data);
  }
  close(): void {
    this.closed = true;
  }
}

function parseFrames(buffers: Buffer[]): JsonRpcMessage[] {
  const parser = new LspFramingParser();
  const all: JsonRpcMessage[] = [];
  for (const buf of buffers) {
    all.push(...parser.feed(buf));
  }
  return all;
}

interface SeenResponse {
  id: unknown;
  method: string | undefined;
}

describe('LspBridge —— [D10] request id 命名空间隔离', () => {
  let transport: FakeTransport;
  let seen: SeenResponse[];
  let clientOutput: Buffer[];

  beforeEach(() => {
    transport = new FakeTransport();
    seen = [];
    clientOutput = [];
    const options: LspBridgeOptions = {
      localization: { enabled: true, mode: 'append' },
      hooks: {
        onServerResponse: (msg: JsonRpcMessage, method: string | undefined) => {
          seen.push({ id: msg.id, method });
        },
      },
    };
    const bridge = new LspBridge(transport, options);
    bridge.onClientOutput((frame) => clientOutput.push(frame));
    // 客户端发请求的入口
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/hover',
        params: {
          textDocument: { uri: 'file:///test.cpp' },
          position: { line: 0, character: 0 },
        },
      }),
    );
  });

  it('服务端请求(带 id)不触发 onServerResponse 钩子', () => {
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'workspace/configuration',
        params: { items: [] },
      }),
    );

    // 关键:服务端请求不是响应,不能进响应钩子
    expect(seen).toHaveLength(0);
  });

  it('服务端请求不破坏客户端同号 id 的关联', () => {
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'workspace/configuration',
        params: { items: [] },
      }),
    );

    // 客户端 hover 的响应随后到达
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 2,
        result: { contents: { kind: 'markdown', value: 'hover text' } },
      }),
    );

    // 关联仍在 → method 仍能查到
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe('textDocument/hover');
  });

  it('服务端请求原样透传给客户端,不被丢弃', () => {
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'workspace/configuration',
        params: { items: [] },
      }),
    );

    const msgs = parseFrames(clientOutput);
    const forwarded = msgs.find((m) => m.method === 'workspace/configuration');
    expect(forwarded).toBeDefined();
    expect(forwarded?.id).toBe(2);
  });

  it('客户端与服务端使用不同 id 时各自独立', () => {
    // 服务端请求用 id=7
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 7,
        method: 'client/registerCapability',
        params: { registrations: [] },
      }),
    );
    // 客户端 hover 响应 id=2 到达
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 2,
        result: { contents: { kind: 'markdown', value: 'hover text' } },
      }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe('textDocument/hover');
  });
});
