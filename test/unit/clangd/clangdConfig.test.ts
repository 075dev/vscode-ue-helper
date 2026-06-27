import { describe, it, expect } from 'vitest';
import { renderClangdConfig, defaultClangdConfig, replaceSystemIncludeBlock } from '@clangd/clangdConfig';

describe('renderClangdConfig (yaml 序列化)', () => {
  it('renders an empty config', () => {
    const yaml = renderClangdConfig({});
    expect(yaml.trim()).toBe('{}');
  });

  it('renders CompileFlags.Add as a YAML list', () => {
    const yaml = renderClangdConfig({
      CompileFlags: { Add: ['-std=c++20', '-Wno-foo'] },
    });
    expect(yaml).toContain('CompileFlags:');
    expect(yaml).toContain('  Add:');
    expect(yaml).toContain('    - -std=c++20');
    expect(yaml).toContain('    - -Wno-foo');
  });

  it('renders CompilationDatabase inside CompileFlags (clangd 22.x requirement)', () => {
    const yaml = renderClangdConfig({
      CompileFlags: { CompilationDatabase: '.vscode/vscodeuehelper' },
    });
    // 必须在 CompileFlags 内部缩进 2 空格，不在根级别
    expect(yaml).toContain('  CompilationDatabase: .vscode/vscodeuehelper');
    const lines = yaml.split('\n');
    const cfLine = lines.findIndex((l) => l.trim() === 'CompileFlags:');
    const cdLine = lines.findIndex((l) => l.trim().startsWith('CompilationDatabase:'));
    expect(cfLine).toBeLessThan(cdLine); // CompilationDatabase 在 CompileFlags 下面
  });
});

describe('defaultClangdConfig (模板风格)', () => {
  it('contains required fields', () => {
    const cfg = defaultClangdConfig();
    expect(cfg.CompileFlags?.CompilationDatabase).toBe('.vscode/vscodeuehelper');
    expect(cfg.Diagnostics?.UnusedIncludes).toBe('None');
    expect(cfg.InlayHints?.Enabled).toBe('Yes');
    expect(cfg.InlayHints?.ParameterNames).toBe('Yes');
    expect(cfg.InlayHints?.DeducedTypes).toBe('Yes');
    expect(cfg.InlayHints?.Designators).toBe('Yes');
  });

  it('uses /std:c++20 on Windows', () => {
    const cfg = defaultClangdConfig();
    const add = cfg.CompileFlags?.Add ?? [];
    if (process.platform === 'win32') {
      expect(add).toContain('/std:c++20');
    } else {
      expect(add).toContain('-std=c++20');
    }
  });

  it('includes MSVC compatibility flags', () => {
    const cfg = defaultClangdConfig();
    const add = cfg.CompileFlags?.Add ?? [];
    expect(add).toContain('/TP');
    expect(add).toContain('-mwaitpkg');
    expect(add).toContain('-Werror');
    expect(add).toContain('-Wshadow');
    expect(add).toContain('-Wundef');
  });

  it('includes systemIncludeFlags at the top', () => {
    const cfg = defaultClangdConfig({
      systemIncludeFlags: ['/X', '/imsvc"path"'],
    });
    const add = cfg.CompileFlags?.Add ?? [];
    expect(add[0]).toBe('/X');
    expect(add[1]).toBe('/imsvc"path"');
  });

  it('includes /FI macroHelperPath in slow mode', () => {
    const cfg = defaultClangdConfig({
      completionMode: 'slow',
      macroHelperPath: '/path/to/macroCompletionHelper.h',
    });
    const add = cfg.CompileFlags?.Add ?? [];
    expect(add).toContain('/FI/path/to/macroCompletionHelper.h');
  });

  it('does NOT include /FI macroHelperPath in fast mode', () => {
    const cfg = defaultClangdConfig({
      completionMode: 'fast',
      macroHelperPath: '/path/to/macroCompletionHelper.h',
    });
    const add = cfg.CompileFlags?.Add ?? [];
    expect(add).not.toContain('/FI/path/to/macroCompletionHelper.h');
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
    expect(matches).toContain('Source/.*\\.(cpp|h)');
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
});

describe('replaceSystemIncludeBlock (yaml 替换)', () => {
  it('replaces system include flags in Add', () => {
    const input = renderClangdConfig({
      CompileFlags: {
        Add: [
          '/X',
          '/imsvc"old/path"',
          '-fms-compatibility-version=19.0',
          '/std:c++20',
          '-Wno-foo',
        ],
      },
    });
    const newFlags = ['/X', '/imsvc"new/path"', '-fms-compatibility-version=19.1'];
    const result = replaceSystemIncludeBlock(input, newFlags);

    expect(result).toContain('/imsvc"new/path"');
    expect(result).toContain('-fms-compatibility-version=19.1');
    // 旧系统 flag 被替换
    expect(result).not.toContain('/imsvc"old/path"');
    expect(result).not.toContain('-fms-compatibility-version=19.0');
    // 非系统 flag 保留
    expect(result).toContain('-Wno-foo');
    // std flag 也是系统 flag，被替换
    expect(result).not.toContain('/std:c++20');
  });

  it('returns input unchanged for non-YAML text', () => {
    const result = replaceSystemIncludeBlock('not yaml', ['/X']);
    expect(result).toBe('not yaml');
  });
});

describe('YAML quoting', () => {
  it('handles strings with colons correctly', () => {
    const yaml = renderClangdConfig({
      CompileFlags: { Add: ['-DFOO=bar:baz'] },
    });
    // yaml 库自动处理冒号
    expect(yaml).toContain("-DFOO=bar:baz");
  });
});
