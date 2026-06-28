/**
 * bridgeLocalization.test.ts —— LSP 代理桥接本地化集成测试
 *
 * 测试策略：
 * - 使用 FakeTransport 模拟 clangd 子进程
 * - 覆盖 diagnostics 通知本地化
 * - 覆盖 codeAction 响应本地化（title/reason 修改，edit/command/data 不变）
 * - 覆盖 hover 响应本地化（代码块保护）
 * - 覆盖 disabled target 透传（字节等效）
 * - 覆盖 CodeAction edit/command/data deep-equal 除 title/reason
 * - 覆盖非目标消息字节等效
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LspFramingParser, encodeMessage } from '@clangd/proxy/framing';
import { LspBridge, type ServerTransport, type LspBridgeOptions } from '@clangd/proxy/bridge';
import { createDefaultLocalizationTable } from '@clangd/proxy/localization';
import type { JsonRpcMessage } from '@clangd/proxy/framing';

class FakeTransport implements ServerTransport {
  public sent: Buffer[] = [];
  private dataHandler: ((data: Buffer) => void) | null = null;
  public closed = false;
  send(data: Buffer): void { this.sent.push(Buffer.from(data)); }
  onData(handler: (data: Buffer) => void): void { this.dataHandler = handler; }
  receiveFromServer(data: Buffer): void { this.dataHandler?.(data); }
  close(): void { this.closed = true; }
}

function parseFrames(buffers: Buffer[]): JsonRpcMessage[] {
  const parser = new LspFramingParser();
  const all: JsonRpcMessage[] = [];
  for (const buf of buffers) { all.push(...parser.feed(buf)); }
  return all;
}

function createLocalizedBridge(transport: FakeTransport, targets: string[], mode: 'append' | 'override' = 'append'): LspBridge {
  const options: LspBridgeOptions = {
    localization: { enabled: true, mode, targets, table: createDefaultLocalizationTable() },
  };
  return new LspBridge(transport, options);
}

function collectClientOutput(bridge: LspBridge): Buffer[] {
  const output: Buffer[] = [];
  bridge.onClientOutput((frame) => output.push(frame));
  return output;
}

describe('LspBridge — 本地化集成', () => {
  let transport: FakeTransport;
  beforeEach(() => { transport = new FakeTransport(); });

  it('diagnostics 通知本地化：匹配规则的消息被翻译', () => {
    const bridge = createLocalizedBridge(transport, ['diagnostics']);
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///test.cpp', diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: "use of undeclared identifier 'Foo'" }] },
    }));
    expect(clientOutput).toHaveLength(1);
    const msgs = parseFrames(clientOutput);
    expect(msgs).toHaveLength(1);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    const message = diags?.[0]?.message as string | undefined;
    expect(message).toContain("[使用了未声明的标识符 'Foo']");
    expect(message).toContain("use of undeclared identifier 'Foo'");
  });
  it('diagnostics 通知本地化：不匹配的消息保持不变', () => {
    const bridge = createLocalizedBridge(transport, ['diagnostics']);
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///test.cpp', diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: 'some random diagnostic' }] },
    }));
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    expect(diags?.[0]?.message).toBe('some random diagnostic');
  });

  it('diagnostics 通知本地化：relatedInformation 也被翻译', () => {
    const bridge = createLocalizedBridge(transport, ['diagnostics']);
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///test.cpp', diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: "use of undeclared identifier 'Foo'", relatedInformation: [{ location: { uri: 'file:///other.h', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } }, message: "no member named 'Value' in 'FMyStruct'" }] }] },
    }));
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    const relatedInfo = diags?.[0]?.relatedInformation as Array<Record<string, unknown>> | undefined;
    expect(relatedInfo?.[0]?.message).toContain("[在 'FMyStruct' 中没有名为 'Value' 的成员]");
  });

  it('codeAction 响应本地化：title 被翻译，edit/command/data 不变', () => {
    const bridge = createLocalizedBridge(transport, ['codeActions']);
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(encodeMessage({ jsonrpc: '2.0', id: 10, method: 'textDocument/codeAction', params: { textDocument: { uri: 'file:///test.cpp' }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, context: { diagnostics: [] } } }));
    const editData = { changes: { 'file:///test.cpp': [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'int x;' }] } };
    const commandData = { command: 'test.command', title: 'Test', arguments: [42] };
    const dataPayload = { someData: 'preserved' };
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', id: 10, result: [{ title: "use of undeclared identifier 'Foo'", kind: 'quickfix', edit: editData, command: commandData, data: dataPayload }] }));
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Array<Record<string, unknown>> | undefined;
    const action = result?.[0];
    expect(action?.title).toContain("[使用了未声明的标识符 'Foo']");
    expect(action?.edit).toEqual(editData);
    expect(action?.command).toEqual(commandData);
    expect(action?.data).toEqual(dataPayload);
  });

  it('codeAction 响应本地化：disabled.reason 也被翻译', () => {
    const bridge = createLocalizedBridge(transport, ['codeActions']);
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(encodeMessage({ jsonrpc: '2.0', id: 11, method: 'textDocument/codeAction', params: { textDocument: { uri: 'file:///test.cpp' }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, context: { diagnostics: [] } } }));
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', id: 11, result: [{ title: 'Some action', kind: 'quickfix', disabled: { reason: "no member named 'Value' in 'FMyStruct'" } }] }));
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Array<Record<string, unknown>> | undefined;
    const disabled = result?.[0]?.disabled as Record<string, unknown> | undefined;
    expect(disabled?.reason).toContain("[在 'FMyStruct' 中没有名为 'Value' 的成员]");
  });

  it('hover 响应本地化：文本内容被翻译，代码块保护', () => {
    const bridge = createLocalizedBridge(transport, ['hover']);
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(encodeMessage({ jsonrpc: '2.0', id: 12, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///test.cpp' }, position: { line: 5, character: 3 } } }));
    const codeBlock = '`cpp\nint x = 42;\n`';
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', id: 12, result: { contents: { kind: 'markdown', value: "use of undeclared identifier 'Foo'\n\n" + codeBlock } } }));
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Record<string, unknown> | undefined;
    const contents = result?.contents as Record<string, unknown> | undefined;
    const value = contents?.value as string | undefined;
    expect(value).toContain("[使用了未声明的标识符 'Foo']");
    expect(value).toContain(codeBlock);
  });

  it('hover 响应本地化：MarkedString 数组被处理', () => {
    const bridge = createLocalizedBridge(transport, ['hover']);
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(encodeMessage({ jsonrpc: '2.0', id: 13, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///test.cpp' }, position: { line: 1, character: 1 } } }));
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', id: 13, result: { contents: [{ language: 'cpp', value: 'int main()' }, "use of undeclared identifier 'Foo'"] } }));
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Record<string, unknown> | undefined;
    const contents = result?.contents as Array<unknown> | undefined;
    expect(contents).toBeDefined();
    expect(contents).toHaveLength(2);
    const first = contents?.[0] as Record<string, unknown> | undefined;
    expect(first?.language).toBe('cpp');
    expect(first?.value).toBe('int main()');
    expect(contents?.[1]).toContain("[使用了未声明的标识符 'Foo']");
  });

  it('disabled target：diagnostics 禁用时 diagnostics 通知透传不修改', () => {
    const bridge = createLocalizedBridge(transport, ['codeActions']);
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file:///test.cpp', diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: "use of undeclared identifier 'Foo'" }] } }));
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    expect(diags?.[0]?.message).toBe("use of undeclared identifier 'Foo'");
    expect(diags?.[0]?.message).not.toContain('[使用了未声明的标识符');
  });

  it('localization 完全禁用时所有消息透传不修改', () => {
    const bridge = new LspBridge(transport);
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(encodeMessage({ jsonrpc: '2.0', id: 20, method: 'textDocument/codeAction', params: { textDocument: { uri: 'file:///test.cpp' }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, context: { diagnostics: [] } } }));
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', id: 20, result: [{ title: "use of undeclared identifier 'Foo'", kind: 'quickfix' }] }));
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Array<Record<string, unknown>> | undefined;
    expect(result?.[0]?.title).toBe("use of undeclared identifier 'Foo'");
  });

  it('非目标响应（completion）透传，JSON 内容等效', () => {
    const bridge = createLocalizedBridge(transport, ['diagnostics']);
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(encodeMessage({ jsonrpc: '2.0', id: 30, method: 'textDocument/completion', params: { textDocument: { uri: 'file:///test.cpp' }, position: { line: 0, character: 0 } } }));
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', id: 30, result: { items: [{ label: 'Foo', kind: 6 }] } }));
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Record<string, unknown> | undefined;
    const items = result?.items as Array<Record<string, unknown>> | undefined;
    expect(items?.[0]?.label).toBe('Foo');
    expect(items?.[0]?.kind).toBe(6);
  });

  it('非目标通知（telemetry/event）透传，JSON 内容等效', () => {
    const bridge = createLocalizedBridge(transport, ['diagnostics']);
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', method: 'telemetry/event', params: { event: 'test', data: { key: 'value' } } }));
    const msgs = parseFrames(clientOutput);
    expect(msgs[0]?.method).toBe('telemetry/event');
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    expect(params?.event).toBe('test');
  });

  it('override 模式：替换原文为中文翻译', () => {
    const bridge = createLocalizedBridge(transport, ['diagnostics'], 'override');
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file:///test.cpp', diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: "use of undeclared identifier 'Foo'" }] } }));
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    expect(diags?.[0]?.message).toBe("[使用了未声明的标识符 'Foo']");
  });

  it('多个 diagnostics 条目都被本地化', () => {
    const bridge = createLocalizedBridge(transport, ['diagnostics']);
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file:///test.cpp', diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: "use of undeclared identifier 'Foo'" }, { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, severity: 1, message: "unknown type name 'FMyClass'" }] } }));
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    expect(diags?.[0]?.message).toContain("[使用了未声明的标识符 'Foo']");
    expect(diags?.[1]?.message).toContain("[未知的类型名称 'FMyClass']");
  });

  it('codeAction 响应本地化：多个 action 都被处理', () => {
    const bridge = createLocalizedBridge(transport, ['codeActions']);
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(encodeMessage({ jsonrpc: '2.0', id: 40, method: 'textDocument/codeAction', params: { textDocument: { uri: 'file:///test.cpp' }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, context: { diagnostics: [] } } }));
    transport.receiveFromServer(encodeMessage({ jsonrpc: '2.0', id: 40, result: [{ title: "use of undeclared identifier 'Foo'", kind: 'quickfix' }, { title: "unknown type name 'FMyClass'", kind: 'quickfix' }] }));
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Array<Record<string, unknown>> | undefined;
    expect(result).toBeDefined();
    expect(result).toHaveLength(2);
    expect(result?.[0]?.title).toContain("[使用了未声明的标识符 'Foo']");
    expect(result?.[1]?.title).toContain("[未知的类型名称 'FMyClass']");
  });
});
