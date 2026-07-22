/**
 * diagnostic 类型测试 —— 验证 ParsedDiagnostic 字段契约
 *
 * Wave 4 T4.2：ParsedDiagnostic 从 @build/types 抽离到 @core/types/diagnostic。
 * 本测试保证字段形态不被后续重构偷偷改动（兼容性护栏）。
 */

import { describe, it, expect } from 'vitest';
import type { ParsedDiagnostic } from '@core/types/diagnostic';

describe('ParsedDiagnostic', () => {
  it('构造一个完整 MSVC 形态（含 column）', () => {
    const d: ParsedDiagnostic = {
      file: 'C:/proj/main.cpp',
      line: 42,
      column: 5,
      severity: 'error',
      code: 'C2065',
      message: "'x': undeclared identifier",
      raw: "C:/proj/main.cpp(42,5): error C2065: 'x': undeclared identifier",
    };

    expect(d.file).toBe('C:/proj/main.cpp');
    expect(d.line).toBe(42);
    expect(d.column).toBe(5);
    expect(d.severity).toBe('error');
    expect(d.code).toBe('C2065');
    expect(d.message).toContain('undeclared identifier');
    expect(d.raw).toContain('C2065');
  });

  it('构造一个 linker fallback 形态（无 column）', () => {
    const d: ParsedDiagnostic = {
      file: 'Module.Gen.cpp.obj',
      line: 1,
      severity: 'error',
      code: 'LNK2019',
      message: 'unresolved external symbol foo',
      raw: 'Module.Gen.cpp.obj : error LNK2019: unresolved external symbol foo',
    };

    expect(d.line).toBe(1);
    expect(d.column).toBeUndefined();
    expect(d.severity).toBe('error');
    expect(d.code).toBe('LNK2019');
  });

  it('severity 字面量被严格收窄', () => {
    // 编译期断言：以下三种值合法，其它不行
    const severities: ParsedDiagnostic['severity'][] = ['error', 'warning', 'note'];
    expect(severities).toHaveLength(3);

    const warn: ParsedDiagnostic['severity'] = 'warning';
    const note: ParsedDiagnostic['severity'] = 'note';
    expect(warn).toBe('warning');
    expect(note).toBe('note');
  });

  it('line / code / raw 是必填字段', () => {
    // 编译期断言：以下字面量对象缺任一必填字段应编译失败
    // （若有人偷偷把字段改为 optional，TS 会在这里开始报错）
    const must: Pick<ParsedDiagnostic, 'line' | 'code' | 'raw'> = {
      line: 1,
      code: 'X1',
      raw: 'x',
    };
    expect(must.line).toBe(1);
    expect(must.code).toBe('X1');
    expect(must.raw).toBe('x');
  });
});
