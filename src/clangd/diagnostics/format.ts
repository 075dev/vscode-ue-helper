/**
 * diagnostics/format —— 将诊断报告格式化为可读文本
 *
 * 从 diagnoseProject.ts 拆分。
 */

import type { DiagnosticReport, CheckStatus, ReportStatus } from './types';

const ICONS: Record<CheckStatus, string> = {
  pass: '[PASS]',
  fail: '[FAIL]',
  warn: '[WARN]',
  skip: '[SKIP]',
};

const LABELS: Record<ReportStatus, string> = {
  ok: '[PASS] 正常',
  warning: '[WARN] 警告',
  error: '[FAIL] 错误',
};

export function formatDiagnosticReport(report: DiagnosticReport): string {
  const lines = [
    '===========================================',
    '  VSCodeUEHelper - Clangd Project Diagnostic',
    '===========================================',
    '',
    `  Time:     ${report.timestamp}`,
    `  Project:  ${report.projectPath}`,
    `  Overall:  ${LABELS[report.overallStatus]}`,
    '',
    '-- Check Results --',
    '',
  ];
  for (const check of report.checks) {
    lines.push(`  ${ICONS[check.status]} [${check.name}] ${check.message}`);
    if (check.detail) {
      lines.push(`       |-- ${check.detail}`);
    }
    if (check.path) {
      lines.push(`       |-- Path: ${check.path}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
