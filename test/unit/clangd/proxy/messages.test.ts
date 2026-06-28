/**
 * messages.test.ts —— JSON-RPC/LSP 消息分类与关联 单元测试
 *
 * 测试策略：
 * - 所有类型从 unknown 收窄，不使用 any
 * - 覆盖 request/response/notification/error 四种消息分类
 * - 覆盖 method/id/result/error 辅助谓词
 * - 覆盖请求-响应关联（correlation）功能
 * - 畸形 id/method 不抛异常，直接透传
 */

import { describe, it, expect } from 'vitest';
import {
  isRequest,
  isNotification,
  isResponse,
  isErrorResponse,
  getMethod,
  getId,
  getResult,
  getError,
  RequestCorrelation,
} from '@clangd/proxy/messages';

// =============================================================================
// 辅助：构造各类消息的工厂函数
// =============================================================================

function makeRequest(
  id: number | string,
  method: string,
  params?: unknown,
): unknown {
  const msg: Record<string, unknown> = { jsonrpc: '2.0', id, method };
  if (params !== undefined) {msg.params = params;}
  return msg;
}

function makeNotification(method: string, params?: unknown): unknown {
  const msg: Record<string, unknown> = { jsonrpc: '2.0', method };
  if (params !== undefined) {msg.params = params;}
  return msg;
}

function makeResponse(id: number | string, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result };
}

function makeErrorResponse(
  id: number | string,
  code: number,
  message: string,
): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
// =============================================================================
// 类型守卫 —— isRequest
// =============================================================================

describe('isRequest (请求判定)', () => {
  it('有 id 和 method 的消息应判定为请求', () => {
    const msg = makeRequest(1, 'textDocument/hover');
    expect(isRequest(msg)).toBe(true);
  });

  it('有 id 和 method 的消息收窄后类型正确', () => {
    const msg: unknown = makeRequest(7, 'textDocument/hover');
    if (isRequest(msg)) {
      expect(msg.id).toBe(7);
      expect(msg.method).toBe('textDocument/hover');
    } else {
      expect.unreachable('应被收窄为 JsonRpcRequest');
    }
  });

  it('无 method 的消息不应判定为请求', () => {
    const msg = { jsonrpc: '2.0', id: 1 };
    expect(isRequest(msg)).toBe(false);
  });

  it('无 id 的消息不应判定为请求', () => {
    const msg = makeNotification('textDocument/didOpen');
    expect(isRequest(msg)).toBe(false);
  });

  it('null id 不应判定为请求（JSON-RPC 规范中 null id 表示通知）', () => {
    const msg: unknown = { jsonrpc: '2.0', id: null, method: 'test' };
    expect(isRequest(msg)).toBe(false);
  });

  it('undefined 输入不应判定为请求', () => {
    expect(isRequest(undefined)).toBe(false);
  });

  it('null 输入不应判定为请求', () => {
    expect(isRequest(null)).toBe(false);
  });

  it('非对象输入不应判定为请求', () => {
    expect(isRequest('string')).toBe(false);
    expect(isRequest(42)).toBe(false);
    expect(isRequest(true)).toBe(false);
  });
});
// =============================================================================
// 类型守卫 —— isNotification
// =============================================================================

describe('isNotification (通知判定)', () => {
  it('有 method 无 id 的消息应判定为通知', () => {
    const msg = makeNotification('textDocument/didOpen');
    expect(isNotification(msg)).toBe(true);
  });

  it('有 method 无 id 的消息收窄后类型正确', () => {
    const msg: unknown = makeNotification('textDocument/didOpen', { textDocument: { uri: 'file:///test.cpp' } });
    if (isNotification(msg)) {
      expect(msg.method).toBe('textDocument/didOpen');
      expect(msg.params).toBeDefined();
    } else {
      expect.unreachable('应被收窄为 JsonRpcNotification');
    }
  });

  it('有 id 和 method 的消息不应判定为通知', () => {
    const msg = makeRequest(1, 'textDocument/hover');
    expect(isNotification(msg)).toBe(false);
  });

  it('无 method 的消息不应判定为通知', () => {
    const msg = { jsonrpc: '2.0', id: 1 };
    expect(isNotification(msg)).toBe(false);
  });

  it('null id 的消息应判定为通知（JSON-RPC 规范）', () => {
    const msg: unknown = { jsonrpc: '2.0', id: null, method: 'textDocument/didChange' };
    expect(isNotification(msg)).toBe(true);
  });

  it('undefined 输入不应判定为通知', () => {
    expect(isNotification(undefined)).toBe(false);
  });

  it('null 输入不应判定为通知', () => {
    expect(isNotification(null)).toBe(false);
  });
});
// =============================================================================
// 类型守卫 —— isResponse
// =============================================================================

describe('isResponse (成功响应判定)', () => {
  it('有 id 和 result 的消息应判定为成功响应', () => {
    const msg = makeResponse(1, { contents: [] });
    expect(isResponse(msg)).toBe(true);
  });

  it('有 id 和 result 的消息收窄后类型正确', () => {
    const msg: unknown = makeResponse(7, { uri: 'file:///test.cpp' });
    if (isResponse(msg)) {
      expect(msg.id).toBe(7);
      expect(msg.result).toEqual({ uri: 'file:///test.cpp' });
    } else {
      expect.unreachable('应被收窄为 JsonRpcResponse');
    }
  });

  it('有 id 和 error 的消息不应判定为成功响应', () => {
    const msg = makeErrorResponse(1, -32601, 'Method not found');
    expect(isResponse(msg)).toBe(false);
  });

  it('无 result 的消息不应判定为成功响应', () => {
    const msg = { jsonrpc: '2.0', id: 1 };
    expect(isResponse(msg)).toBe(false);
  });

  it('result 为 null 的消息应判定为成功响应', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 1, result: null };
    expect(isResponse(msg)).toBe(true);
  });

  it('result 为 false 的消息应判定为成功响应', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 1, result: false };
    expect(isResponse(msg)).toBe(true);
  });

  it('result 为 0 的消息应判定为成功响应', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 1, result: 0 };
    expect(isResponse(msg)).toBe(true);
  });

  it('无 id 的消息不应判定为成功响应', () => {
    const msg = { jsonrpc: '2.0', result: 'ok' };
    expect(isResponse(msg)).toBe(false);
  });
});
// =============================================================================
// 类型守卫 —— isErrorResponse
// =============================================================================

describe('isErrorResponse (错误响应判定)', () => {
  it('有 id 和 error 的消息应判定为错误响应', () => {
    const msg = makeErrorResponse(1, -32601, 'Method not found');
    expect(isErrorResponse(msg)).toBe(true);
  });

  it('有 id 和 error 的消息收窄后类型正确', () => {
    const msg: unknown = makeErrorResponse(1, -32601, 'Method not found');
    if (isErrorResponse(msg)) {
      expect(msg.id).toBe(1);
      expect(msg.error.code).toBe(-32601);
      expect(msg.error.message).toBe('Method not found');
    } else {
      expect.unreachable('应被收窄为 JsonRpcErrorResponse');
    }
  });

  it('error 中带有 data 字段时仍正确判定', () => {
    const msg: unknown = {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32603, message: 'Internal error', data: { detail: 'something broke' } },
    };
    expect(isErrorResponse(msg)).toBe(true);
    if (isErrorResponse(msg)) {
      expect(msg.error.data).toEqual({ detail: 'something broke' });
    }
  });

  it('有 id 和 result 的消息不应判定为错误响应', () => {
    const msg = makeResponse(1, 'ok');
    expect(isErrorResponse(msg)).toBe(false);
  });

  it('无 error 字段的消息不应判定为错误响应', () => {
    const msg = { jsonrpc: '2.0', id: 1 };
    expect(isErrorResponse(msg)).toBe(false);
  });

  it('error 为非对象时不应判定为错误响应', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 1, error: 'string error' };
    expect(isErrorResponse(msg)).toBe(false);
  });

  it('error 为 null 时不应判定为错误响应', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 1, error: null };
    expect(isErrorResponse(msg)).toBe(false);
  });

  it('无 id 的消息不应判定为错误响应', () => {
    const msg = { jsonrpc: '2.0', error: { code: -32601, message: 'err' } };
    expect(isErrorResponse(msg)).toBe(false);
  });
});
// =============================================================================
// 辅助谓词 —— getMethod
// =============================================================================

describe('getMethod (获取方法名)', () => {
  it('从请求中提取 method', () => {
    const msg = makeRequest(1, 'textDocument/hover');
    expect(getMethod(msg)).toBe('textDocument/hover');
  });

  it('从通知中提取 method', () => {
    const msg = makeNotification('textDocument/didOpen');
    expect(getMethod(msg)).toBe('textDocument/didOpen');
  });

  it('method 为字符串时返回该字符串', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 1, method: 'textDocument/completion' };
    expect(getMethod(msg)).toBe('textDocument/completion');
  });

  it('method 为非字符串时返回 undefined', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 1, method: 42 };
    expect(getMethod(msg)).toBeUndefined();
  });

  it('无 method 字段时返回 undefined', () => {
    const msg = makeResponse(1, 'ok');
    expect(getMethod(msg)).toBeUndefined();
  });

  it('undefined 输入返回 undefined', () => {
    expect(getMethod(undefined)).toBeUndefined();
  });

  it('null 输入返回 undefined', () => {
    expect(getMethod(null)).toBeUndefined();
  });

  it('非对象输入返回 undefined', () => {
    expect(getMethod('string')).toBeUndefined();
  });
});
// =============================================================================
// 辅助谓词 —— getId
// =============================================================================

describe('getId (获取消息 ID)', () => {
  it('从请求中提取数字 id', () => {
    const msg = makeRequest(7, 'textDocument/hover');
    expect(getId(msg)).toBe(7);
  });

  it('从请求中提取字符串 id', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 'req-001', method: 'textDocument/hover' };
    expect(getId(msg)).toBe('req-001');
  });

  it('从响应中提取 id', () => {
    const msg = makeResponse(7, {});
    expect(getId(msg)).toBe(7);
  });

  it('id 为 0 时返回 0（有效 id）', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 0, method: 'test' };
    expect(getId(msg)).toBe(0);
  });

  it('id 为 null 时返回 undefined', () => {
    const msg: unknown = { jsonrpc: '2.0', id: null, method: 'test' };
    expect(getId(msg)).toBeUndefined();
  });

  it('id 为 undefined 时返回 undefined', () => {
    const msg = makeNotification('textDocument/didOpen');
    expect(getId(msg)).toBeUndefined();
  });

  it('id 为对象时返回 undefined', () => {
    const msg: unknown = { jsonrpc: '2.0', id: { not: 'valid' }, method: 'test' };
    expect(getId(msg)).toBeUndefined();
  });

  it('undefined 输入返回 undefined', () => {
    expect(getId(undefined)).toBeUndefined();
  });
});
// =============================================================================
// 辅助谓词 —— getResult
// =============================================================================

describe('getResult (获取成功结果)', () => {
  it('从成功响应中提取 result', () => {
    const result = { contents: [{ kind: 'markdown', value: 'hello' }] };
    const msg = makeResponse(1, result);
    expect(getResult(msg)).toEqual(result);
  });

  it('result 为 null 时返回 null', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 1, result: null };
    expect(getResult(msg)).toBeNull();
  });

  it('result 为 false 时返回 false', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 1, result: false };
    expect(getResult(msg)).toBe(false);
  });

  it('无 result 字段时返回 undefined', () => {
    const msg = makeErrorResponse(1, -32601, 'err');
    expect(getResult(msg)).toBeUndefined();
  });

  it('undefined 输入返回 undefined', () => {
    expect(getResult(undefined)).toBeUndefined();
  });
});
// =============================================================================
// 辅助谓词 —— getError
// =============================================================================

describe('getError (获取错误信息)', () => {
  it('从错误响应中提取 error', () => {
    const msg = makeErrorResponse(1, -32601, 'Method not found');
    const err = getError(msg);
    expect(err).toBeDefined();
    expect(err?.code).toBe(-32601);
    expect(err?.message).toBe('Method not found');
  });

  it('无 error 字段时返回 undefined', () => {
    const msg = makeResponse(1, 'ok');
    expect(getError(msg)).toBeUndefined();
  });

  it('error 为非对象时返回 undefined', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 1, error: 'string' };
    expect(getError(msg)).toBeUndefined();
  });

  it('error 为 null 时返回 undefined', () => {
    const msg: unknown = { jsonrpc: '2.0', id: 1, error: null };
    expect(getError(msg)).toBeUndefined();
  });

  it('undefined 输入返回 undefined', () => {
    expect(getError(undefined)).toBeUndefined();
  });
});
// =============================================================================
// 请求-响应关联 —— RequestCorrelation
// =============================================================================

describe('RequestCorrelation (请求-响应关联)', () => {
  it('记录并查找数字 id 对应的 method', () => {
    const corr = new RequestCorrelation();
    corr.record(7, 'textDocument/hover');
    expect(corr.lookup(7)).toBe('textDocument/hover');
  });

  it('记录并查找字符串 id 对应的 method', () => {
    const corr = new RequestCorrelation();
    corr.record('req-001', 'textDocument/codeAction');
    expect(corr.lookup('req-001')).toBe('textDocument/codeAction');
  });

  it('查找未记录的 id 返回 undefined', () => {
    const corr = new RequestCorrelation();
    expect(corr.lookup(999)).toBeUndefined();
  });

  it('移除后 lookup 返回 undefined', () => {
    const corr = new RequestCorrelation();
    corr.record(7, 'textDocument/hover');
    corr.remove(7);
    expect(corr.lookup(7)).toBeUndefined();
  });

  it('移除不存在的 id 不抛异常', () => {
    const corr = new RequestCorrelation();
    expect(() => corr.remove(999)).not.toThrow();
  });

  it('重复记录同一 id 更新 method', () => {
    const corr = new RequestCorrelation();
    corr.record(7, 'textDocument/hover');
    corr.record(7, 'textDocument/completion');
    expect(corr.lookup(7)).toBe('textDocument/completion');
  });

  it('多个不同 id 各自独立关联', () => {
    const corr = new RequestCorrelation();
    corr.record(1, 'textDocument/hover');
    corr.record(2, 'textDocument/codeAction');
    corr.record(3, 'textDocument/completion');
    expect(corr.lookup(1)).toBe('textDocument/hover');
    expect(corr.lookup(2)).toBe('textDocument/codeAction');
    expect(corr.lookup(3)).toBe('textDocument/completion');
  });

  it('clear 清除所有关联', () => {
    const corr = new RequestCorrelation();
    corr.record(1, 'textDocument/hover');
    corr.record(2, 'textDocument/codeAction');
    corr.clear();
    expect(corr.lookup(1)).toBeUndefined();
    expect(corr.lookup(2)).toBeUndefined();
  });

  it('size 返回当前关联数', () => {
    const corr = new RequestCorrelation();
    expect(corr.size).toBe(0);
    corr.record(1, 'textDocument/hover');
    expect(corr.size).toBe(1);
    corr.record(2, 'textDocument/codeAction');
    expect(corr.size).toBe(2);
    corr.remove(1);
    expect(corr.size).toBe(1);
    corr.clear();
    expect(corr.size).toBe(0);
  });
});
