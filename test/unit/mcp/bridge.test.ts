import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@core/config';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import { MCPBridgeServer } from '@mcp/bridge';
import { MCPBridgeClient } from '@mcp/bridgeClient';
import { setMCPContext } from '@mcp/tools';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

afterEach(() => {
  setMCPContext(null);
});

describe('MCP named-pipe bridge', () => {
  it('forwards a tool call to the extension-host MCP context and returns its result', async () => {
    setMCPContext({
      config: {
        configuration: 'Development',
        target: 'Editor',
        platform: 'Win64',
      } as Config,
      logger,
      detection: {} as never,
      workspace: { project: null, engine: null } as WorkspaceState,
    });

    const bridge = new MCPBridgeServer(logger);
    await bridge.start();
    const client = new MCPBridgeClient(bridge.pipeName, bridge.token);
    try {
      const result = await client.callTool('ue_status', {});
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toMatchObject({
        ok: true,
        build: { configuration: 'Development', target: 'Editor', platform: 'Win64' },
      });
    } finally {
      client.dispose();
      bridge.dispose();
    }
  });

  it('rejects callers that do not possess the per-session token', async () => {
    const bridge = new MCPBridgeServer(logger);
    await bridge.start();
    const client = new MCPBridgeClient(bridge.pipeName, 'invalid-token');
    try {
      await expect(client.callTool('ue_status', {})).rejects.toThrow();
    } finally {
      client.dispose();
      bridge.dispose();
    }
  });
});
