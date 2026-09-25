/**
 * tools.envelope.test.ts —— MCP 工具面「响应形状 ↔ 契约」对齐单测(Wave 2 TASK_MCP)
 *
 * 锁定契约:openapi.yaml /mcp/tools/*(9 工具)
 *   - dispatch 类 8 个 → MCPDispatch {ok: true, dispatched, mode?, note?}
 *     (仅 ue_build 的 requestBody 含 mode;非法 mode 静默回落 build 是 D6 保留现状,只断言不修)
 *   - ue_get_build_errors → 同步快照 {ok: true, hasResult, build?}(非 dispatch)
 *   - 错误出口 → 契约全局 Error {code, message}(决策 D5,宪法 C8:禁止裸字符串)
 * 红线 C3/D4:callTool 保持同步签名 (name, args) => string,dispatch fire-and-forget。
 *
 * 与 tools.test.ts 分工:那边验证 dispatch 打桩与参数透传细节;
 * 本文件只钉住响应形状与契约 schema 的对齐。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ============================================================
// 顶部 mock(镜像 tools.test.ts 结构)—— mock factory 回调抽顶层 const
// ============================================================

type MockedExecute = Mock<unknown[], Promise<void>>;

const mockExecuteBuild = vi.fn<unknown[], Promise<void>>();
const mockExecuteLaunchEditor = vi.fn<unknown[], Promise<void>>();
const mockExecuteLiveCoding = vi.fn<unknown[], Promise<void>>();
const mockExecuteGenerateCompileCommands = vi.fn<unknown[], Promise<void>>();
const mockExecuteSetSystemIncludes = vi.fn<unknown[], Promise<void>>();
const mockShowProjectInfo = vi.fn<unknown[], Promise<void>>();

vi.mock('@commands/build', () => ({
  executeBuild: (...args: unknown[]) => mockExecuteBuild(...args),
}));
vi.mock('@commands/launchEditor', () => ({
  executeLaunchEditor: (...args: unknown[]) => mockExecuteLaunchEditor(...args),
}));
vi.mock('@commands/liveCoding', () => ({
  executeLiveCoding: (...args: unknown[]) => mockExecuteLiveCoding(...args),
}));
vi.mock('@commands/generateCompileCommands', () => ({
  executeGenerateCompileCommands: (...args: unknown[]) =>
    mockExecuteGenerateCompileCommands(...args),
}));
vi.mock('@commands/setSystemIncludes', () => ({
  executeSetSystemIncludes: (...args: unknown[]) => mockExecuteSetSystemIncludes(...args),
}));
vi.mock('@commands/showProjectInfo', () => ({
  showProjectInfo: (...args: unknown[]) => mockShowProjectInfo(...args),
}));

// ============================================================
// 测试主体 import (hoist 之后)
// ============================================================

import { MCP_TOOLS, callTool, setMCPContext } from '@mcp/tools';
import { rememberBuildSnapshot, resetLastBuildSnapshot } from '@build/lastBuild';
import { EC_MCP_CONTEXT_NOT_INITIALIZED, EC_UNKNOWN_TOOL } from '@core/envelope';
import type { Config } from '@core/config';
import type { Logger } from '@core/logger';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from '@clangd/clangdOps';

// 顶层 spy const —— 避免对象字面量内 vi.fn() 的 unbound-method 误判(镜像 tools.test.ts)
const fakeLogInfo = vi.fn<unknown[], void>();
const fakeLogWarn = vi.fn<unknown[], void>();
const fakeLogError = vi.fn<unknown[], void>();
const fakeLogDebug = vi.fn<unknown[], void>();

const fakeLogger = {
  info: fakeLogInfo,
  warn: fakeLogWarn,
  error: fakeLogError,
  debug: fakeLogDebug,
} as unknown as Logger;

const fakeCtx = {
  config: {} as Config,
  logger: fakeLogger,
  detection: {} as DetectionHandles,
  workspace: {} as WorkspaceState,
  clangdOps: {} as ClangdOps,
};

/** 契约中除 ue_build 外的 7 个 dispatch 类工具(均无参数) */
const DISPATCH_TOOLS_WITHOUT_MODE: string[] = [
  'ue_rebuild',
  'ue_clean',
  'ue_launch_editor',
  'ue_live_coding',
  'ue_generate_compile_commands',
  'ue_show_project_info',
  'ue_set_system_includes',
];

/** 契约 operationId 清单(9 项,顺序与 MCP_TOOLS 一致) */
const CONTRACT_OPERATION_IDS: string[] = [
  'ue_build',
  'ue_rebuild',
  'ue_clean',
  'ue_get_build_errors',
  'ue_launch_editor',
  'ue_live_coding',
  'ue_generate_compile_commands',
  'ue_show_project_info',
  'ue_set_system_includes',
];

describe('MCP tools 契约对齐(MCPDispatch / 快照 / Error)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLastBuildSnapshot();
    const all: readonly MockedExecute[] = [
      mockExecuteBuild,
      mockExecuteLaunchEditor,
      mockExecuteLiveCoding,
      mockExecuteGenerateCompileCommands,
      mockExecuteSetSystemIncludes,
      mockShowProjectInfo,
    ];
    for (const m of all) {
      m.mockResolvedValue(undefined);
    }
    setMCPContext(fakeCtx);
  });

  // ============================================================
  // 1. 工具清单 ↔ 契约 operationId
  // ============================================================

  it('MCP_TOOLS 9 个工具名与契约 operationId 一一对应', () => {
    expect(MCP_TOOLS.map((t) => t.name)).toEqual(CONTRACT_OPERATION_IDS);
  });

  // ============================================================
  // 2. dispatch 类响应 ↔ 契约 MCPDispatch
  // ============================================================

  it('ue_build dispatch 响应严格符合 MCPDispatch:keys 为 {ok, dispatched, mode, note}', () => {
    const parsed = JSON.parse(callTool('ue_build', {})) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['dispatched', 'mode', 'note', 'ok']);
    expect(parsed['ok']).toBe(true);
    expect(parsed['dispatched']).toBe('ue_build');
    expect(parsed['mode']).toBe('build'); // 契约 requestBody mode 默认 build
    expect(String(parsed['note'])).toContain('fire-and-forget');
  });

  it('[D6 现状保留] ue_build 非法 mode 静默回落 build,不报错', () => {
    const parsed = JSON.parse(callTool('ue_build', { mode: 'not-a-mode' })) as {
      ok: boolean;
      mode?: string;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.mode).toBe('build');
    // [add-002] callTool ue_build 分支固定 8 参(silent 后为 statusBar/module 占位),
    // 非法 mode 与空 args 场景 module 均为 undefined
    expect(mockExecuteBuild).toHaveBeenCalledWith(
      'build',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
      undefined,
      undefined,
    );
  });

  it.each(DISPATCH_TOOLS_WITHOUT_MODE)(
    '%s dispatch 响应符合 MCPDispatch 且无 mode 字段',
    (tool) => {
      const parsed = JSON.parse(callTool(tool, {})) as Record<string, unknown>;
      expect(parsed['ok']).toBe(true);
      expect(parsed['dispatched']).toBe(tool);
      const keys = Object.keys(parsed);
      expect(keys.every((k) => ['ok', 'dispatched', 'note'].includes(k))).toBe(true);
      expect(keys).not.toContain('mode');
    },
  );

  // ============================================================
  // 3. ue_get_build_errors ↔ 契约同步快照
  // ============================================================

  it('ue_get_build_errors 空态 keys 严格为 {ok, hasResult, note},且不触发任何 dispatch', () => {
    const parsed = JSON.parse(callTool('ue_get_build_errors', {})) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['hasResult', 'note', 'ok']);
    expect(parsed['ok']).toBe(true);
    expect(parsed['hasResult']).toBe(false);
    expect(String(parsed['note'])).toContain('ue_build');
    expect(mockExecuteBuild).not.toHaveBeenCalled();
  });

  it('ue_get_build_errors 有快照:build 含契约 BuildSummary 已对齐字段 ok/mode/exitCode/diagnostics/filesWithErrors', () => {
    rememberBuildSnapshot({
      mode: 'rebuild',
      ok: true,
      cancelled: false,
      exitCode: 0,
      durationMs: 10,
      finishedAtIso: '2026-09-19T00:00:00.000Z',
      diagnostics: [
        {
          file: 'C:/proj/Source/A.cpp',
          line: 1,
          severity: 'error',
          code: 'C2065',
          message: 'undeclared identifier',
          raw: 'raw',
        },
      ],
    });
    const parsed = JSON.parse(callTool('ue_get_build_errors', {})) as {
      ok: boolean;
      hasResult: boolean;
      build: Record<string, unknown>;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.hasResult).toBe(true);
    expect(parsed.build['ok']).toBe(true); // 契约 BuildSummary required: ok
    expect(parsed.build['mode']).toBe('rebuild');
    expect(parsed.build['exitCode']).toBe(0);
    expect(Array.isArray(parsed.build['diagnostics'])).toBe(true);
    expect(Array.isArray(parsed.build['filesWithErrors'])).toBe(true);
    // [Wave3 契约适配] 顶层 errorCount/warningCount 由适配层从 totals 映射
    // (src/mcp/tools.ts ue_get_build_errors case),对齐契约 BuildSummary
    expect(parsed.build['errorCount']).toBe(1);
    expect(parsed.build['warningCount']).toBe(0);
    // 其余字段原样保留(totals 超集继续透出,契约未禁止)
    expect(parsed.build['totals']).toEqual({ errors: 1, warnings: 0, notes: 0 });
  });

  // ============================================================
  // 4. 错误出口 ↔ 契约 Error {code, message}(宪法 C8 / 决策 D5)
  // ============================================================

  it('MCP 上下文未初始化 → {ok:false, error:{code: MCP_CONTEXT_NOT_INITIALIZED, message}},非裸字符串', () => {
    setMCPContext(null);
    const parsed = JSON.parse(callTool('ue_build', {})) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe(EC_MCP_CONTEXT_NOT_INITIALIZED);
    expect(typeof parsed.error.message).toBe('string');
    expect(parsed.error.message.length).toBeGreaterThan(0);
  });

  it('未知工具 → {ok:false, error:{code: UNKNOWN_TOOL}},message 含工具名', () => {
    const parsed = JSON.parse(callTool('no_such_tool', {})) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe(EC_UNKNOWN_TOOL);
    expect(parsed.error.message).toContain('no_such_tool');
  });

  // ============================================================
  // 5. C3/D4:同步签名 + fire-and-forget
  // ============================================================

  it('[C3] callTool 返回值是同步 string(非 Promise),dispatch 在 promise 未决时已完成', () => {
    mockExecuteBuild.mockReturnValueOnce(new Promise<void>(() => {})); // 永不 resolve
    const ret = callTool('ue_build', {});
    expect(typeof ret).toBe('string');
    const parsed = JSON.parse(ret) as Record<string, unknown>;
    expect(parsed).toEqual({
      ok: true,
      dispatched: 'ue_build',
      mode: 'build',
      note: expect.any(String) as unknown,
    });
  });
});
