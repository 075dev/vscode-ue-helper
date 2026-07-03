/**
 * ueDocLookup.test.ts —— UE 文档词典查找单元测试
 */

import { describe, it, expect } from 'vitest';
import { UeDocLookup, type DocEntry } from '@clangd/proxy/ueDocLookup';

const SAMPLE_DICT: DocEntry[] = [
  {
    name: 'TObjectPtr',
    kind: 'type_alias',
    file: 'Runtime/CoreUObject/UObject/ObjectPtr.h',
    signature: 'template<typename T> using TObjectPtr = TObjectPtr<T>',
    doc: 'TObjectPtr is a type of pointer to a UObject that is meant to function as a drop-in replacement for raw pointer member properties.',
    translation: 'TObjectPtr 是一种指向 UObject 的指针类型，旨在作为原始指针成员属性的直接替代。',
  },
  {
    name: 'FString',
    kind: 'struct',
    file: 'Runtime/CoreUObject/UObject/String.h',
    signature: 'struct FString',
    doc: 'FString is a core string class in Unreal Engine.',
    translation: 'FString 是 Unreal Engine 中的核心字符串类。',
  },
  {
    name: 'UClass',
    kind: 'class',
    file: 'Runtime/CoreUObject/UObject/Class.h',
    signature: 'class UClass : public UObject',
    doc: 'UClass is the base class for all UObject classes.',
    translation: 'UClass 是所有 UObject 类的基类。',
  },
];

describe('UeDocLookup', () => {
  it('加载词典后应可查找', () => {
    const lookup = new UeDocLookup();
    lookup.loadFromData(SAMPLE_DICT);
    expect(lookup.isLoaded()).toBe(true);
    expect(lookup.size()).toBe(3);
  });

  it('未加载时应返回 null', () => {
    const lookup = new UeDocLookup();
    expect(lookup.lookup('TObjectPtr')).toBe(null);
  });

  it('应匹配类型名并返回翻译', () => {
    const lookup = new UeDocLookup();
    lookup.loadFromData(SAMPLE_DICT);

    const hover = 'struct TObjectPtr<USkeletalMeshComponent>\n\nTObjectPtr is a type of pointer...';
    const result = lookup.lookup(hover);
    expect(result).not.toBeNull();
    expect(result).toContain('TObjectPtr 是一种指向 UObject 的指针类型');
  });

  it('应保留声明行，替换文档部分', () => {
    const lookup = new UeDocLookup();
    lookup.loadFromData(SAMPLE_DICT);

    const hover = 'struct FString\n\nFString is a core string class in Unreal Engine.';
    const result = lookup.lookup(hover);
    expect(result).toContain('struct FString');
    expect(result).toContain('FString 是 Unreal Engine 中的核心字符串类。');
  });

  it('未匹配的名称应返回 null', () => {
    const lookup = new UeDocLookup();
    lookup.loadFromData(SAMPLE_DICT);

    const hover = 'class UWidget\n\nSome random widget class.';
    const result = lookup.lookup(hover);
    expect(result).toBeNull();
  });

  it('应处理 "provided by" 辅助信息行', () => {
    const lookup = new UeDocLookup();
    lookup.loadFromData(SAMPLE_DICT);

    const hover = 'class UClass : public UObject\nprovided by "UObject/Class.h"\n\nUClass is the base class for all UObject classes.';
    const result = lookup.lookup(hover);
    expect(result).not.toBeNull();
    expect(result).toContain('provided by');
    expect(result).toContain('UClass 是所有 UObject 类的基类。');
  });

  it('空词典应返回 0 条', () => {
    const lookup = new UeDocLookup();
    lookup.loadFromData([]);
    expect(lookup.size()).toBe(0);
    expect(lookup.lookup('anything')).toBeNull();
  });

  it('不含翻译的条目不应加入索引', () => {
    const dict: DocEntry[] = [
      {
        name: 'Untranslated',
        kind: 'class',
        file: 'Test.h',
        signature: 'class Untranslated',
        doc: 'Some doc',
        translation: '',
      },
    ];
    const lookup = new UeDocLookup();
    lookup.loadFromData(dict);
    expect(lookup.size()).toBe(0);
  });
});
