/**
 * ueClangdCompat.test.ts —— ueClangdCompat 模块单元测试
 *
 * TDD: 红测阶段，先写断言再实现。
 * 覆盖 FILENAME 常量、路径助手、内容生成器。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  FILENAME_UE_CLANGD_COMPAT,
  getUeClangdCompatDir,
  getUeClangdCompatPath,
  getUeClangdCompatContent,
} from '@clangd/ueClangdCompat';

describe('FILENAME_UE_CLANGD_COMPAT (文件名常量)', () => {
  it('返回正确的文件名', () => {
    expect(FILENAME_UE_CLANGD_COMPAT).toBe('ueClangdCompat.h');
  });
});

describe('getUeClangdCompatPath (路径助手)', () => {
  it('返回路径以 .vscode/vscodeuehelper/ueClangdCompat.h 结尾', () => {
    const projectPath = '/path/to/MyProject.uproject';
    const result = getUeClangdCompatPath(projectPath);
    const expectedSuffix = path.join('.vscode', 'vscodeuehelper', 'ueClangdCompat.h');
    expect(result.endsWith(expectedSuffix)).toBe(true);
  });

  it('getUeClangdCompatDir 返回目录路径', () => {
    const projectPath = '/path/to/MyProject.uproject';
    const dir = getUeClangdCompatDir(projectPath);
    const expectedSuffix = path.join('.vscode', 'vscodeuehelper');
    expect(dir.endsWith(expectedSuffix)).toBe(true);
  });
});

describe('getUeClangdCompatContent (内容生成器)', () => {
  const content = getUeClangdCompatContent();

  it('包含 BODY_MACRO_COMBINE_INNER 的 #undef 和 #define', () => {
    expect(content).toContain('#undef BODY_MACRO_COMBINE_INNER');
    expect(content).toContain('#define BODY_MACRO_COMBINE_INNER');
  });

  it('包含 BODY_MACRO_COMBINE 的 #undef 和 #define', () => {
    expect(content).toContain('#undef BODY_MACRO_COMBINE');
    expect(content).toContain('#define BODY_MACRO_COMBINE');
  });

  it('包含 UE_CLANGD_COMPAT_BODY 宏定义', () => {
    expect(content).toContain('UE_CLANGD_COMPAT_BODY');
  });

  it('包含 friend struct UEClangdCompatStub', () => {
    expect(content).toContain('friend struct UEClangdCompatStub');
  });

  it('包含 static UClass* StaticClass()', () => {
    expect(content).toContain('static UClass* StaticClass()');
  });

  it('不含 BOM (\\uFEFF)', () => {
    expect(content.charCodeAt(0)).not.toBe(0xFEFF);
  });

  it('长度大于 50 字符', () => {
    expect(content.length).toBeGreaterThan(50);
  });
});
