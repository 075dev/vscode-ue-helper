import { describe, it, expect } from 'vitest';
import { MsvcParser } from '@parsers/msvcParser';

describe('MsvcParser', () => {
  it('parses a basic MSVC error line', () => {
    const p = new MsvcParser();
    const diags = p.parse('C:/proj/main.cpp(42,5): error C2065: undeclared identifier foo\n');
    p.flush();
    expect(diags).toHaveLength(1);
    const d = diags[0]!;
    expect(d.file).toBe('C:/proj/main.cpp');
    expect(d.line).toBe(42);
    expect(d.column).toBe(5);
    expect(d.severity).toBe('error');
    expect(d.code).toBe('C2065');
    expect(d.message).toContain('undeclared identifier foo');
  });

  it('parses a warning without column', () => {
    const p = new MsvcParser();
    const diags = p.parse('src/foo.cpp(10): warning C4244: conversion\n');
    p.flush();
    expect(diags).toHaveLength(1);
    const d = diags[0]!;
    expect(d.line).toBe(10);
    expect(d.column).toBeUndefined();
    expect(d.severity).toBe('warning');
    expect(d.code).toBe('C4244');
  });

  it('strips UBT build context prefix', () => {
    const p = new MsvcParser();
    const diags = p.parse('[1/45] MyModule: C:/proj/main.cpp(15,3): error C2065: nope\n');
    p.flush();
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('C2065');
    expect(diags[0]?.file).toBe('C:/proj/main.cpp');
  });

  it('parses LNK linker errors', () => {
    const p = new MsvcParser();
    const diags = p.parse('Module.cpp.obj : error LNK2019: unresolved external symbol foo\n');
    p.flush();
    expect(diags).toHaveLength(1);
    const d = diags[0]!;
    expect(d.severity).toBe('error');
    expect(d.code).toBe('LNK2019');
    expect(d.message).toContain('unresolved external symbol');
  });

  it('parses LNK fatal error as error (F1-7)', () => {
    const p = new MsvcParser();
    const diags = p.parse(
      "LINK : fatal error LNK1104: cannot open file 'UE5Editor.exe'\n",
    );
    p.flush();
    expect(diags).toHaveLength(1);
    const d = diags[0]!;
    expect(d.severity).toBe('error');
    expect(d.code).toBe('LNK1104');
    expect(d.message).toContain("cannot open file 'UE5Editor.exe'");
  });

  it('returns empty for unrelated lines', () => {
    const p = new MsvcParser();
    const diags = p.parse('Some random output line\nAnother line\n');
    p.flush();
    expect(diags).toEqual([]);
  });

  it('normalizes backslashes to forward slashes', () => {
    const p = new MsvcParser();
    const diags = p.parse('C:\\proj\\main.cpp(5,1): error C2065: x\n');
    p.flush();
    expect(diags[0]?.file).toBe('C:/proj/main.cpp');
  });
});
