---
date: 2026-06-30
generator: gsd-map-codebase (orchestrator fallback)
focus: tech — external integrations
---

# Integrations — vscode-ue-helper

本扩展是一层"胶水"：把 VS Code、clangd、Unreal Build Tool、Live Coding、MCP 宿主（Cursor / Claude Code）这些独立系统粘合成一条开发闭环。下面是每个外部边界的清单。

## 1. Unreal Build Tool (UBT)

**触达方式**：`execa` 子进程（`src/build/ubt.ts` / `src/build/buildRunner.ts` / `src/build/taskProvider.ts`）。

UE 的构建工具是一个独立的可执行文件：
- Windows：`Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe`（或 `BuildTool.exe` 在 5.7+）
- macOS / Linux：`UnrealBuildTool` / `BuildTool`

支持版本：默认 5.4，可由用户在 `vscodeUEHelper.ueVersion` 中指定。

调用形式（典型）：
```
<UE>/Engine/Build/BatchFiles/{RunUBT,RunMono,RunUAT}/{platform}/Build.sh|.bat \
  <Target> <Platform> <Config> -Project=<abs.uproject> -waitmutex
```

集成细节：
- 调用前会先用 `src/detection/engineLocator.ts` 自动扫描常见 UE 安装目录
- 通过 `src/parsers/ubtParser.ts` 解析 stdout（错误码、warnings、参考资料链接），把诊断推到 VS Code Problems 面板（`ue-helper-msvc` problem matcher，详见 `package.json`）
- `src/parsers/msvcParser.ts` 在 MSVC 编译器层补刀，处理 `/W...` 噪音

## 2. Unreal Editor (`UE4Editor` / `UnrealEditor`)

- 命令：`vscodeUEHelper.launchEditor` → `src/build/launchEditor.ts`
- Win / Mac / Linux 各自不同路径
- 集成方式：spawn + `execa`，可带 `-project=<abs.uproject>` / `-game` 等参数
- **前置条件**：构建成功（否则编辑器启动后报错）

## 3. Live Coding（UE 5.0+ 热重载）

- 命令：`vscodeUEHelper.liveCoding`
- Windows-only（菜单 `when: "isWindows"`），实现 `src/build/liveCoding.ts`
- 通过命名管道 / Win32 IPC 与已运行的 UE 进程通信，触发 "Live Coding" 模块重新编译
- 集成前提：UE 5.0+ 且启用了 "Live Coding" 设置；UE 进程必须已经在运行

## 4. clangd LSP

两层交互：

### 4a. 直连 clangd 路径（默认）

- 扩展激活后给 VS Code（clangd 扩展）准备 `compile_commands.json`
  - 命令：`vscodeUEHelper.generateCompileCommands` → `src/clangd/compileCommands.ts`
  - 来源：UE 的 `-mode=GenerateClangDatabase` 或者 `-ExportSymbols` 调 UBT
- `.clangd` 配置文件注入（`src/clangd/clangdConfig.ts`）：
  - `IndexBackground: Build`
  - `Diagnostics:
Pull: true
Suppress: Unused Includes: true`
- `vscode-clangd` 扩展的 `clangd.path` 指到 `out/launcher/proxy-launcher.bat|sh`（仅当启用代理时）

### 4b. 自研 clangd LSP 代理（可选）

入口：`src/clangd/proxy/cli.ts` → 编译产物 `out/clangdProxy.js`（独立 Node 进程，不依赖 vscode 模块）。

子模块（详见 `src/clangd/proxy/`）：
- `bridge.ts` — JSON-RPC 帧处理（LSP headers + Content-Length）
- `processBridge.ts` — 与真实 clangd 进程的 stdin/stdout 桥接
- `keepalive.ts` — `didClose` 后保留最近 N（默认 20）个文档以维持预解析/索引
- `localization.ts` — clangd 输出汉化（`append` / `override` 模式）
- `realClangdResolver.ts` — 解析真实 clangd 路径（设置 → which → PATH → 系统默认）
- `settingsManager.ts` — 读取 `vscodeUEHelper.clangdProxy.*` 配置
- `cliArgs.ts` / `cliRuntime.ts` — CLI 参数解析 + 启动入口
- `messages.ts` — JSON-RPC 消息类型
- `status.ts` — 状态查询
- `framing.ts` — LSP 帧协议

联动命令：`enableClangdProxy` / `disableClangdProxy` / `showClangdProxyStatus`（`src/commands/{enable,disable,showClangdProxyStatus}.ts`、`src/clangd/proxyManager.ts`）。

启用流程：写一个 `.clangd` 到工作区，把 `clangd.path` / `clangd.useScriptAsExecutable` 注入到 clangd 扩展设置。

## 5. UE 宏补全数据

`src/clangd/ueMacroCompletionData.ts` + `src/clangd/ueMacroCompletions.ts` + `src/clangd/ueMacroCompletionProvider.ts`：
- 基于 `resources/preparse-includes/ue5-fast.json` 与 `ue5-slow.json` 提供 UE 常用宏（`UCLASS` / `UPROPERTY` / `UFUNCTION` …）补全
- 两档：fast（精选头）/ slow（几乎全量）；用户通过 `vscodeUEHelper.completionMode` 切换

## 6. MCP (Model Context Protocol) Server

`src/mcp/server.ts` + `src/mcp/tools.ts` + `src/mcp/lifecycle.ts` + `src/mcp/index.ts`：
- 用 `@modelcontextprotocol/sdk` 实现 stdio MCP 服务器（`name: "vscode-ue-helper"`，`version: "0.1.0"`）
- 暴露 build / launch / live-coding / diagnose-project 等工具给外部 AI 代理（Cursor、Claude Code）
- 传输：`StdioServerTransport`
- 模式：用户配置 `vscodeUEHelper.useMCP`（`auto` = 仅在 Cursor/Claude Code 中启用）

MCP 客户端使用方：用户在 Cursor / Claude Code 的 mcp 配置中加入此扩展的 stdio 入口，AI 代理即可调用 UE 操作。

## 7. Windows SDK / MSVC 集成

- `vscodeUEHelper.setSystemIncludes` → `src/clangd/windowsSdk.ts`
- 自动注入 `/I` 包含路径到 `.clangd`
- `vscodeUEHelper.setSystemIncludes` 仅 `isWindows`

## 8. 工程扫描：`.uproject`

- `src/detection/uprojectScanner.ts` 扫描工作目录（含子目录）寻找所有 `.uproject`
- `src/detection/uprojectAssociation.ts` 把 `.uproject` 与当前 workspace 关联
- `src/detection/workspaceContext.ts` 维护一套"工程上下文"对象
- `src/detection/workspaceEngines.ts` + `engineLocator.ts` / `engineDiscovery.ts` 推断该用哪个 UE 版本
- `src/parsers/uprojectParser.ts` 用 `json5` 解析 `.uproject`（UE 自己的 JSON5 风格）

## 9. .code-workspace 文件管理

- `vscodeUEHelper.regenerateWorkspace` 根据 `.uproject` 重新生成 workspace 文件（含 src / content / plugins 等文件夹）
- `vscodeUEHelper.openWorkspaceFile` 打开 `.code-workspace`
- `src/clangd/workspaceBackup.ts` 自动备份 / 恢复（防 UBT 误删）
- 默认配置 `vscodeUEHelper.autoBackupWorkspace: true`

## 10. AI Agent 规则安装

- `vscodeUEHelper.installRules` → `src/rules/cursorRules.ts` + `src/rules/index.ts`
- 为 Cursor / Claude Code 安装针对 UE C++ 开发的编码规则文件（如 `.cursorrules` / `AGENTS.md`）
- 卸载命令：`vscodeUEHelper.uninstall`

## 11. 诊断 / 检测

- `vscodeUEHelper.diagnoseProject` → `src/commands/diagnoseProject.ts` + `src/clangd/diagnoseProject.ts`
- `src/clangd/diagnostics/{checks,format,io,types}.ts`：诊断报告的渲染 / 输出 / 类型定义

## 12. 文件监听

- `chokidar` 监听三类关键文件：`.uproject` / `.code-workspace` / `.clangd` / `compile_commands.json`
- 一旦变更，自动触发对应命令（如重生成 workspace、重写 helper 文件）

## 13. cross-platform 路径处理

`src/platform/` 子目录中存在平台相关分支（Win / Mac / Linux）。具体文件列表见 `STRUCTURE.md` §目录布局。

## 不在范围内（重要！）

- **没有 GUI 嵌入式窗口**：所有 UI 走 VS Code 原生 API（QuickPick、Output Channel、StatusBar、Problems、Notifications）
- **不直连 UE Editor 进程 API**：与 Live Coding 走进程间管道而非内嵌通信
