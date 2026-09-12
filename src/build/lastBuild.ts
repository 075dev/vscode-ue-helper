/**
 * lastBuild —— 最近一次构建结果的进程内快照
 *
 * 模式借鉴 engine-link / UE Build Bridge 的 MCP `get_build_errors` 工具：
 * AI 代理闭环"触发构建 → 读取错误 → 修复代码"需要拿到结构化诊断。
 *
 * 本模块是唯一的"记录点"，写入口只有 build 命令层（src/commands/build.ts）。
 * MCP server 与扩展宿主同进程（见 src/mcp/server.ts），所以
 * `ue_get_build_errors` 直接读内存快照即可跨模块共享状态。
 */

import type { ParsedDiagnostic } from '@core/types/diagnostic';

/** 最近一次构建的快照 */
export interface LastBuildSnapshot {
  /** 构建模式 */
  mode: 'build' | 'rebuild' | 'clean';
  /** exitCode === 0 且未取消 */
  ok: boolean;
  /** 用户通过进度条取消 */
  cancelled: boolean;
  /** UBT 退出码；spawn 失败 / 异常中断时为 null */
  exitCode: number | null;
  /** 构建耗时（毫秒）；未跑完即失败时可能为 0 */
  durationMs: number;
  /** 快照写入时刻（ISO 8601） */
  finishedAtIso: string;
  /** MSVC/UBT/链接器诊断列表 */
  diagnostics: ParsedDiagnostic[];
  /** 构建未跑起来时的一句话错误（如 UBT 脚本不存在） */
  error?: string;
}

let _last: LastBuildSnapshot | null = null;

/** 记录/覆盖最近一次构建快照（build 命令层调用） */
export function rememberBuildSnapshot(snapshot: LastBuildSnapshot): void {
  _last = snapshot;
}

/** 读取最近一次构建快照；本会话从未构建过时返回 null */
export function getLastBuildSnapshot(): LastBuildSnapshot | null {
  return _last;
}

/** 测试 / 卸载时清空快照 */
export function resetLastBuildSnapshot(): void {
  _last = null;
}

/** 返回给 AI 代理的诊断条数上限 —— UE 全量构建可能产出上千条，截断保上下文 */
export const MAX_AGENT_DIAGNOSTICS = 100;

export interface BuildErrorsSummary {
  mode: LastBuildSnapshot['mode'];
  ok: boolean;
  cancelled: boolean;
  exitCode: number | null;
  durationMs: number;
  finishedAtIso: string;
  error?: string;
  totals: { errors: number; warnings: number; notes: number };
  /** 出错文件去重列表（方便 AI 定位重灾区） */
  filesWithErrors: string[];
  /** 截断后的诊断明细 */
  diagnostics: ParsedDiagnostic[];
  diagnosticsTruncated: boolean;
}

/**
 * 把快照整理成适合 AI 代理消费的紧凑摘要（纯函数）。
 *
 * - 统计 error/warning/note 计数
 * - errors 的文件去重列表
 * - 诊断明细截断到 MAX_AGENT_DIAGNOSTICS 条
 */
export function summarizeBuildErrorsForAgent(
  snapshot: LastBuildSnapshot,
): BuildErrorsSummary {
  const totals = { errors: 0, warnings: 0, notes: 0 };
  const filesWithErrors = new Set<string>();
  for (const d of snapshot.diagnostics) {
    if (d.severity === 'error') {
      totals.errors += 1;
      filesWithErrors.add(d.file);
    } else if (d.severity === 'warning') {
      totals.warnings += 1;
    } else {
      totals.notes += 1;
    }
  }
  const truncated = snapshot.diagnostics.length > MAX_AGENT_DIAGNOSTICS;
  const summary: BuildErrorsSummary = {
    mode: snapshot.mode,
    ok: snapshot.ok,
    cancelled: snapshot.cancelled,
    exitCode: snapshot.exitCode,
    durationMs: snapshot.durationMs,
    finishedAtIso: snapshot.finishedAtIso,
    totals,
    filesWithErrors: [...filesWithErrors],
    diagnostics: snapshot.diagnostics.slice(0, MAX_AGENT_DIAGNOSTICS),
    diagnosticsTruncated: truncated,
  };
  if (snapshot.error !== undefined) {
    summary.error = snapshot.error;
  }
  return summary;
}
