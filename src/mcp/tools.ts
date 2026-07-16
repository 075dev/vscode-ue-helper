/**
 * mcp/tools —— Model Context Protocol 服务器的工具定义
 *
 * 每个工具对应我们的一个命令,但由 AI 代理通过 MCP 调用(不是用户从命令面板)。
 * 工具列表:列出 UE 项目、读 .uproject、读 .clangd 配置、触发构建等。
 */

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const MCP_TOOLS: MCPTool[] = [
  {
    name: 'ue_build',
    description: 'Run a UBT build for the currently selected .uproject and engine.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['build', 'rebuild', 'clean'],
          description: 'Build mode. Default: build.',
        },
      },
    },
  },
  {
    name: 'ue_launch_editor',
    description: 'Launch the Unreal Editor for the selected .uproject.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ue_live_coding',
    description: 'Trigger Live Coding hot-reload (Windows only).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ue_generate_compile_commands',
    description: 'Generate compile_commands.json for clangd.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ue_show_project_info',
    description: 'Return the currently detected .uproject and Unreal Engine info.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ue_toggle_completion_mode',
    description: 'Toggle clangd completion mode between fast (curated) and slow (comprehensive).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Call a tool by name with the given args. Returns the JSON string the
 * MCP transport expects.
 */
export function callTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'ue_build': {
      const mode = (args.mode as string) ?? 'build';
      return JSON.stringify({
        ok: true,
        mode,
        note: 'Phase 5 stub — Phase 4 command dispatches real UBT',
      });
    }
    case 'ue_launch_editor':
      return JSON.stringify({ ok: true, note: 'Phase 5 stub' });
    case 'ue_live_coding':
      return JSON.stringify({ ok: true, note: 'Phase 5 stub — Windows-only' });
    case 'ue_generate_compile_commands':
      return JSON.stringify({ ok: true, note: 'Phase 5 stub' });
    case 'ue_show_project_info':
      return JSON.stringify({ ok: true, note: 'Phase 5 stub' });
    case 'ue_toggle_completion_mode':
      // T2.1 / H4-B：fast/slow 已合并，返回当前唯一模式 slow。Phase 5 stub 保留。
      return JSON.stringify({ ok: true, mode: 'slow', note: 'Phase 5 stub — fast/slow 已合并为 slow' });
    default:
      return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
  }
}
