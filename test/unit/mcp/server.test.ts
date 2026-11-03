/**
 * server.test.ts —— MCP server 的 CallTool 响应形状单测([D17])
 *
 * 锁定:
 *   - 成功调用 → `{content:[{type:'text',text}], isError 字段不出现}`
 *   - 失败调用 → `{content:[...], isError:true}` —— MCP 协议标准字段,
 *     旧实现从不置位,Cursor / Claude Code 的错误分支形同虚设。
 *   - 载荷文本来自 callToolResult(统一构造器),与 callTool 的文本一致。
 *
 * 通过 mock @modelcontextprotocol/sdk 捕获 setRequestHandler 注册的 handler,
 * 不启动真实 stdio transport。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============ mock MCP SDK ============

type RequestHandler = (request: {
  params: { name?: string; arguments?: Record<string, unknown> };
}) => unknown;

const mockSetRequestHandler = vi.fn<unknown[], void>();
const mockConnect = vi.fn<unknown[], Promise<void>>();
const mockClose = vi.fn<unknown[], Promise<void>>();

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    setRequestHandler(...args: unknown[]): void {
      mockSetRequestHandler(...args);
    }
    async connect(...args: unknown[]): Promise<void> {
      await mockConnect(...args);
    }
    async close(...args: unknown[]): Promise<void> {
      await mockClose(...args);
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    async send(): Promise<void> {
      /* no-op */
    }
  },
}));

// ============ mock tools ============

const mockCallToolResult = vi.fn<[string, Record<string, unknown>], {
  text: string;
  isError: boolean;
}>();

vi.mock('@mcp/tools', async () => {
  const actual = await vi.importActual<typeof import('@mcp/tools')>('@mcp/tools');
  return {
    ...actual,
    callToolResult: (name: string, args: Record<string, unknown>) =>
      mockCallToolResult(name, args),
  };
});

import { MCPServer } from '@mcp/server';
import type { Logger } from '@core/logger';

function stubLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

/**
 * 从 mockSetRequestHandler 的调用记录里找出 CallTool handler。
 *
 * server.ts 里先注册 ListTools、再注册 CallTool —— 取**最后一个**函数型 handler。
 */
function findCallToolHandler(): RequestHandler {
  const handlers: RequestHandler[] = [];
  for (const call of mockSetRequestHandler.mock.calls) {
    const handler = call[1];
    if (typeof handler === 'function') {
      handlers.push(handler as RequestHandler);
    }
  }
  const handler = handlers[handlers.length - 1];
  if (!handler) {
    throw new Error('CallTool handler not registered');
  }
  return handler;
}

describe('MCPServer CallTool 响应([D17])', () => {
  beforeEach(() => {
    mockSetRequestHandler.mockReset();
    mockConnect.mockReset();
    mockClose.mockReset();
    mockCallToolResult.mockReset();
  });

  it('成功调用:content 载荷就绪且不出现 isError 字段', () => {
    mockCallToolResult.mockReturnValue({
      text: JSON.stringify({ ok: true, dispatched: 'ue_build' }),
      isError: false,
    });
    // 构造 server(注册 handler)
    // eslint-disable-next-line no-new -- 构造即注册 handler,实例不需保留
    new MCPServer(stubLogger());

    const handler = findCallToolHandler();
    const result = handler({
      params: { name: 'ue_build', arguments: {} },
    }) as { content: { type: string; text: string }[]; isError?: boolean };

    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain('dispatched');
    // 成功时不出现 isError(契约 MCPDispatch:成功载荷不含该字段)
    expect('isError' in result).toBe(false);
  });

  it('失败调用:MCP 协议层 isError=true', () => {
    mockCallToolResult.mockReturnValue({
      text: JSON.stringify({ ok: false, error: { code: 'UNKNOWN_TOOL', message: 'x' }, isError: true }),
      isError: true,
    });
    // eslint-disable-next-line no-new -- 构造即注册 handler,实例不需保留
    new MCPServer(stubLogger());

    const handler = findCallToolHandler();
    const result = handler({
      params: { name: 'no_such_tool', arguments: {} },
    }) as { content: { type: string; text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('UNKNOWN_TOOL');
  });

  it('start/stop 走 SDK 的 connect/close', async () => {
    // eslint-disable-next-line no-new -- 需要实例方法
    const server = new MCPServer(stubLogger());
    await server.start();
    expect(mockConnect).toHaveBeenCalledTimes(1);
    await server.stop();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
