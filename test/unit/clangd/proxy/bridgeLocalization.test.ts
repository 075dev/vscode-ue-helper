/**
 * bridgeLocalization.test.ts —— LSP 代理桥接本地化集成测试
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

function createLocalizedBridge(
  transport: FakeTransport,
  mode: 'append' | 'zh-only' = 'append',
): LspBridge {
  const options: LspBridgeOptions = { localization: { enabled: true, mode } };
  return new LspBridge(transport, options);
}

function collectClientOutput(bridge: LspBridge): Buffer[] {
  const output: Buffer[] = [];
  bridge.onClientOutput((frame) => output.push(frame));
  return output;
}

describe('LspBridge - localization', () => {
  let transport: FakeTransport;
  beforeEach(() => {
    transport = new FakeTransport();
  });

  it('diagnostics notification: translated', () => {
    const bridge = createLocalizedBridge(transport, 'append');
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///test.cpp',
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              message: "use of undeclared identifier 'Foo'",
            },
          ],
        },
      }),
    );
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    const msg = diags?.[0]?.message as string | undefined;
    expect(msg).toMatch(/[\u4e00-\u9fff]/);
    expect(msg).toContain("use of undeclared identifier 'Foo'");
  });

  it('diagnostics notification: unmatched unchanged', () => {
    const bridge = createLocalizedBridge(transport, 'append');
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///test.cpp',
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              message: 'some random diagnostic',
            },
          ],
        },
      }),
    );
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    expect(diags?.[0]?.message).toBe('some random diagnostic');
  });

  it('diagnostics notification: relatedInformation translated', () => {
    const bridge = createLocalizedBridge(transport, 'append');
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///test.cpp',
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              message: "use of undeclared identifier 'Foo'",
              relatedInformation: [
                {
                  location: {
                    uri: 'file:///other.h',
                    range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
                  },
                  message: "no member named 'Value' in 'FMyStruct'",
                },
              ],
            },
          ],
        },
      }),
    );
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    const related = diags?.[0]?.relatedInformation as Array<Record<string, unknown>> | undefined;
    expect(related?.[0]?.message).toMatch(/[\u4e00-\u9fff]/);
  });

  it('codeAction: title translated, fields preserved', () => {
    const bridge = createLocalizedBridge(transport, 'append');
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        id: 10,
        method: 'textDocument/codeAction',
        params: {
          textDocument: { uri: 'file:///test.cpp' },
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          context: { diagnostics: [] },
        },
      }),
    );
    const editData = {
      changes: {
        'file:///test.cpp': [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: 'int x;',
          },
        ],
      },
    };
    const commandData = { command: 'test.command', title: 'Test', arguments: [42] };
    const dataPayload = { someData: 'preserved' };
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 10,
        result: [
          {
            title: "use of undeclared identifier 'Foo'",
            kind: 'quickfix',
            edit: editData,
            command: commandData,
            data: dataPayload,
          },
        ],
      }),
    );
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Array<Record<string, unknown>> | undefined;
    const action = result?.[0];
    expect(action?.title).toMatch(/[\u4e00-\u9fff]/);
    expect(action?.edit).toEqual(editData);
    expect(action?.command).toEqual(commandData);
    expect(action?.data).toEqual(dataPayload);
  });

  it('codeAction: disabled.reason translated', () => {
    const bridge = createLocalizedBridge(transport, 'append');
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        id: 11,
        method: 'textDocument/codeAction',
        params: {
          textDocument: { uri: 'file:///test.cpp' },
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          context: { diagnostics: [] },
        },
      }),
    );
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 11,
        result: [
          {
            title: 'Some action',
            kind: 'quickfix',
            disabled: { reason: "no member named 'Value' in 'FMyStruct'" },
          },
        ],
      }),
    );
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Array<Record<string, unknown>> | undefined;
    const disabled = result?.[0]?.disabled as Record<string, unknown> | undefined;
    expect(disabled?.reason).toMatch(/[\u4e00-\u9fff]/);
  });

  it('hover: text passes through when no dictionary', () => {
    const bridge = createLocalizedBridge(transport, 'append');
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        id: 12,
        method: 'textDocument/hover',
        params: { textDocument: { uri: 'file:///test.cpp' }, position: { line: 5, character: 3 } },
      }),
    );
    const codeBlock = '`cpp\nint x = 42;\n`';
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 12,
        result: {
          contents: {
            kind: 'markdown',
            value: "use of undeclared identifier 'Foo'\n\n" + codeBlock,
          },
        },
      }),
    );
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Record<string, unknown> | undefined;
    const contents = result?.contents as Record<string, unknown> | undefined;
    const value = contents?.value as string | undefined;
    // No dictionary set → hover passes through unchanged
    expect(value).toBe("use of undeclared identifier 'Foo'\n\n" + codeBlock);
  });

  it('hover: MarkedString array passes through when no dictionary', () => {
    const bridge = createLocalizedBridge(transport, 'append');
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        id: 13,
        method: 'textDocument/hover',
        params: { textDocument: { uri: 'file:///test.cpp' }, position: { line: 1, character: 1 } },
      }),
    );
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 13,
        result: {
          contents: [
            { language: 'cpp', value: 'int main()' },
            "use of undeclared identifier 'Foo'",
          ],
        },
      }),
    );
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Record<string, unknown> | undefined;
    const contents = result?.contents as Array<unknown> | undefined;
    expect(contents).toBeDefined();
    expect(contents).toHaveLength(2);
    const first = contents?.[0] as Record<string, unknown> | undefined;
    expect(first?.language).toBe('cpp');
    expect(first?.value).toBe('int main()');
    // No dictionary → hover passes through unchanged
    expect(contents?.[1]).toBe("use of undeclared identifier 'Foo'");
  });

  it('localization enabled: diagnostics translated', () => {
    const bridge = createLocalizedBridge(transport, 'append');
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///test.cpp',
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              message: "use of undeclared identifier 'Foo'",
            },
          ],
        },
      }),
    );
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    expect(diags?.[0]?.message).toMatch(/[\u4e00-\u9fff]/);
  });

  it('localization disabled: messages pass through', () => {
    const bridge = new LspBridge(transport);
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        id: 20,
        method: 'textDocument/codeAction',
        params: {
          textDocument: { uri: 'file:///test.cpp' },
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          context: { diagnostics: [] },
        },
      }),
    );
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 20,
        result: [{ title: "use of undeclared identifier 'Foo'", kind: 'quickfix' }],
      }),
    );
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Array<Record<string, unknown>> | undefined;
    expect(result?.[0]?.title).toBe("use of undeclared identifier 'Foo'");
  });

  it('non-target response (completion) pass through', () => {
    const bridge = createLocalizedBridge(transport, 'append');
    const clientOutput = collectClientOutput(bridge);
    bridge.feedClientFrame(
      encodeMessage({
        jsonrpc: '2.0',
        id: 30,
        method: 'textDocument/completion',
        params: { textDocument: { uri: 'file:///test.cpp' }, position: { line: 0, character: 0 } },
      }),
    );
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        id: 30,
        result: { items: [{ label: 'Foo', kind: 6 }] },
      }),
    );
    const msgs = parseFrames(clientOutput);
    const result = msgs[0]?.result as Record<string, unknown> | undefined;
    const items = result?.items as Array<Record<string, unknown>> | undefined;
    expect(items?.[0]?.label).toBe('Foo');
    expect(items?.[0]?.kind).toBe(6);
  });

  it('non-target notification (telemetry) pass through', () => {
    const bridge = createLocalizedBridge(transport, 'append');
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'telemetry/event',
        params: { event: 'test', data: { key: 'value' } },
      }),
    );
    const msgs = parseFrames(clientOutput);
    expect(msgs[0]?.method).toBe('telemetry/event');
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    expect(params?.event).toBe('test');
  });

  it('zh-only mode: original replaced with translation', () => {
    const bridge = createLocalizedBridge(transport, 'zh-only');
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///test.cpp',
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              message: "use of undeclared identifier 'Foo'",
            },
          ],
        },
      }),
    );
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    const msg = diags?.[0]?.message as string | undefined;
    expect(msg).toMatch(/[\u4e00-\u9fff]/);
    expect(msg).not.toContain('use of undeclared identifier');
  });

  it('multiple diagnostics entries all localized', () => {
    const bridge = createLocalizedBridge(transport, 'append');
    const clientOutput = collectClientOutput(bridge);
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///test.cpp',
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              message: "use of undeclared identifier 'Foo'",
            },
            {
              range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
              severity: 1,
              message: "unknown type name 'FMyClass'",
            },
          ],
        },
      }),
    );
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    expect(diags?.[0]?.message).toMatch(/[\u4e00-\u9fff]/);
    expect(diags?.[1]?.message).toMatch(/[\u4e00-\u9fff]/);
  });

  it('LOC-04-01: disabled localization passes through byte-identical', () => {
    const bridge = new LspBridge(transport);
    const clientOutput = collectClientOutput(bridge);
    const originalMessage = "use of undeclared identifier 'Foo'";
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///test.cpp',
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              message: originalMessage,
            },
          ],
        },
      }),
    );
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    expect(diags?.[0]?.message).toBe(originalMessage);
    expect(diags?.[0]?.message).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('LOC-04-02: append mode has original + translation', () => {
    const bridge = createLocalizedBridge(transport, 'append');
    const clientOutput = collectClientOutput(bridge);
    const originalMessage = "use of undeclared identifier 'Foo'";
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///test.cpp',
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              message: originalMessage,
            },
          ],
        },
      }),
    );
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    const msg = diags?.[0]?.message as string | undefined;
    expect(msg).toContain(originalMessage);
    expect(msg).toMatch(/\[.+\]/);
    expect(msg).toMatch(/[\u4e00-\u9fff]/);
  });

  it('LOC-04-03: zh-only mode has only translation', () => {
    const bridge = createLocalizedBridge(transport, 'zh-only');
    const clientOutput = collectClientOutput(bridge);
    const originalMessage = "use of undeclared identifier 'Foo'";
    transport.receiveFromServer(
      encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///test.cpp',
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              message: originalMessage,
            },
          ],
        },
      }),
    );
    const msgs = parseFrames(clientOutput);
    const params = msgs[0]?.params as Record<string, unknown> | undefined;
    const diags = params?.diagnostics as Array<Record<string, unknown>> | undefined;
    const msg = diags?.[0]?.message as string | undefined;
    expect(msg).toMatch(/[\u4e00-\u9fff]/);
    expect(msg).not.toContain(originalMessage);
  });
});
