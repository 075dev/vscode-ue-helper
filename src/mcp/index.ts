/**
 * MCP module exports. VS Code's MCP provider launches the stdio child on demand;
 * child requests are forwarded to the extension host over an authenticated pipe.
 */

export { registerMCPProvider, MCP_PROVIDER_ID } from './provider';
export { MCPBridgeServer } from './bridge';
export { MCPBridgeClient } from './bridgeClient';
export {
  MCP_TOOLS,
  callTool,
  callToolResult,
  callToolResultAsync,
  setMCPContext,
  getMCPContext,
  type MCPContext,
  type MCPTool,
  type ToolResult,
} from './tools';
