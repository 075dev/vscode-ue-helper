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
  newBuildId,
  markBuildInProgress,
  clearBuildInProgress,
  getInProgressBuildId,
  MAX_AGENT_DIAGNOSTICS,
  type LastBuildSnapshot,
} from '@build/lastBuild';
import type { ParsedDiagnostic } from '@core/types/diagnostic';

function diag(severity: ParsedDiagnostic['severity'], file: string, line = 1): ParsedDiagnostic {
  return { file, line, severity, code: 'C0000', message: 'm', raw: 'raw' };
}

function snapshot(overrides: Partial<LastBuildSnapshot> = {}): LastBuildSnapshot {
  return {
    buildId: 'build-test-0001',
    startedAtIso: '2026-09-12T00:00:00.000Z',
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

// ============================================================
// [D8] buildId / startedAtIso / 进行中标记
// ============================================================

describe('lastBuild [D8] buildId 与进行中标记', () => {
  beforeEach(() => {
    resetLastBuildSnapshot();
  });

  it('newBuildId 每次调用都不同', () => {
    const a = newBuildId();
    const b = newBuildId();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('快照读写保留 buildId 与 startedAtIso', () => {
    rememberBuildSnapshot(
      snapshot({ buildId: 'b-1', startedAtIso: '2026-10-25T00:00:00.000Z' }),
    );
    const snap = getLastBuildSnapshot();
    expect(snap?.buildId).toBe('b-1');
    expect(snap?.startedAtIso).toBe('2026-10-25T00:00:00.000Z');
  });

  it('摘要透出 buildId 与 startedAtIso', () => {
    const summary = summarizeBuildErrorsForAgent(
      snapshot({ buildId: 'b-2', startedAtIso: '2026-10-25T01:00:00.000Z' }),
    );
    expect(summary.buildId).toBe('b-2');
    expect(summary.startedAtIso).toBe('2026-10-25T01:00:00.000Z');
  });

  it('markBuildInProgress / clearBuildInProgress 标记与清除', () => {
    expect(getInProgressBuildId()).toBeNull();
    markBuildInProgress('b-3');
    expect(getInProgressBuildId()).toBe('b-3');
    clearBuildInProgress('b-3');
    expect(getInProgressBuildId()).toBeNull();
  });

  it('clearBuildInProgress 只清自己的 id(旧构建收尾不抹掉新构建标记)', () => {
    markBuildInProgress('new');
    clearBuildInProgress('old');
    expect(getInProgressBuildId()).toBe('new');
  });

  it('reset 同时清掉进行中标记', () => {
    markBuildInProgress('b-4');
    resetLastBuildSnapshot();
    expect(getInProgressBuildId()).toBeNull();
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

  // [add-002] module 可选字段:与 error 同一"缺省不出现键"风格
  it('[add-002] 无 module 时摘要不含该键,有则透传', () => {
    expect('module' in summarizeBuildErrorsForAgent(snapshot())).toBe(false);

    const withModule = summarizeBuildErrorsForAgent(snapshot({ module: 'MyGame' }));
    expect(withModule.module).toBe('MyGame');
  });
});
