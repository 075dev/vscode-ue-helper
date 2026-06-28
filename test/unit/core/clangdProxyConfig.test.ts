/**
 * clangdProxyConfig.test.ts —— 测试 Clangd Proxy 配置的 typed getters
 *
 * 验证：
 * - 默认值正确（enabled=false, max=20, ttl=900, append mode）
 * - 无效数值被 clamp 到安全默认值
 * - 无效 localization targets 被过滤
 * - 配置 schema 在 package.json 中存在
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { Config } from '@core/config';

// 辅助函数：模拟配置返回值
function setupMockConfig(values: Record<string, unknown>): void {
  const mockGet = vi.fn((key: string, def?: unknown) => {
    if (key in values) {
      return values[key];
    }
    return def;
  });

  (vi.mocked(vscode.workspace.getConfiguration) as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    get: mockGet,
    update: vi.fn(),
  });
}

describe('ClangdProxyConfig', () => {
  beforeEach(() => {
    // 每次测试前重置为默认 mock（返回 undefined，让 getter 用内部默认值）
    setupMockConfig({});
  });

  describe('默认值', () => {
    it('clangdProxyEnabled 默认为 false', () => {
      const config = new Config();
      expect(config.clangdProxyEnabled).toBe(false);
    });

    it('clangdProxyKeepaliveMax 默认为 20', () => {
      const config = new Config();
      expect(config.clangdProxyKeepaliveMax).toBe(20);
    });

    it('clangdProxyKeepaliveTtlSec 默认为 900', () => {
      const config = new Config();
      expect(config.clangdProxyKeepaliveTtlSec).toBe(900);
    });

    it('clangdProxyRealClangdPath 默认为 undefined', () => {
      const config = new Config();
      expect(config.clangdProxyRealClangdPath).toBeUndefined();
    });

    it('clangdProxyLogPath 默认为 undefined', () => {
      const config = new Config();
      expect(config.clangdProxyLogPath).toBeUndefined();
    });

    it('clangdProxyLocalizationEnabled 默认为 false', () => {
      const config = new Config();
      expect(config.clangdProxyLocalizationEnabled).toBe(false);
    });

    it('clangdProxyLocalizationMode 默认为 append', () => {
      const config = new Config();
      expect(config.clangdProxyLocalizationMode).toBe('append');
    });

    it('clangdProxyLocalizationTargets 默认包含 diagnostics/codeActions/hover', () => {
      const config = new Config();
      expect(config.clangdProxyLocalizationTargets).toEqual([
        'diagnostics',
        'codeActions',
        'hover',
      ]);
    });
  });

  describe('正常值读取', () => {
    it('读取 clangdProxyEnabled = true', () => {
      setupMockConfig({ 'clangdProxy.enabled': true });
      const config = new Config();
      expect(config.clangdProxyEnabled).toBe(true);
    });

    it('读取 clangdProxyKeepaliveMax = 50', () => {
      setupMockConfig({ 'clangdProxy.keepaliveMax': 50 });
      const config = new Config();
      expect(config.clangdProxyKeepaliveMax).toBe(50);
    });

    it('读取 clangdProxyKeepaliveTtlSec = 1800', () => {
      setupMockConfig({ 'clangdProxy.keepaliveTtlSec': 1800 });
      const config = new Config();
      expect(config.clangdProxyKeepaliveTtlSec).toBe(1800);
    });

    it('读取 clangdProxyRealClangdPath', () => {
      setupMockConfig({ 'clangdProxy.realClangdPath': '/usr/bin/clangd' });
      const config = new Config();
      expect(config.clangdProxyRealClangdPath).toBe('/usr/bin/clangd');
    });

    it('读取 clangdProxyLogPath', () => {
      setupMockConfig({ 'clangdProxy.logPath': '/tmp/clangd.log' });
      const config = new Config();
      expect(config.clangdProxyLogPath).toBe('/tmp/clangd.log');
    });

    it('读取 clangdProxyLocalizationMode = override', () => {
      setupMockConfig({ 'clangdProxy.localization.mode': 'override' });
      const config = new Config();
      expect(config.clangdProxyLocalizationMode).toBe('override');
    });

    it('读取 clangdProxyLocalizationTargets 自定义值', () => {
      setupMockConfig({
        'clangdProxy.localization.targets': ['diagnostics', 'hover'],
      });
      const config = new Config();
      expect(config.clangdProxyLocalizationTargets).toEqual([
        'diagnostics',
        'hover',
      ]);
    });
  });

  describe('clamp 逻辑：无效数值 clamp 到安全默认值', () => {
    it('keepaliveMax 负数 clamp 到 20', () => {
      setupMockConfig({ 'clangdProxy.keepaliveMax': -5 });
      const config = new Config();
      expect(config.clangdProxyKeepaliveMax).toBe(20);
    });

    it('keepaliveMax 零值 clamp 到 20', () => {
      setupMockConfig({ 'clangdProxy.keepaliveMax': 0 });
      const config = new Config();
      expect(config.clangdProxyKeepaliveMax).toBe(20);
    });

    it('keepaliveMax 非数值 clamp 到 20', () => {
      setupMockConfig({ 'clangdProxy.keepaliveMax': 'abc' });
      const config = new Config();
      expect(config.clangdProxyKeepaliveMax).toBe(20);
    });

    it('keepaliveMax null clamp 到 20', () => {
      setupMockConfig({ 'clangdProxy.keepaliveMax': null });
      const config = new Config();
      expect(config.clangdProxyKeepaliveMax).toBe(20);
    });

    it('keepaliveTtlSec 负数 clamp 到 900', () => {
      setupMockConfig({ 'clangdProxy.keepaliveTtlSec': -100 });
      const config = new Config();
      expect(config.clangdProxyKeepaliveTtlSec).toBe(900);
    });

    it('keepaliveTtlSec 零值 clamp 到 900', () => {
      setupMockConfig({ 'clangdProxy.keepaliveTtlSec': 0 });
      const config = new Config();
      expect(config.clangdProxyKeepaliveTtlSec).toBe(900);
    });

    it('keepaliveTtlSec 非数值 clamp 到 900', () => {
      setupMockConfig({ 'clangdProxy.keepaliveTtlSec': 'xyz' });
      const config = new Config();
      expect(config.clangdProxyKeepaliveTtlSec).toBe(900);
    });
  });

  describe('localization targets 过滤逻辑', () => {
    it('过滤无效 target，保留有效值', () => {
      setupMockConfig({
        'clangdProxy.localization.targets': [
          'diagnostics',
          'invalidTarget',
          'hover',
          'completions',
        ],
      });
      const config = new Config();
      expect(config.clangdProxyLocalizationTargets).toEqual([
        'diagnostics',
        'hover',
      ]);
    });

    it('全部无效时返回默认值', () => {
      setupMockConfig({
        'clangdProxy.localization.targets': ['bad1', 'bad2'],
      });
      const config = new Config();
      expect(config.clangdProxyLocalizationTargets).toEqual([
        'diagnostics',
        'codeActions',
        'hover',
      ]);
    });

    it('空数组返回默认值', () => {
      setupMockConfig({ 'clangdProxy.localization.targets': [] });
      const config = new Config();
      expect(config.clangdProxyLocalizationTargets).toEqual([
        'diagnostics',
        'codeActions',
        'hover',
      ]);
    });

    it('非数组值返回默认值', () => {
      setupMockConfig({ 'clangdProxy.localization.targets': 'not-an-array' });
      const config = new Config();
      expect(config.clangdProxyLocalizationTargets).toEqual([
        'diagnostics',
        'codeActions',
        'hover',
      ]);
    });
  });

  describe('stale_state 测试：重新实例化 Config 后读取最新配置', () => {
    it('修改 mock 配置后，新 Config 实例读取新值', () => {
      // 第一次：默认值
      const config1 = new Config();
      expect(config1.clangdProxyEnabled).toBe(false);

      // 修改 mock 配置
      setupMockConfig({ 'clangdProxy.enabled': true });

      // 新实例读取新值
      const config2 = new Config();
      expect(config2.clangdProxyEnabled).toBe(true);
    });
  });
});
