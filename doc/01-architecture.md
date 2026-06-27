# 01 · 架构总览

> 本文回答三个问题：插件如何启动？模块之间怎么通信？数据从 `.code-workspace` 文件流到状态栏经过哪些步骤？

---

## 1. 启动流程

```
VS Code 激活插件
       │
       ▼
src/extension.ts:activate()
       │
       ├─ initI18n()                ← 先初始化 i18n，Logger 也要用翻译
       │
       ├─ new Logger('VSCodeUEHelper')
       │
       ├─ new Config()             ← 读 vscode.workspace.getConfiguration('vscodeUEHelper')
       │
       ├─ activateDetection()      ← ① 检测项目 + 引擎
       │     │
       │     ▼
       │   detection.ready (Promise)  ← 异步预热
       │
       ├─ activateBuild()          ← ② 注册 UBT Task Provider
       │
       ├─ activateClangd()         ← ③ 启动 clangd 状态栏 + 工作区备份
       │
       ├─ activateUI()             ← ④ 创建 10 个状态栏按钮
       │     │
       │     ▼
       │   await detection.ready   ← 等检测完成，更新状态栏
       │
       ├─ activateCommands()       ← ⑤ 注册 15 个命令
       │
       └─ 显示欢迎信息（首次激活时）
```

**关键点**：所有模块都接收 `DetectionHandles` 作为参数，状态栏 UI 在 `await detection.ready` 之后才渲染 —— 这避免了"检测还没完成，状态栏就显示空"的竞态。

---

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
       └───────────────────┴────────────────────┴────→ 所有模块共用 Logger / Config / i18n
```

| 模块 | 职责 | 关键导出 |
|---|---|---|
| `core/` | 基础工具 | `Logger`、`Config`、`registerCommand` |
| `i18n/` | 国际化 | `t(key, params)`、`initI18n()` |
| `detection/` | 项目 + 引擎发现 | `DetectionHandles`、`detect()`、`UprojectScanner`、`EngineDiscovery` |
| `build/` | UBT 构建 / Live Coding / 启动 Editor | `runBuild()`、`buildUBTCommand()`、`resolveEditorPath()` |
| `clangd/` | clangd 配置 + .clangd + Windows SDK/MSVC | `generateCompileCommands()`、`writeClangdConfig()`、`discoverSystemIncludes()` |
| `ui/` | 状态栏、QuickPick、Output 通道、Problems 面板 | `StatusBarManager`、`pickProject()`、`withProgress()` |
| `commands/` | 15 个命令的实现 | `executeBuild()`、`executeSetSystemIncludes()` 等 |
| `mcp/` | Model Context Protocol 服务器 | `startMcpServer()`、`detectHost()` |
| `parsers/` | 输出解析器 | `MsvcParser`、`UbtParser`、`LinkerParser` |

---

## 3. 数据流：从 `.code-workspace` 到状态栏

这是最关键的一条数据通路。详细描述每一步：

### Step 1: `detection/index.ts:handles.ready` 启动 IIFE

```ts
handles.ready = (async () => {
  // ...
  const workspaceFile = vscode.workspace.workspaceFile;  // ← .code-workspace 的 URI
  // ...
})();
```

### Step 2: 读取 `.code-workspace`

```ts
const raw = await fs.readFile(workspaceFile.fsPath, 'utf-8');
const folders = JSON.parse(raw).folders ?? [];
// folders[0] = { name: "XianDreamwalking", path: "." }
// folders[1] = { name: "UE5", path: "D:\\Program Files\\UE_5.8" }
```

**关键决策**：插件**完全信任** `.code-workspace` 的 `folders[]` 顺序，**不做文件系统扫描**。
- `folders[0]` = 项目根目录
- `folders[1]` = 引擎根目录

### Step 3: 解析项目路径

```ts
const projectAbsPath = path.resolve(workspaceRootDir, projectEntry.path);
const uprojectPath = path.join(projectAbsPath, `${projectEntry.name}.uproject`);
// → E:\Dream\XianDreamwalking\XianDreamwalking.uproject
```

### Step 4: 解析 .uproject（**JSON5** 解析！）

```ts
const project = await scanner.parseFromPath(uprojectPath);
// scanner.parseUProject 内部用 JSON5.parse，不是 JSON.parse
// 因为 UE 的 .uproject 允许注释、尾部逗号、单引号
```

返回的 `ProjectInfo`：
```ts
{
  path: "E:\\Dream\\XianDreamwalking\\XianDreamwalking.uproject",
  name: "XianDreamwalking",
  engineAssociation: "{CDB3CAF5-470B-4D1E-D178-8C8EF113079C}",  // 注意：UE 5.x 用 GUID
  modules: ["XianDreamwalking"],
  raw: { ... }
}
```

### Step 5: 解析引擎版本

```ts
const buildVersionPath = path.join(engineAbsPath, 'Engine', 'Build', 'Build.version');
// → D:\Program Files\UE_5.8\Engine\Build\Build.version

const version = await readBuildVersion(engineAbsPath);
// 返回 "5.8.0"
```

`Build.version` 是 JSON：
```json
{ "MajorVersion": 5, "MinorVersion": 8, "PatchVersion": 0 }
```

### Step 6: 检测失败处理

| 情况 | 行为 |
|---|---|
| `workspaceFile` 是空 | log error，返回 `projects=[], engines=[]` |
| `folders[0]` 缺失 | log error |
| `.uproject` 文件不存在 | log error，return `{projects:[], engines:[]}` |
| `folders[1]` 缺失 | log error，但**仍然**返回 project（只 engines 空） |
| `Build.version` 不存在 | log error，return `{projects, engines:[]}` |

### Step 7: UI 消费

```ts
// src/ui/index.ts
const result = await detection.ready;  // ← 阻塞等
const ctx: StatusBarContext = {
  project: result.projects[0] ? { name, path } : null,
  engine: result.engines[0] ? { version, path } : null,
};
statusBar.update(ctx, settings);  // ← 渲染 11 个按钮
```

---

## 4. 状态栏 UI 渲染规则

`StatusBarManager.update(ctx, settings)` 是核心方法。

| 字段 | 渲染规则 |
|---|---|
| `$(play) Build` | 文本固定 `Build`；prominent 背景；点击触发 `vscodeUEHelper.build` |
| `$(refresh) Rebuild` | 文本固定 `Rebuild`；默认背景 |
| `$(trash) Clean` | 文本固定 `Clean` |
| `$(gear) {config}` | 显示当前 BuildConfiguration（Development / DebugGame / ...）；点击 → `selectConfig` |
| `$(symbol-class) {target}` | 显示当前 Target（Editor / Game / ...）；点击 → `selectTarget` |
| `$(device-desktop) {platform}` | 显示当前 Platform（Win64 / Mac / Linux） |
| `$(library) MSVC/SDK` | Windows-only，点击 → `setSystemIncludes` |
| `$(file-code) {project}` 或 `$(warning) No Project` | 项目名 / 警告 + 红黄背景 |
| `$(package) UE {version}` 或 `$(warning) No Engine` | 引擎版本 / 警告 |
| `$(zap) Live Coding` | prominent；Windows-only |
| `$(rocket) Launch` | prominent；启动 Unreal Editor |

**没有项目时**：Build / Rebuild / Clean / Live Coding / Launch / Engine 按钮隐藏，其余仍显示。

---

## 5. 命令 → 实现的映射

15 个命令分布在 `src/commands/` 下：

| 命令 ID | 文件 | 用途 |
|---|---|---|
| `vscodeUEHelper.build` | `build.ts:executeBuild('build')` | 调 UBT 编译 |
| `vscodeUEHelper.rebuild` | `build.ts:executeBuild('rebuild')` | Clean + Build |
| `vscodeUEHelper.clean` | `build.ts:executeBuild('clean')` | 调 UBT 清理 |
| `vscodeUEHelper.launchEditor` | `launchEditor.ts` | 启动 Unreal Editor |
| `vscodeUEHelper.liveCoding` | `liveCoding.ts` | 触发 Live Coding |
| `vscodeUEHelper.generateCompileCommands` | `generateCompileCommands.ts` | 跑 UBT 生成 compile_commands.json |
| `vscodeUEHelper.createProject` | `createProject.ts` | 写 .clangd + addCompletions.h 模板 |
| `vscodeUEHelper.toggleCompletionMode` | `toggleCompletionMode.ts` | 快速/慢速 clangd 补全模式 |
| `vscodeUEHelper.showProjectInfo` | `showProjectInfo.ts` | 弹输出面板显示项目状态 |
| `vscodeUEHelper.setSystemIncludes` | `setSystemIncludes.ts` | 选 Windows SDK + MSVC + C++ 标准 |
| `vscodeUEHelper.installRules` | `installRules.ts` | 复制 AI agent rules 到项目 |
| `vscodeUEHelper.uninstall` | `uninstall.ts` | 清理生成文件 |
| `vscodeUEHelper.openWorkspaceFile` | `openWorkspaceFile.ts` | 打开 .code-workspace |
| `vscodeUEHelper.regenerateWorkspace` | `regenerateWorkspace.ts` | 从 .uproject 重新生成工作区 |
| `vscodeUEHelper.selectConfig` | `selectConfig.ts` | 弹 quickPick 选 Build Configuration |
| `vscodeUEHelper.selectTarget` | `selectTarget.ts` | 弹 quickPick 选 Target 类型 |

> `selectConfig` 和 `selectTarget` 没出现在 `package.json` 的 commands 数组**初始列表**里，而是后来加的。命令面板默认显示全部。

---

## 6. 配置系统（`Config` 类）

所有配置走 `vscode.workspace.getConfiguration('vscodeUEHelper')`：

| 配置键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `vscodeUEHelper.configuration` | enum | `Development` | BuildConfiguration |
| `vscodeUEHelper.target` | enum | `Editor` | BuildTarget |
| `vscodeUEHelper.platform` | enum | `Win64` | BuildPlatform |
| `vscodeUEHelper.clangdPath` | string | `""` | clangd.exe 完整路径 |
| `vscodeUEHelper.completionMode` | enum | `fast` | 快速 / 慢速 |
| `vscodeUEHelper.autoBackupWorkspace` | bool | `true` | 是否自动备份 .code-workspace |
| `vscodeUEHelper.useMCP` | enum | `auto` | MCP 服务器模式 |
| `vscodeUEHelper.lspLoggingLevel` | enum | `info` | 日志详细级别 |

`Config.update(key, value, target)` 持久化到 workspace 级别（不污染全局设置）。

---

## 7. 进程模型

插件里有两种 spawn 模式：

| 模式 | 场景 | 实现 |
|---|---|---|
| **Fire-and-forget** | `launchEditor.ts` —— 启动 Unreal Editor | `spawn('cmd', ['/c', 'start', '""', editor.exe, projectPath], { detached: true, stdio: 'ignore' })` |
| **Long-running with cancellation** | `buildRunner.ts` —— 跑 UBT | `spawn('cmd.exe', ['/c', 'Build.bat', ...args], { detached: !win32 })`，加 `AbortSignal` 支持 |

**关键 Windows 行为**：
- `.bat` 文件**不能**直接 spawn，必须通过 `cmd.exe /c Build.bat ...`
- 杀进程时**不能**只 `child.kill()` —— 整个 cmd.exe → Build.bat → dotnet → UnrealBuildTool 进程链要用 `taskkill /F /T /PID <pid>`

详见 [05-code-reference.md](./05-code-reference.md#windows-进程管理)。

---

## 8. 错误处理策略

| 层级 | 策略 |
|---|---|
| `Logger` | info / warn / error 三档，写入 Output 通道 |
| 用户可见错误 | `vscode.window.showErrorMessage(message, ...buttons)` —— modal 让用户必须响应 |
| 命令失败 | 命令返回的 Promise reject，由 VS Code 自动弹错误 |
| 异步失败 | 检测 / 状态栏渲染包在 try/catch 里，失败时降级到空 ctx 显示 `(no project) / (no engine)` |
| 文件读写 | 用 `fs.promises`，失败抛 Error 上层 catch |

---

## 9. 项目溯源

> VSCodeUEHelper 是从两个开源参考项目融合而来的全新实现。代码从零编写以避免版本耦合，但核心设计模式、模块职责拆分、状态栏交互范式均继承自以下两个项目。

### 9.1 参考源概览

| 项目 | 作者 | 平台定位 | 许可 | 核心贡献领域 |
|---|---|---|---|---|
| **[engine-link](https://github.com/rmoubayed/engine-link)** | Rami Moubayed | Cursor IDE 扩展 | MIT | UBT 构建管线、Live Coding、MCP AI 集成、状态栏 UI |
| **[unreal-clangd](https://github.com/boocs/unreal-clangd)** | boocs | VS Code 扩展 | MIT | clangd IntelliSense、`compile_commands.json`、Windows SDK/MSVC 发现、工作区备份 |

### 9.2 engine-link 贡献分析

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

### 9.3 unreal-clangd 贡献分析

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
- unreal-clangd 的检测逻辑有不稳定的竞态（检测未完成就渲染 UI）→ VSCodeUEHelper 用 `DetectionHandles.ready` Promise 消除竞态（见 [§1 启动流程](#1-启动流程)）
- unreal-clangd 支持从 UE 5.2 起的多个引擎版本 → VSCodeUEHelper 目前聚焦 5.3+

### 9.4 融合架构决策

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

### 9.5 参考信息表

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

---

## 下一步

继续看 [02-modules.md](./02-modules.md) 了解每个模块的细节。