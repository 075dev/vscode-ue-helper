# 02 · 模块详解

> 本文档逐一拆解每个源码目录，列出文件、职责、关键导出。读完就能在脑中建立完整的代码地图。

---

## 目录速览

| 模块 | 文件数 | 一句话职责 |
|---|---|---|
| `src/core/` | 3 | 基础工具：日志、配置、命令注册 |
| `src/i18n/` | 3 | 国际化（中英双语） |
| `src/detection/` | 9 | 项目 + 引擎发现（单一信息源 = `.code-workspace`） |
| `src/build/` | 7 | UBT 构建、Live Coding、启动 Editor |
| `src/clangd/` | 8 | clangd 配置、Windows SDK/MSVC、工作区备份 |
| `src/ui/` | 6 | 状态栏、QuickPick、Output 通道、Problems 面板 |
| `src/commands/` | 17 | 15 个命令的实现 |
| `src/mcp/` | 4 | Model Context Protocol 服务器 |
| `src/parsers/` | 4 | MSVC / UBT / 链接器输出解析 |
| `src/platform/` | 0 | 预留（跨平台抽象层，目前未使用） |
| `src/rules/` | 2 | AI agent rules（Cursor / Claude Code） |
| 顶层 | `extension.ts` | 入口，串联所有模块 |

---

## 1. `src/core/` —— 基础工具

### `logger.ts`

轻量 Logger，封装 `vscode.OutputChannel`。所有模块共用同一个 Logger 实例（在 `extension.ts` 创建）。

```ts
class Logger {
  info(message: string): void;     // 输出到 Output 通道 + 写日志
  warn(message: string): void;
  error(message: string): void;
  show(): void;                   // 把 Output 通道显示给用户
}
```

### `config.ts`

对 `vscode.workspace.getConfiguration('vscodeUEHelper')` 的强类型包装。所有字段都有默认值。`update(key, value)` 持久化到 workspace。

**重要字段**：
- `configuration: BuildConfiguration` —— `Development | DebugGame | Debug | Shipping | Test`
- `target: BuildTarget` —— `Editor | Game | Server | Client`
- `platform: BuildPlatform` —— `Win64 | Mac | Linux`
- `clangdPath: string | undefined` —— clangd.exe 完整路径

### `command-registry.ts`

`registerCommand(context, id, callback)` 包装 `vscode.commands.registerCommand`，自动 dispose。

---

## 2. `src/i18n/` —— 国际化

### `index.ts`

`initI18n()` 在插件激活时第一个被调用（Logger 也要用翻译），根据 `vscode.env.language` 自动选 `zh` 或 `en` locale。

`t(key, params)` 函数：
```ts
t('showInfo.workspace', { path: '/e/foo' })
// → "工作区: /e/foo"  (zh)
// → "Workspace: /e/foo"  (en)
```

支持 `{name}` 占位符替换。

### `locales/zh.json` / `locales/en.json`

70+ 翻译键，覆盖所有 UI 文案。

---

## 3. `src/detection/` —— 项目 + 引擎发现

> 这是整个插件的**数据根基**。其他所有模块都从这里拿项目和引擎信息。

### `index.ts`

入口。导出 `activateDetection(context, config, logger): DetectionHandles`。

`DetectionHandles` 包含：
- `scanner: UprojectScanner`
- `discovery: EngineDiscovery`
- `vsBuildTools: VsBuildTools`
- `workspaceContext: WorkspaceContext`
- `ready: Promise<DetectionResult>` —— **关键**：UI 层 await 这个 Promise 拿到结果

**核心流程**（IIFE）：
```
1. 拿 vscode.workspace.workspaceFile
2. 读 .code-workspace → folders[]
3. folders[0] → 项目根目录 + 构造 .uproject 路径
4. folders[1] → 引擎根目录 + 读 Engine/Build/Build.version
5. 任何文件不存在 → log error + return 空数组（让 UI 显示警告）
```

### `workspaceFolders.ts`

- `readWorkspaceEntries(workspaceFile)` —— 读 `.code-workspace` 的 `folders[]`，返回 `[{name, path}]`
- `classifyFolders(folderPaths)` —— 检查每个 folder 是否有 .uproject / Build.version（**保留作兼容**，主流程不再使用）
- `readBuildVersion(engineRoot)` —— 解析 `Build.version` → `"5.8.0"` 字符串

### `uprojectScanner.ts`

**关键改动**：从 JSON.parse 改成 **JSON5.parse**。UE 的 `.uproject` 允许注释、尾部逗号、单引号 —— 严格 JSON 解析会失败。

```ts
class UprojectScanner {
  scan(folderPaths?: string[]): Promise<ProjectInfo[]>;
  findSingle(folderPaths?: string[]): Promise<ProjectInfo | null>;
  parseFromPath(uprojectPath: string): Promise<ProjectInfo | null>;  // ← 主入口
}
```

`parseFromPath` 给定已知路径直接读 + 解析，不扫描。detection 流程用这个。

### `engineDiscovery.ts`

`discover(candidates)` —— 给定引擎目录候选列表，验证每个有 `Build.version`，返回 `EngineInstall[]`。

### `engineLocator.ts`（**当前未使用**）

之前用来从 `.uproject` 的 `EngineAssociation` 字段（版本号 / GUID）反查引擎路径。现已被 `workspaceFolders.ts` 取代。**保留作为后备**。

### `vsBuildTools.ts`

扫描 Visual Studio 安装（用 `vswhere.exe`），找到 MSVC 工具链版本（给 clangd 用）。**Windows-only**。

### `workspaceContext.ts`

`workspaceState` 持久化：用户上次选过的项目 / 引擎（跨会话保留）。

### `uprojectAssociation.ts`

Windows 注册表 `HKCR\.uproject` 查询 —— 检查系统是否把 .uproject 关联到 UE。用于"0 引擎"分支的 fallback 提示。

### `types.ts`

共享类型：
```ts
interface ProjectInfo { path, name, engineAssociation, modules, raw }
interface EngineInstall { path, version, isLauncherInstall }
interface VSInstallation { displayName, installationPath, version, vcToolsPath? }
interface WorkspaceSelection { selectedProject?, selectedEngine? }
```

---

## 4. `src/build/` —— UBT 构建

### `index.ts`

导出 `activateBuild()`，注册 `UBTTaskProvider`（VS Code Task system）。

### `ubt.ts`

**UBT 命令行构造** + **路径解析**。

```ts
buildUBTCommand({ project, target, platform, configuration, ubtPath }): UBTCommand
```

**关键函数**：
- `resolveUBTPath(engineRoot)` —— `<Engine>/Engine/Build/BatchFiles/Build.bat`（Win）或 `RunUBT.sh`（POSIX）
- `resolveUBTTarget(uprojectPath, type)` —— **重要**：把 `Editor` 转成 `XianDreamwalkingEditor`（UBT 期望的 target 名是 `<ProjectName><Suffix>`）
- `resolveEditorPath(engineRoot, platform)` —— `<Engine>/Engine/Binaries/<Platform>/UnrealEditor.exe`

### `buildRunner.ts`

**实际 spawn UBT 的地方**。处理三个关键问题：

1. **Windows 不能直接 spawn `.bat`** —— 必须 `spawn('cmd.exe', ['/c', 'Build.bat', ...args], ...)`
2. **杀整个进程树** —— `killTree(child)`：
   - Win: `taskkill /F /T /PID <pid>`
   - POSIX: `process.kill(-pid, 'SIGTERM')`（需要 `detached: true`）
3. **AbortSignal** —— `withProgress` 把 VS Code 的 `CancellationToken` 桥接到 `AbortSignal`，传给 `runBuild`，让取消按钮能杀掉 UBT

返回 `Result<BuildResult, Error>` 风格的 `{ ok, value/error }`。

### `launchEditor.ts`

启动 Unreal Editor（detached 模式）：
- Win: `cmd /c start "" <editor> <project>`
- Mac: `open -a <app> --args <project>`
- Linux: 直接 spawn `<editor> <project>`

### `liveCoding.ts`

通过 `UnrealEditor-Cmd -ExecCmds="LiveCoding.Compile"` 触发 Live Coding 编译。

### `taskProvider.ts`

把 UBT 构建注册成 VS Code Task（`Ctrl+Shift+B`）。**当前是 placeholder**（Phase 4 才接真实命令）。

### `types.ts`

```ts
interface UBTArgs { project, target, platform, configuration, ubtPath }
interface UBTCommand { file, args, cwd?, env? }
interface BuildResult { exitCode, durationMs, output, diagnostics }
interface BuildOptions { signal?, onProgress?, onOutput? }
interface ParsedDiagnostic { file, line, column?, severity, code, message, raw }
```

---

## 5. `src/clangd/` —— clangd 配置

### `index.ts`

导出 `activateClangd()`。包含 `CompletionModeController` + `WorkspaceBackup`。

### `clangdConfig.ts`

**核心**：写 `.clangd` YAML 文件。

```ts
writeClangdConfig(projectPath): Promise<string>  // 写默认 .clangd
renderClangdConfig(config): string                // 转对象为 YAML 文本
defaultClangdConfig(): ClangdConfig                // 默认配置（关闭 MSVC 假阳性警告）
replaceSystemIncludeBlock(yaml, newFlags): string  // 替换 system include 块（setSystemIncludes 用）
```

**关键点**：默认 `.clangd` 配置里 `CompileFlags.Add: [-std=c++20, -Wno-unknown-warning-option, ...]`；`Diagnostics.Suppress` 关闭 clangd 对 MSVC 宏的误报。

### `compileCommands.ts`

```ts
generateCompileCommands({ project, engineRoot }): Promise<string>  // 跑 UBT -ProjectFiles
linkToWorkspaceRoot(jsonPath, projectPath): Promise<string>         // symlink 到项目根
isClangdAvailable(): Promise<boolean>                                // 检查 clangd 是否在 PATH
```

UBT 生成的 `compile_commands.json` 在 `<Project>/Saved/` 下；`linkToWorkspaceRoot` 用 symlink（或 Windows 上 fallback 复制）放到项目根，让 clangd 找到。

### `windowsSdk.ts`

**核心**：发现 MSVC + Windows SDK 路径。

```ts
discoverSystemIncludes(clangdPath?, logger?): Promise<SystemIncludeInfo | null>
listMsvcVersions(parent): Promise<string[]>
listSdkVersions(parent): Promise<string[]>
renderClangdFlags({ msvcRoot, sdkRoot, fmsCompatibilityVersion }): Promise<string[]>
```

**发现策略**：
1. 找 `clangd.exe`（配置 / `where clangd` / PATH walk / 默认 LLVM 路径）
2. 跑 `clangd --version` 拿 `InstalledDir:` 字段
3. 用 InstalledDir 拼出 `clang++.exe`
4. 跑 `<clang++.exe> -v -E -xc++ -` 拿系统 include 搜索列表
5. 从 include 路径里识别 MSVC root 和 Windows SDK root

详见 [05-code-reference.md](./05-code-reference.md#clangd-路径发现)。

### `preparseIncludes.ts`

加载 `resources/preparse-includes/ue5-{fast,slow}.json` —— UE5 头文件列表，让 clangd 预先包含它们（让 UCLASS / UPROPERTY 宏被识别）。

```ts
loadBundledList(mode): Promise<string[]>
mergeUserCustomizations(projectPath, baseList): Promise<string[]>  // 合并 .vscode/unreal-clangd/*.h
getPrepareIncludesList(mode, projectPath): Promise<string[]>
toIncludeFlags(headers): string[]                                    // → -include <header> 标志
```

### `completionMode.ts`

状态栏上的 `$(zap) UE⚡` / `$(clock) UE⌚` —— fast / slow 模式切换。

### `workspaceBackup.ts`

**核心**：备份 `.code-workspace`，防止 UBT 刷新覆盖。

```ts
class WorkspaceBackup {
  snapshot(): Promise<void>      // 复制当前 .code-workspace → .vscode/.code-workspace.backup
  restore(): Promise<void>       // 从备份恢复
  startWatching(): Disposable    // 监听 .code-workspace 变化，自动恢复
}
```

**当前状态**：类已实现，但 `executeBuild` 没有调用 `snapshot/restore`（待 Phase 5 接入）。

### `types.ts`

```ts
type CompletionMode = 'fast' | 'slow'
interface ClangdConfig { CompileFlags?, Diagnostics?, Index? }
interface CompileCommandsEntry { directory, file, arguments?, command?, output? }
```

---

## 6. `src/ui/` —— 用户界面

### `index.ts`

导出 `activateUI()`。创建 `StatusBarManager` 并 await `detection.ready` 后渲染。

### `statusBar.ts` —— **核心 UI**

11 个状态栏按钮的 `StatusBarManager` 类。

详见 [01-architecture.md §4](./01-architecture.md#状态栏-ui-渲染规则)。

### `quickPicks.ts`

```ts
pickProject(projects): Promise<ProjectInfo | undefined>
pickEngine(engines): Promise<EngineInstall | undefined>
pickConfiguration(): Promise<string | undefined>
pickTarget(): Promise<string | undefined>
pickPlatform(): Promise<string | undefined>
```

### `outputChannel.ts`

全局共享的 Output 通道，所有 Logger 都写到这里。

### `problemsPanel.ts`

`pushDiagnostics(diagnostics)` —— 把 MSVC / 链接器错误推到 VS Code Problems 面板。

### `notifications.ts`

`withProgress(title, task)` —— 包装 `vscode.window.withProgress`，task 接收 `report` 回调 + `CancellationToken`。

---

## 7. `src/commands/` —— 命令实现

每个命令一个文件，统一导出 `executeXxx(...)` 函数。`commands/index.ts` 统一注册。

| 文件 | 函数 | 触发命令 |
|---|---|---|
| `build.ts` | `executeBuild(mode, ...)` | build / rebuild / clean |
| `createProject.ts` | `executeCreateProject(...)` | createProject |
| `generateCompileCommands.ts` | `executeGenerateCompileCommands(...)` | generateCompileCommands |
| `installRules.ts` | `executeInstallRules(...)` | installRules |
| `launchEditor.ts` | `executeLaunchEditor(...)` | launchEditor |
| `liveCoding.ts` | `executeLiveCoding(...)` | liveCoding |
| `openWorkspaceFile.ts` | `executeOpenWorkspaceFile()` | openWorkspaceFile |
| `regenerateWorkspace.ts` | `executeRegenerateWorkspace(...)` | regenerateWorkspace |
| `selectConfig.ts` | `executeSelectConfig(...)` | selectConfig |
| `selectTarget.ts` | `executeSelectTarget(...)` | selectTarget |
| `setSystemIncludes.ts` | `executeSetSystemIncludes(...)` | setSystemIncludes |
| `showProjectInfo.ts` | `showProjectInfo(...)` | showProjectInfo |
| `toggleCompletionMode.ts` | `executeToggleCompletionMode(...)` | toggleCompletionMode |
| `uninstall.ts` | `executeUninstall(...)` | uninstall |
| `index.ts` | `activateCommands(...)` | 统一注册所有命令 |

每个命令都遵循同样的形状：
```ts
export async function executeXxx(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  ...otherArgs
): Promise<void>
```

---

## 8. `src/mcp/` —— Model Context Protocol

### `index.ts`

`activateMcp()` —— 启动 MCP 服务器。

### `lifecycle.ts`

`detectHost()` —— 检测当前是不是 Cursor / Claude Code / 其他 AI 工具。

### `server.ts`

MCP 服务器主循环。监听 stdio / socket，响应 AI 工具的请求。

### `tools.ts`

注册 MCP tools：列出 UE 项目、读 .uproject、读 .clangd 配置等。

---

## 9. `src/parsers/` —— 输出解析器

把 UBT / MSVC / 链接器的 stdout/stderr 解析成结构化 `ParsedDiagnostic[]`。

### `msvcParser.ts`

正则匹配 MSVC 错误格式：`file(line,col): error/warning C1234: message`

### `ubtParser.ts`

解析 UBT 的进度行：`[1/N] xxx` → `{ current, total, description }`

### `linkerParser.ts`

解析链接器错误（重复符号、未解析外部符号等）。

### `uprojectParser.ts`

解析 .uproject（**JSON5**，与 `UprojectScanner` 一致）。

---

## 10. `src/rules/` —— AI agent rules

### `cursorRules.ts`

为 Cursor IDE 复制 .cursorrules / rules 文件到项目。

### `index.ts`

`activateRules()` —— 把插件内置的 AI agent rules 复制到工作区。

---

## 11. `src/extension.ts` —— 入口

按固定顺序激活所有模块：

```ts
initI18n()           // 必须最先：Logger 也要用翻译
new Logger()
new Config()

activateDetection()  // 1. 检测
activateBuild()      // 2. 构建
activateClangd()     // 3. clangd
activateUI()         // 4. UI
activateCommands()   // 5. 命令
activateMcp()        // 6. MCP（如果启用）
```

注意：**没有显式**"activate i18n"，i18n 在 Logger 之前被 init。

---

## 下一步

- [03-user-guide.md](./03-user-guide.md) —— 怎么用
- [04-developer-guide.md](./04-developer-guide.md) —— 怎么改
- [05-code-reference.md](./05-code-reference.md) —— 关键算法详解