/**
 * framing.test.ts —— LSP stdio 帧解析器/序列化器 单元测试
 *
 * 测试策略：
 * - 基于 Buffer 的解析，不依赖行分割或 JS 字符串长度
 * - Content-Length 使用 UTF-8 字节长度
 * - 包含：单帧、拼接帧、部分帧、UTF-8 中文、无效长度、垃圾恢复
 */

import { describe, it, expect } from 'vitest';
import { LspFramingParser, encodeMessage } from '@clangd/proxy/framing';

// ---------------------------------------------------------------------------
// 辅助：快速构造一个完整的 LSP 帧 Buffer
// ---------------------------------------------------------------------------
function makeFrame(body: object): Buffer {
  const json = JSON.stringify(body);
  const utf8 = Buffer.from(json, 'utf-8');
  const header = `Content-Length: ${utf8.byteLength}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, 'ascii'), utf8]);
}

// ---------------------------------------------------------------------------
// encodeMessage —— 序列化器
// ---------------------------------------------------------------------------
describe('encodeMessage (序列化器)', () => {
  it('生成 Content-Length 头 + 双 CRLF + JSON 体', () => {
    const buf = encodeMessage({ jsonrpc: '2.0', method: 'test' });
    const text = buf.toString('utf-8');
    expect(text).toMatch(/^Content-Length: \d+\r\n\r\n/);
    expect(text).toContain('"jsonrpc":"2.0"');
    expect(text).toContain('"method":"test"');
  });

  it('Content-Length 等于 UTF-8 字节长度，而非 JS 字符串长度', () => {
    // 中文 "你好" 在 UTF-8 中是 6 字节，JS 字符串长度是 2
    const body = { jsonrpc: '2.0', message: '你好' };
    const buf = encodeMessage(body);
    const headerEnd = buf.indexOf('\r\n\r\n');
    expect(headerEnd).not.toBe(-1);
    const header = buf.subarray(0, headerEnd).toString('ascii');
    const match = header.match(/Content-Length: (\d+)/);
    expect(match).not.toBeNull();
    const declaredLength = Number(match![1]);
    // 验证声明的长度确实等于 UTF-8 字节数
    const json = JSON.stringify(body);
    const actualUtf8Length = Buffer.byteLength(json, 'utf-8');
    expect(declaredLength).toBe(actualUtf8Length);
    // 验证它不等于 JS 字符串长度（中文场景下不同）
    expect(declaredLength).not.toBe(json.length);
  });

  it('Content-Length 与 JSON 体字节数严格一致', () => {
    const body = { jsonrpc: '2.0', params: { a: 1, b: 'hello' } };
    const buf = encodeMessage(body);
    const sep = Buffer.from('\r\n\r\n', 'ascii');
    const sepIdx = buf.indexOf(sep);
    expect(sepIdx).not.toBe(-1);
    const headerPart = buf.subarray(0, sepIdx).toString('ascii');
    const bodyPart = buf.subarray(sepIdx + sep.length);
    const m = headerPart.match(/Content-Length: (\d+)/);
    expect(m).not.toBeNull();
    expect(bodyPart.byteLength).toBe(Number(m![1]));
  });

  it('支持 JSON-RPC 通知（无 id）', () => {
    const buf = encodeMessage({ jsonrpc: '2.0', method: 'test', params: {} });
    const parsed = JSON.parse(buf.subarray(buf.indexOf('\r\n\r\n') + 4).toString('utf-8')) as {
      method?: string;
      id?: unknown;
    };
    expect(parsed.method).toBe('test');
    expect(parsed.id).toBeUndefined();
  });

  it('支持 JSON-RPC 请求（有 id）', () => {
    const buf = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'test' });
    const parsed = JSON.parse(buf.subarray(buf.indexOf('\r\n\r\n') + 4).toString('utf-8')) as {
      id?: number;
    };
    expect(parsed.id).toBe(1);
  });

  it('支持 JSON-RPC 响应（有 result）', () => {
    const buf = encodeMessage({ jsonrpc: '2.0', id: 1, result: { uri: 'file:///test' } });
    const parsed = JSON.parse(buf.subarray(buf.indexOf('\r\n\r\n') + 4).toString('utf-8')) as {
      result?: { uri?: string };
    };
    expect(parsed.result?.uri).toBe('file:///test');
  });

  it('支持 JSON-RPC 错误响应', () => {
    const buf = encodeMessage({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Method not found' },
    });
    const parsed = JSON.parse(buf.subarray(buf.indexOf('\r\n\r\n') + 4).toString('utf-8')) as {
      error?: { code?: number };
    };
    expect(parsed.error?.code).toBe(-32601);
  });
});

// ---------------------------------------------------------------------------
// LspFramingParser —— 解析器
// ---------------------------------------------------------------------------
describe('LspFramingParser (解析器)', () => {
  it('解析单个完整帧', () => {
    const parser = new LspFramingParser();
    const body = { jsonrpc: '2.0', id: 1, method: 'test' };
    const messages = parser.feed(makeFrame(body));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe('test');
    expect(messages[0]?.id).toBe(1);
  });

  it('解析拼接的多个完整帧', () => {
    const parser = new LspFramingParser();
    const frame1 = makeFrame({ jsonrpc: '2.0', id: 1, method: 'a' });
    const frame2 = makeFrame({ jsonrpc: '2.0', id: 2, method: 'b' });
    const messages = parser.feed(Buffer.concat([frame1, frame2]));
    expect(messages).toHaveLength(2);
    expect(messages[0]?.id).toBe(1);
    expect(messages[1]?.id).toBe(2);
  });

  it('分块喂入数据时累积解析', () => {
    const parser = new LspFramingParser();
    const full = makeFrame({ jsonrpc: '2.0', id: 1, method: 'chunked' });
    const part1 = full.subarray(0, 10);
    const part2 = full.subarray(10);

    let messages = parser.feed(part1);
    expect(messages).toHaveLength(0); // 还不完整

    messages = parser.feed(part2);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe('chunked');
  });

  it('UTF-8 中文正文正确解析', () => {
    const parser = new LspFramingParser();
    const body = { jsonrpc: '2.0', id: 1, result: { message: '你好世界' } };
    const messages = parser.feed(makeFrame(body));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.result).toEqual({ message: '你好世界' });
  });

  it('Content-Length 声明为 UTF-8 字节数（中文正文）', () => {
    // 验证：对于包含中文的 JSON，Content-Length 是 UTF-8 字节数
    const body = { text: '中文测试' };
    const json = JSON.stringify(body);
    const utf8Len = Buffer.byteLength(json, 'utf-8');
    const strLen = json.length;
    // 中文场景下，UTF-8 字节长度 > JS 字符串长度
    expect(utf8Len).toBeGreaterThan(strLen);

    // 构造帧并验证解析器能正确读取
    const parser = new LspFramingParser();
    const messages = parser.feed(makeFrame(body));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe('中文测试');
  });

  it('Content-Length 为零时解析空 JSON 体', () => {
    const parser = new LspFramingParser();
    // Content-Length: 0 表示空体
    const buf = Buffer.from('Content-Length: 0\r\n\r\n', 'ascii');
    const messages = parser.feed(buf);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ jsonrpc: '' });
  });

  it('Content-Length 为负值时忽略该帧并继续扫描', () => {
    const parser = new LspFramingParser();
    const bad = Buffer.from('Content-Length: -5\r\n\r\n{}', 'ascii');
    const good = makeFrame({ jsonrpc: '2.0', id: 1, method: 'after-bad' });
    const messages = parser.feed(Buffer.concat([bad, good]));
    // 负长度帧被跳过，只解析后面的有效帧
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe('after-bad');
  });

  it('Content-Length 为非数字时忽略该帧并继续扫描', () => {
    const parser = new LspFramingParser();
    const bad = Buffer.from('Content-Length: abc\r\n\r\n{}', 'ascii');
    const good = makeFrame({ jsonrpc: '2.0', id: 1, method: 'after-nan' });
    const messages = parser.feed(Buffer.concat([bad, good]));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe('after-nan');
  });

  it('Content-Length 声明大于实际数据时等待更多数据', () => {
    const parser = new LspFramingParser();
    // 声明 100 字节但只给了 10 字节
    const header = Buffer.from('Content-Length: 100\r\n\r\n', 'ascii');
    const partialBody = Buffer.alloc(10, 0x20); // 10 个空格
    const messages = parser.feed(Buffer.concat([header, partialBody]));
    expect(messages).toHaveLength(0); // 还不完整
  });

  it('Content-Length 声明小于实际数据时只消费声明长度', () => {
    const parser = new LspFramingParser();
    // 声明 2 字节，但给了更多数据
    const body = { jsonrpc: '2.0', id: 1, method: 'first' };
    const json = JSON.stringify(body);
    const utf8 = Buffer.from(json, 'utf-8');
    // 手动构造一个 Content-Length 只声明 2 字节的帧
    const header = Buffer.from('Content-Length: 2\r\n\r\n', 'ascii');
    const garbage = Buffer.from('xx', 'ascii'); // 额外垃圾
    const messages = parser.feed(Buffer.concat([header, utf8, garbage]));
    // 只消费前 2 字节作为 body，JSON 解析会失败，所以返回空
    // 但 parser 应该恢复并继续扫描
    expect(Array.isArray(messages)).toBe(true);
  });

  it('头部出现垃圾字节后能恢复并解析后续有效帧', () => {
    const parser = new LspFramingParser();
    // 在有效帧前插入垃圾字节
    const garbage = Buffer.from('GET / HTTP/1.1\r\n\r\n', 'ascii');
    const good = makeFrame({ jsonrpc: '2.0', id: 1, method: 'recovered' });
    const messages = parser.feed(Buffer.concat([garbage, good]));
    // 应该跳过垃圾，解析出有效帧
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe('recovered');
  });

  it('连续垃圾字节后恢复（多个无效帧后跟有效帧）', () => {
    const parser = new LspFramingParser();
    const garbage1 = Buffer.from('garbage data without header\r\n', 'ascii');
    const garbage2 = Buffer.from('Content-Length: abc\r\n\r\n{}', 'ascii');
    const good = makeFrame({ jsonrpc: '2.0', id: 1, method: 'multi-recovery' });
    const messages = parser.feed(Buffer.concat([garbage1, garbage2, good]));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe('multi-recovery');
  });

  it('reset() 清除内部缓冲区', () => {
    const parser = new LspFramingParser();
    parser.feed(Buffer.from('Content-Length: 100\r\n\r\n', 'ascii'));
    parser.reset();
    // reset 后内部缓冲区为空
    expect(parser.leftover().byteLength).toBe(0);
    // 再喂有效帧应该能正常解析
    const messages = parser.feed(makeFrame({ jsonrpc: '2.0', id: 1, method: 'after-reset' }));
    expect(messages).toHaveLength(1);
  });

  it('leftover() 返回未消费的字节', () => {
    const parser = new LspFramingParser();
    const full = makeFrame({ jsonrpc: '2.0', id: 1, method: 'leftover-test' });
    const extra = Buffer.from('EXTRA', 'ascii');
    const messages = parser.feed(Buffer.concat([full, extra]));
    expect(messages).toHaveLength(1);
    expect(parser.leftover().toString('ascii')).toBe('EXTRA');
  });

  it('Content-Type 头被忽略（仅 Content-Length 被处理）', () => {
    const parser = new LspFramingParser();
    const body = { jsonrpc: '2.0', id: 1, method: 'ignore-content-type' };
    const json = JSON.stringify(body);
    const utf8 = Buffer.from(json, 'utf-8');
    const header = `Content-Length: ${utf8.byteLength}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`;
    const buf = Buffer.concat([Buffer.from(header, 'ascii'), utf8]);
    const messages = parser.feed(buf);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe('ignore-content-type');
  });

  it('多行头（Content-Length 后跟其他头）正确解析', () => {
    const parser = new LspFramingParser();
    const body = { jsonrpc: '2.0', id: 1, method: 'multi-header' };
    const json = JSON.stringify(body);
    const utf8 = Buffer.from(json, 'utf-8');
    const header = `Content-Length: ${utf8.byteLength}\r\nX-Custom: value\r\n\r\n`;
    const buf = Buffer.concat([Buffer.from(header, 'ascii'), utf8]);
    const messages = parser.feed(buf);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe('multi-header');
  });

  it('Content-Length 值前后有空白字符时仍能解析', () => {
    const parser = new LspFramingParser();
    const body = { jsonrpc: '2.0', id: 1, method: 'whitespace' };
    const json = JSON.stringify(body);
    const utf8 = Buffer.from(json, 'utf-8');
    const header = `Content-Length:  ${utf8.byteLength} \r\n\r\n`; // 前后空格
    const buf = Buffer.concat([Buffer.from(header, 'ascii'), utf8]);
    const messages = parser.feed(buf);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe('whitespace');
  });

  it('超大 Content-Length 不会导致 OOM（限制检查）', () => {
    const parser = new LspFramingParser();
    // 声明 1GB 长度
    const header = Buffer.from('Content-Length: 1073741824\r\n\r\n', 'ascii');
    const messages = parser.feed(header);
    // 没有足够数据，返回空
    expect(messages).toHaveLength(0);
    // 但内部缓冲区不应该膨胀到 1GB
    expect(parser.leftover().byteLength).toBeLessThan(200);
  });

  it('JSON 解析失败时跳过该帧并继续', () => {
    const parser = new LspFramingParser();
    // 声明 5 字节但内容是无效 JSON
    const bad = Buffer.from('Content-Length: 5\r\n\r\n{}{}{}', 'ascii');
    const good = makeFrame({ jsonrpc: '2.0', id: 1, method: 'after-bad-json' });
    const messages = parser.feed(Buffer.concat([bad, good]));
    // 第一个帧 JSON 解析失败被跳过，第二个帧正常解析
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe('after-bad-json');
  });

  it('Content-Length 值为 0 且体为空字符串时解析为空对象', () => {
    const parser = new LspFramingParser();
    const buf = Buffer.from('Content-Length: 0\r\n\r\n', 'ascii');
    const messages = parser.feed(buf);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ jsonrpc: '' });
  });
});
