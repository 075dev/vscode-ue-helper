/**
 * ueCapabilities.test.ts —— UE 版本 × 能力矩阵单测
 *
 * [借鉴 unreal-engine-mcp 的 ue_status / 版本兼容表]
 */

import { describe, it, expect } from 'vitest';
import {
  parseUeVersion,
  compareUeVersion,
  buildUeCapabilityReport,
  summarizeUeCapabilities,
  MINIMUM_SUPPORTED_UE_TEXT,
} from '@core/ueCapabilities';

describe('parseUeVersion', () => {
  it('Given 两段式版本 When 解析 Then 得到 major/minor', () => {
    expect(parseUeVersion('5.3')).toEqual({ major: 5, minor: 3 });
  });

  it('Given 三段式版本 When 解析 Then 忽略 patch', () => {
    expect(parseUeVersion('5.3.2')).toEqual({ major: 5, minor: 3 });
  });

  it('Given 带 UE 前缀的版本 When 解析 Then 正确提取数字', () => {
    expect(parseUeVersion('UE5.4')).toEqual({ major: 5, minor: 4 });
    expect(parseUeVersion('UE_5_4')).toEqual({ major: 5, minor: 4 });
  });

  it('Given 只有主版本号 When 解析 Then minor 记为 0', () => {
    expect(parseUeVersion('5')).toEqual({ major: 5, minor: 0 });
  });

  it('Given 预发布后缀 When 解析 Then 取到首个数字段', () => {
    expect(parseUeVersion('5.4.0-rc1')).toEqual({ major: 5, minor: 4 });
  });

  it('Given null/空串/非数字 When 解析 Then 返回 null', () => {
    expect(parseUeVersion(null)).toBeNull();
    expect(parseUeVersion(undefined)).toBeNull();
    expect(parseUeVersion('')).toBeNull();
    expect(parseUeVersion('   ')).toBeNull();
    expect(parseUeVersion('unknown')).toBeNull();
  });
});

describe('compareUeVersion', () => {
  it('Given major 不同 When 比较 Then 按 major 优先', () => {
    expect(compareUeVersion({ major: 5, minor: 4 }, { major: 4, minor: 9 })).toBeGreaterThan(0);
    expect(compareUeVersion({ major: 4, minor: 9 }, { major: 5, minor: 4 })).toBeLessThan(0);
  });

  it('Given major 相同 When 比较 Then 按 minor', () => {
    expect(compareUeVersion({ major: 5, minor: 3 }, { major: 5, minor: 4 })).toBeLessThan(0);
    expect(compareUeVersion({ major: 5, minor: 4 }, { major: 5, minor: 4 })).toBe(0);
  });
});

describe('buildUeCapabilityReport', () => {
  it('Given UE 5.3 When 构建报告 Then 判定为受支持并给出推荐 clangd', () => {
    const report = buildUeCapabilityReport('5.3');
    expect(report.supported).toBe(true);
    expect(report.major).toBe(5);
    expect(report.minor).toBe(3);
    expect(report.recommendedClangd).toBe('16.0.6');
    expect(report.minimumSupported).toBe(MINIMUM_SUPPORTED_UE_TEXT);
  });

  it('Given UE 5.1 When 构建报告 Then 判定为低于最低支持版本', () => {
    const report = buildUeCapabilityReport('5.1');
    expect(report.supported).toBe(false);
    // 无可靠版本来源 → null(不是 undefined),与契约 UeCapabilityReport 一致
    expect(report.recommendedClangd).toBeNull();
  });

  it('Given UE 5.2 When 构建报告 Then 响应文件能力可用', () => {
    const report = buildUeCapabilityReport('5.2');
    const responseFile = report.capabilities.find((cap) => cap.id === 'responseFileCommands');
    expect(responseFile?.supported).toBe(true);
    expect(responseFile?.since).toBe('5.1');
  });

  it('Given UE 5.0 When 构建报告 Then 响应文件能力不可用', () => {
    const report = buildUeCapabilityReport('5.0');
    const responseFile = report.capabilities.find((cap) => cap.id === 'responseFileCommands');
    expect(responseFile?.supported).toBe(false);
  });

  it('Given 无可靠版本来源的 UE 5.5 When 构建报告 Then 不臆造 clangd 版本', () => {
    const report = buildUeCapabilityReport('5.5');
    expect(report.recommendedClangd).toBeNull();
    const toolchain = report.capabilities.find((cap) => cap.id === 'clangdToolchain');
    expect(toolchain?.detail).toContain('Epic');
  });

  it('Given 未知版本 When 构建报告 Then 所有能力标记为不可判定', () => {
    const report = buildUeCapabilityReport(null);
    expect(report.major).toBeNull();
    expect(report.minor).toBeNull();
    expect(report.supported).toBe(false);
    expect(report.recommendedClangd).toBeNull();
    expect(report.capabilities.every((cap) => cap.supported === false)).toBe(true);
    expect(report.capabilities[0]?.detail).toContain('未检测到 UE 版本');
  });

  it('Given 任意版本 When 构建报告 Then 能力集合恒定且 id 唯一', () => {
    const report = buildUeCapabilityReport('5.4');
    const ids = report.capabilities.map((cap) => cap.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('projectFilesCompileDb');
    expect(ids).toContain('uhtGeneratedHeaders');
    expect(ids).toContain('clangdToolchain');
  });
});

describe('summarizeUeCapabilities', () => {
  it('Given 已知版本 When 摘要 Then 含版本号与 clangd 建议', () => {
    const summary = summarizeUeCapabilities(buildUeCapabilityReport('5.3'));
    expect(summary).toContain('UE 5.3');
    expect(summary).toContain('16.0.6');
  });

  it('Given 低于最低版本 When 摘要 Then 提示最低支持版本', () => {
    const summary = summarizeUeCapabilities(buildUeCapabilityReport('5.1'));
    expect(summary).toContain(MINIMUM_SUPPORTED_UE_TEXT);
  });

  it('Given 未知版本 When 摘要 Then 说明无法判定', () => {
    const summary = summarizeUeCapabilities(buildUeCapabilityReport(null));
    expect(summary).toContain('未知');
  });
});
