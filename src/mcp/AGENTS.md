# mcp 模块 —— MCP 服务器（仅 Cursor / Claude Code 启动）

**关键**：MCP **只在 Cursor / Claude Code 环境自动启用**。普通 VS Code 里 MCP 完全 no-op，不要假设 always-on。

## 环境检测

`src/mcp/index.ts` 检测环境变量：

```typescript
const isMcpHost =
  !!process.env.CURSOR_TRACE_ID ||
  !!process.env.CURSOR_USER_DATA_DIR ||
  !!process.env.CLAUDE_CODE_ENTRYPOINT ||
  !!process.env.CLAUDE_CODE_SSE_PORT;
```

普通 VS Code 用户：MCP 代码**完全不执行**。改 MCP 时不要被 always-on 假设误导。

## 组件

| 文件 | 职责 |
|---|---|
| `index.ts` | activateMcp 入口，环境检测，构造 Server + Tools |
| `server.ts` | MCP 服务器（基于 @modelcontextprotocol/sdk），stdio transport |
| `tools.ts` | 6 个工具的定义 + handler 注册 |
| `lifecycle.ts` | 启动/暂停/卸载生命周期 |

## 暴露的工具（6 个）

| 工具名 | 用途 |
|---|---|
| `ue_build` | 触发 UBT 构建 |
| `ue_launch_editor` | 启动 Unreal Editor |
| `ue_live_coding` | Live Coding 热重载（Windows only） |
| `ue_generate_compile_commands` | 生成 compile_commands.json |
| `ue_show_project_info` | 显示当前检测到的项目/引擎信息 |
| `ue_toggle_completion_mode` | 切换 fast/slow 模式。**注意**：completionMode 已废弃，[Pitfall #11] 仅 slow 生效 |

## 用户层控制

- 设置 `vscodeUEHelper.useMCP: 'auto' \| 'always' \| 'never'`
  - `'auto'`（默认）：仅在 Cursor / Claude Code 启动
  - `'always'`：强制启动（实验性）
  - `'never'`：完全禁用，即使在 Cursor 也不启
- AI 规则生成（@rules/cursorRules）把 UE C++ 工作流写进 `.cursor/rules/unreal-cpp.mdc` 和 `.github/copilot-instructions.md`

## 测试现状

**目前 0 测试**（test/unit/mcp/ 不存在）。可补 tools.ts 的 input validation 单测，但 e2e 必须靠手动启动 Cursor 验证 —— 不要写跨 vscode/test-runner 的 mock e2e。
