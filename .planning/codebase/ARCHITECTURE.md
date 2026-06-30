---
date: 2026-06-30
generator: gsd-map-codebase (orchestrator fallback)
focus: arch — architecture
---

# Architecture — vscode-ue-helper

## One-line summary

一个分层四块架构：`commands/`（人机交互面板）→ `core/`（配置、日志、命令注册中心）→ `domains/`（build / clangd / detection / i18n / mcp / parsers / platform / rules / ui 按职责划分的子系统）→ `infra`（被外部进程和资源文件支撑）。

## Pattern

整体走的是 **VS Code Extension Controller Pattern + Service Locator** 的混合：
- `extension.ts` 是 Composition Root，集中 wire-up
- `core/command-registry.ts` 是命令注册中心：所有命令走统一注册流程（参见 `AGENTS.md` 中的命令命名 / i18n / 错误处理约定）
- `core/config.ts` 通过 `vscode.workspace.getConfiguration('vscodeUEHelper')` 暴露强类型配置 + `onDidChangeConfiguration` 监听
- `core/logger.ts` 提供分级 logger（与 `vscodeUEHelper.lspLoggingLevel` 联动）
- 各 domain 子模块对外暴露纯函数 / 类，由 commands 调用，不互相直接依赖

## Layers

### 1. Entry（入口）

- `src/extension.ts` — `activate(context)` 是 VS Code 触发的统一入口
- 被 `out/extension.js` 通过 esbuild 打包（见 `package.json` `main`）
- 触发条件（任一）：
  - 打开工作区含 `**/*.uproject`（典型路径）
  - 通过命令 `vscodeUEHelper.{build,liveCoding,showProjectInfo,diagnoseProject,...}` 前置激活

### 2. Commands Layer（人机交互）

`src/commands/*.ts`，每个命令一个文件 + 同一目录下挂 `AGENTS.md` 写协作约定：
- `build.ts` → 调用 `build/buildRunner.ts`
- `liveCoding.ts` → 调用 `build/liveCoding.ts`
- `generateCompileCommands.ts` → 调用 `clangd/compileCommands.ts`
- `diagnoseProject.ts` → `commands/` + `clangd/diagnoseProject.ts`
- `createProject.ts` / `regenerateWorkspace.ts` / `openWorkspaceFile.ts` → 文件层
- `installRules.ts` → `rules/cursorRules.ts`
- `enableClangdProxy.ts` / `disableClangdProxy.ts` / `showClangdProxyStatus.ts` → `clangd/proxyManager.ts`
- `selectConfig.ts` / `selectTarget.ts` → 状态选择 quickPick
- `setSystemIncludes.ts` → `clangd/windowsSdk.ts`
- `toggleCompletionMode.ts` → `clangd/completionMode.ts`
- `launchEditor.ts` / `uninstall.ts` / `showProjectInfo.ts`

注册方式：通过 `core/command-registry.ts` 注册到 `vscode.commands.registerCommand`，附带 `CoreServices`（Logger + Config + OutputChannel）的注入。

### 3. Domain Layer（领域逻辑）

```
src/
├── build/        ← UBT / Editor / Live Coding
│   ├── buildRunner.ts      （高层构建入口，向 TaskProvider 提交）
│   ├── ubt.ts              （UBT 路径解析 + 参数拼装）
│   ├── launchEditor.ts     （启动 UnrealEditor）
│   ├── liveCoding.ts       （IPC 触发 Live Coding）
│   ├── taskProvider.ts     （vscode TaskProvider 暴露 build/rebuild/clean）
│   └── types.ts
│
├── clangd/       ← clangd 集成（核心）
│   ├── proxy/             ← 自研 LSP 代理子进程
│   │   ├── bridge.ts        （LSP JSON-RPC 协议解析）
│   │   ├── processBridge.ts （stdin/stdout → 真实 clangd）
│   │   ├── framing.ts       （Content-Length 帧协议）
│   │   ├── messages.ts      （消息类型 / 工具函数）
│   │   ├── keepalive.ts     （didClose 后保留索引）
│   │   ├── localization.ts  （clangd 输出汉化）
│   │   ├── settingsManager.ts
│   │   ├── realClangdResolver.ts
│   │   ├── status.ts
│   │   ├── cliArgs.ts
│   │   ├── cliRuntime.ts
│   │   └── cli.ts            （CLI 入口 → out/clangdProxy.js）
│   ├── diagnostics/        ← 诊断输出格式化
│   │   ├── checks.ts
│   │   ├── format.ts
│   │   ├── io.ts
│   │   └── types.ts
│   ├── clangdConfig.ts      （.clangd 配置文件生成）
│   ├── compileCommands.ts   （compile_commands.json 生成）
│   ├── completionFiles.ts   （UE preparse 头文件清单）
│   ├── completionMode.ts    （fast / slow 切换）
│   ├── createRspMatchers.ts （problem matcher helper）
│   ├── diagnoseProject.ts   （项目诊断）
│   ├── index.ts / types.ts
│   ├── modifyRspFiles.ts
│   ├── preparseIncludes.ts
│   ├── proxyManager.ts      （代理启停 + 状态查询）
│   ├── ueClangdCompat.ts    （UE 与 clangd 兼容性处理）
│   ├── ueHelpers.ts
│   ├── ueMacroCompletionData.ts
│   ├── ueMacroCompletionProvider.ts
│   ├── ueMacroCompletions.ts
│   ├── windowsSdk.ts        （设置 -I 路径到 .clangd）
│   └── workspaceBackup.ts   （UBT 刷新前备份 .code-workspace）
│
├── detection/    ← 工程探测
│   ├── engineDiscovery.ts       （扫多 UE 安装根）
│   ├── engineLocator.ts         （旧实现，仍被引用）
│   ├── uprojectAssociation.ts   （.uproject ↔ workspace）
│   ├── uprojectScanner.ts       （全工作区扫描）
│   ├── vsBuildTools.ts          （寻找 VS Build Tools）
│   ├── workspaceContext.ts
│   ├── workspaceEngines.ts
│   ├── workspaceFolders.ts
│   └── types.ts / index.ts
│
├── i18n/         ← 国际化
│   ├── index.ts                （注册 + t() 实现）
│   └── locales/{en,zh}.json
│
├── mcp/          ← Model Context Protocol 服务器
│   ├── server.ts          （stdio MCP server，name=vscode-ue-helper, version=0.1.0）
│   ├── lifecycle.ts       （start/stop 生命周期）
│   ├── tools.ts           （暴露给 AI 代理的工具集）
│   └── index.ts
│
├── parsers/      ← 文本 / 数据解析
│   ├── linkerParser.ts    （linker 日志）
│   ├── msvcParser.ts      （MSVC 错误）
│   ├── ubtParser.ts       （UBT 输出）
│   └── uprojectParser.ts  （.uproject JSON5）
│
├── platform/     ← 平台分支（Win/Mac/Linux）
├── rules/        ← Cursor / Claude Code 规则安装
│   ├── cursorRules.ts
│   └── index.ts
└── ui/           ← VS Code 原生 UI 适配
    ├── notifications.ts
    ├── outputChannel.ts
    ├── problemsPanel.ts
    ├── quickPicks.ts
    └── statusBar.ts
```

### 4. Core Layer（共享基础）

- `src/core/command-registry.ts` — 命令注册中心，统一 dispose
- `src/core/config.ts` — 强类型配置封装
- `src/core/logger.ts` — 日志门面，按 `lspLoggingLevel` 分级

## Cross-cutting Concerns

### 1. Activation Lifecycle

1. 用户打开工作区（含 `.uproject`）→ VS Code 触发 `activate(context)`
2. `extension.ts` 顺序做：
   - 初始化 `Logger` → 写入 OutputChannel
   - 初始化 `Config` → 加载配置
   - 初始化 `CommandRegistry`
   - 调用 `detection` 模块推导 UE 工程上下文
   - 注册 `commands/*` 的所有 `vscode.commands.registerCommand`
   - 启动 `mcp/server.ts`（按 `useMCP` 决定）
   - 监听 `.uproject` / `.code-workspace`（chokidar）触发后续自动重写
3. `deactivate(context)` 反向 dispose

### 2. Command-to-Handler Flow

```
QuickPick / CommandPalette
   ↓
context.subscriptions.push(vscode.commands.registerCommand(NAME, handler))
   ↓ (commands/*.ts)
handler 调 core service → domain module → 返回 Promise<T>
   ↓ 错误处理
core/logger.ts 输出 → ui/notifications.ts 弹窗（可选）
```

### 3. MCP ↔ Internal Commands

MCP 不会直接调命令，而是：
1. `mcp/server.ts` 用 `StdioServerTransport` 暴露 `tools/list` 与 `tools/call`
2. `tools/call` 实际委派给 `commands/*` 或 `build/*` 的纯函数（避免循环依赖）

### 4. Clangd Proxy Flow

```
clangd extension (vscode-clangd)
   ↓ 启动 via .clangd 里的 path
Windows: out/launcher/proxy-launcher.bat
Unix:    out/launcher/proxy-launcher.sh
   ↓ exec node
out/clangdProxy.js (esbuild bundle, 无 vscode 依赖)
   ↓ JSON-RPC over stdin/stdout
src/clangd/proxy/bridge.ts   ←─  监听来自 clangd ext 的 LSP 请求
   ↓
src/clangd/proxy/processBridge.ts  ←─ 把请求转发到真实 clangd
   ↓
src/clangd/proxy/keepalive.ts      ←─ didClose 缓存最近 20 个 doc
src/clangd/proxy/localization.ts   ←─ 中文输出追加 / 覆盖
```

代理可被 `enableClangdProxy` 命令写到工作区 `.clangd`，并注入 `clangd.useScriptAsExecutable=true` 到 clangd 扩展设置。

### 5. Detection ↔ Build Interaction

1. `detection/engineDiscovery.ts` → 解析可能的 UE 安装根（遍历注册表 / WinGet / Steam / Epic Launcher）
2. `detection/workspaceContext.ts` → 维护"当前 .uproject 对应的 UE 路径 + 目标 + 平台"
3. `commands/{selectConfig, selectTarget}.ts` → 调出 QuickPick 修改上述 context
4. `build/ubt.ts` → 拿到 context 后拼接命令行参数交给 execa

### 6. State Machines（xstate）

`xstate ^5.9.0` 主要用于：
- 代理进程生命周期（disabled → enabling → enabled → disabling → disabled + error 状态）
- UBT 任务队列（idle → building → streaming → done | failed）

（注：实际 import 范围可能在 CONCERNS 中列出，未声明的部分应删除以减小 bundle。）

### 7. Error Boundary

- 所有命令通过 `Result<T, E>` 模式（基于 `neverthrow`）或不抛异常的异步链
- `core/logger.ts` 在所有未捕获错误时写日志 + 弹 `vscode.window.showErrorMessage`
- 错误码约定：`UE-HELPER-{DOMAIN}-{NUMBER}`，例如 `UE-HELPER-BUILD-001`

## Entry Points

| 入口 | 文件 | 编译产物 |
|---|---|---|
| VS Code 扩展 | `src/extension.ts` | `out/extension.js` |
| 独立 LSP 代理 | `src/clangd/proxy/cli.ts` | `out/clangdProxy.js` |
| Windows launcher | （生成自 esbuild） | `out/launcher/proxy-launcher.bat` |
| Unix launcher | （生成自 esbuild） | `out/launcher/proxy-launcher.sh` |

## Dependency Direction

```
extension.ts
   ├─→ commands/*
   │      └─→ core/*
   │      └─→ build/* clangd/* detection/* parsers/* rules/* ui/*
   ├─→ mcp/server.ts
   │      └─→ commands/* (via tools/call)
   └─→ core/* (Logger + Config)
```

- i18n/parsers/platform 任何一个模块都可被任意层引用
- clangd/proxy/* 是独立 CLI，不能依赖 vscode 模块
- mcp/server.ts 依赖 `@modelcontextprotocol/sdk`，但不依赖 `vscode`

## Abstractions Worth Noting

- **CoreServices 容器** —— 通过 `CommandRegistry.register(name, deps, handler)` 注入 Logger/Config/OutputChannel
- **Command 模式 + Async 微任务** —— 所有命令都返回 `Promise`，错误统一转化为 Result 或 log
- **Proxy pattern for clangd** —— 在 clangd 扩展和真实 clangd 之间插入透明代理
- **i18n t() 函数** —— 包装 `vscode.l10n.t`（部分场景回退到 `vscode.l10n` 的 `bundle` 机制）
- **Parser Strategy** —— 每种工具链输出（UBT/MSVC/linker）一个 Parser，统一暴露 `parseLine(line): Diagnostic | null`
