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
 * [bugfix-002] extension.ts 已接线 activateMCP(激活流程 fire-and-forget 调用),
 * 本模块不再是 dead code;宿主门控(detectHost + config.useMCP)决定是否真正启动。
 */

import type * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
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
  // [D7] 关闭 console 输出 —— MCP stdio 传输把 JSON-RPC 帧写到 process.stdout,
  // 而 logger.info → console.log 也写 stdout,任何一行日志都会插进帧流,
  // 让 MCP 客户端解析失败。关闭后日志只进 OutputChannel(用户仍可在
  // "VSCodeUEHelper" 输出面板看到全部日志)。
  logger.setConsoleEnabled(false);
  const server = new MCPServer(logger);
  try {
    await server.start();
    context.subscriptions.push({
      dispose: () => {
        setMCPContext(null);
        // 恢复 console 输出 —— MCP 停止后扩展宿主仍可能有日志要走 console
        logger.setConsoleEnabled(true);
        void server.stop();
      },
    });
    return { server, host };
  } catch (err) {
    logger.error('[mcp] failed to start:', err);
    logger.setConsoleEnabled(true);
    setMCPContext(null);
    return { server: undefined, host };
  }
}
