/**
 * tools.test.ts —— MCP tools 单测
 *
 * Phase 11 SSoT 包 4 红测 → 绿测:
 * - MCP_TOOLS 列表正确(6 个,不含已废弃的 ue_toggle_completion_mode)
 * - 未设 context 时 callTool 同步返回 ok=false 错误
 * - 6 个 case 各自 dispatch 到对应 executeXxx 并传 silent=true
 *
 * 测试通过 vi.mock 把 6 个 @commands/* 模块打桩——
 * 这样 callTool switch 各分支都能验证,不需要真跑命令(命令路径覆盖
 * 由 test/unit/commands/ 单独负责)。
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// ============================================================
// 顶部 mock —— vitest 自动 hoist vi.mock,但 mock factory 里的回调函数
// 必须在 hoist 阶段可枚举,因此抽到顶层 const。
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

import { MCP_TOOLS, callTool, setMCPContext, getMCPContext } from '@mcp/tools';
import { rememberBuildSnapshot, resetLastBuildSnapshot } from '@build/lastBuild';
import type { Config } from '@core/config';
import type { Logger } from '@core/logger';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from '@clangd/clangdOps';

// ============================================================
// fake handles —— 任何 callTool 调用都基于这套 inputs
// ============================================================

const fakeConfig = {
  useMCP: 'auto',
  platform: 'Win64',
  configuration: 'Development',
  target: 'Editor',
  clangdPath: '',
  userAddFlags: [],
} as unknown as Config;

// 顶层 spy const —— 避免 unbound-method 误判 (vi.mocked(spy) 不引用 method extraction)
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

const fakeDetection = {
  ready: Promise.resolve({
    projects: [],
    engines: [],
    workspaceFile: undefined,
    workspaceRoot: undefined,
    workspaceFolders: [],
    projectFolder: null,
    engineFolder: null,
  }),
  workspaceContext: {
    getSelectedProject: vi.fn<unknown[], string | undefined>(),
    getSelectedEngine: vi.fn<unknown[], string | undefined>(),
    setProject: vi.fn<unknown[], Promise<void>>(),
    setEngine: vi.fn<unknown[], Promise<void>>(),
  },
} as unknown as DetectionHandles;

const fakeWorkspace = {
  resolveSelectedProject: vi.fn<unknown[], undefined>(),
  resolveSelectedEngine: vi.fn<unknown[], undefined>(),
} as unknown as WorkspaceState;

const fakeClangdOps = {
  exists: vi.fn<unknown[], Promise<boolean>>(),
} as unknown as ClangdOps;

/**
 * 让 fire-and-forget 的 mock 触发完成。callTool 是同步签名,真实 executeXxx 是 async,
 * mock 触发在下一轮 microtask 队列。多次 await + setImmediate 等待,避开 require-await
 * 与 unbound-method 误报。
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** 通用 helper —— 调 callTool 后等 mock 触发再断言 */
async function expectDispatched(
  toolName: string,
  mockFn: MockedExecute,
  args: Record<string, unknown>,
  expectedMockArgs: readonly unknown[],
): Promise<void> {
  const parsed = JSON.parse(callTool(toolName, args)) as {
    ok: boolean;
    dispatched?: string;
    mode?: string;
    error?: string;
  };
  expect(parsed.ok).toBe(true);
  expect(parsed.dispatched).toBe(toolName);
  await flushMicrotasks();
  expect(mockFn).toHaveBeenCalledTimes(1);
  expect(mockFn).toHaveBeenCalledWith(...expectedMockArgs);
}

describe('MCP tools', () => {
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
    setMCPContext({
      config: fakeConfig,
      logger: fakeLogger,
      detection: fakeDetection,
      workspace: fakeWorkspace,
      clangdOps: fakeClangdOps,
    });
  });

  afterEach(() => {
    setMCPContext(null);
  });

  // ============================================================
  // 1. MCP_TOOLS schema
  // ============================================================

  it('MCP_TOOLS 含 9 个工具且不含已废弃的 ue_toggle_completion_mode', () => {
    expect(MCP_TOOLS).toHaveLength(9);
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      'ue_build',
      'ue_rebuild',
      'ue_clean',
      'ue_get_build_errors',
      'ue_launch_editor',
      'ue_live_coding',
      'ue_generate_compile_commands',
      'ue_show_project_info',
      'ue_set_system_includes',
    ]);
    expect(MCP_TOOLS.find((t) => t.name === 'ue_toggle_completion_mode')).toBeUndefined();
  });

  it('ue_build schema 包含 mode enum', () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'ue_build');
    expect(tool).toBeDefined();
    const props = tool?.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props.mode?.enum).toEqual(['build', 'rebuild', 'clean']);
  });

  // ============================================================
  // 2. context 缺失 / 未知工具
  // ============================================================

  it('未设 context 时 callTool 同步返回 ok=false error', () => {
    setMCPContext(null);
    expect(getMCPContext()).toBeNull();
    const parsed = JSON.parse(callTool('ue_build', {})) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/MCP context not initialized/);
  });

  it('未知工具返回 ok=false error', () => {
    const parsed = JSON.parse(callTool('ue_unknown', {})) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('Unknown tool: ue_unknown');
  });

  // ============================================================
  // 3. 6 个 case dispatch + silent = true 透传
  // ============================================================

  it('ue_build dispatch 到 executeBuild(mode=rebuild, ..., silent=true)', async () => {
    await expectDispatched('ue_build', mockExecuteBuild, { mode: 'rebuild' }, [
      'rebuild',
      fakeConfig,
      fakeLogger,
      fakeDetection,
      fakeWorkspace,
      true,
    ]);
  });

  it('ue_build mode 缺省时默认 build', async () => {
    const parsed = JSON.parse(callTool('ue_build', {})) as { mode?: string };
    expect(parsed.mode).toBe('build');
    await flushMicrotasks();
    expect(mockExecuteBuild).toHaveBeenCalledWith(
      'build',
      fakeConfig,
      fakeLogger,
      fakeDetection,
      fakeWorkspace,
      true,
    );
  });

  it('ue_build 非法 mode 字符串 normalize 为 build', () => {
    const parsed = JSON.parse(callTool('ue_build', { mode: 'garbage' })) as { mode?: string };
    expect(parsed.mode).toBe('build');
  });

  it('ue_launch_editor dispatch silent=true', async () => {
    await expectDispatched('ue_launch_editor', mockExecuteLaunchEditor, {}, [
      fakeConfig,
      fakeLogger,
      fakeDetection,
      fakeWorkspace,
      true,
    ]);
  });

  it('ue_live_coding dispatch silent=true', async () => {
    await expectDispatched('ue_live_coding', mockExecuteLiveCoding, {}, [
      fakeConfig,
      fakeLogger,
      fakeDetection,
      fakeWorkspace,
      true,
    ]);
  });

  it('ue_generate_compile_commands dispatch silent=true', async () => {
    await expectDispatched('ue_generate_compile_commands', mockExecuteGenerateCompileCommands, {}, [
      fakeConfig,
      fakeLogger,
      fakeDetection,
      fakeWorkspace,
      true,
    ]);
  });

  it('ue_show_project_info dispatch silent=true', async () => {
    await expectDispatched('ue_show_project_info', mockShowProjectInfo, {}, [
      fakeConfig,
      fakeLogger,
      fakeDetection,
      fakeWorkspace,
      true,
    ]);
  });

  it('ue_set_system_includes dispatch silent=true 并透传 clangdOps', async () => {
    await expectDispatched('ue_set_system_includes', mockExecuteSetSystemIncludes, {}, [
      fakeConfig,
      fakeLogger,
      fakeDetection,
      fakeWorkspace,
      fakeClangdOps,
      true,
    ]);
  });

  // ============================================================
  // 3.1 [借鉴 engine-link] ue_rebuild / ue_clean / ue_get_build_errors
  // ============================================================

  it('ue_rebuild dispatch 到 executeBuild(mode=rebuild, silent=true)', async () => {
    await expectDispatched('ue_rebuild', mockExecuteBuild, {}, [
      'rebuild',
      fakeConfig,
      fakeLogger,
      fakeDetection,
      fakeWorkspace,
      true,
    ]);
  });

  it('ue_clean dispatch 到 executeBuild(mode=clean, silent=true)', async () => {
    await expectDispatched('ue_clean', mockExecuteBuild, {}, [
      'clean',
      fakeConfig,
      fakeLogger,
      fakeDetection,
      fakeWorkspace,
      true,
    ]);
  });

  it('ue_get_build_errors 无快照时返回 hasResult=false(不 fire-and-forget)', () => {
    resetLastBuildSnapshot();
    const parsed = JSON.parse(callTool('ue_get_build_errors', {})) as {
      ok: boolean;
      hasResult: boolean;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.hasResult).toBe(false);
    expect(mockExecuteBuild).not.toHaveBeenCalled();
  });

  it('ue_get_build_errors 有快照时返回 build 摘要(计数/文件去重/诊断明细)', () => {
    rememberBuildSnapshot({
      mode: 'build',
      ok: false,
      cancelled: false,
      exitCode: 2,
      durationMs: 1234,
      finishedAtIso: '2026-09-12T00:00:00.000Z',
      diagnostics: [
        {
          file: 'C:/proj/Source/A.cpp',
          line: 10,
          severity: 'error',
          code: 'C2065',
          message: 'undeclared identifier',
          raw: 'raw',
        },
        {
          file: 'C:/proj/Source/A.cpp',
          line: 20,
          severity: 'warning',
          code: 'C4100',
          message: 'unreferenced',
          raw: 'raw',
        },
        {
          file: 'C:/proj/Source/B.cpp',
          line: 5,
          severity: 'error',
          code: 'C2039',
          message: 'not a member',
          raw: 'raw',
        },
      ],
    });

    const parsed = JSON.parse(callTool('ue_get_build_errors', {})) as {
      ok: boolean;
      hasResult: boolean;
      build: {
        ok: boolean;
        exitCode: number;
        totals: { errors: number; warnings: number; notes: number };
        filesWithErrors: string[];
        diagnostics: unknown[];
        diagnosticsTruncated: boolean;
      };
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.hasResult).toBe(true);
    expect(parsed.build.exitCode).toBe(2);
    expect(parsed.build.totals).toEqual({ errors: 2, warnings: 1, notes: 0 });
    expect(parsed.build.filesWithErrors).toEqual(['C:/proj/Source/A.cpp', 'C:/proj/Source/B.cpp']);
    expect(parsed.build.diagnostics).toHaveLength(3);
    expect(parsed.build.diagnosticsTruncated).toBe(false);
  });

  // ============================================================
  // 4. fire-and-forget 错误捕获
  // ============================================================

  it('executeXxx 抛错时 logger.error 收到(mcp fire-and-forget 不会让 MCP 死掉)', async () => {
    mockExecuteBuild.mockRejectedValueOnce(new Error('boom'));
    const parsed = JSON.parse(callTool('ue_build', {})) as { ok: boolean };
    expect(parsed.ok).toBe(true);
    await flushMicrotasks();
    expect(fakeLogError).toHaveBeenCalled();
    const errCall = fakeLogError.mock.calls[0];
    expect(String(errCall?.[0])).toContain('ue_build');
  });
});
