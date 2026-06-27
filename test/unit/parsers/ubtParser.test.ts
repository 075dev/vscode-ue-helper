import { describe, it, expect } from 'vitest';
import { UbtParser } from '@parsers/ubtParser';

describe('UbtParser', () => {
  it('parses a UBT progress line', () => {
    const p = new UbtParser();
    const result = p.parse('[ 12/45] Compile Module.Core.cpp');
    expect(result).not.toBeNull();
    expect(result?.current).toBe(12);
    expect(result?.total).toBe(45);
    expect(result?.description).toBe('Compile Module.Core.cpp');
  });

  it('handles padded brackets', () => {
    const p = new UbtParser();
    const result = p.parse('[1/2] Link UE5Editor.exe');
    expect(result?.current).toBe(1);
    expect(result?.total).toBe(2);
  });

  it('returns null for non-progress lines', () => {
    const p = new UbtParser();
    expect(p.parse('Random output line')).toBeNull();
    expect(p.parse('')).toBeNull();
  });
});
