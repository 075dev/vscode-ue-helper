# 架构总览

> 基于 `src/extension.ts:1-143` 和 `doc/01-architecture.md` 整理

## 1. 激活流程

```
VS Code 激活插件
       │
       ▼
extension.ts:activate()                              [src/extension.ts:56]
       │
       ├─ initI18n()                                 [src/i18n/index.ts] — 最先调用
       ├─ new Logger('VSCodeUEHelper')               [src/core/logger.ts]
       ├─ new Config()                               [src/core/config.ts]
       ├─ activateDetection()                        [src/detection/index.ts]
       │     └─ detection.ready (Promise<DetectionResult>)
       ├─ activateBuild(detection)                   [src/build/index.ts]
       ├─ activateClangd(detection)                  [src/clangd/index.ts]
       ├─ activateUI(detection)                      [src/ui/index.ts]
       │     └─ await detection.ready                ← 关键：避免竞态
       ├─ activateCommands(detection, clangd)        [src/commands/index.ts]
       └─ 首次激活：显示欢迎信息 → showProjectInfo
```

## 2. 模块依赖图

```
                 ┌─────────────────────────────────────┐
                 │           extension.ts              │  ← 入口、串联各模块
                 └──────────────┬──────────────────────┘
                                │
      ┌──────────┬──────────┬────┴────┬──────────┬──────────┐
      ▼          ▼          ▼         ▼          ▼          ▼
  ┌────────┐┌────────┐┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
  │  core  ││ i18n   ││detection│ │ build  │ │ clangd │ │   ui   │
  └───┬────┘└────────┘└───┬────┘ └───┬────┘ └───┬────┘ └────────┘
      │                   │          │          │
      │                   │          └──────────┤
      │                   │                     ▼
      │                   │              ┌──────────┐
      │                   │              │ commands │  ← 调用 detection/build/clangd
      │                   │              └─────┬────┘
      │                   │                    │
      └───────────────────┴────────────────────┴────→ 共用 Logger / Config / i18n
```

## 3. 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 框架 | VS Code Extension API ^1.85 | `vscode` 模块由宿主提供 |
| 语言 | TypeScript 5.3 (ES2022 / Node16) | `strict` 模式全开 |
| 构建 | esbuild 0.20 | bundle → `out/extension.js` (CJS) |
| 测试 | vitest 1.3 | 覆盖率阈值: lines 80%, branches 75% |
| 格式化 | Prettier 3.2 / ESLint 8.57 | 提交前自动检查 |
| 外部依赖 | @modelcontextprotocol/sdk, chokidar, execa, neverthrow, xstate | 详细见 [dependencies.md](dependencies.md) |

## 4. 关键设计决策

### 4.1 Promise 而非回调
`detection.ready` 是一个 Promise，UI 层 `await` 之后才渲染状态栏。避免"检测未完成，状态栏先显示空"的竞态。
> 溯源: [`src/extension.ts:22-25 (注释)`](src/extension.ts:22), [`src/ui/index.ts`](src/ui/index.ts)

### 4.2 完全信任 .code-workspace
不做文件系统扫描。`folders[0]` = 项目根目录，`folders[1]` = 引擎根目录。
> 溯源: [`doc/01-architecture.md:103-107`](doc/01-architecture.md:103), [`src/detection/index.ts:58-141`](src/detection/index.ts:58)

### 4.3 JSON5 解析 .uproject
UE 的 `.uproject` 允许注释、尾部逗号、单引号——严格 JSON 会失败，用 `json5` 库。
> 溯源: [`src/detection/uprojectScanner.ts`](src/detection/uprojectScanner.ts)

### 4.4 Detached spawn + taskkill
`.bat` 不能直接 spawn，须 `cmd.exe /c Build.bat`。杀进程用 `taskkill /F /T /PID` 杀整棵进程树。
> 溯源: [`doc/01-architecture.md:250-253`](doc/01-architecture.md:250), [`src/build/buildRunner.ts`](src/build/buildRunner.ts)

### 4.5 模块激活顺序强制
`extension.ts` 按固定顺序激活: i18n → Logger/Config → detection → build → clangd → ui → commands。顺序不能变——后续模块依赖前序模块。
> 溯源: [`src/extension.ts:13-19 (注释)`](src/extension.ts:13)

## 5. 配置系统

| 配置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `vscodeUEHelper.configuration` | enum | `Development` | Debug/DebugGame/Development/Shipping/Test |
| `vscodeUEHelper.target` | enum | `Editor` | Editor/Game/Server/Client |
| `vscodeUEHelper.platform` | enum | `Win64` | Win64/Mac/Linux |
| `vscodeUEHelper.completionMode` | enum | `fast` | fast(精选头文件)/slow(所有宏) |
| `vscodeUEHelper.autoBackupWorkspace` | bool | `true` | 自动备份 .code-workspace |
| `vscodeUEHelper.useMCP` | enum | `auto` | auto/always/never |
| `vscodeUEHelper.lspLoggingLevel` | enum | `info` | error/warn/info/debug |

## 6. 进程模型

| 模式 | 场景 | 实现 |
|------|------|------|
| Fire-and-forget | 启动 Unreal Editor | `spawn('cmd', ['/c', 'start', ...], {detached, stdio:'ignore'})` |
| Long-running + cancel | 跑 UBT | `spawn('cmd.exe', ['/c', 'Build.bat', ...])` + AbortSignal |

## 7. 项目溯源

> VSCodeUEHelper 是从两个开源参考项目融合而来的全新实现。代码从零编写以避免版本耦合，但核心设计模式、模块职责拆分、状态栏交互范式均继承自以下两个项目。

### 7.1 参考源概览

| 项目 | 作者 | 平台定位 | 许可 | 核心贡献领域 |
|---|---|---|---|---|
| **[engine-link](https://github.com/rmoubayed/engine-link)** | Rami Moubayed | Cursor IDE 扩展 | MIT | UBT 构建管线、Live Coding、MCP AI 集成、状态栏 UI |
| **[unreal-clangd](https://github.com/boocs/unreal-clangd)** | boocs | VS Code 扩展 | MIT | clangd IntelliSense、`compile_commands.json`、Windows SDK/MSVC 发现、工作区备份 |

### 7.2 engine-link 贡献分析

engine-link 的核心设计理念是 **"让 Cursor 成为 UE 开发的主编辑器"** —— 状态栏驱动、AI 优先。

**VSCodeUEHelper 继承的模式：**

| 模式 | engine-link 中的形态 | VSCodeUEHelper 中的落地 |
|---|---|---|
| **状态栏驱动交互** | 10 个状态栏按钮（Build / Rebuild / Clean / Config / Target / Platform / Live Coding / Launch / Project / Engine），所有操作从状态栏发起 | `src/ui/StatusBarManager.ts` —— 11 个按钮，与 engine-link 对齐的布局和优先级 |
| **MCP AI 集成** | 内置 MCP 服务器，在 Cursor 中自动启动，暴露 6 个工具给 AI agent | `src/mcp/` —— 同样 6 个工具（`ue_build`、`ue_launch_editor`、`ue_live_coding`、`ue_generate_compile_commands`、`ue_show_project_info`、`ue_toggle_completion_mode`），增加 `auto`/`always`/`never` 模式控制 |
| **Task Provider** | 注册 VS Code Task Provider，让 `Ctrl+Shift+B` 触发 UBT 构建 | `src/build/` —— `UbtTaskProvider` 实现 `vscode.TaskProvider` 接口 |
| **Fire-and-forget 进程** | `spawn('cmd', ['/c', 'start', ...], { detached: true })` 启动 Editor | `src/build/editorLauncher.ts` —— 相同模式，增加跨平台支持（Mac: `open`，Linux: 直接 spawn） |
| **引擎检测** | Windows 注册表 `HKLM\SOFTWARE\EpicGames\Unreal Engine\<version>` | `src/detection/engineDiscovery.ts` —— 扩展为跨平台（Mac: `~/Library/Application Support/Epic`，Linux: 多路径扫描 + `$UE_ROOT`） |
| **AI agent rules 生成** | 自动写 `.cursor/rules/*.mdc` | `src/rules/` —— 扩展到 Cursor + Copilot 双平台 |

**未被继承的设计决策：**
- engine-link 用 **C/C++ for Cursor** 作为语言服务器 → VSCodeUEHelper 直接依赖 **clangd 官方扩展**（`llvm-vs-code-extensions.vscode-clangd`），获得更好的 UE 宏支持和跨平台一致性
- engine-link 仅支持 Windows → VSCodeUEHelper 支持 Windows / Mac / Linux
- engine-link 状态栏按钮文本固定英文 → VSCodeUEHelper 内置 i18n（中/英）

### 7.3 unreal-clangd 贡献分析

unreal-clangd 的核心设计理念是 **"让 clangd 在 UE 项目中开箱即用"** —— 自动化所有配置、处理 UE 特有的编译器边缘情况。

**VSCodeUEHelper 继承的模式：**

| 模式 | unreal-clangd 中的形态 | VSCodeUEHelper 中的落地 |
|---|---|---|
| **compile_commands.json 生成** | 通过 UBT `-ProjectFiles` 模式生成 compile_commands.json，然后复制或符号链接到项目根目录 | `src/clangd/compileCommandsGenerator.ts` —— 相同流程，生成后通过 clangd 的 `--compile-commands-dir` 指向 |
| **preparse-includes 宏补全** | `addCompletions.h` + `addMacroCompletions.h`，用 `-include` 注入 clangd preamble，让 `UCLASS`/`UPROPERTY` 等宏被正确解析 | `src/clangd/preparseIncludes.ts` —— 两档模式：**Fast**（18 个精选 header，快速索引）/**Slow**（49 个全面 header），对应 unreal-clangd 中的快速/慢速补全 |
| **.clangd 配置管理** | 写 `.clangd` 文件抑制 MSVC 误报（`builtin-macro-redefinition`、`unknown-warning-option` 等），使用 managed block 标记 | `src/clangd/clangdConfigWriter.ts` —— 继承 managed block 模式（`# <<< vscodeuehelper-managed >>>` 标记），扩展到更多 suppress 项 |
| **工作区备份** | 备份 `.code-workspace` 到 `.vscode/unreal-clangd/.code-workspace.backup`，在 UBT refresh 后自动恢复 | `src/clangd/workspaceBackup.ts` —— 相同机制，备份路径改为 `.vscode/vscodeuehelper/` |
| **Windows SDK / MSVC 发现** | `vswhere.exe` 定位 VS 安装，从注册表读 Windows SDK 版本，写 `-imsvc` 标志 | `src/detection/vsDetector.ts` —— 继承 vswhere + Registry 双路径，增加 `unreal-clangd.setSystemIncludes` 等效命令 |
| **命令行快速切换** | 快速/慢速补全模式一键 toggle | `src/commands/toggleCompletionMode.ts` —— 完全对齐 |

**未被继承的设计决策：**
- unreal-clangd 的模块代码大量使用回调嵌套 → VSCodeUEHelper 全面使用 `async/await` + `Promise`
- unreal-clangd 的检测逻辑有不稳定的竞态（检测未完成就渲染 UI）→ VSCodeUEHelper 用 `DetectionHandles.ready` Promise 消除竞态（见 [§1 激活流程](#1-激活流程)）
- unreal-clangd 支持从 UE 5.2 起的多个引擎版本 → VSCodeUEHelper 目前聚焦 5.3+

### 7.4 融合架构决策

两个参考源在 VSCodeUEHelper 中的融合并非简单拼接，而是经过以下关键决策：

```
engine-link 的构建/UI/MCP 管线  +  unreal-clangd 的 clangd/补全/配置管线
               │                                    │
               └──────────────┬─────────────────────┘
                              ▼
              ┌───────────────────────────────┐
              │     VSCodeUEHelper 融合层      │
              │                               │
              │  · 统一的 DetectionHandles    │
              │  · 统一的 Config 配置系统      │
              │  · 统一的 Logger + i18n       │
              │  · 消除竞态的启动 Promise 链   │
              │  · 跨平台的进程管理抽象        │
              └───────────────────────────────┘
```

| 融合点 | 说明 |
|---|---|
| **检测系统统一** | engine-link 的引擎检测 + unreal-clangd 的 vswhere/SDK 检测 → 统一 `DetectionHandles`，单次检测、多处消费 |
| **配置系统统一** | engine-link 用 `enginelink.*` 命名空间，unreal-clangd 用 `unreal-clangd.*` → 统一为 `vscodeUEHelper.*` |
| **状态栏 + clangd 共存** | 状态栏同时显示构建按钮（来自 engine-link）和 MSVC/SDK 选择器（来自 unreal-clangd），两个领域在同一个 `StatusBarContext` 中消费 |
| **MCP + clangd 无冲突** | MCP 服务器不依赖 clangd 状态，反之亦然。两者通过 Config 读取共享的项目/引擎信息，但运行时完全解耦 |

### 7.5 参考信息表

| 维度 | engine-link | unreal-clangd | VSCodeUEHelper |
|---|---|---|---|
| **首次发布** | 2025 Q4 | 2023 (UE 5.2) | 2026 Q2 |
| **目标 IDE** | Cursor | VS Code | VS Code（兼容 Cursor） |
| **语言** | TypeScript | TypeScript | TypeScript (strict) |
| **打包** | esbuild | webpack | esbuild |
| **测试** | 无公开测试 | Mocha | Vitest (26 tests) |
| **平台** | Windows only | Win / Mac / Linux | Win / Mac / Linux |
| **UE 版本** | 5.4 – 5.7 | 5.2 – 5.8 | 5.3+ |
| **状态栏按钮** | 10 | 0 | 11 |
| **MCP** | ✅ 6 tools | ❌ | ✅ 6 tools |
| **clangd 集成** | Extension Pack (间接) | 直接 (核心功能) | 直接 (Extension Pack) |
| **i18n** | ❌ | ❌ | ✅ zh / en |

> **版权声明**：VSCodeUEHelper 的代码是全新编写的，不包含 engine-link 或 unreal-clangd 的任何源代码。上述设计模式（如状态栏布局、managed block 格式、preparse-includes 策略）属于架构层面的"思想借鉴"，在 MIT 许可下合法合规。
