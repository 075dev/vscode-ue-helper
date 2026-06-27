# src/commands/ 模块分析报告

## 一、模块概览

**文件数**: 15 个 TypeScript 文件  
**总代码量**: 约 1,163 行  
**职责**: 实现 VSCode UE Helper 插件所有用户可触发的命令（16 个 vscodeUEHelper.* 命令），是插件行为层的入口和调度中心。

### 文件清单

| # | 文件名 | 行数 | 职责摘要 |
|---|--------|------|----------|
| 1 | `index.ts` | 89 | 模块入口，注册 16 个命令到 VS Code |
| 2 | `build.ts` | 120 | 实现 build / rebuild / clean 三个构建命令 |
| 3 | `createProject.ts` | 154 | 一次性初始化 UE + clangd 工作区（4 步流程） |
| 4 | `setSystemIncludes.ts` | 162 | 配置 Windows SDK + MSVC + C++ 标准到 .clangd |
| 5 | `selectTarget.ts` | 19 | 选择 Build Target 类型并持久化 |
| 6 | `selectConfig.ts` | 18 | 选择 Build Configuration 并持久化 |
| 7 | `showProjectInfo.ts` | 167 | 显示项目/引擎/配置等检测状态，含 0 引擎引导 |
| 8 | `liveCoding.ts` | 54 | 触发 UE Live Coding 热重载（Windows-only） |
| 9 | `launchEditor.ts` | 49 | 启动 Unreal Editor |
| 10 | `toggleCompletionMode.ts` | 14 | 切换 clangd 快速/慢速补全模式 |
| 11 | `regenerateWorkspace.ts` | 162 | 从 .uproject 生成 .code-workspace（4 步注册表定位引擎） |
| 12 | `uninstall.ts` | 72 | 删除插件生成的所有文件（保留用户文件） |
| 13 | `openWorkspaceFile.ts` | 33 | 在编辑器打开 .code-workspace 文件 |
| 14 | `installRules.ts` | 67 | 安装 AI Agent 规则文件（Cursor + Copilot） |
| 15 | `generateCompileCommands.ts` | 48 | 重新生成 compile_commands.json |

---

## 二、每个文件的符号表

### 2.1 index.ts —— 模块入口（第 1-89 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `activateCommands` (export) | 37 | `(context: vscode.ExtensionContext, config: Config, logger: Logger, detection: DetectionHandles, clangd: ClangdHandles) => void` | 集中注册全部 16 个 vscodeUEHelper.* 命令 |

**注册的 16 个命令**:

| 命令 ID | 行号 | 实现函数 | 关键参数 |
|---------|------|----------|----------|
| `vscodeUEHelper.showProjectInfo` | 44 | `showProjectInfo` | config, logger, detection |
| `vscodeUEHelper.build` | 47 | `executeBuild('build', ...)` | config, logger, detection |
| `vscodeUEHelper.rebuild` | 50 | `executeBuild('rebuild', ...)` | config, logger, detection |
| `vscodeUEHelper.clean` | 53 | `executeBuild('clean', ...)` | config, logger, detection |
| `vscodeUEHelper.launchEditor` | 56 | `executeLaunchEditor` | config, logger, detection |
| `vscodeUEHelper.liveCoding` | 59 | `executeLiveCoding` | config, logger, detection |
| `vscodeUEHelper.generateCompileCommands` | 62 | `executeGenerateCompileCommands` | logger, detection |
| `vscodeUEHelper.toggleCompletionMode` | 65 | `executeToggleCompletionMode` | logger, clangd |
| `vscodeUEHelper.createProject` | 68 | `executeCreateProject` | config, logger, detection |
| `vscodeUEHelper.installRules` | 71 | `executeInstallRules` | logger, detection |
| `vscodeUEHelper.uninstall` | 74 | `executeUninstall` | logger, detection |
| `vscodeUEHelper.setSystemIncludes` | 75 | `executeSetSystemIncludes` | config, logger, detection |
| `vscodeUEHelper.openWorkspaceFile` | 78 | `executeOpenWorkspaceFile` | (无参数) |
| `vscodeUEHelper.regenerateWorkspace` | 79 | `executeRegenerateWorkspace` | logger |
| `vscodeUEHelper.selectConfig` | 82 | `executeSelectConfig` | config, logger |
| `vscodeUEHelper.selectTarget` | 85 | `executeSelectTarget` | config, logger |

**模块内 import 依赖**:
- `vscode` — VS Code API
- `@core/logger` → `Logger`
- `@core/config` → `Config`
- `@core/command-registry` → `registerCommand`
- `@detection` → `DetectionHandles`（类型）
- `@clangd` → `ClangdHandles`（类型）
- `@commands/showProjectInfo` → `showProjectInfo`
- 同目录文件: `./build`, `./launchEditor`, `./liveCoding`, `./generateCompileCommands`, `./toggleCompletionMode`, `./createProject`, `./installRules`, `./uninstall`, `./setSystemIncludes`, `./openWorkspaceFile`, `./regenerateWorkspace`, `./selectConfig`, `./selectTarget`

---

### 2.2 build.ts —— 构建命令（第 1-120 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `type Mode` | 25 | `'build' \| 'rebuild' \| 'clean'` | 构建模式类型（内部类型，未 export） |
| `executeBuild` (export) | 27 | `(mode: Mode, config: Config, logger: Logger, detection: DetectionHandles) => Promise<void>` | 实现 build/rebuild/clean 三个命令 |

**内部流程** (行 27-120):
1. `detection.scanner.scan()` 解析项目（行 34）
2. `detection.discovery.discover()` 解析引擎（行 45）
3. `resolveUBTPath()` / `buildUBTCommand()` / `resolveUBTTarget()` 构造 UBT 命令（行 54-61）
4. 根据 mode 追加 `-Rebuild` / `-Clean` 参数（行 64-65）
5. `clearDiagnostics()` 清空 Problems 面板（行 78）
6. `withProgress()` 包裹 `runBuild()`（行 80-107）
7. 成功后 `pushDiagnostics()` 推诊断到 Problems 面板（行 101）

**import 依赖**:
- `vscode`
- `@core/logger` → `Logger`
- `@core/config` → `Config`
- `@build` → `runBuild`, `buildUBTCommand`, `resolveUBTPath`, `resolveUBTTarget`
- `@ui/problemsPanel` → `pushDiagnostics`, `clearDiagnostics`
- `@ui/notifications` → `withProgress`
- `@ui/outputChannel` → `getOutputChannel`
- `@ui/quickPicks` → `pickProject`, `pickEngine`
- `@detection` → `DetectionHandles`（类型）

---

### 2.3 createProject.ts —— 项目初始化（第 1-154 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `executeCreateProject` (export) | 23 | `(config: Config, logger: Logger, detection: DetectionHandles) => Promise<void>` | 4 步流程初始化 UE + clangd 工作区 |

**4 步流程** (行 52-135):
1. **Step 1** (行 62): `writeClangdConfig()` 写默认 .clangd
2. **Step 2** (行 75): `generateCompileCommands()` 调用 UBT 生成 compile_commands.json
3. **Step 3** (行 95): `populateAddCompletions()` 扫 Intermediate/Build 的 generated.h 填充 addCompletions.h
4. **Step 4** (行 113): Windows 平台调用 `executeSetSystemIncludes()` 配置 MSVC/SDK 标志

**import 依赖**:
- `node:fs/promises`, `node:path`, `vscode`
- `@core/logger` → `Logger`
- `@core/config` → `Config`
- `@clangd` → `writeClangdConfig`, `generateCompileCommands`, `populateAddCompletions`
- `@ui/quickPicks` → `pickProject`, `pickEngine`
- `./setSystemIncludes` → `executeSetSystemIncludes`
- `@detection` → `DetectionHandles`（类型）

---

### 2.4 setSystemIncludes.ts —— 系统 Includes 配置（第 1-162 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `CPP_STANDARDS` | 34 | `readonly ['c++17', 'c++20', 'c++23']` | C++ 标准选项常量 |
| `executeSetSystemIncludes` (export) | 36 | `(config: Config, logger: Logger, detection: DetectionHandles) => Promise<void>` | 3 个 quickPick 选择 MSVC/SDK/标准后写入 .clangd |

**流程**:
1. 非 Windows 平台提示后返回（行 41-46）
2. `discoverSystemIncludes()` 检测当前 clangd 识别的系统 include（行 59）
3. QuickPick 1: 选择 MSVC 版本（行 107-116）
4. QuickPick 2: 选择 Windows SDK 版本（行 119-128）
5. QuickPick 3: 选择 C++ 标准（行 131-135）
6. `renderClangdFlags()` 渲染标志，`replaceSystemIncludeBlock()` 写入 .clangd（行 138-157）

**import 依赖**:
- `vscode`, `node:path`, `node:fs/promises`
- `@core/logger` → `Logger`
- `@core/config` → `Config`
- `@clangd/windowsSdk` → `discoverSystemIncludes`, `listMsvcVersions`, `listSdkVersions`, `renderClangdFlags`
- `@clangd/clangdConfig` → `replaceSystemIncludeBlock`, `findClangdConfig`, `writeClangdConfig`
- `@ui/quickPicks` → `pickProject`
- `@detection` → `DetectionHandles`（类型）

---

### 2.5 selectTarget.ts —— 选择 Target（第 1-19 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `executeSelectTarget` (export) | 13 | `(config: Config, logger: Logger) => Promise<void>` | 弹 pickTarget 选择编辑器/游戏/服务器/客户端，写 config.target |

**import 依赖**:
- `vscode`
- `@core/config` → `Config`
- `@core/logger` → `Logger`
- `@ui/quickPicks` → `pickTarget`

---

### 2.6 selectConfig.ts —— 选择构建配置（第 1-18 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `executeSelectConfig` (export) | 12 | `(config: Config, logger: Logger) => Promise<void>` | 弹 pickConfiguration 选 Debug/Development/Shipping，写 config.configuration |

**import 依赖**:
- `vscode`
- `@core/config` → `Config`
- `@core/logger` → `Logger`
- `@ui/quickPicks` → `pickConfiguration`

---

### 2.7 showProjectInfo.ts —— 项目信息展示（第 1-167 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `showProjectInfo` (export) | 20 | `(config: Config, logger: Logger, detection?: DetectionHandles) => Promise<void>` | 输出项目/引擎/配置/MCP 等信息，含 0 引擎引导分支 |

**0 引擎引导分支** (行 96-151):
- 有 `.code-workspace` → 提示 "打开 .code-workspace" → 调 `vscodeUEHelper.openWorkspaceFile`
- 无 `.code-workspace` 且未关联 UE → 提示 "下载 UE" → 打开 unrealengine.com
- 无 `.code-workspace` 但已关联 UE → 提示 "重新生成 workspace" → 调 `vscodeUEHelper.regenerateWorkspace`

**import 依赖**:
- `vscode`, `node:fs/promises`
- `@core/config` → `Config`
- `@core/logger` → `Logger`
- `@mcp/lifecycle` → `detectHost`
- `@detection` → `DetectionHandles`（类型）
- `@detection/uprojectAssociation` → `checkUprojectAssociation`
- `@i18n` → `t`

---

### 2.8 liveCoding.ts —— Live Coding 热重载（第 1-54 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `executeLiveCoding` (export) | 15 | `(config: Config, logger: Logger, detection: DetectionHandles) => Promise<void>` | 触发 UE Live Coding 热重载（Windows-only） |

**import 依赖**:
- `vscode`
- `@core/logger` → `Logger`
- `@core/config` → `Config`
- `@build` → `triggerLiveCoding`, `isLiveCodingSupported`
- `@ui/quickPicks` → `pickProject`, `pickEngine`
- `@detection` → `DetectionHandles`（类型）

---

### 2.9 launchEditor.ts —— 启动编辑器（第 1-49 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `executeLaunchEditor` (export) | 15 | `(config: Config, logger: Logger, detection: DetectionHandles) => Promise<void>` | 启动 Unreal Editor |

**import 依赖**:
- `vscode`
- `@core/logger` → `Logger`
- `@core/config` → `Config`
- `@build` → `launchEditor`（别名 `launch`）
- `@ui/quickPicks` → `pickProject`, `pickEngine`
- `@detection` → `DetectionHandles`（类型）

---

### 2.10 toggleCompletionMode.ts —— 补全模式切换（第 1-14 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `executeToggleCompletionMode` (export) | 11 | `(logger: Logger, clangd: ClangdHandles) => void` | 调用 `clangd.completionMode.toggle()` 切换快/慢速模式 |

**import 依赖**:
- `@core/logger` → `Logger`
- `@clangd` → `ClangdHandles`（类型）

---

### 2.11 regenerateWorkspace.ts —— 工作区重新生成（第 1-162 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `interface UProjectJson` | 23-26 | `{ EngineAssociation?: string; Modules?: unknown[] }` | .uproject 文件结构 |
| `findUProject` | 28 | `(roots: readonly vscode.WorkspaceFolder[]) => Promise<string \| undefined>` | 在 workspace 根目录扫描 .uproject |
| `locateUEFromRegistry` | 41 | `(version: string) => Promise<string \| null>` | 从 Windows 注册表定位 UE 安装路径 |
| `locateUEFromCommonPaths` | 67 | `(version: string) => Promise<string \| null>` | 从 C/D/E/F 盘标准路径定位 UE |
| `locateUE` | 81 | `(version: string) => Promise<string \| null>` | 组合注册表 + 标准路径查找 |
| `executeRegenerateWorkspace` (export) | 85 | `(logger: Logger) => Promise<void>` | 4 步流程生成 .code-workspace |

**4 步流程** (行 98-161):
1. Step 1 (行 101): `findUProject()` 找 .uproject
2. Step 2 (行 112): 读取 `EngineAssociation` 版本号
3. Step 3 (行 122): `locateUE()` 注册表+标准路径定位引擎
4. Step 4 (行 130): 写 `.code-workspace` JSON 文件，提示重新打开

**import 依赖**:
- `node:fs/promises`, `node:path`, `node:child_process` → `execFile`
- `node:util` → `promisify`
- `vscode`
- `@core/logger` → `Logger`
- `@i18n` → `t`

---

### 2.12 uninstall.ts —— 卸载插件文件（第 1-72 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `interface CleanupTarget` | 23-26 | `{ label: string; paths: string[] }` | 清理目标结构 |
| `executeUninstall` (export) | 28 | `(logger: Logger, detection: DetectionHandles) => Promise<void>` | 删除 6 类生成文件，保留 addCompletions.h |

**清理的 6 类文件** (行 38-54):
- `.clangd`
- `compile_commands.json`
- `.vscode/unreal-clangd/`
- `.vscode/.code-workspace.backup`
- `.cursor/rules/unreal-cpp.mdc`
- `.github/copilot-instructions.md`

**import 依赖**:
- `node:fs/promises`, `node:path`, `vscode`
- `@core/logger` → `Logger`
- `@detection` → `DetectionHandles`（类型）

---

### 2.13 openWorkspaceFile.ts —— 打开工作区文件（第 1-33 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `executeOpenWorkspaceFile` (export) | 12 | `() => Promise<void>` | 扫描 workspace 根目录查找 .code-workspace 并在编辑器打开 |

**import 依赖**:
- `node:fs/promises`, `node:path`, `vscode`

---

### 2.14 installRules.ts —— 安装 AI Agent 规则（第 1-67 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `RULES_CONTENT` | 14-38 | `string` | 内嵌的 Cursor/Copilot AI Agent 规则文本 |
| `executeInstallRules` (export) | 40 | `(logger: Logger, detection: DetectionHandles) => Promise<void>` | 写入 `.cursor/rules/unreal-cpp.mdc` 和 `.github/copilot-instructions.md` |

**import 依赖**:
- `node:fs/promises`, `node:path`, `vscode`
- `@core/logger` → `Logger`
- `@detection` → `DetectionHandles`（类型）

---

### 2.15 generateCompileCommands.ts —— 生成 compile_commands（第 1-48 行）

| 符号 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `executeGenerateCompileCommands` (export) | 14 | `(logger: Logger, detection: DetectionHandles) => Promise<void>` | 调 UBT 生成 compile_commands.json 并 link 到项目根 |

**import 依赖**:
- `vscode`
- `@core/logger` → `Logger`
- `@clangd` → `generateCompileCommands`, `linkToWorkspaceRoot`
- `@ui/quickPicks` → `pickProject`, `pickEngine`
- `@detection` → `DetectionHandles`（类型）

---

## 三、模块对外依赖（commands 导入了哪些其他模块）

### 3.1 Node.js 内置模块
| 模块 | 导入文件 |
|------|----------|
| `node:fs/promises` | createProject, setSystemIncludes, showProjectInfo, regenerateWorkspace, uninstall, openWorkspaceFile, installRules |
| `node:path` | createProject, setSystemIncludes, regenerateWorkspace, uninstall, openWorkspaceFile, installRules |
| `node:child_process` (`execFile`) | regenerateWorkspace |
| `node:util` (`promisify`) | regenerateWorkspace |

### 3.2 VS Code API
| 模块 | 导入文件 |
|------|----------|
| `vscode` | index, build, createProject, setSystemIncludes, selectTarget, selectConfig, showProjectInfo, liveCoding, launchEditor, regenerateWorkspace, uninstall, openWorkspaceFile, installRules, generateCompileCommands |

> 注: 仅 `toggleCompletionMode.ts` 不依赖 `vscode`（只到 import Logger 和 ClangdHandles 类型），因为状态栏按钮注册在 clangd 模块内部。

### 3.3 项目内部模块依赖矩阵

| 被依赖模块 | 依赖它的 commands 文件 |
|------------|----------------------|
| `@core/logger` → `Logger` | index(1), build(1), createProject(1), setSystemIncludes(1), selectTarget(1), selectConfig(1), showProjectInfo(1), liveCoding(1), launchEditor(1), toggleCompletionMode(1), regenerateWorkspace(1), uninstall(1), installRules(1), generateCompileCommands(1) |
| `@core/config` → `Config` | index(1), build(1), createProject(1), setSystemIncludes(1), selectTarget(1), selectConfig(1), showProjectInfo(1), liveCoding(1), launchEditor(1) |
| `@detection` → `DetectionHandles` | index, build, createProject, setSystemIncludes, showProjectInfo, liveCoding, launchEditor, uninstall, installRules, generateCompileCommands |
| `@detection/uprojectAssociation` → `checkUprojectAssociation` | showProjectInfo |
| `@clangd` → `writeClangdConfig`, `generateCompileCommands`, `populateAddCompletions`, `linkToWorkspaceRoot` | createProject, generateCompileCommands |
| `@clangd` → `ClangdHandles`（类型） | index, toggleCompletionMode |
| `@clangd/windowsSdk` → 4 个函数 | setSystemIncludes |
| `@clangd/clangdConfig` → 3 个函数 | setSystemIncludes |
| `@build` → `runBuild`, `buildUBTCommand`, `resolveUBTPath`, `resolveUBTTarget` | build |
| `@build` → `triggerLiveCoding`, `isLiveCodingSupported` | liveCoding |
| `@build` → `launchEditor` | launchEditor |
| `@ui/quickPicks` → `pickProject`, `pickEngine`, `pickTarget`, `pickConfiguration` | build, createProject, setSystemIncludes, selectTarget, selectConfig, liveCoding, launchEditor, generateCompileCommands |
| `@ui/problemsPanel` → `pushDiagnostics`, `clearDiagnostics` | build |
| `@ui/notifications` → `withProgress` | build |
| `@ui/outputChannel` → `getOutputChannel` | build |
| `@mcp/lifecycle` → `detectHost` | showProjectInfo |
| `@i18n` → `t` | showProjectInfo, regenerateWorkspace |
| `@core/command-registry` → `registerCommand` | index |
| `./setSystemIncludes` → `executeSetSystemIncludes` | createProject |

---

## 四、模块被谁依赖（谁调用了 commands）

### 4.1 extension.ts（第 36-37 行）
```typescript
import { activateCommands } from '@commands';
import { showProjectInfo } from '@commands/showProjectInfo';
```
- 第 87 行调用 `activateCommands(context, config, logger, detection, clangd)` 注册全部命令
- 激活时调用 `showProjectInfo(config, logger, detection)` 显示欢迎信息

### 4.2 UI 模块（statusBar.ts）
状态栏 `src/ui/statusBar.ts` 将按钮的 `command` 属性绑定到命令 ID：
| 按钮 | 绑定的命令 ID | statusBar.ts 行号 |
|------|--------------|-------------------|
| BuildBtn | `vscodeUEHelper.build` | 84, 142, 251 |
| RebuildBtn | `vscodeUEHelper.rebuild` | 88 |
| CleanBtn | `vscodeUEHelper.clean` | 92 |
| ConfigBtn | `vscodeUEHelper.selectConfig` | 97 |
| TargetBtn | `vscodeUEHelper.selectTarget` | 101 |
| SdkBtn | `vscodeUEHelper.setSystemIncludes` | 108 |
| ProjectBtn | `vscodeUEHelper.showProjectInfo` | 112 |
| EngineBtn | `vscodeUEHelper.showProjectInfo` | 116 |
| LiveCodingBtn | `vscodeUEHelper.liveCoding` | 121 |
| LaunchBtn | `vscodeUEHelper.launchEditor` | 125 |

### 4.3 clangd 模块（completionMode.ts:20）
```typescript
this.statusBarItem.command = 'vscodeUEHelper.toggleCompletionMode';
```
clangd 模块内部创建的状态栏项也绑定到 `toggleCompletionMode` 命令。

### 4.4 命令间相互调用
- `createProject.ts` → Step 4 调用 `executeSetSystemIncludes()`（同目录函数导入）
- `showProjectInfo.ts` → 通过 `vscode.commands.executeCommand` 调用：
  - `vscodeUEHelper.openWorkspaceFile`（行 119）
  - `vscodeUEHelper.regenerateWorkspace`（行 147）

### 4.5 package.json contributes.commands（编译时）
16 个命令在 `package.json` 的 `contributes.commands` 中声明，VS Code 通过命令面板和快捷键可触发。

---

## 五、关键设计模式与架构特征

1. **统一的 execute* 命名规范**：每个文件导出一个 `executeXxx` 函数，便于 index.ts 集中注册。
2. **依赖注入**：通过 `Config`, `Logger`, `DetectionHandles`, `ClangdHandles` 注入依赖，commands 层不直接实例化服务。
3. **三层项目/引擎解析**：优先 workspaceContext 缓存 → 唯一扫描结果自动选择 → UI 交互选择（pickProject/pickEngine），在 build/create/liveCoding/launchEditor 中重复使用。
4. **4 步进度条模式**：createProject 和 regenerateWorkspace 都用 `vscode.window.withProgress` + 4 步递增式进度报告。
5. **Windows 平台保护**：setSystemIncludes 和 liveCoding 明确检查 `process.platform === 'win32'`，非 Windows 优雅降级。
6. **错误不阻断流程**：createProject 的 4 步各自 try/catch，单步失败不影响后续。
7. **命令间解耦**：toggleCompletionMode 只依赖 Logger + ClangdHandles，openWorkspaceFile 只依赖原生 vscode API，无项目模块依赖。
