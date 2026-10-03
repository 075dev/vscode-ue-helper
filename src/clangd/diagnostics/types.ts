/**
 * diagnostics/types —— clangd 诊断的共享类型与常量
 *
 * 从 diagnoseProject.ts 拆分，保持 <250 纯 LOC。
 * 包含: 检查结果/报告类型、状态枚举、内部类型、常量。
 */

// ---- 导出类型 ----

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export type CheckSeverity = 'error' | 'warning' | 'info';

export type ReportStatus = 'ok' | 'warning' | 'error';

export interface DiagnosticCheck {
  name: string;
  status: CheckStatus;
  severity: CheckSeverity;
  message: string;
  detail?: string;
  path?: string;
}

export interface DiagnosticReport {
  timestamp: string;
  projectPath: string;
  overallStatus: ReportStatus;
  checks: DiagnosticCheck[];
}

// ---- 内部类型 ----

export type CompileCommandsEntry = {
  readonly file?: string;
};

export type ParsedClangd = {
  readonly addFlags: readonly string[];
  readonly compilationDatabase?: string;
  readonly missingIncludes?: string;
  readonly unusedIncludes?: string;
};

// ---- 常量 ----

export const EXPECTED_COMPILATION_DATABASE = '.vscode/vscodeuehelper';
export const COMPILE_COMMANDS_FILE = 'compile_commands.json';
export const REQUIRED_SYSTEM_PREFIXES = ['/X', '/imsvc'] as const;
// Plan B: macroCompletionHelper.h 不再生成（被 addMacroCompletions.h 通过 preparse 直接包含替代），
//         因此不再作为必需文件出现在强制包含白名单中。
export const REQUIRED_FORCED_INCLUDE_SUFFIXES = ['ueclangdcompat.h'] as const;
