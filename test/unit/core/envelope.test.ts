import { describe, it, expect } from 'vitest';
import {
  EC_PROJECT_NOT_DETECTED,
  EC_UBT_NOT_FOUND,
  EC_BUILD_FAILED,
  EC_LIVE_CODING_UNAVAILABLE,
  EC_CLANGD_NOT_AVAILABLE,
  EC_OPERATION_CANCELLED,
  EC_MCP_CONTEXT_NOT_INITIALIZED,
  EC_UNKNOWN_TOOL,
  EC_INTERNAL_ERROR,
  okEnvelope,
  errEnvelope,
  ContractErrorCode,
} from '../../../src/core/envelope';

describe('ContractErrorCode 常量值', () => {
  const codePairs: [ContractErrorCode, string][] = [
    [EC_PROJECT_NOT_DETECTED, 'PROJECT_NOT_DETECTED'],
    [EC_UBT_NOT_FOUND, 'UBT_NOT_FOUND'],
    [EC_BUILD_FAILED, 'BUILD_FAILED'],
    [EC_LIVE_CODING_UNAVAILABLE, 'LIVE_CODING_UNAVAILABLE'],
    [EC_CLANGD_NOT_AVAILABLE, 'CLANGD_NOT_AVAILABLE'],
    [EC_OPERATION_CANCELLED, 'OPERATION_CANCELLED'],
    [EC_MCP_CONTEXT_NOT_INITIALIZED, 'MCP_CONTEXT_NOT_INITIALIZED'],
    [EC_UNKNOWN_TOOL, 'UNKNOWN_TOOL'],
    [EC_INTERNAL_ERROR, 'INTERNAL_ERROR'],
  ];
  it.each(codePairs)('%p === %p', (constVal, literal) => {
    expect(constVal).toBe(literal);
  });
});

describe('okEnvelope', () => {
  it('无参数: 只产出 ok 字段', () => {
    const result = okEnvelope();
    expect(result).toEqual({ ok: true });
    expect('error' in result).toBe(false);
  });
  it('带 data: 产出 ok, data', () => {
    const data = { foo: 123 };
    const result = okEnvelope(data);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(data);
    expect('error' in result).toBe(false);
  });
  it('带 data+summary: 产出 ok, data, summary', () => {
    const data = [1, 2];
    const summary = 's';
    const result = okEnvelope(data, summary);
    expect(result).toEqual({ ok: true, data, summary });
    expect('error' in result).toBe(false);
  });
});

describe('errEnvelope', () => {
  it('只填 code/message, 必有 ok=false + error 对象(code/message)', () => {
    const result = errEnvelope('INTERNAL_ERROR', '原因ABC');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('INTERNAL_ERROR');
    expect(result.error?.message).toBe('原因ABC');
    expect(result.error?.details).toBeUndefined();
  });
  it('填 details, error.details 正确透传', () => {
    const details = { foo: 321, bar: 'kkk' };
    const result = errEnvelope('BUILD_FAILED', 'msg', details);
    expect(result.error?.details).toEqual(details);
  });
});
