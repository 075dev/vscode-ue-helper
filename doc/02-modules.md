# 02 — 模块参考

> 每个模块的入口、文件清单、关键类型/函数、外部依赖。
> 进入具体模块开发前先读对应 `src/<module>/AGENTS.md`。

## 1. `src/core/` —— 基础设施

无外部依赖，被所有其他模块依赖。

| 文件 | 职责 |
|---|---|
| `logger.ts` | `Logger` 类：包装 `vscode.window.createOutputChannel('VSCodeUEHelper')`，统一 info/warn/error 日志格式（带 `[module]` 前缀） |
| `config.ts` | `Config` 类：强类型封装 `vscode.workspace.getConfiguration('vscodeUEHelper')`；每个 getter 对应 `package.json` 里一个设置；`update()` 写完自动 `refreshRoot()` 防同进程内读取旧值 |
| `command-registry.ts` | `registerCommand(context, id, callback)`：把 `vscode.commands.registerCommand` + `context.subscriptions.push` 打包 |
| `workspace.ts` | **`WorkspaceState` 类（Phase 8 单一真相源）** —— 项目/引擎/路径分 4 层（Level 0 根源 → Level 3 补全文件），getter 缺失时弹错去重 |

### 关键类型

```typescript
// core/logger.ts
export class Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

// core/config.ts
export type BuildConfiguration = 'Debug' | 'DebugGame' | 'Development' | 'Shipping' | 'Test';
export type BuildTarget = 'Editor' | 'Game' | 'Server' | 'Client';
export type BuildPlatform = 'Win64' | 'Mac' | 'Linux';
export type CompletionMode = 'fast' | 'slow';  // deprecated, 归一化为 'slow'
export type MCPMode = 'auto' | 'always' | 'never';

export class Config {
  // Getter 形式: configuration / target / platform / clangdPath / completionMode ...
  async update(key: string, value: unknown, target?: ConfigurationTarget): Promise<void>;
  onDidChange(listener: (e: ConfigurationChangeEvent) => void): Disposable;
}

// core/workspace.ts
export interface WorkspaceFolderInfo {
  name: string; path: string;
  role: 'project' | 'engine' | 'unknown';
  absPath: string;
}

export class WorkspaceState {
  // Level 0 根源
  get workspaceFile(): string | null;
  get workspaceFolders(): WorkspaceFolderInfo[];
  get projectFolder(): WorkspaceFolderInfo | null;
  get engineFolder(): WorkspaceFolderInfo | null;
  get project(): ProjectInfo | null;
  get engine(): EngineInstall | null;
  // Level 1 派生
  get workspaceRoot(): string | null;
  get projectDir(): string | null;
  get projectFile(): string | null;
  get projectName(): string | null;
  get engineRoot(): string | null;
  get engineVersion(): string | null;
  // Level 2 .clangd
  get clangdConfigPath(): string | null;
  get clangdHelperDir(): string | null;
  get compileCommandsPath(): string | null;
  // Level 3 补全文件
  get macroHelperPath(): string | null;
  get ueClangdCompatPath(): string | null;
  get addCompletionsPath(): string | null;
  get addMacroCompletionsPath(): string | null;
}
```

## 2. `src/detection/` —— 项目/引擎检测

依赖 `@core`。

| 文件 | 职责 |
|---|---|
| `index.ts` | `activateDetection()` 入口；读取 `.code-workspace` 的 `folders[]` 并按 `path === '.'` / `name === 'UE5'` 规则打 role |
| `uprojectScanner.ts` | 解析 `.uproject`（JSON5 格式，Epic 用 trailing commas） |
| `engineDiscovery.ts` | 引擎路径枚举 + 读 `Build.version` 拿版本号 |
| `vsBuildTools.ts` | Windows 用 `vswhere.exe` 发现 MSVC 工具链 |
| `workspaceContext.ts` | 持久化用户选择（`context.workspaceState`） |
| `workspaceFolders.ts` | 解析 `.code-workspace` 的 folders 配置 + 读 Build.version |
| `types.ts` | `ProjectInfo` / `EngineInstall` / `VSInstallation` / `WorkspaceSelection` |

### 关键导出

```typescript
export interface DetectionHandles {
  scanner: UprojectScanner;
  discovery: EngineDiscovery;
  vsBuildTools: VsBuildTools;
  workspaceContext: WorkspaceContext;
  ready: Promise<DetectionResult>;
}

export interface DetectionResult {
  projects: ProjectInfo[];
  engines: EngineInstall[];
  workspaceFile: string | undefined;
  workspaceRoot: string | undefined;
  workspaceFolders: WorkspaceFolderInfo[];
  projectFolder: WorkspaceFolderInfo | null;
  engineFolder: WorkspaceFolderInfo | null;
}
```

## 3. `src/build/` —— UBT 构建与 Live Coding

依赖 `@core` / `@detection` / `@parsers`。

| 文件/目录 | 职责 |
|---|---|
| `ubt.ts` | 构造 UBT 命令行；`buildUBTCommand` / `resolveUBTPath` / `resolveUBTTarget` / `resolveEditorPath` / `resolveLiveCodingCmd` |
| `buildRunner.ts` | 实际跑 UBT 进程（用 `execa`），流式 stdout/stderr，把 MSVC 诊断推到 Problems 面板 |
| `taskProvider.ts` | `UBTTaskProvider` 实现 `vscode.TaskProvider` 接口，提供 `ue` 类型任务 |
| `liveCoding.ts` | 触发 UE Live Coding 热重载（仅 Windows + MSVC） |
| `launchEditor.ts` | 跨平台启动 Unreal Editor（cmd / open / 直接 exec） |
| `types.ts` | `UBTArgs` / `UBTCommand` / `BuildResult` / `ParsedDiagnostic` |
| `domain/` | DDD 风格：entities、value-objects、events、services、repositories |
| `application/` | 应用层（use cases / handlers），目前基本为空，是后续业务迁移预留 |
| `infrastructure/` | 基础设施层，目前为空 |

### 关键类型

```typescript
// build/types.ts
export interface UBTArgs {
  target: string;          // 例如 'XianDreamwalkingEditor'
  platform: string;        // 'Win64' | 'Mac' | 'Linux'
  configuration: string;   // 'Development' | 'DebugGame' | 'Debug' | 'Shipping' | 'Test'
  projectPath: string;     // .uproject 绝对路径
  extraArgs?: string[];
}

export interface ParsedDiagnostic {
  file: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'note';
  code?: string;           // 例如 'C2065' / 'LNK2019'
  message: string;
}
```

### UBT 命令行结构

```bash
<EngineRoot>/Engine/Build/BatchFiles/Build.bat \
  <TargetName> <Platform> <Configuration> \
  -Project=<path>.uproject \
  -waitmutex -FromMsBuild
```

### `resolveUBTTarget(uprojectPath, type)`

抽象类型 → 具体 target 名的映射（UBT 按名字查 `.Target.cs`）：

| `type` | target name |
|---|---|
| `Editor` | `<ProjectName>Editor` |
| `Game` | `<ProjectName>` |
| `Server` | `<ProjectName>Server` |
| `Client` | `<ProjectName>Client` |

## 4. `src/clangd/` —— clangd 智能提示

依赖 `@core` / `@detection`。这是最大、最复杂的模块。

| 文件 | 职责 |
|---|---|
| `clangdConfig.ts` | 写/读 `.clangd`（YAML）；`defaultClangdConfig` + `renderClangdConfig` |
| `clangdOps.ts` | **`ClangdOps` 类（Phase 8 统一 API）** —— `readConfig` / `exists` / `writeFull` / `mutate` / `applyAddFlags` |
| `compileCommands.ts` | 跑 UBT `-ProjectFiles` 生成 `compile_commands.json`，符号链接到工作区根 |
| `compileCommandsCache.ts` / `compileCommandsFallback.ts` | 缓存、fallback |
| `completionMode.ts` | fast/slow 模式状态栏控制器（注：fast/slow 已合并为 slow，但 API 保留） |
| `completionFiles.ts` | 创建 `.vscode/vscodeuehelper/` 下的补全 helper 文件 |
| `preparseIncludes.ts` | 加载 `resources/preparse-includes/ue5-slow.json` 头列表 |
| `workspaceBackup.ts` | UBT 跑 `-ProjectFiles` 前后备份/恢复 `.code-workspace` |
| `windowsSdk.ts` | MSVC + Windows SDK 路径发现（`vswhere.exe` + 枚举 Kit/Include） |
| `ueClangdCompat.ts` | 写 `ueClangdCompat.h`：重写 `BODY_MACRO_COMBINE` 让 `UCLASS()` / `GENERATED_BODY()` 在 `.generated.h` 缺失时仍能展开 |
| `ueMacroCompletionProvider.ts` | UE 宏（UCLASS / UPROPERTY / UFUNCTION / USTRUCT / UENUM）参数补全 provider |
| `ueReflectionLinter.ts` | 反射头文件 lint（检查 `GENERATED_BODY()` 等） |
| `headerCache.ts` / `fingerprint.ts` / `fileWatcher.ts` / `intermediateUhtCollector.ts` | 头缓存、fingerprint 增量扫描、UE 反射头文件 watcher、UHT 中间目录收集 |
| `proxyManager.ts` | clangd LSP 代理管理：enable/disable/reapply，备份 clangd.path，重启提示 |
| `perfLog.ts` / `perfProxy.ts` / `perfStatusBar.ts` / `proxyLogChannel.ts` / `proxyLogTailer.ts` | 性能埋点、代理日志面板 |
| `diagnostics/` | Diagnose Clangd Project 命令的检查器：checks、io、format、types |
| `proxy/` | **独立的 clangd LSP 代理 CLI**（不依赖 vscode） |

### 关键类型

```typescript
// clangd/types.ts
export type CompletionMode = 'fast' | 'slow';  // 实际只走 slow

export interface ClangdConfig {
  If?: IfBlock;
  CompileFlags?: { Remove?: string[]; Add?: string[]; Compiler?: string; CompilationDatabase?: string };
  Diagnostics?: { UnusedIncludes?: 'Strict' | 'None'; MissingIncludes?: 'Strict' | 'None'; Suppress?: string[] };
  InlayHints?: { Enabled?: 'Yes' | 'No'; ParameterNames?: 'Yes' | 'No'; DeducedTypes?: 'Yes' | 'No' };
}

// clangd/clangdOps.ts
export class ClangdOps {
  get workspace(): WorkspaceState;
  async readConfig(): Promise<ClangdConfig | null>;
  async exists(): Promise<boolean>;
  async writeFull(opts: ClangdConfigOptions): Promise<{ path: string } | null>;
  async mutate(closure: (ctx: { config: ClangdConfig }) => void): Promise<ClangdMutateResult>;
  async applyAddFlags(flags: readonly string[]): Promise<ClangdMutateResult>;
}
```

### `.clangd` 默认结构（Plan Add 收束后）

```yaml
CompileFlags:
  CompilationDatabase: .vscode/vscodeuehelper
  Add: []                    # 永远空数组！由用户在控制面板显式勾选
Diagnostics:
  UnusedIncludes: None
InlayHints:
  Enabled: Yes
  ParameterNames: Yes
  DeducedTypes: Yes
```

**关键不变式**：`CompileFlags.Add` 永远 `[]`，系统零默认注入。所有 Add 由用户在控制面板「自定义 Add Flags」tab 显式勾选决定，或由 `setSystemIncludes` / `createProject` 通过 `ClangdOps.applyAddFlags` 写入。

### `src/clangd/proxy/` —— 独立 LSP 代理 CLI

不依赖 `vscode`，编译为 `out/clangdProxy.js` 后作为 Node 子进程跑。

| 文件 | 职责 |
|---|---|
| `cli.ts` | CLI 入口；解析参数 + 创建 `ProcessBridge` + 创建 `LspBridge` + 注册信号处理器 |
| `cliArgs.ts` | `parseArgs` 纯函数 + `CliOptions` 类型 |
| `cliRuntime.ts` | CLI 运行时（realIo / realStdio / wireBridgeStdio） |
| `bridge.ts` | LSP 协议桥接（didClose keepalive + 翻译钩子） |
| `processBridge.ts` | 真实 clangd 子进程适配器（stdout 是 LSP 协议通道，不写日志） |
| `framing.ts` | LSP 帧编解码（Content-Length header） |
| `messages.ts` | JSON-RPC 消息解析 + 请求/响应关联 |
| `keepalive.ts` | didClose 保活（防止 clangd 索引被回收） |
| `localization.ts` | clangd 输出汉化（hover / diagnostics / codeAction） |
| `genericTranslator.ts` | 通用术语翻译 |
| `ueDiagnosticWatcher.ts` | **[Phase 8]** 监听 UE 诊断，被动触发 UBT 重生成 |
| `generatedHeaderWatcher.ts` | **[Phase 8]** 监听 `.generated.h` 文件变化 + trigger 文件 |
| `ueDocLookup.ts` | UE 文档词典查询（用于 hover 汉化） |
| `realClangdResolver.ts` | 真实 clangd 路径解析 |
| `settingsManager.ts` / `settingsReader.ts` | 代理侧配置管理 + 读取 |
| `status.ts` | 代理状态展示 |

**CLI 形式**：

```bash
node out/clangdProxy.js \
  --real-clangd=<path> \
  --keepalive-max=20 --keepalive-ttl-sec=900 \
  [--log-path=<path>] [--localization-enabled] \
  [--project-dir=<path>] [--engine-root=<path>] [--ubt-path=<path>] \
  -- \
  <clangd 原生参数>
```

## 5. `src/parsers/` —— 错误解析器

依赖 `@build`（用 `ParsedDiagnostic` 类型）。

| 文件 | 职责 |
|---|---|
| `msvcParser.ts` | MSVC 错误格式 `file(line,col): severity Code: message` + 链接器 `LNK2019` / `LNK1120` |
| `ubtParser.ts` | UBT 摘要行 `[N/M] description` + Total build time |
| `linkerParser.ts` | 单独链接器错误（被 msvcParser 合并） |
| `uprojectParser.ts` | `.uproject` JSON5 解析（实际被 `detection/uprojectScanner.ts` 间接使用） |

### MSVC 正则（**两处定义必须同步**）

```typescript
// src/parsers/msvcParser.ts
const MSVC_RE = /^(.*?)\((\d+)(?:,(\d+))?\)\s*:\s*(error|warning|note|fatal error)\s+([A-Z]+\d+)\s*:\s*(.*)$/;

// package.json#contributes.problemMatchers[0].pattern.regexp
"^(.*)\\((\\d+)(?:,(\\d+))?\\):\\s+(error|warning|note|fatal error)\\s+([A-Z]+\\d+):\\s+(.*)$"
```

## 6. `src/commands/` —— 20 个 VS Code 命令

依赖 `@core` / `@detection` / `@clangd` / `@ui` / `@i18n`。完整命令列表见 `package.json#contributes.commands`，下面是分组速查。

**构建相关**

| 命令 ID | 实现文件 | 功能 |
|---|---|---|
| `vscodeUEHelper.build` | `build.ts` | UBT 构建 |
| `vscodeUEHelper.rebuild` | `build.ts` | 清理 + 构建 |
| `vscodeUEHelper.clean` | `build.ts` | 清理构建产物 |

**编辑器与 Live Coding**

| 命令 ID | 实现文件 | 功能 | 平台限制 |
|---|---|---|---|
| `vscodeUEHelper.launchEditor` | `launchEditor.ts` | 启动 Unreal Editor | — |
| `vscodeUEHelper.liveCoding` | `liveCoding.ts` | Live Coding 热重载 | Windows only（命令面板 `when: isWindows`） |

**clangd 项目**

| 命令 ID | 实现文件 | 功能 |
|---|---|---|
| `vscodeUEHelper.generateCompileCommands` | `generateCompileCommands.ts` | 生成 `compile_commands.json` |
| `vscodeUEHelper.diagnoseProject` | `diagnoseProject.ts` | 诊断 clangd 项目（写报告到 Output） |
| `vscodeUEHelper.createProject` | `createProject.ts` | 脚手架（`.clangd` + `.vscode/vscodeuehelper/*`） |
| `vscodeUEHelper.setSystemIncludes` | `setSystemIncludes.ts` | 设置 Windows SDK / MSVC 头（Windows only） |
| `vscodeUEHelper.uninstall` | `uninstall.ts` | 清理所有生成文件 |

**代理（clangd LSP Proxy）**

| 命令 ID | 实现文件 | 功能 |
|---|---|---|
| `vscodeUEHelper.enableClangdProxy` | `enableClangdProxy.ts` | 启用代理（写 clangd.path + 备份） |
| `vscodeUEHelper.disableClangdProxy` | `disableClangdProxy.ts` | 禁用代理（恢复 clangd.path） |
| `vscodeUEHelper.showClangdProxyStatus` | `showClangdProxyStatus.ts` | 显示代理状态 |

**UI / 信息**

| 命令 ID | 实现文件 | 功能 |
|---|---|---|
| `vscodeUEHelper.showProjectInfo` | `showProjectInfo.ts` | 显示检测结果 |
| `vscodeUEHelper.showControlPanel` | `showControlPanel.ts` | 打开侧边栏控制面板 |
| `vscodeUEHelper.selectConfig` | `selectConfig.ts` | QuickPick 选构建配置 |
| `vscodeUEHelper.selectTarget` | `selectTarget.ts` | QuickPick 选构建目标 |
| `vscodeUEHelper.openWorkspaceFile` | `openWorkspaceFile.ts` | 打开 `.code-workspace` |
| `vscodeUEHelper.installRules` | `installRules.ts` | 写 Cursor / Copilot 规则文件 |

注：`toggleCompletionMode` 在状态栏触发，不在命令面板列表中。

## 7. `src/ui/` —— 用户界面

依赖 `@core` / `@detection` / `@clangd`。

| 文件 | 职责 |
|---|---|
| `statusBar.ts` | `StatusBarManager`：11 个状态栏按钮 |
| `quickPicks.ts` | 引擎 / 配置 / 目标 / 平台 QuickPick 选择器 |
| `notifications.ts` | `notifyInfo` / `notifyWarn` / `notifyError` 封装 |
| `problemsPanel.ts` | Problems 面板诊断管理（一个 DiagnosticCollection） |
| `outputChannel.ts` | Output Channel 包装 |
| `controlPanel.ts` + `controlPanel.html.ts` + `controlPanelMessages.ts` | 侧边栏 Webview 控制面板（`.clangd` Add flags 自定义） |
| `perfStatusBar.ts` | 状态栏性能三段（默认关闭） |

### 状态栏布局

```
[配置] [目标] [平台] [构建] [启动] [热重载] [clangd] [项目] [引擎] [检测] [日志]
```

详细按钮职责见 `src/ui/AGENTS.md`。

## 8. `src/mcp/` —— MCP 服务器

依赖 `@core` / `@build` / `@clangd` / `@commands`（仅在 Cursor / Claude Code 启动）。

| 文件 | 职责 |
|---|---|
| `server.ts` | `MCPServer` 类：包装 `@modelcontextprotocol/sdk` 的 Server + StdioServerTransport |
| `tools.ts` | `MCP_TOOLS` 6 个工具定义 + `callTool` 派发 |
| `lifecycle.ts` | `shouldStartMCP` / `detectHost`（环境变量判断） |

### 6 个 MCP 工具

| 工具名 | 功能 |
|---|---|
| `ue_build` | UBT 构建（mode: build / rebuild / clean） |
| `ue_launch_editor` | 启动 Unreal Editor |
| `ue_live_coding` | Live Coding 热重载 |
| `ue_generate_compile_commands` | 生成 `compile_commands.json` |
| `ue_show_project_info` | 返回检测结果 |
| `ue_toggle_completion_mode` | 切换 fast/slow（实际只走 slow） |

注意：`mcp/tools.ts:callTool` 当前是 Phase 5 stub，未真实派发到 `commands/executeXxx`。Phase 8 之后应该接上。

## 9. `src/rules/` —— AI 规则生成

无外部依赖。

| 文件 | 职责 |
|---|---|
| `cursorRules.ts` | `UE_HELPER_RULES_MDC`（`.cursor/rules/*.mdc`）+ `UE_HELPER_COPILOT_INSTRUCTIONS`（`.github/copilot-instructions.md`） |
| `index.ts` | re-export |

## 10. `src/i18n/` —— 中英双语

依赖 `vscode.env`。

| 文件 | 职责 |
|---|---|
| `index.ts` | `initI18n()` / `t(key, params)`；按 `vscode.env.language` 选 locale，缺 key fallback 英文 |
| `locales/en.json` | 英文文案 |
| `locales/zh.json` | 中文文案 |

**约束**：所有用户可见字符串走 `t()`，改文案必须同步两个文件。