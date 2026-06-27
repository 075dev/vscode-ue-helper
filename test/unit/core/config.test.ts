import { describe, it, expect } from 'vitest';
import { MsvcParser } from '@parsers/msvcParser';
import { UbtParser } from '@parsers/ubtParser';
import { LinkerParser } from '@parsers/linkerParser';

describe('LinkerParser', () => {
  it('parses LNK2019 errors', () => {
    const p = new LinkerParser();
    const m = p.parse('LNK2019: unresolved external symbol foo');
    expect(m?.code).toBe('LNK2019');
    expect(m?.message).toContain('unresolved external symbol foo');
  });

  it('extracts undefined symbol names', () => {
    const p = new LinkerParser();
    expect(p.extractSymbol('undefined reference to `SomeFunc`')).toBe('SomeFunc');
    expect(p.extractSymbol('undefined reference to globalVar')).toBe('globalVar');
  });

  it('returns null for non-linker lines', () => {
    const p = new LinkerParser();
    expect(p.parse('Random output')).toBeNull();
  });
});

describe('MsvcParser integration with UbtParser', () => {
  it('correctly handles interleaved UBT progress + MSVC diagnostics', () => {
    const msvc = new MsvcParser();
    const ubt = new UbtParser();

    const lines = [
      '[ 1/45] Compile Module.Core.cpp',
      'C:/proj/main.cpp(42,5): error C2065: undeclared x',
      '[ 2/45] Link UE5Editor.exe',
    ];

    const allDiags: ReturnType<MsvcParser['parse']> = [];
    for (const line of lines) {
      allDiags.push(...msvc.parse(line + '\n'));
      const progress = ubt.parse(line);
      if (progress) {
        expect(progress.current).toBeGreaterThan(0);
        expect(progress.total).toBe(45);
      }
    }
    allDiags.push(...msvc.flush());

    expect(allDiags).toHaveLength(1);
    expect(allDiags[0]?.code).toBe('C2065');
  });
});
