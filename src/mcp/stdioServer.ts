import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { MCPTool } from './tools';
import { MCPBridgeClient } from './bridgeClient';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMCPTool(value: unknown): value is MCPTool {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    isRecord(value.inputSchema)
  );
}

function readToolDefinitions(value: string | undefined): MCPTool[] {
  if (!value) {
    throw new Error('VSCode UE Helper MCP tool definitions were not provided by VS Code');
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error('VSCode UE Helper MCP tool definitions must be an array');
  }
  const definitions: unknown[] = parsed;
  for (const tool of definitions) {
    if (!isMCPTool(tool)) {
      throw new Error('VSCode UE Helper MCP tool definition is invalid');
    }
  }
  return definitions as MCPTool[];
}

export async function runMCPStdioServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const pipeName = env.VSCODE_UE_HELPER_MCP_PIPE;
  const token = env.VSCODE_UE_HELPER_MCP_TOKEN;
  if (!pipeName || !token) {
    throw new Error('VS Code MCP bridge environment is missing');
  }
  const tools = readToolDefinitions(env.VSCODE_UE_HELPER_MCP_TOOLS);
  const bridge = new MCPBridgeClient(pipeName, token);
  const server = new Server(
    { name: 'vscode-ue-helper', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await bridge.callTool(request.params.name, request.params.arguments ?? {});
    return {
      content: [{ type: 'text', text: result.text }],
      ...(result.isError ? { isError: true } : {}),
    };
  });

  const transport = new StdioServerTransport();
  transport.onclose = () => bridge.dispose();
  process.stdin.once('end', () => bridge.dispose());
  try {
    await server.connect(transport);
  } catch (error) {
    bridge.dispose();
    throw error;
  }
  process.once('exit', () => bridge.dispose());
}

if (require.main === module) {
  void runMCPStdioServer().catch((error: unknown) => {
    process.stderr.write(
      `[vscode-ue-helper-mcp] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
