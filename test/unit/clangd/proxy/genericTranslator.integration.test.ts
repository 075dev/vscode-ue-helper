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

  it('反引号标识符：恢复后无 \\x00 残留且保留反引号原文', () => {
    const input = '`Foo` is not defined';
    const result = applyLocalizationToDiagnostic(input);
    // 原文前缀（append 模式）保留反引号原文
    expect(result.startsWith(input)).toBe(true);
    // 恢复后不得残留占位符控制字符（旧 bug 会把 \x00ID0\x00 压入 identifiers，
    // restoreIdentifiers 恢复时残留 \x00ID0\x00 占位符文本）
    expect(result).not.toContain('\x00');
    // 翻译括号内应恢复反引号标识符原文
    const bracket = result.match(/\[(.+)\]$/);
    expect(bracket?.[1]).toContain('`Foo`');
    expect(result).toMatch(/[\u4e00-\u9fff]/);
  });

  it('反引号 + 单引号混合输入：两者都正确恢复', () => {
    const input = "`Foo` is not a member of 'Bar'";
    const result = applyLocalizationToDiagnostic(input);
    expect(result.startsWith(input)).toBe(true);
    expect(result).not.toContain('\x00');
    // 反引号与单引号标识符都应恢复为原文
    const bracket = result.match(/\[(.+)\]$/);
    expect(bracket?.[1]).toContain('`Foo`');
    expect(bracket?.[1]).toContain("'Bar'");
    expect(result).toMatch(/[\u4e00-\u9fff]/);
  });

  it('off-by-one 回归：cannot 句式不输出"无法undefined",含真实捕获内容', () => {
    const result = applyLocalizationToDiagnostic(
      "Cannot specify '/FoE:/file.obj' when compiling multiple source files",
    );
    // 回归守卫：TEMPLATES translate 用 1-based 捕获组索引,必须取到真实内容。
    // 旧 bug（调用处传 match.slice(1)）会让 g[1] 取到第 2 个捕获组（undefined),
    // 翻译括号内输出恒为"无法undefined"。
    expect(result).not.toContain('undefined');
    const bracket = result.match(/\[(.+)\]$/);
    expect(bracket?.[1]).not.toContain('无法undefined');
    expect(bracket?.[1]).toContain('specify');
    expect(bracket?.[1]).toContain("'/FoE:/file.obj'");
  });

  it('off-by-one 回归：多捕获组句式（no X for Y）语序与标识符正确', () => {
    const result = applyLocalizationToDiagnostic(
      "no matching function for call to 'Foo'",
    );
    // 旧 bug：g[3]（第 4 个捕获组）为 undefined,输出"没有undefined的..."且丢失 'Foo'
    expect(result).not.toContain('undefined');
    const bracket = result.match(/\[(.+)\]$/);
    expect(bracket?.[1]).toContain("'Foo'");
    expect(bracket?.[1]).not.toMatch(/没有undefined/);
    expect(result).toMatch(/[\u4e00-\u9fff]/);
  });
});
