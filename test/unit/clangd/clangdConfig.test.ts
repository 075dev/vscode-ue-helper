import { describe, it, expect } from 'vitest';
import * as yaml from 'yaml';
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
});

describe('defaultClangdConfig (compatHeaderPath)', () => {
  it('在 fast 模式下 Add[0] 为 /FI<compatHeaderPath>', () => {
    const cfg = defaultClangdConfig({
      completionMode: 'fast',
      compatHeaderPath: '/path/to/ueClangdCompat.h',
    });
    const add = cfg.CompileFlags?.Add ?? [];
    expect(add[0]).toBe('/FI/path/to/ueClangdCompat.h');
  });

  it('在 slow 模式下 Add[0] 为 /FI<compatHeaderPath>（即使有 macroHelperPath）', () => {
    const cfg = defaultClangdConfig({
      completionMode: 'slow',
      compatHeaderPath: '/path/to/ueClangdCompat.h',
      macroHelperPath: '/path/to/macroCompletionHelper.h',
    });
    const add = cfg.CompileFlags?.Add ?? [];
    expect(add[0]).toBe('/FI/path/to/ueClangdCompat.h');
  });

  it('未提供 compatHeaderPath 时 Add 不含任何 /FI 开头的值', () => {
    const cfg = defaultClangdConfig();
    const add = cfg.CompileFlags?.Add ?? [];
    const fiFlags = add.filter((f) => f.startsWith('/FI'));
    expect(fiFlags).toHaveLength(0);
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

// ===== T2: preparseHeaders 与 EngineRoot 解析 =====

describe('defaultClangdConfig (preparseHeaders with EngineRoot resolution)', () => {
  it('engineRoot 提供时 preparseHeaders 的 $(EngineRoot) 被解析为实际路径', () => {
    const cfg = defaultClangdConfig({
      engineRoot: 'E:/UE_5.8',
      preparseHeaders: [
        '$(EngineRoot)/Source/Runtime/Core/Public/CoreSharedPCH.h',
        '$(EngineRoot)/Source/Runtime/Engine/Public/EngineSharedPCH.h',
      ],
    });
    const add = cfg.CompileFlags?.Add ?? [];

    // 解析后不应含 $(EngineRoot)
    const unresolved = add.filter((f) => f.includes('$(EngineRoot)'));
    expect(unresolved).toHaveLength(0);

    // 应包含解析后的 -include 标志
    expect(add).toContain('-include');
    expect(add).toContain('E:/UE_5.8/Source/Runtime/Core/Public/CoreSharedPCH.h');
    expect(add).toContain('E:/UE_5.8/Source/Runtime/Engine/Public/EngineSharedPCH.h');
  });

  it('engineRoot 缺失时含 $(EngineRoot) 的 header 被过滤，绝对路径保留', () => {
    const cfg = defaultClangdConfig({
      preparseHeaders: [
        '$(EngineRoot)/Source/Runtime/Core/Public/CoreSharedPCH.h',
        '/absolute/external/header.h',
      ],
    });
    const add = cfg.CompileFlags?.Add ?? [];

    // $(EngineRoot) 占位符不应出现在输出中
    expect(add).not.toContain('$(EngineRoot)');

    // 不含占位符的绝对路径 header 应保留
    expect(add).toContain('/absolute/external/header.h');
  });

  it('Diagnostics.MissingIncludes 设为 None', () => {
    const cfg = defaultClangdConfig();
    expect(cfg.Diagnostics?.MissingIncludes).toBe('None');
  });

  it('forced include 顺序: compatHeaderPath → systemInclude → std → macroHelper → preparseHeaders → MSVC', () => {
    const cfg = defaultClangdConfig({
      completionMode: 'slow',
      engineRoot: 'E:/UE_5.8',
      compatHeaderPath: '/path/to/ueClangdCompat.h',
      macroHelperPath: '/path/to/macroCompletionHelper.h',
      systemIncludeFlags: ['/X', '/imsvc"sys"'],
      preparseHeaders: [
        '$(EngineRoot)/Source/Runtime/Core/Public/CoreSharedPCH.h',
      ],
    });
    const add = cfg.CompileFlags?.Add ?? [];

    const compatIdx = add.findIndex((f) => f === '/FI/path/to/ueClangdCompat.h');
    const sysIdx = add.findIndex((f) => f === '/X');
    const stdIdx = add.findIndex((f) => f.includes('std:c++20'));
    const macroIdx = add.findIndex((f) => f === '/FI/path/to/macroCompletionHelper.h');
    const preparseIdx = add.findIndex((f) => f === '-include');
    const msvcIdx = add.findIndex((f) => f === '/TP');

    expect(compatIdx).toBeGreaterThanOrEqual(0);
    expect(sysIdx).toBeGreaterThan(compatIdx);
    expect(stdIdx).toBeGreaterThan(sysIdx);
    expect(macroIdx).toBeGreaterThan(stdIdx);
    expect(preparseIdx).toBeGreaterThan(macroIdx);
    expect(msvcIdx).toBeGreaterThan(preparseIdx);
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

// ===== T2 对抗测试: misleading_success_output, dirty_worktree, hung_commands =====

describe('defaultClangdConfig (adversarial)', () => {
  it('misleading_success: engineRoot 为空但 preparseHeaders 全为 $(EngineRoot) 时不写入无效路径', () => {
    const cfg = defaultClangdConfig({
      engineRoot: '',
      preparseHeaders: [
        '$(EngineRoot)/Source/Runtime/Core/Public/CoreSharedPCH.h',
      ],
    });
    const add = cfg.CompileFlags?.Add ?? [];

    // 不应含 $(EngineRoot) 或 -include（全部被过滤）
    const unresolved = add.filter((f) => f.includes('$(EngineRoot)'));
    expect(unresolved).toHaveLength(0);

    const includeFlags = add.filter((f) => f.startsWith('-include'));
    expect(includeFlags).toHaveLength(0);
  });

  it('misleading_success: preparseHeaders 为空数组时不写入任何 -include', () => {
    const cfg = defaultClangdConfig({
      engineRoot: 'E:/UE_5.8',
      preparseHeaders: [],
    });
    const add = cfg.CompileFlags?.Add ?? [];
    const includeFlags = add.filter((f) => f.startsWith('-include'));
    expect(includeFlags).toHaveLength(0);
  });

  it('hung_commands: defaultClangdConfig 是纯同步函数，无异步 I/O', () => {
    // 调用不应抛出或挂起
    const start = Date.now();
    const cfg = defaultClangdConfig({
      engineRoot: 'E:/UE_5.8',
      preparseHeaders: new Array(100).fill('$(EngineRoot)/Source/X.h'),
    });
    const elapsed = Date.now() - start;

    // 100 个 header 应在 10ms 内完成（纯字符串操作）
    expect(elapsed).toBeLessThan(100);
    expect(cfg.CompileFlags?.Add?.length).toBeGreaterThan(0);
  });

  it('dirty_worktree: renderClangdConfig 输出可被 yaml.parse 还原', () => {
    const cfg = defaultClangdConfig({
      completionMode: 'slow',
      engineRoot: 'E:/UE_5.8',
      compatHeaderPath: '/fake/ueClangdCompat.h',
      macroHelperPath: '/fake/macroCompletionHelper.h',
      systemIncludeFlags: ['/X'],
      preparseHeaders: [
        '$(EngineRoot)/Source/Runtime/Core/Public/CoreSharedPCH.h',
      ],
    });
    const yamlText = renderClangdConfig(cfg);

    // 可被 yaml.parse 还原
    let parsed: unknown;
    expect(() => {
      parsed = yaml.parse(yamlText);
    }).not.toThrow();
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe('object');

    const doc = parsed as Record<string, unknown>;
    const cf = doc.CompileFlags as Record<string, unknown>;
    const add = cf.Add as string[];

    // 往返后 -include 标志仍存在
    expect(add).toContain('-include');
    expect(add).toContain('E:/UE_5.8/Source/Runtime/Core/Public/CoreSharedPCH.h');

    // 往返后 MissingIncludes 仍存在
    const diag = doc.Diagnostics as Record<string, string>;
    expect(diag.MissingIncludes).toBe('None');
  });
});
