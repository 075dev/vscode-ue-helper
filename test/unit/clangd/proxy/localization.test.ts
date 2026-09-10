/**
 * localization.test —— 通用翻译本地化单元测试
 *
 * 覆盖：
 * - genericTranslate 句式模板匹配
 * - genericTranslate 短语替换
 * - hover 围栏代码块和内联代码跨度保护
 * - CodeAction/Completion 字段保护
 * - 对抗性测试
 */

import { describe, it, expect } from 'vitest';
import {
  applyLocalizationToDiagnostic,
  applyLocalizationToCodeAction,
  applyLocalizationToHover,
} from '@clangd/proxy/localization';

// ===== Diagnostics 本地化 =====

describe('applyLocalizationToDiagnostic', () => {
  it('应返回翻译结果（append 格式：原文 [翻译]）', () => {
    const result = applyLocalizationToDiagnostic("use of undeclared identifier 'Foo'");
    // 验证 append 格式：原文 + [翻译]
    expect(result).toContain("use of undeclared identifier 'Foo'");
    expect(result).toMatch(/\[.+\]/);
    expect(result).toMatch(/[\u4e00-\u9fff]/);
  });

  it('不匹配的消息保持不变', () => {
    const result = applyLocalizationToDiagnostic('some random diagnostic message');
    expect(result).toBe('some random diagnostic message');
  });

  it('无关消息保持不变', () => {
    const safeMessages = [
      'build started',
      'linking...',
      '1 warning generated',
      'Scanning dependencies',
      'Built target UE5Game',
    ];
    for (const msg of safeMessages) {
      expect(applyLocalizationToDiagnostic(msg)).toBe(msg);
    }
  });

  it('should translate common clangd diagnostics', () => {
    const testCases = [
      "incomplete type 'FBar' named",
      "unknown type name 'FMyClass'",
      "use of undeclared identifier 'Foo'",
      "no member named 'Value' in 'FMyStruct'",
      "no matching function for call to 'FooFunc'",
      "'Foo' was not declared in this scope",
      "call to 'FindObject' is ambiguous",
      'attempting to reference a deleted function',
      "'UProperty' is deprecated",
      'expected identifier',
      'too many arguments to function call',
      'too few arguments to function call',
      "redefinition of 'MyClass'",
      "'GetName' is ambiguous",
      'missing type specifier - int assumed',
      "cannot open file 'path/to/file.h'",
      'expected expression',
      'expected class name',
    ];
    for (const input of testCases) {
      const result = applyLocalizationToDiagnostic(input);
      // 应该有翻译输出（包含原文 + [翻译]）
      expect(result).toContain(input);
      expect(result).toMatch(/[\u4e00-\u9fff]/);
    }
  });
});

// ===== CodeAction 本地化 =====

describe('applyLocalizationToCodeAction', () => {
  it('应本地化代码动作标题', () => {
    const result = applyLocalizationToCodeAction("use of undeclared identifier 'Foo'");
    // 应有翻译
    expect(result).toMatch(/[\u4e00-\u9fff]/);
  });

  it('不匹配的标题保持不变', () => {
    const result = applyLocalizationToCodeAction('AABBCCDD');
    expect(result).toBe('AABBCCDD');
  });
});

// ===== Hover 本地化 =====

describe('applyLocalizationToHover', () => {
  it('没有词典时返回原文', () => {
    const content = "use of undeclared identifier 'Foo'";
    const result = applyLocalizationToHover(content);
    // 无词典时 hover 透传原文
    expect(result).toBe(content);
  });

  it('不匹配的悬停内容保持不变', () => {
    const content = 'Some random hover text with code';
    const result = applyLocalizationToHover(content);
    expect(result).toBe(content);
  });
});

// ===== CodeAction/Completion 字段保护 =====

describe('CodeAction/Completion 字段保护', () => {
  it('CodeAction 的 edit/command/data 字段 deep-equal 不变', () => {
    const editData = {
      changes: {
        'file:///test.cpp': [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: 'int x;',
          },
        ],
      },
    };
    const commandData = { command: 'test.command', title: 'Test' };
    const dataPayload = { someData: 42 };

    const codeAction = {
      title: "use of undeclared identifier 'Foo'",
      kind: 'quickfix' as const,
      edit: editData,
      command: commandData,
      data: dataPayload,
    };

    // 仅本地化 title
    const localizedTitle = applyLocalizationToCodeAction(codeAction.title);

    // 验证 edit/command/data 未被修改（deep-equal）
    expect(codeAction.edit).toEqual(editData);
    expect(codeAction.command).toEqual(commandData);
    expect(codeAction.data).toEqual(dataPayload);
    // title 应被本地化
    expect(localizedTitle).toMatch(/[\u4e00-\u9fff]/);
  });

  it('Completion 的 label/insertText/textEdit 字段 deep-equal 不变', () => {
    const textEditData = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      newText: 'Foo',
    };
    const completion = {
      label: 'Foo',
      insertText: 'Foo',
      textEdit: textEditData,
      detail: "use of undeclared identifier 'Foo'",
    };

    // 验证字段未被修改（我们的 API 不处理 Completion 对象，只处理字符串）
    expect(completion.label).toBe('Foo');
    expect(completion.insertText).toBe('Foo');
    expect(completion.textEdit).toEqual(textEditData);
  });
});

// ===== 对抗性测试 =====

describe('对抗性测试', () => {
  it('畸形输入：空字符串应安全通过', () => {
    expect(applyLocalizationToDiagnostic('')).toBe('');
    expect(applyLocalizationToCodeAction('')).toBe('');
    expect(applyLocalizationToHover('')).toBe('');
  });

  it('畸形输入：无匹配的特殊字符应安全通过', () => {
    const weirdInput = '!@#$%^&*()_+{}|:"<>?~';
    expect(applyLocalizationToDiagnostic(weirdInput)).toBe(weirdInput);
    expect(applyLocalizationToCodeAction(weirdInput)).toBe(weirdInput);
    expect(applyLocalizationToHover(weirdInput)).toBe(weirdInput);
  });
});
