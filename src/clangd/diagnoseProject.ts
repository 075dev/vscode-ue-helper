/**
 * diagnoseProject —— 纯只读 clangd 项目诊断（薄门面）
 *
 * 委托到 diagnostics/ 子模块。
 * 公共 API 保持向后兼容：diagnoseProject, formatDiagnosticReport, 所有类型。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkspaceState } from '@core/workspace';
import {
  type DiagnosticCheck,
  type ParsedClangd,
  EXPECTED_COMPILATION_DATABASE,
} from './diagnostics/types';
import { normalizePath, parseClangdYaml, resolveCompileCommandsPath, appendCompileCommandsJsonCheck } from './diagnostics/io';
import { computeOverallStatus, checkForcedIncludes, checkSystemIncludeFlags, checkDiagnostics, checkPreparsePlaceholders } from './diagnostics/checks';

// ---- 重新导出公共 API ----
export type { CheckStatus, CheckSeverity, ReportStatus, DiagnosticCheck, DiagnosticReport } from './diagnostics/types';
export { formatDiagnosticReport } from './diagnostics/format';

// ---- 主诊断函数 ----

export async function diagnoseProject(
  projectPath: string,
  workspace?: WorkspaceState,
): Promise<import('./diagnostics/types').DiagnosticReport> {
  const projectDir = path.dirname(projectPath);
  const clangdFile = workspace?.clangdConfigPath ?? path.join(projectDir, '.clangd');
  const checks: DiagnosticCheck[] = [];

  const clangdContent = await fs.readFile(clangdFile, 'utf-8').catch(() => undefined);
  if (clangdContent === undefined) {
    checks.push({ name: 'clangdConfig', status: 'fail', severity: 'error', message: '.clangd 文件不存在', path: clangdFile });
    return buildReport(projectPath, checks);
  }
  let parsed: ParsedClangd;
  try {
    parsed = parseClangdYaml(clangdContent);
    checks.push({ name: 'clangdConfig', status: 'pass', severity: 'info', message: '.clangd 文件存在且 YAML 可解析', path: clangdFile });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name: 'clangdConfig', status: 'fail', severity: 'error', message: `.clangd YAML 解析失败: ${message}`, path: clangdFile });
    const fallbackCompileCommands = resolveCompileCommandsPath(projectDir);
    await appendCompileCommandsJsonCheck(checks, fallbackCompileCommands);
    return buildReport(projectPath, checks);
  }

  if (parsed.compilationDatabase !== EXPECTED_COMPILATION_DATABASE) {
    checks.push({ name: 'compileCommands', status: 'fail', severity: 'error', message: 'CompilationDatabase 指向错误目录', detail: `当前: ${parsed.compilationDatabase ?? '(未设置)'}; 期望: ${EXPECTED_COMPILATION_DATABASE}`, path: clangdFile });
  } else {
    checks.push({ name: 'compileCommands', status: 'pass', severity: 'info', message: 'CompilationDatabase 指向 .vscode/vscodeuehelper', path: clangdFile });
  }

  const compileCommandsPath = resolveCompileCommandsPath(projectDir, parsed.compilationDatabase);
  const entries = await appendCompileCommandsJsonCheck(checks, compileCommandsPath);
  if (entries !== undefined) {
    const expectedHelper = normalizePath(path.join(projectDir, EXPECTED_COMPILATION_DATABASE, 'completionHelper.cpp'));
    const hasHelper = entries.some((entry) => (
      typeof entry.file === 'string' && normalizePath(entry.file) === expectedHelper
    ));
    checks.push(hasHelper
      ? { name: 'completionHelperEntry', status: 'pass', severity: 'info', message: 'compile_commands.json 包含 completionHelper.cpp 条目', path: compileCommandsPath }
      : { name: 'completionHelperEntry', status: 'fail', severity: 'warning', message: 'compile_commands.json 缺少 completionHelper.cpp 条目', path: compileCommandsPath });
  }

  checks.push(await checkForcedIncludes(projectDir, clangdFile, parsed.addFlags));
  checks.push(checkSystemIncludeFlags(parsed.addFlags));
  checks.push(...checkDiagnostics(parsed));
  checks.push(checkPreparsePlaceholders(parsed.addFlags));

  return buildReport(projectPath, checks);
}

function buildReport(projectPath: string, checks: DiagnosticCheck[]): import('./diagnostics/types').DiagnosticReport {
  return { timestamp: new Date().toISOString(), projectPath, overallStatus: computeOverallStatus(checks), checks: [...checks] };
}
