/**
 * createProject.test.ts —— createProject 命令单元测试
 *
 * 覆盖 formatFillResultDetail 纯函数的三种结果：
 * - added：有实际添加条目
 * - no-op：所有文件已覆盖
 * - skipped：无合适模板跳过
 */

import { describe, it, expect } from 'vitest';
import { formatFillResultDetail } from '@commands/createProject';
import type { FillResult } from '@clangd/compileCommands';

describe('formatFillResultDetail', () => {
  it('added 结果：包含添加数量和源码根数量', () => {
    const result: FillResult = {
      roots: ['/proj/Source', '/proj/Plugins/MyPlugin/Source'],
      scanned: 45,
      missing: ['/proj/Source/new.cpp', '/proj/Source/new.h', '/proj/Plugins/MyPlugin/Source/foo.h'],
      added: ['/proj/Source/new.cpp', '/proj/Source/new.h', '/proj/Plugins/MyPlugin/Source/foo.h'],
    };
    const detail = formatFillResultDetail(result);
    expect(detail).toContain('3');
    expect(detail).toContain('2 source roots');
    expect(detail).not.toContain('All source files now have complete clang flags');
  });

  it('added 结果：单根目录时格式正确', () => {
    const result: FillResult = {
      roots: ['/proj/Source'],
      scanned: 10,
      missing: ['/proj/Source/foo.cpp'],
      added: ['/proj/Source/foo.cpp'],
    };
    const detail = formatFillResultDetail(result);
    expect(detail).toContain('1');
    expect(detail).toContain('source root');
    expect(detail).not.toContain('All source files now have complete clang flags');
  });

  it('no-op 结果：所有文件已覆盖', () => {
    const result: FillResult = {
      roots: ['/proj/Source'],
      scanned: 30,
      missing: [],
      added: [],
    };
    const detail = formatFillResultDetail(result);
    expect(detail).toContain('all scanned source files already covered');
    expect(detail).not.toContain('All source files now have complete clang flags');
  });

  it('skipped 结果：包含跳过原因且不含旧文本', () => {
    const result: FillResult = {
      roots: ['/proj/Source'],
      scanned: 20,
      missing: ['/proj/Source/new.cpp'],
      added: [],
      skippedReason: 'no suitable project/plugin .cpp template found for any missing file',
    };
    const detail = formatFillResultDetail(result);
    expect(detail).toContain('skipped');
    expect(detail).toContain('no suitable');
    expect(detail).not.toContain('All source files now have complete clang flags');
  });

  it('skipped 结果：无模板场景', () => {
    const result: FillResult = {
      roots: ['/proj/Source'],
      scanned: 5,
      missing: ['/proj/Source/bar.cpp'],
      added: [],
      skippedReason: 'no suitable template',
    };
    const detail = formatFillResultDetail(result);
    expect(detail).toContain('skipped');
    expect(detail).toContain('no suitable template');
    expect(detail).not.toContain('All source files now have complete clang flags');
  });

  it('undefined 结果：回退文本', () => {
    const detail = formatFillResultDetail(undefined);
    expect(detail).toBe('compile_commands.json not found or empty, skipped');
    expect(detail).not.toContain('All source files now have complete clang flags');
  });
});
