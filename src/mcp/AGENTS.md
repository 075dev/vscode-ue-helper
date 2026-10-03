<!-- Parent: ../AGENTS.md -->
# mcp 模块 —— MCP 服务器（仅 Cursor / Claude Code 启动）

> 治理参考：`.specify/memory/constitution.md`。MCP 是 conditional infrastructure（宪法 Additional Constraints）：自动激活仅限支持的 AI 宿主，普通 VS Code 下必须保持 no-op。本模块必须满足宪法 §III（Localized, Observable, Resource-Safe UX）与 §V（Minimal, Traceable, Reversible Evolution）。

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

## 设置与用户层覆盖

- 设置 `vscodeUEHelper.useMCP: 'auto' | 'always' | 'never'`
  - `'auto'`（默认）：仅在 Cursor / Claude Code 启动
  - `'always'`：强制启动（实验性）
  - `'never'`：完全禁用，即使在 Cursor 也不启
- AI 规则生成（`@rules/cursorRules`）把 UE C++ 工作流写进 `.cursor/rules/unreal-cpp.mdc` 和 `.github/copilot-instructions.md`

## 组件

| 文件           | 职责                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`     | `activateMcp` 入口，环境检测，构造 Server + Tools；普通 VS Code 调用立即返回                                                        |
| `server.ts`    | MCP 服务器（基于 `@modelcontextprotocol/sdk`），stdio transport                                                                     |
| `tools.ts`     | **6 个工具**（`MCP_TOOLS` 常量）的定义 + handler 注册。`callTool` 同步签名，dispatch 到真实 `executeXxx`（Phase 11 SSoT 包 4 变更） |
| `lifecycle.ts` | 启动 / 暂停 / 卸载生命周期                                                                                                          |

`activateMcp` 调用 `setMCPContext({ config, logger, detection, workspace, clangdOps })` 注入本进程单例；普通 VS Code 下**不调**此方法，`callTool` 拿到 `_ctx === null` 后直接 `{ ok: false, error: 'mcp not activated' }`，绝不返回 stub 假成功。

## 暴露的工具（6 个）

| 工具名                         | 用途                                                               | 备注                                                    |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------- | --------- | -------------- |
| `ue_build`                     | 触发 UBT 构建（`build` / `rebuild` / `clean` 三态）                | dispatch → `executeBuild('build'                        | 'rebuild' | 'clean', ...)` |
| `ue_launch_editor`             | 启动 Unreal Editor（Windows only）                                 | dispatch → `executeLaunchEditor(...)`                   |
| `ue_live_coding`               | Live Coding 热重载（**Windows only**，详见 build 模块）            | dispatch → `executeLiveCoding(...)`                     |
| `ue_generate_compile_commands` | 生成 `compile_commands.json`（Windows / UBT 链路）                 | dispatch → `executeGenerateCompileCommands(...)`        |
| `ue_show_project_info`         | 显示当前检测到的项目 / 引擎信息                                    | dispatch → `showProjectInfo(...)`                       |
| `ue_set_system_includes`       | **Windows only** —— 把 MSVC + Windows SDK + C++ 标准写到 `.clangd` | dispatch → `executeSetSystemIncludes(..., silent=true)` |

> `ue_set_system_includes` 沿用命令版本的 Windows-only 短路；非 Windows 主机即使 host 误激活也会触发工具内部的 i18n 友好提示并返回，不污染 `.clangd`。
>
> **`ue_toggle_completion_mode` 已删除**（Phase 11 SSoT 包 4）：fast/slow 切换早已合并为统一 slow rewrite（见 `src/clangd/AGENTS.md`），不要在 MCP 重新引入该工具。

## dispatch 行为（callTool）

- **同步签名** `(name, args) => string`：MCP request handler 立即拿到 fire-and-forget 收据；真实进度经 Logger 流到 OutputChannel + Problems 面板（命令层已有处理）。
- **`silent = true` 短路**：MCP 调用走 `executeXxx(..., silent=true)` 路径，跳过 auto-pick / picker，避免阻塞 AI Agent。
- **统一使用 SSoT**：所有工具通过 `@core/workspace` 拿 `selectedProject` / `selectedEngine`、通过 `@clangd/clangdOps` 写 `.clangd` —— 满足宪法 §II。

## 资源清理与生命周期

- MCP 生命周期由激活入口与宿主进程共同拥有；新增 transport / handler / timer 必须有显式清理路径并接入扩展生命周期（满足宪法 §III lifecycle ownership）。
- 所有日志使用 `[mcp]` 前缀；i18n 双语 key 走 `t('mcp.xxx', params)`（满足宪法 §III 的 bilingual UX / observable logs）。

## 测试现状

`test/unit/mcp/tools.test.ts` 覆盖 6 个工具的 schema、context 未注入错误、未知工具与真实 `executeXxx(..., silent=true)` dispatch；宿主级 e2e 仍需在 Cursor / Claude Code 中手动验证。

## 新增 MCP 工具的步骤

1. `src/mcp/tools.ts`：在 `MCP_TOOLS` 增加 `{ name, description, inputSchema }`，并在 `callTool` 添加 dispatch 分支。
2. `src/commands/<name>.ts`：导出 `executeXxx(..., silent?: boolean)`，silent 路径跳过 UI 交互。
3. `src/commands/index.ts`：用 `track` 注册 `vscodeUEHelper.<name>` 命令。
4. `package.json`：`contributes.commands` 增加命令定义（保持与命令面板一致）。
5. i18n：在 `src/i18n/locales/{en,zh}.json` 增加 description / 用户可见字符串（**双语同步**）。

修改 MCP 之前请把 constitution §II/§V 看一遍：MCP 是 command 的 thin dispatcher，**禁止**在 MCP 层重新实现业务逻辑。
