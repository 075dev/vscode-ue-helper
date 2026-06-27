# mcp 模块文档

## 基本信息
- **路径**: `src/mcp/`
- **文件数**: 4
- **语言**: TypeScript
- **职责**: Model Context Protocol 服务器——让 AI agent (Cursor / Claude Code) 能通过标准协议调用 UE 构建/clangd 功能。

## 符号表

### 导出函数

| 函数名 | 文件:行号 | 签名 | 说明 |
|--------|----------|------|------|
| startMcpServer | `src/mcp/server.ts` | 启动 MCP 协议服务端 | 注册 tools/resources |
| detectHost | `src/mcp/lifecycle.ts` | 检测 AI 宿主环境 | 判断 Cursor / Claude Code / 其他 |
| lifecycle | `src/mcp/lifecycle.ts` | MCP 生命周期管理 | start/stop/restart |

### MCP Tools 定义

| Tool | 文件:行号 | 对应的命令 | 说明 |
|------|----------|-----------|------|
| `ue_build` | `src/mcp/tools.ts` | `vscodeUEHelper.build` | UBT 编译 |
| `ue_rebuild` | `src/mcp/tools.ts` | `vscodeUEHelper.rebuild` | 重新构建 |
| `ue_live_coding` | `src/mcp/tools.ts` | `vscodeUEHelper.liveCoding` | Live Coding |
| `ue_get_project_info` | `src/mcp/tools.ts` | `vscodeUEHelper.showProjectInfo` | 项目信息 |

## 运行模式

| 模式 | 配置值 | 行为 |
|------|--------|------|
| auto | `"auto"` (默认) | 仅在 Cursor/Claude Code 中启用 |
| always | `"always"` | 始终启动 MCP 服务器 |
| never | `"never"` | 不启动 |

## 依赖

| 依赖 | 用途 |
|------|------|
| @modelcontextprotocol/sdk ^1.0 | MCP 协议实现 |
| @detection | 获取项目/引擎信息 |
| @build | 执行构建命令 |
| @clangd | clangd 状态查询 |
| xstate ^5.9 | MCP 服务器状态机 |
| neverthrow ^6.1 | Result 类型错误处理 |

## 被依赖情况

- `extension.ts` — 不直接激活（按需启动，通过 MCP 协议自动发现）
- 不被其他模块直接导入——mcp 是独立子进程，通过 stdio/HTTP 通信
