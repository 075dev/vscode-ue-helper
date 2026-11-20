<!-- Parent: ../AGENTS.md -->
# MCP module

The extension publishes an MCP server through VS Code's `McpServerDefinitionProvider`.
The VS Code-managed stdio child (`stdioServer.ts`) is bundled as `out/mcpServer.js`.
It forwards tool calls over a random, authenticated Windows named pipe to the extension
host, where command implementations retain access to VS Code APIs and workspace state.

## Components

| File | Responsibility |
|---|---|
| `provider.ts` | Registers the contributed provider, applies `useMCP`, and resolves a stdio server definition. |
| `stdioServer.ts` | MCP protocol process; stdout is reserved for MCP frames. |
| `bridge.ts` | New per-server named pipe, random token authentication, and bounded JSON-line RPC. |
| `tools.ts` | Ten tool schemas and handlers using the injected extension-host context. |
| `lifecycle.ts` | Legacy host detection utilities used by project-info reporting. |

`package.json` must keep the `mcpServerDefinitionProviders` contribution ID aligned
with `MCP_PROVIDER_ID`, plus the matching `onMcpServerDefinitionProvider` activation event.
The MCP bundle must be included in the VSIX.

## Tool calls

The stdio process receives tool definitions from the provider and forwards only tool
name and arguments to the extension host. The pipe token is generated for each resolved
server definition; validate message shape, token, and size before dispatch.

`callToolResultAsync` waits for command-backed operations and returns the command's
actual envelope to the MCP client. Keep `callTool` / `callToolResult` synchronous only
for compatibility tests and callers; do not route the VS Code-managed server through
the extension host's own stdio.

The ten tools are `ue_build`, `ue_rebuild`, `ue_clean`, `ue_get_build_errors`,
`ue_launch_editor`, `ue_live_coding`, `ue_generate_compile_commands`,
`ue_show_project_info`, `ue_set_system_includes`, and `ue_status`.

The integration targets VS Code's MCP provider API, including Copilot Chat.
Cursor and Claude Code require their own server registration and are not enabled by
the VS Code provider alone.
