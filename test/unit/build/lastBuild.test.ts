/**
 * lastBuild 测试 —— 最近构建快照存取与 AI 摘要
 *
 * 覆盖:
 *   - remember/get/reset 生命周期(模块级单例,注意用例间 reset)
 *   - summarizeBuildErrorsForAgent:severity 计数、文件去重、超限截断、error 字段
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  rememberBuildSnapshot,
  getLastBuildSnapshot,
  resetLastBuildSnapshot,
  summarizeBuildErrorsForAgent,
  MAX_AGENT_DIAGNOSTICS,
  type LastBuildSnapshot,
} from '@build/lastBuild';
import type { ParsedDiagnostic } from '@core/types/diagnostic';

function diag(severity: ParsedDiagnostic['severity'], file: string, line = 1): ParsedDiagnostic {
  return { file, line, severity, code: 'C0000', message: 'm', raw: 'raw' };
}

function snapshot(overrides: Partial<LastBuildSnapshot> = {}): LastBuildSnapshot {
  return {
    mode: 'build',
    ok: true,
    cancelled: false,
    exitCode: 0,
    durationMs: 1000,
    finishedAtIso: '2026-09-12T00:00:00.000Z',
    diagnostics: [],
    ...overrides,
  };
}

describe('lastBuild 快照存取', () => {
  beforeEach(() => {
    resetLastBuildSnapshot();
  });

  it('初始为 null(本会话没构建过)', () => {
    expect(getLastBuildSnapshot()).toBeNull();
  });

  it('remember 后可读取,再次 remember 覆盖', () => {
    rememberBuildSnapshot(snapshot({ exitCode: 1 }));
    expect(getLastBuildSnapshot()?.exitCode).toBe(1);

    rememberBuildSnapshot(snapshot({ exitCode: 0 }));
    expect(getLastBuildSnapshot()?.exitCode).toBe(0);
  });

  it('reset 清空', () => {
    rememberBuildSnapshot(snapshot());
    resetLastBuildSnapshot();
    expect(getLastBuildSnapshot()).toBeNull();
  });
});

describe('summarizeBuildErrorsForAgent', () => {
  beforeEach(() => {
    resetLastBuildSnapshot();
  });

  it('统计 error/warning/note 计数与出错文件去重', () => {
    const summary = summarizeBuildErrorsForAgent(
      snapshot({
        ok: false,
        exitCode: 2,
        diagnostics: [
          diag('error', 'A.cpp', 1),
          diag('error', 'A.cpp', 5),
          diag('error', 'B.cpp', 9),
          diag('warning', 'C.cpp', 3),
          diag('note', 'A.cpp', 6),
        ],
      }),
    );

    expect(summary.totals).toEqual({ errors: 3, warnings: 1, notes: 1 });
    expect(summary.filesWithErrors).toEqual(['A.cpp', 'B.cpp']);
    expect(summary.diagnostics).toHaveLength(5);
    expect(summary.diagnosticsTruncated).toBe(false);
    expect(summary.ok).toBe(false);
    expect(summary.exitCode).toBe(2);
  });

  it('诊断超过上限时截断并标记 truncated', () => {
    const many = Array.from({ length: MAX_AGENT_DIAGNOSTICS + 10 }, (_, i) =>
      diag('error', `F${i}.cpp`, i + 1),
    );
    const summary = summarizeBuildErrorsForAgent(snapshot({ diagnostics: many }));

    expect(summary.diagnostics).toHaveLength(MAX_AGENT_DIAGNOSTICS);
    expect(summary.diagnosticsTruncated).toBe(true);
    // filesWithErrors 基于全量统计,不受明细截断影响
    expect(summary.filesWithErrors.length).toBe(MAX_AGENT_DIAGNOSTICS + 10);
  });

  it('无 error 字段时摘要不含该键,有则透传', () => {
    expect('error' in summarizeBuildErrorsForAgent(snapshot())).toBe(false);

    const withError = summarizeBuildErrorsForAgent(snapshot({ error: 'UBT script not found' }));
    expect(withError.error).toBe('UBT script not found');
  });
});
