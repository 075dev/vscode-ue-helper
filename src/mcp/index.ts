/**
 * mcp —— 模块入口
 *
 * 仅当宿主支持 MCP 时启动 MCP 服务器(Cursor / Claude Code)。
 * 普通 VS Code 注册一个 no-op。
 *
 * ## Phase 11 SSoT 包 4 变更
 *
 * activateMCP 接受可选的 workspace / clangdOps 参数,在服务器启动前
 * 注入 MCP runtime context(由 setMCPContext 写到 tools.ts 单例)。
 * 这是 fire-and-forget dispatch 的必要前置——未注入时 callTool 同步
 * 返回 "MCP context not initialized" 错误。
 *
 * 注意:扩展主入口 extension.ts 当前没调 activateMCP(dead code),
 * Plan 12 处理 dispatch 接入。这里只是把 index.ts 改造好,方便后续接入。
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from '@clangd/clangdOps';
import { MCPServer } from './server';
import { setMCPContext } from './tools';
import { shouldStartMCP, detectHost } from './lifecycle';

export { MCPServer } from './server';
export { MCP_TOOLS, callTool, setMCPContext, getMCPContext, type MCPContext } from './tools';
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
  detection: DetectionHandles,
  // [Phase 11 SSoT] 可选——production 走 WorkspaceState;老调用方/test 留 fallback
  workspace?: WorkspaceState,
  clangdOps?: ClangdOps,
): Promise<MCPHandles> {
  const host = detectHost();
  const enabled = shouldStartMCP(config.useMCP);

  if (!enabled || !host) {
    // [Phase 11 SSoT] 清空可能残留的 context,避免 stale handle 漏出去
    setMCPContext(null);
    logger.info(`[mcp] skipped (host=${host ?? 'none'}, mode=${config.useMCP})`);
    return { server: undefined, host };
  }

  logger.info(`[mcp] detected host=${host}, starting server`);
  // [Phase 11 SSoT] 先注入 context,callTool 才能 dispatch 到 executeXxx
  setMCPContext({ config, logger, detection, workspace, clangdOps });
  const server = new MCPServer(logger);
  try {
    await server.start();
    context.subscriptions.push({
      dispose: () => {
        setMCPContext(null);
        void server.stop();
      },
    });
    return { server, host };
  } catch (err) {
    logger.error('[mcp] failed to start:', err);
    setMCPContext(null);
    return { server: undefined, host };
  }
}
