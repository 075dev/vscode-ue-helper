/**
 * 通用翻译器集成测试
 */
import { describe, it, expect } from 'vitest';
import {
  createDefaultLocalizationTable,
  applyLocalizationToDiagnostic,
} from '@clangd/proxy/localization';

describe('genericTranslator 集成测试', () => {
  const table = createDefaultLocalizationTable();

  it('通用翻译：cannot 句式', () => {
    const result = applyLocalizationToDiagnostic(
      "Cannot specify '/FoE:/file.obj' when compiling multiple source files",
      table,
    );
    expect(result).not.toBe("Cannot specify '/FoE:/file.obj' when compiling multiple source files");
    console.log('cannot句式结果:', result);
  });

  it('通用翻译：The last 句式（无模板匹配时走短语替换）', () => {
    const result = applyLocalizationToDiagnostic(
      "The last '/TP' or '/TC' option takes precedence over earlier instances",
      table,
    );
    // 精确规则 32 应该匹配这个
    expect(result).not.toBe("The last '/TP' or '/TC' option takes precedence over earlier instances");
    console.log('The last句式结果:', result);
  });

  it('通用翻译：Function defined in header', () => {
    const result = applyLocalizationToDiagnostic(
      "Function 'GetFrontendSoftWidgetClassByTag' defined in a header file; function definitions in header files can lead to ODR violations",
      table,
    );
    // 精确规则 31 应该匹配
    expect(result).not.toBe("Function 'GetFrontendSoftWidgetClassByTag' defined in a header file; function definitions in header files can lead to ODR violations");
    console.log('ODR结果:', result);
  });
});
