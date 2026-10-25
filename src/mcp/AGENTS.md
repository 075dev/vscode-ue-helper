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
| `tools.ts`     | **10 个工具**（`MCP_TOOLS` 常量）的定义 + handler 注册。`callTool` 同步签名，dispatch 到真实 `executeXxx`（Phase 11 SSoT 包 4 变更） |
| `lifecycle.ts` | 启动 / 暂停 / 卸载生命周期                                                                                                          |

`activateMcp` 调用 `setMCPContext({ config, logger, detection, workspace, clangdOps })` 注入本进程单例；普通 VS Code 下**不调**此方法，`callTool` 拿到 `_ctx === null` 后直接 `{ ok: false, error: 'mcp not activated' }`，绝不返回 stub 假成功。

## 暴露的工具（10 个）

| 工具名                         | 用途                                                               | 调用方式                                                |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `ue_build`                     | 触发 UBT 构建（`build` 态；支持可选 `module` 单模块编译）           | dispatch → `executeBuild('build', …, silent=true)`      |
| `ue_rebuild`                   | 触发 UBT 重建                                                       | dispatch → `executeBuild('rebuild', …, silent=true)`    |
| `ue_clean`                     | 触发 UBT 清理                                                       | dispatch → `executeBuild('clean', …, silent=true)`      |
| `ue_get_build_errors`          | 读最近一次构建的结构化诊断                                          | **同步**读进程内快照                                    |
| `ue_launch_editor`             | 启动 Unreal Editor（Windows only）                                 | dispatch → `executeLaunchEditor(…, true)`               |
| `ue_live_coding`               | Live Coding 热重载（**Windows only**，详见 build 模块）             | dispatch → `executeLiveCoding(…, true)`                 |
| `ue_generate_compile_commands` | 生成 `compile_commands.json`（Windows / UBT 链路）                 | dispatch → `executeGenerateCompileCommands(…, true)`    |
| `ue_show_project_info`         | 显示当前检测到的项目 / 引擎信息                                     | dispatch → `showProjectInfo(…, true)`                   |
| `ue_set_system_includes`       | **Windows only** —— 把 MSVC + Windows SDK + C++ 标准写到 `.clangd` | dispatch → `executeSetSystemIncludes(…, silent=true)`   |
| `ue_status`                    | 返回项目 / 引擎 / 当前构建配置 + UE 版本能力矩阵                   | **同步**读进程内 detection / workspace / config         |

> **同步 vs fire-and-forget**：只有 `ue_get_build_errors` 与 `ue_status` 是同步返回
> （数据全部来自进程内已注入的 state，不等子进程）；其余 8 个是 fire-and-forget ——
> 立即返回 `{ ok: true, dispatched }`，真实结果看日志或后续读快照。

> `ue_set_system_includes` 沿用命令版本的 Windows-only 短路；非 Windows 主机即使 host 误激活也会触发工具内部的 i18n 友好提示并返回，不污染 `.clangd`。
>
> **`ue_toggle_completion_mode` 已删除**（Phase 11 SSoT 包 4）：fast/slow 切换早已合并为统一 slow rewrite（见 `src/clangd/AGENTS.md`），不要在 MCP 重新引入该工具。

## dispatch 行为（callTool）

- **同步签名** `(name, args) => string`：MCP request handler 立即拿到 fire-and-forget 收据；真实进度经 Logger 流到 OutputChannel + Problems 面板（命令层已有处理）。
- **`silent = true` 短路**：MCP 调用走 `executeXxx(..., silent=true)` 路径，跳过 auto-pick / picker，避免阻塞 AI Agent。
- **统一使用 SSoT**：所有工具通过 `@core/workspace` 拿 `selectedProject` / `selectedEngine`、通过 `@clangd/clangdOps` 写 `.clangd` —— 满足宪法 §II。

## 响应构造（[D17]）

`tools.ts` 只有一个响应出口 `makeResult(payload)`：

- 载荷形状（`ok` / `dispatched` / `hasResult` / `build`）**保持不变** —— 契约 openapi.yaml 已定义 `required`，不做破坏性重构；
- `isError` 由 `ok === false` 统一推导，**不再逐分支手写**；
- 失败载荷额外带 `isError: true`（契约 `components.schemas.MCPFailure`）。

对外两个入口：

| 函数 | 返回 | 用途 |
|---|---|---|
| `callTool(name, args)` | `string` | 载荷 JSON 文本（旧签名，测试与外部调用方兼容） |
| `callToolResult(name, args)` | `{ text, isError }` | MCP server 用；`isError` 会被映射到 MCP 协议的 `CallToolResult.isError` |

`server.ts` 的响应形状：`{ content: [{ type: 'text', text }], isError?: true }`。
成功时**不出现** `isError` 字段。

## 构建快照的早退收口（[D8]）

`ue_get_build_errors` 读的是进程内 `lastBuild` 快照（`src/build/lastBuild.ts`）。两条硬约束：

1. **每次构建尝试都产生 `buildId`**（UUID）+ `startedAtIso`；构建命令的**每一个**早退分支（没选到项目 / 没选到引擎 / 并发守卫 / 用户取消 / 转发 Live Coding）都补写一条失败快照 —— 否则 agent 读到的是上一次成功构建的旧结果，会误判「这次编译通过了」。
2. **构建进行中不回旧快照**：`getInProgressBuildId()` 非空时返回 `hasResult: false` + `reason: 'build-in-progress'`，agent 应轮询等待。

`dispatch` 对 **resolve 出来的错误信封**也记日志（不只 catch rejection）—— 命令层早退失败在旧实现里完全静默。

## stdout 洁净性（[D7]）

MCP stdio 传输把 JSON-RPC 帧写到 `process.stdout`，而 `logger.info` → `console.log` 也写 stdout —— 任何一行日志都会插进帧流。

- `Logger.setConsoleEnabled(false)` 三路（info / warn / error）统一关闭 console 输出，日志只进 OutputChannel；
- `activateMCP` 在构造 `MCPServer` **之前**关闭，dispose / 启动失败时恢复。

## 已知限制（务必如实标注）

MCP server 当前跑在 **VS Code 扩展宿主进程内**，其 stdin/stdout 不是 MCP 客户端的管道 —— **外部客户端（Cursor / Claude Code）当前无法直连**。`useMCP: "auto"` 只表示「检测到宿主且不污染 stdout」，**不代表端到端可用**。独立进程化列为后续事项，前置条件是解耦 `detection` / `commands` 层的 vscode 运行时依赖。

## 资源清理与生命周期

- MCP 生命周期由激活入口与宿主进程共同拥有；新增 transport / handler / timer 必须有显式清理路径并接入扩展生命周期（满足宪法 §III lifecycle ownership）。
- 所有日志使用 `[mcp]` 前缀；i18n 双语 key 走 `t('mcp.xxx', params)`（满足宪法 §III 的 bilingual UX / observable logs）。

## 测试现状

`test/unit/mcp/tools.test.ts` 覆盖 10 个工具的 schema、context 未注入错误、未知工具与真实 `executeXxx(..., silent=true)` dispatch；`test/unit/mcp/tools.envelope.test.ts` 钉住响应形状与 `isError`（[D17]）；`test/unit/mcp/server.test.ts` 钉住 MCP 层的 `isError` 映射（[D17]）；`test/unit/mcp/index.test.ts` 钉住 MCP 激活期的 stdout 洁净性（[D7]）。宿主级 e2e 仍需在 Cursor / Claude Code 中手动验证。

## 新增 MCP 工具的步骤

1. `src/mcp/tools.ts`：在 `MCP_TOOLS` 增加 `{ name, description, inputSchema }`，并在 `callTool` 添加 dispatch 分支。
2. `src/commands/<name>.ts`：导出 `executeXxx(..., silent?: boolean)`，silent 路径跳过 UI 交互。
3. `src/commands/index.ts`：用 `track` 注册 `vscodeUEHelper.<name>` 命令。
4. `package.json`：`contributes.commands` 增加命令定义（保持与命令面板一致）。
5. i18n：在 `src/i18n/locales/{en,zh}.json` 增加 description / 用户可见字符串（**双语同步**）。

修改 MCP 之前请把 constitution §II/§V 看一遍：MCP 是 command 的 thin dispatcher，**禁止**在 MCP 层重新实现业务逻辑。
