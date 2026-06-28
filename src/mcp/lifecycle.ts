/**
 * mcp/lifecycle —— 检测当前宿主是否支持 MCP
 *
 * Cursor 和 Claude Code 在 spawn 子进程时会设置独特的环境变量,
 * 我们用它作为信号决定是否启动 MCP 服务器。
 * 普通 VS Code 没有这些 env var,保持静默。
 *
 * detectHost() 返回宿主信息(类型 + 标志位)。
 */

export type MCPMode = 'auto' | 'always' | 'never';

export function shouldStartMCP(mode: MCPMode): boolean {
  if (mode === 'always') {return true;}
  if (mode === 'never') {return false;}
  // 'auto' mode — start iff we can detect a Cursor / Claude Code host.
  return detectHost() !== null;
}

export function detectHost(): 'cursor' | 'claude-code' | null {
  if (process.env.CURSOR_TRACE_ID || process.env.CURSOR_USER_DATA_DIR) {return 'cursor';}
  if (process.env.CLAUDE_CODE_ENTRYPOINT || process.env.CLAUDE_CODE_SSE_PORT) {return 'claude-code';}
  return null;
}
