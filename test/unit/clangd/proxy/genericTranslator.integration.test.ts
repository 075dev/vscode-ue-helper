/**
 * 通用翻译器集成测试
 */
import { describe, it, expect } from 'vitest';
import { applyLocalizationToDiagnostic } from '@clangd/proxy/localization';

describe('genericTranslator 集成测试', () => {
  it('通用翻译：cannot 句式', () => {
    const result = applyLocalizationToDiagnostic(
      "Cannot specify '/FoE:/file.obj' when compiling multiple source files",
    );
    // 应有中文翻译
    expect(result).toMatch(/[\u4e00-\u9fff]/);
  });

  it('通用翻译：Function defined in header', () => {
    const result = applyLocalizationToDiagnostic(
      "Function 'GetFrontendSoftWidgetClassByTag' defined in a header file; function definitions in header files can lead to ODR violations",
    );
    // 应有中文翻译
    expect(result).toMatch(/[\u4e00-\u9fff]/);
  });
});
