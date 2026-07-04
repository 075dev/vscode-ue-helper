/**
 * preparseIncludes 单元测试
 *
 * 覆盖: resolvePreparseHeaders, toIncludeFlags, loadBundledList
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  resolvePreparseHeaders,
  toIncludeFlags,
  getPrepareIncludesList,
  getPreparseStats,
} from '@clangd/preparseIncludes';
import type { PerfSession } from '@clangd/perfLog';

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

// ===== Phase 7: 性能埋点（D-13） =====

describe('getPrepareIncludesList (Phase 7 perfSession 注入)', () => {
  it('不传 perfSession 仍可正常工作（向后兼容）', async () => {
    // 不传第三个参数 → 不抛错，返回数组
    const result = await getPrepareIncludesList('fast', '/nonexistent/path');
    // 加载 bundled 列表（即使 projectPath 无效，base 列表仍存在）
    expect(Array.isArray(result)).toBe(true);
  });

  it('注入 mock perfSession 时 recordPreparseResult 被调用', async () => {
    let recorded: { mode: string; baseCount: number; userCount: number } | null = null;

    const mockSession: PerfSession = {
      record: () => {},
      recordPreparseResult: (mode, baseCount, userCount) => {
        recorded = { mode, baseCount, userCount };
      },
      recordIncrementalScan: () => {},
      getCompileCommandsLastMs: () => 0,
      getPreparseHitRate: () => ({ hits: 0, misses: 0, rate: 0 }),
      getLastIncrementalScanMs: () => 0,
      onMetricUpdate: () => ({ dispose: () => {} }),
      flushToDisk: async () => {},
    };

    await getPrepareIncludesList('fast', '/nonexistent/path', {
      perfSession: mockSession,
    });

    expect(recorded).not.toBeNull();
    // 非空断言：上面 expect.toBeNull 失败会终止测试，到这里 recorded 必非 null
    expect(recorded?.mode).toBe('fast');
    expect(recorded?.baseCount).toBeGreaterThan(0);
  });

  it('getPreparseStats 返回 perfLog 单例的命中率', () => {
    const stats = getPreparseStats();
    expect(stats).toHaveProperty('hit');
    expect(stats).toHaveProperty('miss');
    expect(stats).toHaveProperty('hitRate');
    expect(stats.hitRate).toBeGreaterThanOrEqual(0);
    expect(stats.hitRate).toBeLessThanOrEqual(1);
  });
});

describe('getPrepareIncludesList 集成 (tmpdir)', () => {
  it('空 projectPath 返回 bundled 列表', async () => {
    const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'preparse-test-'));
    try {
      const result = await getPrepareIncludesList('fast', tmpDir);
      expect(result.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
