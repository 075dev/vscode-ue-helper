/**
 * preparseIncludes 单元测试
 *
 * 覆盖: resolvePreparseHeaders, toIncludeFlags, loadBundledList
 */

import { describe, it, expect } from 'vitest';
import { resolvePreparseHeaders, toIncludeFlags } from '@clangd/preparseIncludes';

describe('resolvePreparseHeaders', () => {
  it('将 $(EngineRoot) 占位符替换为实际 engineRoot 路径', () => {
    const headers = [
      '$(EngineRoot)/Source/Runtime/Core/Public/CoreSharedPCH.h',
      '$(EngineRoot)/Source/Runtime/Engine/Public/EngineSharedPCH.h',
    ];
    const result = resolvePreparseHeaders(headers, 'E:/UE_5.8');

    expect(result).toHaveLength(2);
    expect(result[0]).toBe('E:/UE_5.8/Source/Runtime/Core/Public/CoreSharedPCH.h');
    expect(result[1]).toBe('E:/UE_5.8/Source/Runtime/Engine/Public/EngineSharedPCH.h');
  });

  it('处理 engineRoot 带反斜杠的路径（Windows 风格）', () => {
    const headers = [
      '$(EngineRoot)/Source/Runtime/Core/Public/CoreSharedPCH.h',
    ];
    const result = resolvePreparseHeaders(headers, 'E:\\UE_5.8');

    expect(result).toHaveLength(1);
    expect(result[0]).toBe('E:/UE_5.8/Source/Runtime/Core/Public/CoreSharedPCH.h');
  });

  it('空 headers 数组返回空数组', () => {
    const result = resolvePreparseHeaders([], 'E:/UE_5.8');
    expect(result).toEqual([]);
  });

  it('engineRoot 为空字符串时过滤所有含占位符的 header', () => {
    const headers = [
      '$(EngineRoot)/Source/Runtime/Core/Public/CoreSharedPCH.h',
      '/absolute/path/to/something.h',
    ];
    const result = resolvePreparseHeaders(headers, '');

    // 含 $(EngineRoot) 的过滤掉，不含的保留
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('/absolute/path/to/something.h');
  });

  it('engineRoot 为 undefined 时行为同空字符串', () => {
    const headers = [
      '$(EngineRoot)/Source/Runtime/Core/Public/CoreSharedPCH.h',
    ];
    const result = resolvePreparseHeaders(headers, undefined as unknown as string);

    expect(result).toHaveLength(0);
  });

  it('header 中出现多次 $(EngineRoot) 全部替换', () => {
    const headers = [
      '$(EngineRoot)/Plugins/$(EngineRoot)_Compat/SomeHeader.h',
    ];
    const result = resolvePreparseHeaders(headers, 'E:/UE_5.8');

    expect(result).toHaveLength(1);
    expect(result[0]).toBe('E:/UE_5.8/Plugins/E:/UE_5.8_Compat/SomeHeader.h');
  });
});

describe('toIncludeFlags', () => {
  it('将 header 列表转换为 -include 标志对', () => {
    const headers = ['/path/to/a.h', '/path/to/b.h'];
    const flags = toIncludeFlags(headers);

    expect(flags).toEqual([
      '-include', '/path/to/a.h',
      '-include', '/path/to/b.h',
    ]);
  });

  it('空列表返回空数组', () => {
    expect(toIncludeFlags([])).toEqual([]);
  });
});

// ===== 对抗测试: malformed input, edge cases =====

describe('resolvePreparseHeaders (adversarial)', () => {
  it('engineRoot 含尾部斜杠时正常解析', () => {
    const headers = ['$(EngineRoot)/Source/CoreSharedPCH.h'];
    const result = resolvePreparseHeaders(headers, 'E:/UE_5.8/');

    expect(result[0]).toBe('E:/UE_5.8//Source/CoreSharedPCH.h');
    // 双斜杠 clangd 也能处理，但保留原始行为
  });

  it('engineRoot 含空格时不崩溃', () => {
    const headers = ['$(EngineRoot)/Source/Core.h'];
    const result = resolvePreparseHeaders(headers, 'C:/Program Files/UE_5.8');

    expect(result[0]).toBe('C:/Program Files/UE_5.8/Source/Core.h');
    // 含空格的路径 clangd 可能需要引号包裹，此处只验证不崩溃
  });

  it('header 为空字符串时保留空字符串', () => {
    const headers = [''];
    const result = resolvePreparseHeaders(headers, 'E:/UE_5.8');

    // 空字符串不含 $(EngineRoot)，会原样保留
    expect(result).toEqual(['']);
  });

  it('所有 header 都含 $(EngineRoot) 且 engineRoot 缺失时返回空', () => {
    const headers = [
      '$(EngineRoot)/Source/a.h',
      '$(EngineRoot)/Source/b.h',
    ];
    const result = resolvePreparseHeaders(headers, '');

    expect(result).toEqual([]);
  });

  it('混合有效和无效 header 时只保留有效项', () => {
    const headers = [
      '$(EngineRoot)/Source/a.h',           // 需要 engineRoot
      '/system/global.h',                    // 绝对路径，不含占位符
      '$(EngineRoot)/Plugins/b.h',           // 需要 engineRoot
    ];
    const result = resolvePreparseHeaders(headers, '');

    expect(result).toEqual(['/system/global.h']);
  });

  it('engineRoot 含反斜杠混合时统一为正斜杠', () => {
    const headers = ['$(EngineRoot)/Source/a.h'];
    const result = resolvePreparseHeaders(headers, 'E:\\UE_5.8\\Engine');

    expect(result[0]).toBe('E:/UE_5.8/Engine/Source/a.h');
  });
});
