import { describe, it, expect } from 'vitest';
import { renderClangdConfig, defaultClangdConfig } from '@clangd/clangdConfig';

describe('renderClangdConfig', () => {
  it('renders a minimal config', () => {
    const yaml = renderClangdConfig({});
    expect(yaml).toBe('\n');
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

  it('renders Diagnostics.Suppress', () => {
    const yaml = renderClangdConfig({
      Diagnostics: { Suppress: ['unknown-warning-option', 'unused-includes'] },
    });
    expect(yaml).toContain('Diagnostics:');
    expect(yaml).toContain('  Suppress:');
    expect(yaml).toContain('    - unknown-warning-option');
  });

  it('quotes strings containing YAML-sensitive characters', () => {
    const yaml = renderClangdConfig({
      CompileFlags: { Add: ['-DFOO=bar:baz'] },
    });
    expect(yaml).toContain('"-DFOO=bar:baz"');
  });

  it('defaultClangdConfig is non-empty and suppresses MSVC warnings', () => {
    const cfg = defaultClangdConfig();
    const yaml = renderClangdConfig(cfg);
    expect(yaml).toContain('CompileFlags:');
    expect(yaml).toContain('Diagnostics:');
    expect(yaml).toContain('builtin-macro-redefinition');
  });
});
