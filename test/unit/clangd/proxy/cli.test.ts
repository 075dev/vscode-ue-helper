/**
 * cli.test.ts —— CLI 参数解析单元测试
 *
 * 测试策略：
 * - parseArgs 为纯函数，不依赖 I/O，覆盖所有参数组合
 * - 验证缺失 --real-clangd 时返回错误（而非调用 process.exit）
 * - 验证 -- 分隔符后参数完整保留
 * - 验证默认值
 */

import { describe, it, expect } from 'vitest';
import { parseArgs } from '@clangd/proxy/cli';

// ===========================================================================
// parseArgs —— 纯函数参数解析
// ===========================================================================

describe('parseArgs — CLI 参数解析', () => {
  // ─── 完整参数集 ───────────────────────────────────────────────

  it('解析完整参数集（含 -- 分隔符）', () => {
    const result = parseArgs([
      'node',
      'proxy.js',
      '--keepalive-max',
      '50',
      '--keepalive-ttl-sec',
      '300',
      '--real-clangd',
      '/usr/bin/clangd',
      '--log-path',
      '/tmp/proxy.log',
      '--localization-enabled',
      '--localization-mode',
      'zh-only',
      '--',
      '--background-index',
      '--header-insertion=never',
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.options.keepaliveMax).toBe(50);
    expect(result.options.keepaliveTtlSec).toBe(300);
    expect(result.options.realClangd).toBe('/usr/bin/clangd');
    expect(result.options.logPath).toBe('/tmp/proxy.log');
    expect(result.options.localizationEnabled).toBe(true);
    expect(result.options.localizationMode).toBe('zh-only');
    expect(result.options.realClangdArgs).toEqual([
      '--background-index',
      '--header-insertion=never',
    ]);
  });

  // ─── 缺失 --real-clangd ───────────────────────────────────────

  it('缺失 --real-clangd 返回错误信息', () => {
    const result = parseArgs(['node', 'proxy.js', '--', '--arg']);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('--real-clangd'))).toBe(true);
    // 不调用 process.exit，不写入 stderr —— 纯函数返回错误
  });

  it('缺失 --real-clangd 且无 -- 时也返回错误', () => {
    const result = parseArgs(['node', 'proxy.js']);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('--real-clangd'))).toBe(true);
  });

  // ─── 无 -- 分隔符 ─────────────────────────────────────────────

  it('无 -- 分隔符时 realClangdArgs 为空数组', () => {
    const result = parseArgs(['node', 'proxy.js', '--real-clangd', '/usr/bin/clangd']);

    expect(result.errors).toHaveLength(0);
    expect(result.options.realClangdArgs).toEqual([]);
  });

  // ─── 默认值 ───────────────────────────────────────────────────

  it('未指定代理参数时使用默认值', () => {
    const result = parseArgs(['node', 'proxy.js', '--real-clangd', '/usr/bin/clangd']);

    expect(result.options.keepaliveMax).toBe(20);
    expect(result.options.keepaliveTtlSec).toBe(900);
    expect(result.options.logPath).toBeUndefined();
    expect(result.options.localizationEnabled).toBe(false);
    expect(result.options.localizationMode).toBe('append');
  });

  // ─── 未知参数 ─────────────────────────────────────────────

  it('未知代理参数返回错误信息', () => {
    const result = parseArgs([
      'node',
      'proxy.js',
      '--unknown-arg',
      'value',
      '--real-clangd',
      '/usr/bin/clangd',
    ]);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('--unknown-arg'))).toBe(true);
    expect(result.options.realClangd).toBe('/usr/bin/clangd');
    expect(result.options.keepaliveMax).toBe(20); // 默认值
  });

  // ─── --real-clangd 作为最后一个参数 ───────────────────────────

  it('--real-clangd 是最后一个代理参数时正确解析', () => {
    const result = parseArgs([
      'node',
      'proxy.js',
      '--keepalive-max',
      '10',
      '--real-clangd',
      '/usr/bin/clangd',
      '--',
      '--compile-commands-dir=build',
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.options.realClangd).toBe('/usr/bin/clangd');
    expect(result.options.keepaliveMax).toBe(10);
    expect(result.options.realClangdArgs).toEqual(['--compile-commands-dir=build']);
  });

  // ─── 仅 -- 分隔符 ─────────────────────────────────────────────

  it('仅有 -- 分隔符且无 real clangd 参数时 realClangdArgs 为空', () => {
    const result = parseArgs(['node', 'proxy.js', '--real-clangd', '/usr/bin/clangd', '--']);

    expect(result.errors).toHaveLength(0);
    expect(result.options.realClangdArgs).toEqual([]);
  });

  // ─── --keepalive-max 非数字值 ─────────────────────────────────

  it('--keepalive-max 非数字值时使用默认值', () => {
    const result = parseArgs([
      'node',
      'proxy.js',
      '--keepalive-max',
      'not-a-number',
      '--real-clangd',
      '/usr/bin/clangd',
    ]);

    expect(result.options.keepaliveMax).toBe(20);
  });

  // ─── --keepalive-ttl-sec 非数字值 ─────────────────────────────

  it('--keepalive-ttl-sec 非数字值时使用默认值', () => {
    const result = parseArgs([
      'node',
      'proxy.js',
      '--keepalive-ttl-sec',
      'abc',
      '--real-clangd',
      '/usr/bin/clangd',
    ]);

    expect(result.options.keepaliveTtlSec).toBe(900);
  });

  // ─── --localization-mode 无效值 ───────────────────────────────

  it('--localization-mode 无效值时使用默认值', () => {
    const result = parseArgs([
      'node',
      'proxy.js',
      '--localization-mode',
      'invalid',
      '--real-clangd',
      '/usr/bin/clangd',
    ]);

    expect(result.options.localizationMode).toBe('append');
  });

  // ─── --localization-targets 空值 ──────────────────────────────

  it('--localization-targets 参数已移除（默认全开）', () => {
    const result = parseArgs(['node', 'proxy.js', '--real-clangd', '/usr/bin/clangd']);

    // --localization-targets 参数已删除，--localization-enabled 未传时默认禁用
    expect(result.options.localizationEnabled).toBe(false);
  });

  // ─── 本地化启用 ───────────────────────────────────────────

  it('--localization-enabled 启用本地化并指定模式与目标', () => {
    const result = parseArgs([
      'node',
      'proxy.js',
      '--real-clangd',
      '/usr/bin/clangd',
      '--localization-enabled',
      '--localization-mode',
      'append',
    ]);

    expect(result.options.localizationEnabled).toBe(true);
    expect(result.options.localizationMode).toBe('append');
  });

  // ─── 仅 --real-clangd 路径 ────────────────────────────────────

  it('最简参数：仅 --real-clangd', () => {
    const result = parseArgs(['node', 'proxy.js', '--real-clangd', 'clangd.exe']);

    expect(result.errors).toHaveLength(0);
    expect(result.options.realClangd).toBe('clangd.exe');
    expect(result.options.realClangdArgs).toEqual([]);
  });
});
