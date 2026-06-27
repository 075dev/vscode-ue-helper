import { describe, it, expect } from 'vitest';
import { renderYaml, defaultClangdConfig, renderManagedBlock, upsertManagedBlock } from '@clangd/clangdConfig';

describe('renderYaml (low-level renderer)', () => {
  it('renders an empty config as empty string', () => {
    const yaml = renderYaml({});
    expect(yaml).toBe('');
  });

  it('renders CompileFlags.Add as a YAML list', () => {
    const yaml = renderYaml({
      CompileFlags: { Add: ['-std=c++20', '-Wno-foo'] },
    });
    expect(yaml).toContain('CompileFlags:');
    expect(yaml).toContain('  Add:');
    expect(yaml).toContain('    - -std=c++20');
    expect(yaml).toContain('    - -Wno-foo');
  });

  it('renders Diagnostics.Suppress', () => {
    const yaml = renderYaml({
      Diagnostics: { Suppress: ['unknown-warning-option', 'unused-includes'] },
    });
    expect(yaml).toContain('Diagnostics:');
    expect(yaml).toContain('  Suppress:');
    expect(yaml).toContain('    - unknown-warning-option');
  });

  it('renders CompilationDatabase inside CompileFlags (clangd 22.x requirement)', () => {
    const yaml = renderYaml({
      CompileFlags: { CompilationDatabase: '.vscode/vscodeuehelper' },
    });
    expect(yaml).toContain('  CompilationDatabase: .vscode/vscodeuehelper');
    // ⚠️ 关键：不能在根级别
    expect(yaml.split('\n')[0]).toBe('CompileFlags:');
  });
});

describe('defaultClangdConfig (极简模板)', () => {
  it('contains required fields', () => {
    const cfg = defaultClangdConfig();
    expect(cfg.CompileFlags?.CompilationDatabase).toBe('.vscode/vscodeuehelper');
    expect(cfg.Diagnostics?.Suppress).toContain('builtin_definition');
    expect(cfg.Diagnostics?.Suppress).toContain('unknown-warning-option');
    expect(cfg.Diagnostics?.UnusedIncludes).toBe('None');
    expect(cfg.Diagnostics?.MissingIncludes).toBe('None');
    expect(cfg.InlayHints?.Enabled).toBe('Yes');
    expect(cfg.Index?.Background).toBe('Build');
  });

  it('does NOT contain Preamble/Hover/Completion (clangd 22.x unsupported)', () => {
    const cfg = defaultClangdConfig() as Record<string, unknown>;
    expect(cfg.Preamble).toBeUndefined();
    expect(cfg.Hover).toBeUndefined();
    expect(cfg.Completion).toBeUndefined();
  });
});

describe('renderManagedBlock (带 begin/end 标记)', () => {
  it('contains both markers', () => {
    const block = renderManagedBlock();
    expect(block).toContain('# <<< vscodeuehelper-managed >>>');
    expect(block).toContain('# <<< end-vscodeuehelper-managed >>>');
  });

  it('contains default config content', () => {
    const block = renderManagedBlock();
    expect(block).toContain('CompilationDatabase: .vscode/vscodeuehelper');
    expect(block).toContain('Diagnostics:');
    expect(block).toContain('Index:');
  });
});

describe('upsertManagedBlock (managed block 管理)', () => {
  it('inserts block into empty file', () => {
    const result = upsertManagedBlock('');
    expect(result).toContain('# <<< vscodeuehelper-managed >>>');
    expect(result).toContain('# <<< end-vscodeuehelper-managed >>>');
  });

  it('replaces existing content without managed markers (避免重复键)', () => {
    const existing = '# 用户自定义注释（无 managed 标记）\nCompileFlags:\n  Add: ["my-flag"]';
    const result = upsertManagedBlock(existing);
    // 用户内容被 managed block 替换，而不是追加
    expect(result).not.toContain('# 用户自定义注释');
    expect(result).not.toContain('"my-flag"');
    expect(result).toContain('# <<< vscodeuehelper-managed >>>');
    expect(result).toContain('# <<< end-vscodeuehelper-managed >>>');
  });

  it('replaces existing managed block but preserves outer content', () => {
    const existing = [
      '# 用户顶部注释',
      '# <<< vscodeuehelper-managed >>>',
      'Diagnostics:',
      '  Suppress:',
      '    - old-one',
      '# <<< end-vscodeuehelper-managed >>>',
      '# 用户底部注释',
    ].join('\n');
    const result = upsertManagedBlock(existing);
    expect(result).toContain('# 用户顶部注释');
    expect(result).toContain('# 用户底部注释');
    // 旧内容应该被替换
    expect(result).not.toContain('- old-one');
    // 新内容应该出现
    expect(result).toContain('builtin_definition');
  });

  it('idempotent: upsert twice produces same result', () => {
    const first = upsertManagedBlock('');
    const second = upsertManagedBlock(first);
    expect(second).toBe(first);
  });
});

describe('YAML quoting', () => {
  it('quotes strings with YAML-sensitive characters', () => {
    const yaml = renderYaml({
      CompileFlags: { Add: ['-DFOO=bar:baz'] },
    });
    expect(yaml).toContain('"-DFOO=bar:baz"');
  });

  it('does not quote simple strings', () => {
    const yaml = renderYaml({
      CompileFlags: { Add: ['-std=c++20'] },
    });
    expect(yaml).toContain('    - -std=c++20');
    expect(yaml).not.toContain('"-std=c++20"');
  });
});
