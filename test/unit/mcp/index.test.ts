/**
 * index.test.ts —— MCP 模块入口 activateMCP 单测(T5.4)
 *
 * 覆盖维度:
 * 1. detectHost 不支持 → skipped 路径(server=undefined, host=null)
 * 2. shouldStartMCP=false (mode=never) → skipped 路径
 * 3. detectHost=cursor 且 enabled=true → 调用 MCPServer.start + push dispose
 * 4. start() 抛错 → catch 分支返回 server=undefined + host 保留
 * 5. dispose → setMCPContext(null) + server.stop()
 *
 * vi.mock 必须在顶层 import 之前(vitest 自动 hoist)。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// 顶层 vi.mock —— vitest 自动 hoist
// ============================================================

const mockShouldStartMCP = vi.fn<[], boolean>();
const mockDetectHost = vi.fn<[], 'cursor' | 'claude-code' | null>();
const mockMCPServerStart = vi.fn<[], Promise<void>>();
const mockMCPServerStop = vi.fn<[], Promise<void>>();
const mockSetMCPContext = vi.fn<[unknown], void>();
// [D7] MCP 启动时必须关闭 logger 的 console 输出(stdout 会被 JSON-RPC 帧占用)
const mockSetConsoleEnabled = vi.fn<[boolean], void>();

vi.mock('../../../src/mcp/lifecycle', async () => {
  const actual = await vi.importActual<typeof import('../../../src/mcp/lifecycle')>(
    '../../../src/mcp/lifecycle',
  );
  return {
    ...actual,
    shouldStartMCP: () => mockShouldStartMCP(),
    detectHost: () => mockDetectHost(),
  };
});

vi.mock('../../../src/mcp/server', async () => {
  const actual = await vi.importActual<typeof import('../../../src/mcp/server')>(
    '../../../src/mcp/server',
  );
  return {
    ...actual,
    MCPServer: vi.fn().mockImplementation(() => ({
      start: () => mockMCPServerStart(),
      stop: () => mockMCPServerStop(),
    })),
  };
});

vi.mock('../../../src/mcp/tools', async () => {
  const actual = await vi.importActual<typeof import('../../../src/mcp/tools')>(
    '../../../src/mcp/tools',
  );
  return {
    ...actual,
    setMCPContext: (...args: unknown[]) => mockSetMCPContext(args[0]),
  };
});

// ============================================================
// subject under test
// ============================================================

import { activateMCP, type MCPHandles } from '../../../src/mcp/index';
import { Logger } from '../../../src/core/logger';
import type { Config } from '../../../src/core/config';
import type { DetectionHandles } from '../../../src/detection';
import { MCPServer } from '../../../src/mcp/server';

function stubConfig(): Config {
  return { useMCP: 'auto' } as unknown as Config;
}

function stubLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    // [D7] activateMCP 在 MCP 启动时关闭 console 输出
    setConsoleEnabled: (enabled: boolean) => mockSetConsoleEnabled(enabled),
  } as unknown as Logger;
}

function stubDetection(): DetectionHandles {
  return {} as DetectionHandles;
}

interface StubContext {
  subscriptions: { dispose: () => void }[];
}

function stubContext(): StubContext {
  return { subscriptions: [] };
}

beforeEach(() => {
  mockShouldStartMCP.mockReset();
  mockDetectHost.mockReset();
  mockMCPServerStart.mockReset();
  mockMCPServerStop.mockReset();
  mockSetMCPContext.mockReset();
  mockSetConsoleEnabled.mockReset();
  vi.mocked(MCPServer).mockClear();
});

describe('activateMCP skipped paths', () => {
  it('returns server=undefined, host=null when detectHost returns null (no MCP host)', async () => {
    mockDetectHost.mockReturnValue(null);
    mockShouldStartMCP.mockReturnValue(false);

    const result = await activateMCP(
      stubContext() as unknown as Parameters<typeof activateMCP>[0],
      stubConfig(),
      stubLogger(),
      stubDetection(),
    );

    expect(result.server).toBeUndefined();
    expect(result.host).toBeNull();
    expect(mockSetMCPContext).toHaveBeenCalledWith(null);
    expect(vi.mocked(MCPServer)).not.toHaveBeenCalled();
  });

  it('returns server=undefined when shouldStartMCP=false (mode=never override)', async () => {
    mockDetectHost.mockReturnValue('cursor');
    mockShouldStartMCP.mockReturnValue(false);

    const result = await activateMCP(
      stubContext() as unknown as Parameters<typeof activateMCP>[0],
      stubConfig(),
      stubLogger(),
      stubDetection(),
    );

    expect(result.server).toBeUndefined();
    expect(result.host).toBe('cursor');
    expect(mockSetMCPContext).toHaveBeenCalledWith(null);
    expect(vi.mocked(MCPServer)).not.toHaveBeenCalled();
  });
});

describe('activateMCP start path', () => {
  it('starts MCPServer and registers disposal subscription when host=cursor and enabled=true', async () => {
    mockDetectHost.mockReturnValue('cursor');
    mockShouldStartMCP.mockReturnValue(true);
    mockMCPServerStart.mockResolvedValue();

    const ctx = stubContext();
    const result: MCPHandles = await activateMCP(
      ctx as unknown as Parameters<typeof activateMCP>[0],
      stubConfig(),
      stubLogger(),
      stubDetection(),
    );

    expect(result.server).toBeDefined();
    expect(result.host).toBe('cursor');
    expect(vi.mocked(MCPServer)).toHaveBeenCalledTimes(1);
    expect(mockMCPServerStart).toHaveBeenCalledTimes(1);
    /* eslint-disable @typescript-eslint/no-unsafe-assignment -- vitest expect.objectContaining 链式调用在 @typescript-eslint 类型推导下返回 any,这是 vitest matcher API 的已知 limitations,不需修复 */
    const matcher = expect.objectContaining({
      config: expect.anything(),
      logger: expect.anything(),
    });
    expect(mockSetMCPContext).toHaveBeenCalledWith(matcher);
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    expect(ctx.subscriptions).toHaveLength(1);
  });

  it('start() throws -> catch path: returns server=undefined, host preserved, context cleared', async () => {
    mockDetectHost.mockReturnValue('claude-code');
    mockShouldStartMCP.mockReturnValue(true);
    mockMCPServerStart.mockRejectedValue(new Error('port already in use'));

    const result = await activateMCP(
      stubContext() as unknown as Parameters<typeof activateMCP>[0],
      stubConfig(),
      stubLogger(),
      stubDetection(),
    );

    expect(result.server).toBeUndefined();
    expect(result.host).toBe('claude-code');
    expect(mockSetMCPContext).toHaveBeenLastCalledWith(null);
  });

  // ============ [D7] MCP 启动时关闭 console 输出(stdout 被 JSON-RPC 帧占用) ============

  it('[D7] MCP 启动时关闭 logger console 输出', async () => {
    mockDetectHost.mockReturnValue('cursor');
    mockShouldStartMCP.mockReturnValue(true);
    mockMCPServerStart.mockResolvedValue();

    await activateMCP(
      stubContext() as unknown as Parameters<typeof activateMCP>[0],
      stubConfig(),
      stubLogger(),
      stubDetection(),
    );

    expect(mockSetConsoleEnabled).toHaveBeenCalledWith(false);
  });

  it('[D7] MCP 启动失败时恢复 console 输出', async () => {
    mockDetectHost.mockReturnValue('cursor');
    mockShouldStartMCP.mockReturnValue(true);
    mockMCPServerStart.mockRejectedValue(new Error('boom'));

    await activateMCP(
      stubContext() as unknown as Parameters<typeof activateMCP>[0],
      stubConfig(),
      stubLogger(),
      stubDetection(),
    );

    expect(mockSetConsoleEnabled).toHaveBeenLastCalledWith(true);
  });

  it('[D7] 非 MCP 宿主不改动 console 开关', async () => {
    mockDetectHost.mockReturnValue(null);
    mockShouldStartMCP.mockReturnValue(false);

    await activateMCP(
      stubContext() as unknown as Parameters<typeof activateMCP>[0],
      stubConfig(),
      stubLogger(),
      stubDetection(),
    );

    expect(mockSetConsoleEnabled).not.toHaveBeenCalled();
  });
});

describe('dispose subscription', () => {
  it('disposing the registered subscription clears MCP context and stops server', async () => {
    mockDetectHost.mockReturnValue('cursor');
    mockShouldStartMCP.mockReturnValue(true);
    mockMCPServerStart.mockResolvedValue();
    mockMCPServerStop.mockResolvedValue();

    const ctx = stubContext();
    await activateMCP(
      ctx as unknown as Parameters<typeof activateMCP>[0],
      stubConfig(),
      stubLogger(),
      stubDetection(),
    );

    // 触发 dispose 回调
    const sub = ctx.subscriptions[0];
    if (!sub) {
      throw new Error('expected subscription registered');
    }
    sub.dispose();

    expect(mockSetMCPContext).toHaveBeenLastCalledWith(null);
    expect(mockMCPServerStop).toHaveBeenCalledTimes(1);
    // [D7] dispose 时恢复 console 输出
    expect(mockSetConsoleEnabled).toHaveBeenLastCalledWith(true);
  });
});
