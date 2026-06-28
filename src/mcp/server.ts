/**
 * mcp/server —— Model Context Protocol 服务器,给 AI 代理集成用
 *
 * 把 build / launch / live-coding 工具暴露给 Cursor、Claude Code
 * 等 MCP 兼容宿主。
 *
 * 模式参考 engine-link 的 src/mcp/server.ts。用 stdio 传输,
 * 通过 @modelcontextprotocol/sdk 通信。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '@core/logger';
import { MCP_TOOLS, callTool } from './tools';

export class MCPServer {
  private server: Server;
  private transport: StdioServerTransport | undefined;

  constructor(private readonly logger: Logger) {
    this.server = new Server(
      {
        name: 'vscode-ue-helper',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: MCP_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, (request) => {
      const { name, arguments: args } = request.params;
      this.logger.info(`[mcp] tool call: ${name}`);
      const result = callTool(name ?? '', (args as Record<string, unknown>) ?? {});
      return {
        content: [{ type: 'text', text: result }],
      };
    });
  }

  async start(): Promise<void> {
    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);
    this.logger.info('[mcp] server connected via stdio');
  }

  async stop(): Promise<void> {
    await this.server.close();
    this.transport = undefined;
    this.logger.info('[mcp] server stopped');
  }
}
