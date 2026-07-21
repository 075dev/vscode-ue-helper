import { describe, it, expect } from 'vitest';
import * as yaml from 'yaml';
// [Phase 9 SSoT] 测试内部直 import src/，绕开 @clangd/clangdConfig barrel（已脱锁）
// eslint-disable-next-line no-restricted-imports
import {
  renderClangdConfig,
  defaultClangdConfig,
} from '../../../src/clangd/clangdConfig';

describe('renderClangdConfig (yaml 序列化)', () => {
  it('renders an empty config', () => {
    const yamlText = renderClangdConfig({});
    expect(yamlText.trim()).toBe('{}');
  });

  it('renders CompileFlags.Add as a YAML list', () => {
    const yamlText = renderClangdConfig({
      CompileFlags: { Add: ['-std=c++20', '-Wno-foo'] },
    });
    expect(yamlText).toContain('CompileFlags:');
    expect(yamlText).toContain('  Add:');
    expect(yamlText).toContain('    - -std=c++20');
    expect(yamlText).toContain('    - -Wno-foo');
  });

  it('renders CompilationDatabase inside CompileFlags (clangd 22.x requirement)', () => {
    const yamlText = renderClangdConfig({
      CompileFlags: { CompilationDatabase: '.vscode/vscodeuehelper' },
    });
    // 必须在 CompileFlags 内部缩进 2 空格，不在根级别
    expect(yamlText).toContain('  CompilationDatabase: .vscode/vscodeuehelper');
    const lines = yamlText.split('\n');
    const cfLine = lines.findIndex((l) => l.trim() === 'CompileFlags:');
    const cdLine = lines.findIndex((l) => l.trim().startsWith('CompilationDatabase:'));
    expect(cfLine).toBeLessThan(cdLine); // CompilationDatabase 在 CompileFlags 下面
  });
});

describe('defaultClangdConfig (Plan Add 收束,零默认注入)', () => {
  it('【强化】默认 CompileFlags.Add 永远为空数组', () => {
    // Plan Add 收束强化版:用户明确要求"系统完全不让 add 默认注入"。
    // 包括 MSVC warning baseline 也被移除 —— defaultClangdConfig 一律输出空 Add。
    const cfg = defaultClangdConfig();
    expect(cfg.CompileFlags?.Add).toEqual([]);
  });

  it('【强化】空 options 时 Add 仍为 []', () => {
    expect(defaultClangdConfig({}).CompileFlags?.Add).toEqual([]);
  });

  it('【强化】传 projectPath 时 Add 仍为 []', () => {
    const cfg = defaultClangdConfig({ projectPath: '/p/proj.uproject' });
    expect(cfg.CompileFlags?.Add).toEqual([]);
  });

  it('【强化】传 compilerPath 时 Add 仍为 []', () => {
    const cfg = defaultClangdConfig({ compilerPath: 'D:/clang-cl.exe' });
    expect(cfg.CompileFlags?.Add).toEqual([]);
  });

  it('【强化】defaultClangdConfig 不存在 MSVC warning flag（-W/-Wno 等均不在 Add 中）', () => {
    const add = defaultClangdConfig().CompileFlags?.Add ?? [];
    const msvcRelated = add.filter(
      (f) => f.startsWith('-W') || f.startsWith('/W') || f.startsWith('/w'),
    );
    expect(msvcRelated).toEqual([]);
  });

  it('不再注入 compatHeaderPath（即使传入 opts）', () => {
    // 旧 API 不应继续注入 /FI<compat>。
    const cfg = defaultClangdConfig({
      compatHeaderPath: '/path/to/ueClangdCompat.h',
    } as Parameters<typeof defaultClangdConfig>[0]);
    const add = cfg.CompileFlags?.Add ?? [];
    expect(add.some((f) => f.includes('ueClangdCompat.h'))).toBe(false);
  });

  it('不再注入 macroHelperPath（即使传入 opts）', () => {
    const cfg = defaultClangdConfig({
      macroHelperPath: '/path/to/macroCompletionHelper.h',
    } as Parameters<typeof defaultClangdConfig>[0]);
    const add = cfg.CompileFlags?.Add ?? [];
    expect(add.some((f) => f.includes('macroCompletionHelper.h'))).toBe(false);
  });

  it('不再注入 systemIncludeFlags / /X（即使传入 opts）', () => {
    const cfg = defaultClangdConfig({
      systemIncludeFlags: ['/X', '/imsvc"path"'],
    } as Parameters<typeof defaultClangdConfig>[0]);
    const add = cfg.CompileFlags?.Add ?? [];
    expect(add).not.toContain('/X');
  });

  it('不再注入 preparseHeaders / -include', () => {
    const cfg = defaultClangdConfig({
      preparseHeaders: ['E:/UE/Core/Public/CoreSharedPCH.h'],
      engineRoot: 'E:/UE_5.8',
    } as Parameters<typeof defaultClangdConfig>[0]);
    const add = cfg.CompileFlags?.Add ?? [];
    const includeFlags = add.filter((f) => f.startsWith('-include') || f.startsWith('/FI'));
    // 仅 MSVC baseline 中不出现 -include / /FI
    expect(includeFlags).toEqual([]);
  });

  it('不再注入 intermediateUhtDirs', () => {
    const cfg = defaultClangdConfig({
      intermediateUhtDirs: ['/proj/Intermediate/Build/Win64/Editor/Inc/Foo/UHT'],
    } as Parameters<typeof defaultClangdConfig>[0]);
    const add = cfg.CompileFlags?.Add ?? [];
    const uhtFlags = add.filter((f) => f.includes('UHT'));
    expect(uhtFlags).toHaveLength(0);
  });
  it('不再注入 /std:c++20（用户通过 flagGlossary 显式控制）', () => {
    const cfg = defaultClangdConfig();
    const add = cfg.CompileFlags?.Add ?? [];
    expect(add.some((f) => f.includes('std:c++20'))).toBe(false);
  });
});

describe('defaultClangdConfig (必需字段)', () => {
  it('contains required fields', () => {
    const cfg = defaultClangdConfig();
    expect(cfg.CompileFlags?.CompilationDatabase).toBe('.vscode/vscodeuehelper');
    expect(cfg.Diagnostics?.UnusedIncludes).toBe('None');
    expect(cfg.Diagnostics?.MissingIncludes).toBe('None');
    expect(cfg.InlayHints?.Enabled).toBe('Yes');
    expect(cfg.InlayHints?.ParameterNames).toBe('Yes');
    expect(cfg.InlayHints?.DeducedTypes).toBe('Yes');
    expect(cfg.InlayHints?.Designators).toBe('Yes');
  });

  it('sets Compiler when compilerPath is provided', () => {
    const cfg = defaultClangdConfig({
      compilerPath: 'D:/scoop/apps/llvm/22.1.8/bin/clang-cl.exe',
    });
    expect(cfg.CompileFlags?.Compiler).toBe('D:/scoop/apps/llvm/22.1.8/bin/clang-cl.exe');
  });

  it('generates If.PathMatch when projectPath is provided', () => {
    const cfg = defaultClangdConfig({
      projectPath: '/path/to/MyProject.uproject',
    });
    expect(cfg.If).toBeDefined();
    expect(cfg.If?.PathMatch).toBeDefined();
    const matches = cfg.If?.PathMatch as string[];
    expect(matches).toContain('.vscode/vscodeuehelper/completionHelper.cpp');
    expect(matches).toContain('Source/.*\\.(cpp|h|hpp|c)');
    expect(matches).toContain('Plugins/.*/Source/.*\\.(cpp|h|hpp|c)');
  });

  it('omits If when projectPath is not provided', () => {
    const cfg = defaultClangdConfig();
    expect(cfg.If).toBeUndefined();
  });

  it('does NOT contain Preamble/Hover/Completion (clangd 22.x unsupported)', () => {
    const cfg = defaultClangdConfig() as Record<string, unknown>;
    expect(cfg.Preamble).toBeUndefined();
    expect(cfg.Hover).toBeUndefined();
    expect(cfg.Completion).toBeUndefined();
  });

  it('[Phase 7 D-12] defaultClangdConfig 输出含 Index.Background = Build', () => {
    const cfg = defaultClangdConfig();
    expect(cfg.Index).toBeDefined();
    expect(cfg.Index?.Background).toBe('Build');
  });

  it('[Phase 7] Index 字段必须放在根级别，不在 If 块内（per types.ts 第 33 行注释）', () => {
    const cfg = defaultClangdConfig({
      projectPath: '/path/to/MyProject.uproject',
    });
    expect(cfg.Index?.Background).toBe('Build');
    expect((cfg.If as Record<string, unknown> | undefined)?.Index).toBeUndefined();
  });
});

describe('YAML quoting', () => {
  it('handles strings with colons correctly', () => {
    const yamlText = renderClangdConfig({
      CompileFlags: { Add: ['-DFOO=bar:baz'] },
    });
    expect(yamlText).toContain('-DFOO=bar:baz');
  });
});

describe('renderClangdConfig + yaml.parse round-trip', () => {
  it('defaultClangdConfig 输出可被 yaml.parse 还原', () => {
    const cfg = defaultClangdConfig();
    const yamlText = renderClangdConfig(cfg);

    let parsed: unknown;
    expect(() => {
      parsed = yaml.parse(yamlText);
    }).not.toThrow();
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe('object');

    const doc = parsed as Record<string, unknown>;
    const cf = doc.CompileFlags as Record<string, unknown>;
    // 【强化】Add 永远是空数组
    expect(cf.Add).toEqual([]);
    const diag = doc.Diagnostics as Record<string, string>;
    expect(diag.MissingIncludes).toBe('None');
  });

  it('defaultClangdConfig 输出往返后 Add 严格为 []（无 baseline 残留）', () => {
    const cfg = defaultClangdConfig({ projectPath: '/p/proj.uproject' });
    const yamlText = renderClangdConfig(cfg);
    const parsed = yaml.parse(yamlText) as { CompileFlags: { Add: string[] } };
    expect(parsed.CompileFlags.Add).toEqual([]);
  });
});
