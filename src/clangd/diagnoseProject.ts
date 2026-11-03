/**
 * diagnoseProject —— 纯只读 clangd 项目诊断（薄门面）
 *
 * 委托到 diagnostics/ 子模块。
 * 公共 API 保持向后兼容：diagnoseProject, formatDiagnosticReport, 所有类型。
 *
 * [Phase 9 SSoT 收尾] .clangd 读取走 ClangdOps.readText()（统一 fs 入口；不再直 readFile）。
 * 诊断需要 raw text 给 parseClangdYaml 转成 ParsedClangd；ClangdOps.readText() 是为此设计的。
 */

import * as path from 'node:path';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from './clangdOps';
import {
  type DiagnosticCheck,
  type ParsedClangd,
  EXPECTED_COMPILATION_DATABASE,
} from './diagnostics/types';
import {
  normalizePath,
  parseClangdYaml,
  resolveCompileCommandsPath,
  appendCompileCommandsJsonCheck,
} from './diagnostics/io';
import {
  computeOverallStatus,
  checkForcedIncludes,
  checkSystemIncludeFlags,
  checkDiagnostics,
  checkPreparsePlaceholders,
  checkUeVersionAndCapabilities,
} from './diagnostics/checks';

// ---- 重新导出公共 API ----
export type {
  CheckStatus,
  CheckSeverity,
  ReportStatus,
  DiagnosticCheck,
  DiagnosticReport,
} from './diagnostics/types';
export { formatDiagnosticReport } from './diagnostics/format';

// ---- 主诊断函数 ----

export async function diagnoseProject(
  projectPath: string,
  workspace?: WorkspaceState,
  // [Phase 9 SSoT 收尾] 可选——production 由命令链注入；未注入时回落到 fs 直读（测试兼容）
  clangdOps?: ClangdOps,
): Promise<import('./diagnostics/types').DiagnosticReport> {
  const projectDir = path.dirname(projectPath);
  // [Phase 9 SSoT] .clangd 路径走 WorkspaceState.clangdConfigPath（单一真相源），不再 path.join 拼
  const clangdFile = workspace?.clangdConfigPath ?? path.join(projectDir, '.clangd');
  const checks: DiagnosticCheck[] = [];

  // [借鉴 unreal-engine-mcp 的 ue_status / 版本兼容表] UE 版本 × 能力矩阵检查。
  // 放在最前面：即使 .clangd 缺失导致提前返回，版本能力结论也要出现在报告里。
  checks.push(...checkUeVersionAndCapabilities(workspace?.engineVersion ?? null));

  // [Phase 9 SSoT 收尾] 优先 ClangdOps.readText()（单一 fs 入口）；未注入时回落到 fs 直读兼容老测试
  const clangdContent = clangdOps
    ? await clangdOps.readText(clangdFile)
    : await (async (): Promise<string | null> => {
        // [Test fallback] 未注入 ClangdOps 时 fs 直读
        const { readFile } = await import('node:fs/promises');
        try {
          return await readFile(clangdFile, 'utf-8');
        } catch {
          return null;
        }
      })();
  if (clangdContent === null) {
    checks.push({
      name: 'clangdConfig',
      status: 'fail',
      severity: 'error',
      message: '.clangd 文件不存在',
      path: clangdFile,
    });
    return buildReport(projectPath, checks);
  }
  let parsed: ParsedClangd;
  try {
    parsed = parseClangdYaml(clangdContent);
    checks.push({
      name: 'clangdConfig',
      status: 'pass',
      severity: 'info',
      message: '.clangd 文件存在且 YAML 可解析',
      path: clangdFile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      name: 'clangdConfig',
      status: 'fail',
      severity: 'error',
      message: `.clangd YAML 解析失败: ${message}`,
      path: clangdFile,
    });
    const fallbackCompileCommands = resolveCompileCommandsPath(projectDir);
    await appendCompileCommandsJsonCheck(checks, fallbackCompileCommands);
    return buildReport(projectPath, checks);
  }

  if (parsed.compilationDatabase !== EXPECTED_COMPILATION_DATABASE) {
    checks.push({
      name: 'compileCommands',
      status: 'fail',
      severity: 'error',
      message: 'CompilationDatabase 指向错误目录',
      detail: `当前: ${parsed.compilationDatabase ?? '(未设置)'}; 期望: ${EXPECTED_COMPILATION_DATABASE}`,
      path: clangdFile,
    });
  } else {
    checks.push({
      name: 'compileCommands',
      status: 'pass',
      severity: 'info',
      message: 'CompilationDatabase 指向 .vscode/vscodeuehelper',
      path: clangdFile,
    });
  }

  const compileCommandsPath = resolveCompileCommandsPath(projectDir, parsed.compilationDatabase);
  const entries = await appendCompileCommandsJsonCheck(checks, compileCommandsPath);
  if (entries !== undefined) {
    const expectedHelper = normalizePath(
      path.join(projectDir, EXPECTED_COMPILATION_DATABASE, 'completionHelper.cpp'),
    );
    const hasHelper = entries.some(
      (entry) => typeof entry.file === 'string' && normalizePath(entry.file) === expectedHelper,
    );
    checks.push(
      hasHelper
        ? {
            name: 'completionHelperEntry',
            status: 'pass',
            severity: 'info',
            message: 'compile_commands.json 包含 completionHelper.cpp 条目',
            path: compileCommandsPath,
          }
        : {
            name: 'completionHelperEntry',
            status: 'fail',
            severity: 'warning',
            message: 'compile_commands.json 缺少 completionHelper.cpp 条目',
            path: compileCommandsPath,
          },
    );
  }

  checks.push(await checkForcedIncludes(projectDir, clangdFile, parsed.addFlags));
  checks.push(checkSystemIncludeFlags(parsed.addFlags));
  checks.push(...checkDiagnostics(parsed));
  checks.push(checkPreparsePlaceholders(parsed.addFlags));

  return buildReport(projectPath, checks);
}

function buildReport(
  projectPath: string,
  checks: DiagnosticCheck[],
): import('./diagnostics/types').DiagnosticReport {
  return {
    timestamp: new Date().toISOString(),
    projectPath,
    overallStatus: computeOverallStatus(checks),
    checks: [...checks],
  };
}
