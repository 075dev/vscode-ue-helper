/**
 * diagnostics/checks —— clangd 诊断的单项检查函数
 *
 * 每个函数返回一个 DiagnosticCheck，纯函数/异步纯函数，无副作用。
 * 从 diagnoseProject.ts 拆分。
 */

import * as path from 'node:path';
import {
  type DiagnosticCheck,
  type ParsedClangd,
  REQUIRED_SYSTEM_PREFIXES,
  REQUIRED_FORCED_INCLUDE_SUFFIXES,
} from './types';
import { stripQuotes, normalizePath, pathExists } from './io';

// ---- 状态计算 ----

export function computeOverallStatus(
  checks: readonly DiagnosticCheck[],
): 'ok' | 'warning' | 'error' {
  if (checks.some((check) => check.status === 'fail' && check.severity === 'error')) {
    return 'error';
  }
  if (checks.some((check) => check.status === 'fail' || check.status === 'warn')) {
    return 'warning';
  }
  return 'ok';
}

// ---- /FI 路径提取 ----

function extractForcedIncludePath(flag: string): string | undefined {
  const clean = stripQuotes(flag.trim());
  if (!clean.startsWith('/FI')) {
    return undefined;
  }
  const rawPath = clean.slice('/FI'.length).trim();
  return rawPath.length > 0 ? stripQuotes(rawPath) : undefined;
}

// ---- 单项检查 ----

export async function checkForcedIncludes(
  projectDir: string,
  clangdFile: string,
  addFlags: readonly string[],
): Promise<DiagnosticCheck> {
  const fiPaths = addFlags
    .map(extractForcedIncludePath)
    .filter((item): item is string => typeof item === 'string' && item.length > 0);
  const normalized = fiPaths.map(normalizePath);
  const missingNames = REQUIRED_FORCED_INCLUDE_SUFFIXES.filter(
    (suffix) => !normalized.some((item) => item.endsWith(suffix)),
  );
  const missingFiles: string[] = [];
  for (const fiPath of fiPaths) {
    const resolvedPath = path.isAbsolute(fiPath) ? fiPath : path.resolve(projectDir, fiPath);
    if (!(await pathExists(resolvedPath))) {
      missingFiles.push(fiPath);
    }
  }
  if (fiPaths.length === 0 || missingNames.length > 0 || missingFiles.length > 0) {
    return {
      name: 'forcedIncludes',
      status: 'fail',
      severity: 'error',
      message: 'forced include 配置不完整',
      detail: `缺少引用: ${missingNames.join(', ') || '(无)'}; 缺少文件: ${missingFiles.join(', ') || '(无)'}`,
      path: clangdFile,
    };
  }
  return {
    name: 'forcedIncludes',
    status: 'pass',
    severity: 'info',
    message: `forced include 文件存在 (${fiPaths.length} 个)`,
    detail: fiPaths.join(', '),
    path: clangdFile,
  };
}

export function checkSystemIncludeFlags(addFlags: readonly string[]): DiagnosticCheck {
  const missing = REQUIRED_SYSTEM_PREFIXES.filter(
    (prefix) => !addFlags.some((flag) => stripQuotes(flag).startsWith(prefix)),
  );
  if (missing.length > 0) {
    return {
      name: 'systemIncludeFlags',
      status: 'fail',
      severity: 'warning',
      message: '系统 include flags 缺失',
      detail: `缺少: ${missing.join(', ')}`,
    };
  }
  return {
    name: 'systemIncludeFlags',
    status: 'pass',
    severity: 'info',
    message: '系统 include flags 已配置 (/X + /imsvc)',
  };
}

export function checkDiagnostics(parsed: ParsedClangd): readonly DiagnosticCheck[] {
  return [
    parsed.missingIncludes === 'None'
      ? {
          name: 'missingIncludes',
          status: 'pass',
          severity: 'info',
          message: 'MissingIncludes 已设为 None',
        }
      : {
          name: 'missingIncludes',
          status: 'fail',
          severity: 'warning',
          message: `MissingIncludes 未设为 None (当前: ${parsed.missingIncludes ?? '未设置'})`,
        },
    parsed.unusedIncludes === 'None'
      ? {
          name: 'unusedIncludes',
          status: 'pass',
          severity: 'info',
          message: 'UnusedIncludes 已设为 None',
        }
      : {
          name: 'unusedIncludes',
          status: 'warn',
          severity: 'warning',
          message: `UnusedIncludes 未设为 None (当前: ${parsed.unusedIncludes ?? '未设置'})`,
        },
  ];
}

export function checkPreparsePlaceholders(addFlags: readonly string[]): DiagnosticCheck {
  const unresolved = addFlags.filter((flag) => flag.includes('$(EngineRoot)'));
  if (unresolved.length > 0) {
    return {
      name: 'preparsePlaceholders',
      status: 'fail',
      severity: 'error',
      message: 'preparse header 存在未解析 EngineRoot 占位符',
      detail: unresolved.join(', '),
    };
  }
  return {
    name: 'preparsePlaceholders',
    status: 'pass',
    severity: 'info',
    message: 'preparse headers 无未解析占位符',
  };
}
