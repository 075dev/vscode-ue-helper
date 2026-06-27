/**
 * mcp —— 模块入口
 *
 * 仅当宿主支持 MCP 时启动 MCP 服务器(Cursor / Claude Code)。
 * 普通 VS Code 注册一个 no-op。
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import { MCPServer } from './server';
import { shouldStartMCP, detectHost } from './lifecycle';

export { MCPServer } from './server';
export { MCP_TOOLS, callTool } from './tools';
export { shouldStartMCP, detectHost, type MCPMode } from './lifecycle';
export type { MCPTool } from './tools';

export interface MCPHandles {
  server: MCPServer | undefined;
  host: 'cursor' | 'claude-code' | null;
}

export async function activateMCP(
  context: vscode.ExtensionContext,
  config: Config,
  logger: Logger,
): Promise<MCPHandles> {
  const host = detectHost();
  const enabled = shouldStartMCP(config.useMCP);

  if (!enabled || !host) {
    logger.info(`[mcp] skipped (host=${host ?? 'none'}, mode=${config.useMCP})`);
    return { server: undefined, host };
  }

  logger.info(`[mcp] detected host=${host}, starting server`);
  const server = new MCPServer(logger);
  try {
    await server.start();
    context.subscriptions.push({
      dispose: () => {
        void server.stop();
      },
    });
    return { server, host };
  } catch (err) {
    logger.error('[mcp] failed to start:', err);
    return { server: undefined, host };
  }
}
