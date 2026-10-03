/**
 * flagGlossary.test —— verify DEFAULT_FLAG_GLOSSARY shape & resolveFlags
 */
import { describe, expect, it } from 'vitest';
import type { FlagEntry } from '@clangd/flagGlossary';
import {
  DEFAULT_FLAG_GLOSSARY,
  findFlagEntry,
  getGlossaryForWebview,
  resolveFlags,
} from '@clangd/flagGlossary';

describe('DEFAULT_FLAG_GLOSSARY', () => {
  it('contains the canonical 5 entry ids that UI exposes', () => {
    const ids = DEFAULT_FLAG_GLOSSARY.map((e) => e.id);
    expect(ids).toContain('compat-header');
    expect(ids).toContain('macro-helper');
    expect(ids).toContain('std-cxx20');
    expect(ids).toContain('preparse-headers');
    expect(ids).toContain('uht-include-dirs');
  });

  it('does NOT expose MSVC warning flags (baseline-managed)', () => {
    // 抽样：/X、/imsvc、/W4、-Werror 都必须不在 glossary 中
    const ids = DEFAULT_FLAG_GLOSSARY.map((e) => e.id);
    for (const badId of ['x-suppress-builtin', 'imsvc', 'w4', 'werror']) {
      expect(ids).not.toContain(badId);
    }
  });

  it('all entries have non-empty title and description (Chinese)', () => {
    for (const e of DEFAULT_FLAG_GLOSSARY) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
      // 简单 CJK 检测：包含常见汉字范围
      expect(/[一-鿿]/.test(e.title)).toBe(true);
    }
  });

  it('id is unique', () => {
    const ids = DEFAULT_FLAG_GLOSSARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('category is one of the 5 known values', () => {
    const knownCategories = new Set([
      'forced-include',
      'standard',
      'system-include',
      'preparse',
      'uht-include',
    ]);
    for (const e of DEFAULT_FLAG_GLOSSARY) {
      expect(knownCategories.has(e.category)).toBe(true);
    }
  });
});

describe('findFlagEntry', () => {
  it('returns the entry by id', () => {
    const e = findFlagEntry('compat-header');
    expect(e).toBeDefined();
    expect(e?.category).toBe('forced-include');
  });

  it('returns undefined for unknown id', () => {
    expect(findFlagEntry('nonexistent')).toBeUndefined();
  });
});

describe('resolveFlags', () => {
  describe('compat-header', () => {
    it('emits /FI<path> when compatHeaderPath provided', () => {
      const flags = resolveFlags(['compat-header'], {
        compatHeaderPath: 'D:/proj/ueClangdCompat.h',
      });
      expect(flags).toEqual(['/FID:/proj/ueClangdCompat.h']);
    });

    it('emits nothing when compatHeaderPath is missing', () => {
      const flags = resolveFlags(['compat-header'], {});
      expect(flags).toEqual([]);
    });
  });

  describe('macro-helper', () => {
    it('emits /FI<path> when macroHelperPath provided', () => {
      const flags = resolveFlags(['macro-helper'], {
        macroHelperPath: 'D:/proj/macro.h',
      });
      expect(flags).toEqual(['/FID:/proj/macro.h']);
    });
  });

  describe('std-cxx20', () => {
    it('emits platform-appropriate flag', () => {
      const flags = resolveFlags(['std-cxx20'], {});
      expect(flags.length).toBe(1);
      // 仅断言其一（平台相关）
      expect(['/std:c++20', '-std=c++20']).toContain(flags[0]);
    });
  });

  describe('preparse-headers', () => {
    it('emits per-header flags when preparseHeaders provided', () => {
      const headers = ['D:/pch1.h', 'D:/pch2.h'];
      const flags = resolveFlags(['preparse-headers'], { preparseHeaders: headers });
      // 不论平台，至少与 header 数相同
      expect(flags.length).toBeGreaterThanOrEqual(headers.length);
      // 至少包含路径引用
      const joined = flags.join(' ');
      expect(joined).toContain('pch1.h');
      expect(joined).toContain('pch2.h');
    });

    it('emits nothing when preparseHeaders empty', () => {
      const flags = resolveFlags(['preparse-headers'], { preparseHeaders: [] });
      expect(flags).toEqual([]);
    });
  });

  describe('uht-include-dirs', () => {
    it('emits /I<dir> per dir when intermediateUhtDirs provided', () => {
      const dirs = ['D:/a/UHT', 'D:/b/UHT'];
      const flags = resolveFlags(['uht-include-dirs'], { intermediateUhtDirs: dirs });
      expect(flags.length).toBe(dirs.length);
      for (const dir of dirs) {
        expect(flags.some((f) => f.endsWith(dir))).toBe(true);
      }
    });
  });

  describe('system-include-windows (dynamic id, no FlagEntry)', () => {
    it('passes through ctx.systemIncludeFlags', () => {
      const flags = resolveFlags(['system-include-windows'], {
        systemIncludeFlags: ['/X', '/imsvcD:/sdk/ucrt', '-fms-compatibility-version=19.30'],
      });
      expect(flags).toEqual(['/X', '/imsvcD:/sdk/ucrt', '-fms-compatibility-version=19.30']);
    });

    it('emits nothing when systemIncludeFlags missing', () => {
      const flags = resolveFlags(['system-include-windows'], {});
      expect(flags).toEqual([]);
    });
  });

  it('silently skips unknown ids', () => {
    const flags = resolveFlags(['nonexistent-id', 'compat-header'], {
      compatHeaderPath: 'D:/X.h',
    });
    expect(flags).toEqual(['/FID:/X.h']);
  });

  it('empty ids yields empty result', () => {
    expect(resolveFlags([], { compatHeaderPath: 'D:/X.h' })).toEqual([]);
  });

  it('combines multiple ids in order', () => {
    const flags = resolveFlags(['compat-header', 'std-cxx20', 'preparse-headers'], {
      compatHeaderPath: 'D:/X.h',
      preparseHeaders: ['D:/Y.h'],
    });
    expect(flags[0]).toBe('/FID:/X.h');
    // /std:c++20 or -std=c++20 depending on platform
    expect(['/std:c++20', '-std=c++20']).toContain(flags[1]);
    // preparse tail
    expect(flags.slice(2).join(' ')).toContain('D:/Y.h');
  });
});

describe('getGlossaryForWebview', () => {
  it('returns same shape as FlagEntry but stipped to wire fields', () => {
    const wire: readonly FlagEntry[] = DEFAULT_FLAG_GLOSSARY; // shape match
    const result = getGlossaryForWebview();
    expect(result.length).toBe(wire.length);
    for (let i = 0; i < result.length; i++) {
      const r = result[i]!;
      expect(typeof r.id).toBe('string');
      expect(typeof r.category).toBe('string');
      expect(typeof r.title).toBe('string');
      expect(typeof r.description).toBe('string');
      expect(typeof r.severity).toBe('string');
    }
  });
});
