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

  it('包含 stub struct 定义', () => {
    expect(content).toContain('struct UEClangdCompatStub');
  });

  it('包含 friend struct UEClangdCompatStub', () => {
    expect(content).toContain('friend struct UEClangdCompatStub');
  });

  it('包含 static UClass* StaticClass()', () => {
    expect(content).toContain('static UClass* StaticClass()');
  });

  it('StaticClass() 是带返回体的函数定义', () => {
    // 必须形如 static UClass* StaticClass() { return nullptr; }
    expect(content).toMatch(/static UClass\*\s+StaticClass\(\)\s*\{\s*return\s+nullptr;\s*\}/);
  });

  it('不含 BOM (\\uFEFF)', () => {
    expect(content.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('长度大于 50 字符', () => {
    expect(content.length).toBeGreaterThan(50);
  });

  /* ================================================================ */
  /*  Todo 8: compat 宏扩展验证                                          */
  /*  12 个外层反射宏 + WITH_EDITOR + CURRENT_FILE_ID + GENERATED_BODY    */
  /* ================================================================ */

  it('包含 WITH_EDITOR 1', () => {
    expect(content).toContain('#define WITH_EDITOR 1');
  });

  it('包含 WITH_EDITORONLY_DATA 1', () => {
    expect(content).toContain('#define WITH_EDITORONLY_DATA 1');
  });

  it('包含 12 个外层反射宏空展开', () => {
    const outerMacros = [
      'UCLASS',
      'USTRUCT',
      'UENUM',
      'UINTERFACE',
      'UPROPERTY',
      'UFUNCTION',
      'UMETA',
      'UPARAM',
      'GENERATED_UCLASS_BODY',
      'GENERATED_USTRUCT_BODY',
      'GENERATED_UINTERFACE_BODY',
      'GENERATED_IINTERFACE_BODY',
    ];
    for (const macro of outerMacros) {
      expect(content).toContain(`#define ${macro}(...)`);
    }
  });

  it('包含 GENERATED_BODY 空展开', () => {
    expect(content).toContain('#define GENERATED_BODY(...)');
  });

  it('包含 CURRENT_FILE_ID 0', () => {
    expect(content).toContain('#define CURRENT_FILE_ID 0');
  });

  it('外层反射宏使用 ifndef 守卫', () => {
    expect(content).toMatch(/#ifndef UCLASS[\s\S]+#endif/);
  });
});
