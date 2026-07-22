/**
 * ueMacroCompletions.test.ts —— UE 反射宏补全纯逻辑测试
 *
 * TDD: T5 只定义补全数据与上下文解析，不注册 VS Code provider。
 * 覆盖宏名、参数区、meta 子区、非宏位置、字符串/注释负例与畸形输入。
 */

import { describe, expect, it } from 'vitest';
import {
  getUeMacroCompletionContext,
  getUeMacroCompletionItems,
  type UeMacroCompletionContext,
} from '@clangd/ueMacroCompletions';

type CursorFixture = {
  readonly text: string;
  readonly offset: number;
};

function fixture(source: string): CursorFixture {
  const offset = source.indexOf('|');
  expect(offset).toBeGreaterThanOrEqual(0);
  return {
    text: source.replace('|', ''),
    offset,
  };
}

function contextFor(source: string): UeMacroCompletionContext {
  const cursor = fixture(source);
  return getUeMacroCompletionContext(cursor.text, cursor.offset);
}

function completionLabels(context: UeMacroCompletionContext): readonly string[] {
  return getUeMacroCompletionItems(context).map((item) => item.label);
}

describe('getUeMacroCompletionContext (T5: UE 反射宏上下文解析)', () => {
  it('Given 正在输入宏名 When 解析上下文 Then 识别 macroName 并返回宏名补全', () => {
    // Given
    const context = contextFor('class UMyActor { UFUN| };');

    // When
    const labels = completionLabels(context);

    // Then
    expect(context).toEqual({ kind: 'macroName', prefix: 'UFUN' });
    expect(labels).toEqual(expect.arrayContaining(['UFUNCTION']));
  });

  it('Given UFUNCTION 括号参数区 When 解析上下文 Then 返回 UFUNCTION 参数补全', () => {
    // Given
    const context = contextFor('UFUNCTION(BlueprintCallable, |)\nvoid DoWork();');

    // When
    const labels = completionLabels(context);

    // Then
    expect(context).toEqual({ kind: 'parameters', macro: 'UFUNCTION', prefix: '' });
    expect(labels).toEqual(
      expect.arrayContaining(['BlueprintCallable', 'BlueprintPure', 'Category', 'meta']),
    );
  });

  it('Given UPROPERTY 括号参数区 When 解析上下文 Then 返回属性常用参数补全', () => {
    // Given
    const context = contextFor('UPROPERTY(EditAnywhere, |)\nint32 Count;');

    // When
    const labels = completionLabels(context);

    // Then
    expect(context).toEqual({ kind: 'parameters', macro: 'UPROPERTY', prefix: '' });
    expect(labels).toEqual(
      expect.arrayContaining(['EditAnywhere', 'BlueprintReadWrite', 'Category', 'meta']),
    );
  });

  it('Given UFUNCTION meta 子区 When 解析上下文 Then 返回 meta 参数补全', () => {
    // Given
    const context = contextFor(
      'UFUNCTION(BlueprintCallable, meta=(WorldContext="WorldContextObject", |))\nvoid Spawn();',
    );

    // When
    const labels = completionLabels(context);

    // Then
    expect(context).toEqual({ kind: 'meta', macro: 'UFUNCTION', prefix: '' });
    expect(labels).toEqual(
      expect.arrayContaining(['AdvancedDisplay', 'AutoCreateRefTerm', 'BlueprintInternalUseOnly']),
    );
  });

  it('Given C++ 普通位置 When 解析上下文 Then 返回 empty 且无补全', () => {
    // Given
    const context = contextFor('void DoWork(|);');

    // When
    const labels = completionLabels(context);

    // Then
    expect(context).toEqual({ kind: 'empty' });
    expect(labels).toEqual([]);
  });

  it('Given 字符串和注释中的宏文本 When 解析上下文 Then 不触发补全', () => {
    const cases = [
      'const TCHAR* Text = TEXT("UFUNCTION(|)");',
      '// UPROPERTY(|)\nint32 Count;',
      '/* UCLASS(|) */\nclass UMyObject {};',
    ] as const;

    for (const source of cases) {
      // Given
      const context = contextFor(source);

      // When
      const labels = completionLabels(context);

      // Then
      expect(context).toEqual({ kind: 'empty' });
      expect(labels).toEqual([]);
    }
  });

  it('Given 畸形但仍在宏内的输入 When 解析上下文 Then 支持未闭合宏与嵌套括号', () => {
    // Given
    const metaContext = contextFor('UFUNCTION(BlueprintCallable, meta=(AdvancedDisplay=(A, B), |');
    const parameterContext = contextFor('UPROPERTY(EditAnywhere, Category=(Inventory|');

    // When
    const metaLabels = completionLabels(metaContext);
    const parameterLabels = completionLabels(parameterContext);

    // Then
    expect(metaContext).toEqual({ kind: 'meta', macro: 'UFUNCTION', prefix: '' });
    expect(metaLabels).toEqual(expect.arrayContaining(['ClampMin', 'DisplayName']));
    expect(parameterContext).toEqual({
      kind: 'parameters',
      macro: 'UPROPERTY',
      prefix: 'Inventory',
    });
    expect(parameterLabels).toEqual(
      expect.arrayContaining(['EditDefaultsOnly', 'VisibleAnywhere']),
    );
  });
});

describe('UE 反射宏补全数据覆盖', () => {
  it('Given T5 覆盖范围 When 查询各宏参数 Then 包含 UCLASS/USTRUCT/UENUM/UMETA 常用项', () => {
    const contexts = [
      {
        context: contextFor('UCLASS(|)\nclass UMyObject {};'),
        expected: ['Blueprintable', 'Config', 'meta'],
      },
      {
        context: contextFor('USTRUCT(|)\nstruct FMyData {};'),
        expected: ['BlueprintType', 'Atomic', 'meta'],
      },
      {
        context: contextFor('UENUM(|)\nenum class EState {};'),
        expected: ['BlueprintType', 'Flags', 'meta'],
      },
      { context: contextFor('UMETA(|)'), expected: ['DisplayName', 'Hidden', 'ToolTip'] },
    ];

    for (const item of contexts) {
      // Given / When
      const labels = completionLabels(item.context);

      // Then
      expect(labels).toEqual(expect.arrayContaining(item.expected));
    }
  });
});
