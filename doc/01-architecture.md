# 01 — 整体架构

> 适用版本：0.1.0+（Phase 8 架构）

## 项目定位

VSCodeUEHelper 是 VS Code 扩展，给 Unreal Engine 5.2+ C++ 开发用：

- UBT 构建 / 重建 / 清理（Task Provider，Ctrl+Shift+B）
- Live Coding 热重载（仅 Windows）
- clangd 智能提示（compile_commands.json + `.clangd` + 自定义 Add flags）
- 可选 MCP AI Agent 集成（Cursor / Claude Code 自动启用）
- 状态栏 + 控制面板 Webview + QuickPick + Problems 面板

代码融合自两个上游项目（避免版本耦合，全部重写）：

- `rmoubayed/engine-link`（v3）：UBT 流水线、Live Coding、引擎发现、MCP 集成
- `boocs/unreal-clangd`（v3）：clangd 配置、compile_commands.json 维护、preparse-includes

## 双 bundle 设计（关键）

`esbuild.config.mjs` 同时构建两个产物：

| 产物 | 用途 | 依赖 |
|---|---|---|
| `out/extension.js` | 主扩展，VS Code 加载 | `vscode` 标 external，由运行时提供 |
| `out/clangdProxy.js` | clangd LSP 代理 CLI，独立子进程 | 不依赖 `vscode`，纯 Node |

构建时还会生成两个 launcher 脚本：

- `out/launcher/proxy-launcher.bat`（Windows）
- `out/launcher/proxy-launcher.sh`（Unix，chmod 755，Windows 上失败被吞掉）

启用代理的方式：把 `clangd.path` 指向 launcher 脚本，配合 `clangd.useScriptAsExecutable=true`。

## 入口与激活顺序（硬约束）

`src/extension.ts` 是唯一入口，模块按以下顺序串联：

```
1. initI18n()                  ← 必须最先（Logger 内部可能用翻译）
2. new Logger('VSCodeUEHelper')
3. new Config()                ← 强类型封装 vscodeUEHelper.* 命名空间
4. activateDetection(...)      ← 返回 DetectionHandles + ready Promise
5. new WorkspaceState(...)     ← [Phase 8] 项目/引擎/路径单一真相源
6. new ClangdOps(...)          ← [Phase 8] .clangd 统一 API
7. activateBuild(...)          ← UBT Task Provider
8. activateClangd(...)         ← 状态栏 / 备份 / completion mode / 代理
9. activateUI(...)             ← 11 个状态栏按钮，await detection.ready
10. activateCommands(...)      ← 20 个命令（依赖全部 handles）
11. ControlPanelProvider.register(...)
12. runFirstTimeInit(...)      ← fire-and-forget，首次使用弹 Initialize
```

**为什么这个顺序是硬约束**：

- `initI18n` 必须早于 `Logger` —— Logger 日志走 `t()` 翻译。
- `WorkspaceState` 必须早于 `ClangdOps` —— 后者通过前者派生路径。
- `activateUI` 在 `activateCommands` 之前 —— 命令回调里要 await UI 状态。
- `runFirstTimeInit` 必须是 fire-and-forget —— 它内部 await detection.ready，不应阻塞激活主流程。

## `.code-workspace` 检测模型（核心设计）

**不扫文件系统，完全信任 `.code-workspace` 的 `folders[]`**。

UE 项目通常几十 GB、几千个 `.cpp` 文件，递归扫描会卡顿；workspace 配置是用户的显式意图。

`folders[]` 规则（硬规则，**用户不允许自定义**）：

| `path` | `name` | role |
|---|---|---|
| `.` | 任意 | `project` |
| 绝对路径 | `UE5` | `engine` |
| 其他 | 任意 | `unknown` |

只有单文件夹打开（无 `.code-workspace` 文件）时，detection 返回空结果，UI 显示警告。

## Phase 8 单一真相源：WorkspaceState

`src/core/workspace.ts` 是项目/引擎/路径的**单一真相源**，分 4 层：

| 层 | 字段 | 来源 |
|---|---|---|
| Level 0 根源 | `workspaceFile` / `workspaceFolders` / `projectFolder` / `engineFolder` / `project` / `engine` | detection 注入 |
| Level 1 派生路径 | `workspaceRoot` / `projectDir` / `projectFile` / `projectName` / `engineRoot` / `engineVersion` | 从 Level 0 派生 |
| Level 2 .clangd | `clangdConfigPath` / `clangdHelperDir` / `compileCommandsDir` / `compileCommandsPath` | 从 Level 1 派生 |
| Level 3 补全文件 | `macroHelperPath` / `ueClangdCompatPath` / `addCompletionsPath` / `addMacroCompletionsPath` / `completionHelperPath` / `defaultCompletionsPath` | 从 Level 2 派生 |

**关键约束**：

1. 调用方**不允许自己拼接路径** —— 必须通过 getter 拿。`src/clangd/clangdOps.ts` 是唯一允许派生路径的层。
2. 根源信息缺失时 getter 自动弹错（去重，整 session 每字段只弹一次），文案统一为「从 .uproject 重新生成工作区」**无按钮**（按按钮还是要 `.code-workspace`，会死循环）。
3. 字段集固定 —— **不允许扩展**自定义派生规则（如 `buildVersionPath` 等硬编码路径拼接都不允许）。

## Phase 8 统一 API：ClangdOps

`src/clangd/clangdOps.ts` 把所有 `.clangd` 读写收束到 4 个核心 API：

| 方法 | 用途 |
|---|---|
| `readConfig()` | 读取 + YAML 解析 |
| `exists()` | 检查 `.clangd` 存在性 |
| `writeFull(opts)` | 全量重写（用 `defaultClangdConfig` 重建） |
| `mutate(closre)` | 事务性 read-modify-write（读 yaml → 应用 mutator → 原子写回） |

**为什么收束到这个最小集**：之前细粒度 setter（`setAddFlag` / `removeAddFlag` / `replaceAddBlock` 等）只是 `mutate` 闭包的固化，对调用方没价值 —— 只增加 API 表面，难扩展，难组合。

**原子写入**：`temp + rename`（per PATTERNS §3 第 280-285 行），防止半写状态被 clangd 读到。

**`applyAddFlags(flags)`**：Add 操作的统一入口，把 `.clangd` 的 `CompileFlags.Add` **整体替换**为给定数组（不做过滤/合并的脆弱拼接）。

**迁移状态**：Phase 8 仍在迁移中，老模块（`writeClangdConfig` / `findClangdConfig` 等）保留兼容。

## 双 esbuild 之间的耦合

主扩展和代理 CLI 共享同一份 `tsconfig.json` 路径别名（`@core/*` / `@clangd/*` 等），但代理 CLI **不依赖 `vscode`**。这意味着：

- 代理侧代码只能用 `node:*` API
- 代理侧代码不能调 `vscode.window.*` —— 它的「日志」通过 stderr 或 `--log-path` 指定的文件
- 代理侧代码 stdout 留给 LSP 协议通道

扩展侧通过 `clangd.path = <path-to-proxy-launcher>` + `clangd.useScriptAsExecutable=true` 触发，launcher 接收代理 CLI 参数 + `--` 分隔符后的真实 clangd 参数。

## MCP 生命周期

`src/mcp/lifecycle.ts` 用环境变量判断宿主：

| 环境变量 | 宿主 |
|---|---|
| `CURSOR_TRACE_ID` 或 `CURSOR_USER_DATA_DIR` | Cursor |
| `CLAUDE_CODE_ENTRYPOINT` 或 `CLAUDE_CODE_SSE_PORT` | Claude Code |
| 其他 | 普通 VS Code（MCP no-op） |

`useMCP` 设置 `auto` / `always` / `never` 决定是否启动：
- `auto`：仅在 Cursor / Claude Code 中启动
- `always`：总是启动
- `never`：不启动

普通 VS Code 用户**永远不会**看到 MCP 工具 —— 这是设计选择，不是 bug。

## 数据流总览

```
.code-workspace ──┐
                  ▼
        DetectionHandles ──ready Promise──► WorkspaceState ──► ClangdOps ──► .clangd
                  │                              │
                  │                              ▼
                  │                       ClangdProxyManager ──► clangdProxy.js
                  │
                  ▼
            UI (StatusBar / ControlPanel)
                  │
                  ▼
            Commands (20 个) ──► BuildRunner / ClangdGenerator / ClangdProxyManager / ...
```

并行：

```
MCP Server ──► tools.ts (6 个工具) ──► executeXxx 函数（同 commands）
```

## 模块依赖（编译期 import 方向）

```
extension.ts
  ├── core         (无依赖)
  ├── detection    → core
  ├── build        → core, detection, parsers
  ├── clangd       → core, detection
  │   └── proxy    → core（但外部不依赖 vscode）
  ├── ui           → core, detection
  ├── commands     → core, detection, build, clangd, ui, parsers, i18n
  ├── mcp          → core, build, clangd, commands
  ├── rules        (无依赖)
  └── i18n         (无依赖)
```

`commands` 和 `mcp` 是汇聚点 —— 它们**可以**依赖所有下层模块（这是它们的设计职责：编排），但**任何其他模块不得依赖 `commands` 或 `mcp`**（防止循环）。

## 持久化

| 数据 | 存储位置 | API |
|---|---|---|
| `vscodeUEHelper.*` 配置 | VS Code settings.json（workspace scope） | `Config` getter/setter |
| 用户选择的 engine / project | `.code-workspace` 的 `settings.vscodeUEHelper.*` | `WorkspaceContext` |
| 首次初始化标记 | `.code-workspace` 的 `settings.vscodeUEHelper.initialized` | `firstRunInit.ts` 原子写 |
| 备份 `.code-workspace` | `.vscode/.code-workspace.backup`（gitignore） | `WorkspaceBackup` |
| UBT 解析缓存 / 编译数据库 | `.vscode/vscodeuehelper/`（gitignore） | `compileCommands*` |

## 关键不变式（破坏会导致 bug）

1. **激活顺序**不可乱（见上）
2. **路径获取**必须走 `WorkspaceState` getter（不允许调用方 `path.join`）
3. **`Config.update` 写完必须 refresh** —— `src/core/config.ts` 内部已处理，但调用方常见误用：`await config.update(); 立刻读 config.xxx` 会拿到旧值
4. **MSVC 错误正则**在 `package.json#contributes.problemMatchers` 和 `src/parsers/msvcParser.ts` **两处定义**，必须同步
5. **所有 VS Code 资源**（命令、状态栏、Watcher、DiagnosticCollection）必须 push 到 `context.subscriptions`
6. **新增命令 4 步**：`package.json` 定义 → `commands/xxx.ts` 实现 → `commands/index.ts` 注册 → i18n 双语 key