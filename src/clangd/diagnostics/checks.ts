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
import { buildUeCapabilityReport } from '@core/ueCapabilities';

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

/**
 * UE 版本 + 能力矩阵检查
 *
 * [借鉴 unreal-engine-mcp 的 ue_status / 版本兼容表、boocs/unreal-clangd 的
 *  「不同 UE 版本要求不同 LLVM 版本」说明]
 *
 * 产出两项检查:
 * - `ueVersion`:引擎版本是否满足最低支持要求 + 推荐的 clangd 版本
 * - `ueCapabilities`:该版本下本插件依赖的能力可用情况
 *
 * 版本未知时返回 skip(不是 fail)—— 没检测到引擎不等于引擎版本不兼容。
 */
export function checkUeVersionAndCapabilities(
  engineVersion: string | null | undefined,
): readonly DiagnosticCheck[] {
  const report = buildUeCapabilityReport(engineVersion);

  if (report.major === null || report.minor === null) {
    return [
      {
        name: 'ueVersion',
        status: 'skip',
        severity: 'info',
        message: '未检测到 UE 引擎版本，跳过版本能力检查',
      },
      {
        name: 'ueCapabilities',
        status: 'skip',
        severity: 'info',
        message: 'UE 引擎版本未知，无法判定能力可用性',
      },
    ];
  }

  const versionText = `UE ${report.major}.${report.minor}`;
  const clangdText =
    report.recommendedClangd === null
      ? 'clangd 版本请查 Epic 官方 Hardware and Software Specifications 页面'
      : `建议 clangd ${report.recommendedClangd}`;

  const versionCheck: DiagnosticCheck = report.supported
    ? {
        name: 'ueVersion',
        status: 'pass',
        severity: 'info',
        message: `${versionText} 满足最低支持版本 ${report.minimumSupported}`,
        detail: clangdText,
      }
    : {
        name: 'ueVersion',
        status: 'fail',
        severity: 'warning',
        message: `${versionText} 低于本插件最低支持版本 ${report.minimumSupported}`,
        detail: clangdText,
      };

  const unsupported = report.capabilities.filter((cap) => !cap.supported);
  const capabilityCheck: DiagnosticCheck =
    unsupported.length === 0
      ? {
          name: 'ueCapabilities',
          status: 'pass',
          severity: 'info',
          message: `${versionText} 下 ${report.capabilities.length} 项依赖能力全部可用`,
        }
      : {
          name: 'ueCapabilities',
          status: 'warn',
          severity: 'warning',
          message: `${versionText} 下有 ${unsupported.length} 项依赖能力不可用`,
          detail: unsupported.map((cap) => `${cap.title} (自 UE ${cap.since} 起支持)`).join('; '),
        };

  return [versionCheck, capabilityCheck];
}
