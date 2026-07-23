/**
 * errors.test.ts —— VSCodeUEHelperError + E_* 常量 + isVSCodeUEHelperError 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  VSCodeUEHelperError,
  E_CONFIG_INVALID,
  E_DETECTION_NOT_READY,
  E_BUILD_FAILED,
  E_PROXY_CRASHED,
  isVSCodeUEHelperError,
  type ErrorCode,
} from '@core/errors';

describe('E_* 常量', () => {
  it('E_CONFIG_INVALID 字面量正确', () => {
    expect(E_CONFIG_INVALID).toBe('E_CONFIG_INVALID');
  });

  it('E_DETECTION_NOT_READY 字面量正确', () => {
    expect(E_DETECTION_NOT_READY).toBe('E_DETECTION_NOT_READY');
  });

  it('E_BUILD_FAILED 字面量正确', () => {
    expect(E_BUILD_FAILED).toBe('E_BUILD_FAILED');
  });

  it('E_PROXY_CRASHED 字面量正确', () => {
    expect(E_PROXY_CRASHED).toBe('E_PROXY_CRASHED');
  });

  it('常量可赋值给 ErrorCode 类型', () => {
    // 编译期类型守卫
    const codes: ErrorCode[] = [
      E_CONFIG_INVALID,
      E_DETECTION_NOT_READY,
      E_BUILD_FAILED,
      E_PROXY_CRASHED,
    ];
    expect(codes).toHaveLength(4);
  });
});

describe('VSCodeUEHelperError', () => {
  it('name 字段固定为 VSCodeUEHelperError', () => {
    const e = new VSCodeUEHelperError(E_CONFIG_INVALID, 'bad config');
    expect(e.name).toBe('VSCodeUEHelperError');
  });

  it('message 透传到 Error.message', () => {
    const e = new VSCodeUEHelperError(E_BUILD_FAILED, 'UBT exit 1');
    expect(e.message).toBe('UBT exit 1');
  });

  it('code 字段关联 E_* 常量', () => {
    const e = new VSCodeUEHelperError(E_PROXY_CRASHED, 'proxy died');
    expect(e.code).toBe(E_PROXY_CRASHED);
  });

  it('cause 字段(可选)正确传递', () => {
    const inner = new Error('inner');
    const e = new VSCodeUEHelperError(E_DETECTION_NOT_READY, 'no workspace', inner);
    expect(e.cause).toBe(inner);
  });

  it('cause 缺省时为 undefined', () => {
    const e = new VSCodeUEHelperError(E_CONFIG_INVALID, 'bad');
    expect(e.cause).toBeUndefined();
  });

  it('是 Error 子类(instanceof Error 为 true)', () => {
    const e = new VSCodeUEHelperError(E_CONFIG_INVALID, 'x');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('isVSCodeUEHelperError 类型守卫', () => {
  it('识别 VSCodeUEHelperError 实例', () => {
    const e = new VSCodeUEHelperError(E_CONFIG_INVALID, 'x');
    expect(isVSCodeUEHelperError(e)).toBe(true);
    if (isVSCodeUEHelperError(e)) {
      // narrow 后可访问 e.code
      expect(e.code).toBe(E_CONFIG_INVALID);
    }
  });

  it('拒绝普通 Error', () => {
    const e = new Error('plain');
    expect(isVSCodeUEHelperError(e)).toBe(false);
  });

  it('拒绝 string / number / null / undefined', () => {
    expect(isVSCodeUEHelperError('error')).toBe(false);
    expect(isVSCodeUEHelperError(42)).toBe(false);
    expect(isVSCodeUEHelperError(null)).toBe(false);
    expect(isVSCodeUEHelperError(undefined)).toBe(false);
  });

  it('拒绝 plain object', () => {
    expect(isVSCodeUEHelperError({ code: 'E_X', message: 'fake' })).toBe(false);
  });
});
