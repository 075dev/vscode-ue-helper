import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { Config } from '@core/config';
import type { Logger } from '@core/logger';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from '@clangd/clangdOps';
import { MCP_PROVIDER_ID, registerMCPProvider } from '@mcp/provider';

describe('VS Code MCP provider', () => {
  it('publishes the bundled stdio server with tool definitions and resolves an authenticated bridge', async () => {
    const subscriptions: vscode.Disposable[] = [];
    const config = {
      useMCP: 'auto',
      onDidChange: () => ({ dispose: vi.fn() }),
    } as unknown as Config;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    const context = {
      subscriptions,
      extensionUri: vscode.Uri.file('C:\\extension'),
      extension: { packageJSON: { version: '0.2.0' } },
    } as unknown as vscode.ExtensionContext;

    const registration = registerMCPProvider({
      context,
      config,
      logger,
      mcpContext: {
        config,
        logger,
        detection: {} as DetectionHandles,
        workspace: {} as WorkspaceState,
        clangdOps: {} as ClangdOps,
      },
    });
    expect(registration).toBeDefined();

    const register = vi.mocked(vscode.lm.registerMcpServerDefinitionProvider);
    expect(register).toHaveBeenCalledWith(MCP_PROVIDER_ID, expect.anything());
    const provider = register.mock.calls.at(-1)?.[1];
    expect(provider).toBeDefined();

    const cancellation = { isCancellationRequested: false } as vscode.CancellationToken;
    const definitions = await provider?.provideMcpServerDefinitions(cancellation);
    expect(definitions).toHaveLength(1);
    const definition = definitions?.[0] as vscode.McpStdioServerDefinition | undefined;
    expect(definition).toBeInstanceOf(vscode.McpStdioServerDefinition);
    expect(definition?.args[0]).toContain('out/mcpServer.js');
    expect(definition?.env['VSCODE_UE_HELPER_MCP_TOOLS']).toContain('ue_build');

    const resolved = (await provider?.resolveMcpServerDefinition?.(definition!, cancellation)) as
      vscode.McpStdioServerDefinition | undefined;
    expect(resolved?.env['VSCODE_UE_HELPER_MCP_PIPE']).toMatch(
      /^\\\\\.\\pipe\\vscode-ue-helper-mcp-/,
    );
    expect(resolved?.env['VSCODE_UE_HELPER_MCP_TOKEN']).toHaveLength(64);

    for (const subscription of subscriptions) {
      subscription.dispose();
    }
  });

  it('publishes a self-sufficient definition — bridge env present without resolve (bugfix-005)', async () => {
    // bugfix-005:VS Code 存在不调用 resolveMcpServerDefinition 的启动路径
    // (后台转发到 Copilot 会话、definition 缓存重启,官方文档明确警示
    // "Don't rely on an interactive resolver running during background forwarding")。
    // provide 返回的 definition 必须在 provide 阶段就带齐 pipe/token,
    // 否则 spawn 出的 mcpServer.js 立即抛 "VS Code MCP bridge environment is missing"。
    const subscriptions: vscode.Disposable[] = [];
    const config = {
      useMCP: 'auto',
      onDidChange: () => ({ dispose: vi.fn() }),
    } as unknown as Config;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    const context = {
      subscriptions,
      extensionUri: vscode.Uri.file('C:\\extension'),
      extension: { packageJSON: { version: '0.2.0' } },
    } as unknown as vscode.ExtensionContext;

    registerMCPProvider({
      context,
      config,
      logger,
      mcpContext: { config, logger, detection: {} as DetectionHandles },
    });
    const provider = vi
      .mocked(vscode.lm.registerMcpServerDefinitionProvider)
      .mock.calls.at(-1)?.[1];

    const definitions = await provider?.provideMcpServerDefinitions({
      isCancellationRequested: false,
    } as vscode.CancellationToken);
    const definition = definitions?.[0] as vscode.McpStdioServerDefinition | undefined;
    expect(definition?.env['VSCODE_UE_HELPER_MCP_PIPE']).toMatch(
      /^\\\\\.\\pipe\\vscode-ue-helper-mcp-/,
    );
    expect(definition?.env['VSCODE_UE_HELPER_MCP_TOKEN']).toHaveLength(64);

    for (const subscription of subscriptions) {
      subscription.dispose();
    }
  });

  it('reuses one bridge across provide/resolve calls instead of leaking one per resolve (bugfix-005)', async () => {
    // bugfix-005:旧实现每次 resolve 都 new MCPBridgeServer 且从不清理,
    // 定义变更/会话重启反复 resolve 时泄漏管道服务器并"重新呼出新进程"。
    const subscriptions: vscode.Disposable[] = [];
    const config = {
      useMCP: 'auto',
      onDidChange: () => ({ dispose: vi.fn() }),
    } as unknown as Config;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    const context = {
      subscriptions,
      extensionUri: vscode.Uri.file('C:\\extension'),
      extension: { packageJSON: { version: '0.2.0' } },
    } as unknown as vscode.ExtensionContext;

    registerMCPProvider({
      context,
      config,
      logger,
      mcpContext: { config, logger, detection: {} as DetectionHandles },
    });
    const provider = vi
      .mocked(vscode.lm.registerMcpServerDefinitionProvider)
      .mock.calls.at(-1)?.[1];
    const cancellation = { isCancellationRequested: false } as vscode.CancellationToken;

    const first = (await provider?.provideMcpServerDefinitions(cancellation))?.[0] as
      | vscode.McpStdioServerDefinition
      | undefined;
    const second = (await provider?.provideMcpServerDefinitions(cancellation))?.[0] as
      | vscode.McpStdioServerDefinition
      | undefined;
    expect(first?.env['VSCODE_UE_HELPER_MCP_PIPE']).toMatch(/^\\\\\.\\pipe\\vscode-ue-helper-mcp-/);
    expect(first?.env['VSCODE_UE_HELPER_MCP_PIPE']).toBe(second?.env['VSCODE_UE_HELPER_MCP_PIPE']);
    expect(first?.env['VSCODE_UE_HELPER_MCP_TOKEN']).toBe(second?.env['VSCODE_UE_HELPER_MCP_TOKEN']);

    const resolved = (await provider?.resolveMcpServerDefinition?.(first!, cancellation)) as
      | vscode.McpStdioServerDefinition
      | undefined;
    expect(resolved?.env['VSCODE_UE_HELPER_MCP_PIPE']).toBe(first?.env['VSCODE_UE_HELPER_MCP_PIPE']);

    for (const subscription of subscriptions) {
      subscription.dispose();
    }
  });

  it('does not publish the server when MCP is disabled', async () => {
    const config = {
      useMCP: 'never',
      onDidChange: () => ({ dispose: vi.fn() }),
    } as unknown as Config;
    const context = {
      subscriptions: [],
      extensionUri: vscode.Uri.file('C:\\extension'),
      extension: { packageJSON: { version: '0.2.0' } },
    } as unknown as vscode.ExtensionContext;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    registerMCPProvider({
      context,
      config,
      logger,
      mcpContext: { config, logger, detection: {} as DetectionHandles },
    });
    const provider = vi
      .mocked(vscode.lm.registerMcpServerDefinitionProvider)
      .mock.calls.at(-1)?.[1];
    expect(
      await provider?.provideMcpServerDefinitions({
        isCancellationRequested: false,
      } as vscode.CancellationToken),
    ).toEqual([]);
  });
});
