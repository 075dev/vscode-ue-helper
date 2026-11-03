/**
 * ueVersionChecks.test.ts —— 诊断中的 UE 版本 × 能力矩阵检查单测
 *
 * [借鉴 unreal-engine-mcp 的 ue_status / 版本兼容表]
 */

import { describe, it, expect } from 'vitest';
import { checkUeVersionAndCapabilities } from '@clangd/diagnostics/checks';

describe('checkUeVersionAndCapabilities', () => {
  it('Given 受支持的 UE 版本 When 检查 Then 版本项 pass 且能力项 pass', () => {
    const checks = checkUeVersionAndCapabilities('5.4');
    const version = checks.find((c) => c.name === 'ueVersion');
    const capabilities = checks.find((c) => c.name === 'ueCapabilities');

    expect(version?.status).toBe('pass');
    expect(version?.message).toContain('5.4');
    expect(version?.detail).toContain('clangd 17');
    expect(capabilities?.status).toBe('pass');
    expect(capabilities?.message).toContain('全部可用');
  });

  it('Given 低于最低支持版本 When 检查 Then 版本项 fail 并给出最低版本号', () => {
    const checks = checkUeVersionAndCapabilities('5.1');
    const version = checks.find((c) => c.name === 'ueVersion');

    expect(version?.status).toBe('fail');
    expect(version?.severity).toBe('warning');
    expect(version?.message).toContain('5.2');
  });

  it('Given 低版本 When 检查 Then 能力项列出不可用能力', () => {
    const checks = checkUeVersionAndCapabilities('5.0');
    const capabilities = checks.find((c) => c.name === 'ueCapabilities');

    expect(capabilities?.status).toBe('warn');
    expect(capabilities?.detail).toContain('response');
  });

  it('Given 无版本来源 When 检查 Then 两项都是 skip 而非 fail', () => {
    const checks = checkUeVersionAndCapabilities(null);
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.status === 'skip')).toBe(true);
    expect(checks.every((c) => c.severity === 'info')).toBe(true);
  });

  it('Given 无法解析的版本串 When 检查 Then 同样按未知版本处理', () => {
    const checks = checkUeVersionAndCapabilities('unknown');
    expect(checks.every((c) => c.status === 'skip')).toBe(true);
  });

  it('Given UE 5.5 When 检查 Then 不臆造 clangd 版本', () => {
    const checks = checkUeVersionAndCapabilities('5.5');
    const version = checks.find((c) => c.name === 'ueVersion');
    expect(version?.detail).toContain('Epic');
  });
});
