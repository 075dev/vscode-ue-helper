/**
 * result.test.ts —— Result<T, E> + Ok/Err/isOk/isErr 单元测试
 */
import { describe, it, expect } from 'vitest';
import { Ok, Err, isOk, isErr, type Result } from '@core/result';

describe('Result<T, E>', () => {
  describe('Ok factory', () => {
    it('构造成功 Result 含 value', () => {
      const r = Ok(42);
      expect(r.ok).toBe(true);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toBe(42);
      }
    });

    it('支持任意 value 类型(对象、数组、null)', () => {
      const obj = Ok({ name: 'foo' });
      expect(isOk(obj)).toBe(true);
      if (isOk(obj)) {
        expect(obj.value.name).toBe('foo');
      }

      const arr = Ok([1, 2, 3]);
      if (isOk(arr)) {
        expect(arr.value).toEqual([1, 2, 3]);
      }

      const nul = Ok(null);
      if (isOk(nul)) {
        expect(nul.value).toBeNull();
      }
    });
  });

  describe('Err factory', () => {
    it('构造失败 Result 含 code + message', () => {
      const r = Err('E_TEST', 'something failed');
      expect(r.ok).toBe(false);
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error.code).toBe('E_TEST');
        expect(r.error.message).toBe('something failed');
      }
    });
  });

  describe('isOk type guard', () => {
    it('成功时返回 true 并 narrow value', () => {
      const r: Result<number> = Ok(10);
      if (isOk(r)) {
        // 编译期应推导出 r.value 为 number
        const v: number = r.value;
        expect(v).toBe(10);
      } else {
        throw new Error('expected ok');
      }
    });

    it('失败时返回 false', () => {
      const r: Result<number> = Err('E_X', 'fail');
      expect(isOk(r)).toBe(false);
    });
  });

  describe('isErr type guard', () => {
    it('失败时返回 true 并 narrow error', () => {
      const r: Result<number> = Err('E_TEST', 'nope');
      if (isErr(r)) {
        // 编译期应推导出 r.error 为 { code, message }
        expect(r.error.code).toBe('E_TEST');
        expect(r.error.message).toBe('nope');
      } else {
        throw new Error('expected err');
      }
    });

    it('成功时返回 false', () => {
      const r: Result<number> = Ok(1);
      expect(isErr(r)).toBe(false);
    });
  });

  describe('Result 在分支中的实际用法', () => {
    function divide(a: number, b: number): Result<number> {
      if (b === 0) {
        return Err('E_DIV_ZERO', 'division by zero');
      }
      return Ok(a / b);
    }

    it('成功路径取 value', () => {
      const r = divide(10, 2);
      if (!isOk(r)) {
        throw new Error('expected ok');
      }
      expect(r.value).toBe(5);
    });

    it('失败路径取 error', () => {
      const r = divide(10, 0);
      if (!isErr(r)) {
        throw new Error('expected err');
      }
      expect(r.error.code).toBe('E_DIV_ZERO');
    });
  });
});
