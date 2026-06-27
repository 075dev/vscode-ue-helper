# src/detection 与 src/build 模块分析报告

> 分析日期: 2026-06-26 | 文件数: detection 10 个, build 7 个 | 总计 17 个 .ts 文件

---

## 一、src/detection 模块 (UE 引擎发现 / .uproject 扫描 / VS Build Tools 检测)

### 1.1 模块概览

`detection` 模块是插件的"感知层"，负责发现和识别工作区中的 Unreal Engine 项目和引擎安装。核心设计理念是 **信任 `.code-workspace` 作为单一信息源**，不做文件系统扫描去"猜测"项目位置。架构约定：

- `folders[0]` → 项目目录 (`name` 对应 `.uproject` 文件名)
- `folders[1]` → 引擎根目录 (含 `Engine/Build/Build.version`)

任何路径上期望文件不存在时，log error + 返回空结果，由 UI 层展示警告。

主要流程由 `activateDetection()` 驱动，返回 `DetectionHandles` 对象（含 `ready: Promise<DetectionResult>`）。

| 文件 | 职责 | 行数 |
|---|---|---|
| `types.ts` | 共享类型定义 | 46 |
| `index.ts` | 模块入口, `activateDetection` 主流程 | 156 |
| `uprojectScanner.ts` | 解析 .uproject (JSON5) | 144 |
| `engineDiscovery.ts` | 验证引擎路径, 读 Build.version | 150 |
| `engineLocator.ts` | 按版本号搜引擎 (注册表/文件系统, 备用 API) | 161 |
| `workspaceFolders.ts` | 读 .code-workspace 的 folders[] | 113 |
| `workspaceEngines.ts` | 从工作区发现引擎候选 | 78 |
| `workspaceContext.ts` | 跨会话持久化用户选择 (Memento) | 66 |
| `uprojectAssociation.ts` | 检测 UE 是否安装 (reg query) | 99 |
| `vsBuildTools.ts` | 定位 VS Build Tools (vswhere) | 169 |

---

### 1.2 符号表

#### 类型 (Interfaces / Types)

| 符号 | 文件 | 说明 |
|---|---|---|
| `ProjectInfo` | `types.ts` | .uproject 解析结果: path, name, engineAssociation, modules, raw |
| `EngineInstall` | `types.ts` / `engineDiscovery.ts` | 引擎安装信息: path, version, isLauncherInstall |
| `VSInstallation` | `types.ts` | VS 安装信息: displayName, installationPath, version, vcToolsPath |
| `WorkspaceSelection` | `types.ts` | 用户选择: selectedProject?, selectedEngine? |
| `EngineLocation` | `engineLocator.ts` | 引擎位置: path, version, source (registry/common-path/mac-fs/linux-fs) |
| `EngineDiscoveryOptions` | `engineDiscovery.ts` | EngineDiscovery 构造参数: candidates |
| `DiscoveryResult` | `engineDiscovery.ts` | 发现结果: valid[], invalid[] |
| `ClassifiedFolder` | `workspaceFolders.ts` | 文件夹分类: path, isProject, isEngine, uprojectPath? |
| `DetectionHandles` | `index.ts` | 激活后句柄: scanner, discovery, vsBuildTools, workspaceContext, ready |
| `DetectionResult` | `index.ts` | 检测结果: projects[], engines[], workspaceFile |
| `RawUProject` | `uprojectScanner.ts` (内部) | .uproject JSON 结构 |

#### 类 (Classes)

| 符号 | 文件 | 关键方法 |
|---|---|---|
| `UprojectScanner` | `uprojectScanner.ts` | `scan(folderPaths?)`, `findSingle(folderPaths?)`, `parseFromPath(uprojectPath)` |
| `EngineDiscovery` | `engineDiscovery.ts` | `discover()`, `discoverWithErrors()`, `getInvalidPaths()` |
| `WorkspaceContext` | `workspaceContext.ts` | `getSelection()`, `setProject()`, `setEngine()`, `clear()` |
| `VsBuildTools` | `vsBuildTools.ts` | `findLatest()`, `findAll()` |

#### 函数 (Functions)

| 符号 | 文件 | 说明 |
|---|---|---|
| `activateDetection()` | `index.ts` | 模块激活入口, 读 .code-workspace → 解析 project + engine |
| `locateEngineByVersion()` | `engineLocator.ts` | 按版本号查找引擎 (注册表→常见路径→文件系统) |
| `locateEngineByVersionAsInstall()` | `engineLocator.ts` | 同上, 但返回 EngineInstall |
| `readWorkspaceFolders()` | `workspaceFolders.ts` | 读 .code-workspace 返回 folders 路径数组 |
| `classifyFolders()` | `workspaceFolders.ts` | 分类文件夹 (项目/引擎) |
| `readBuildVersion()` | `workspaceFolders.ts` | 解析 Build.version → "5.8.0" |
| `readWorkspaceEngines()` | `workspaceEngines.ts` | 从 .code-workspace 读引擎路径 |
| `discoverEngineCandidatesFromWorkspace()` | `workspaceEngines.ts` | 按命名模式发现引擎候选 |
| `checkUprojectAssociation()` | `uprojectAssociation.ts` | 检查 OS 是否安装 UE |

---

### 1.3 对外依赖

#### 内部模块依赖

```
@core/logger     ← Logger (index.ts)
@core/config     ← Config (index.ts)
./types          ← ProjectInfo, EngineInstall, VSInstallation, WorkspaceSelection (几乎所有文件)
./uprojectScanner   ← UprojectScanner (index.ts)
./engineDiscovery   ← EngineDiscovery (index.ts)
./vsBuildTools      ← VsBuildTools (index.ts)
./workspaceContext  ← WorkspaceContext (index.ts)
./workspaceFolders  ← readBuildVersion (index.ts)
```

#### 第三方 / npm 依赖

| 包 | 使用文件 | 用途 |
|---|---|---|
| `json5` | `uprojectScanner.ts` | 解析 UE 的 JSON5 格式 .uproject (注释/尾逗号/单引号) |
| `vscode` | `index.ts`, `workspaceContext.ts`, `uprojectScanner.ts` | VS Code API (workspace, Memento, findFiles, RelativePattern) |

#### Node.js 内置模块依赖

| 模块 | 使用文件 |
|---|---|
| `node:fs/promises` | `index.ts`, `uprojectScanner.ts`, `engineLocator.ts`, `workspaceFolders.ts`, `workspaceEngines.ts`, `uprojectAssociation.ts`, `engineDiscovery.ts`, `vsBuildTools.ts` |
| `node:path` | `index.ts`, `engineLocator.ts`, `workspaceFolders.ts`, `workspaceEngines.ts`, `uprojectAssociation.ts`, `vsBuildTools.ts`, `engineDiscovery.ts` |
| `node:child_process` (`execFile`) | `engineLocator.ts`, `uprojectAssociation.ts`, `vsBuildTools.ts` |
| `node:util` (`promisify`) | `engineLocator.ts`, `uprojectAssociation.ts` |

#### 平台依赖

| 功能 | 平台 | 外部工具 |
|---|---|---|
| 注册表查询引擎 | Windows | `reg.exe` (reg query) |
| vswhere 定位 VS | Windows | `vswhere.exe` |
| 注册表检查 UE 关联 | Windows | `reg.exe` (HKCR\\.uproject) |
| 文件系统扫描 | Mac/Linux | 无外部依赖 |

---

## 二、src/build 模块 (UBT 构建 / Live Coding / 任务提供)

### 2.1 模块概览

`build` 模块是插件的"构建层"，负责：
1. **构造 UBT 命令行** — 将抽象配置 (target/platform/configuration) 转为 UBT 可识别的参数
2. **执行构建** — 调用 `spawn` 跑构建脚本，流式输出，解析 MSVC 诊断信息
3. **Live Coding 热重载** — 触发 UE Editor 的 Live Coding 编译
4. **启动 Editor** — 跨平台启动 UnrealEditor
5. **VS Code Task 集成** — 注册 `build/rebuild/clean` 任务，支持 Ctrl+Shift+B

当前 taskProvider 为 placeholder 实现（echo 占位），真正的 UBT 调用在 Phase 4 完成。

| 文件 | 职责 | 行数 |
|---|---|---|
| `types.ts` | 构建层共享类型 | 60 |
| `index.ts` | 模块入口, `activateBuild` | 47 |
| `ubt.ts` | UBT 命令构造、路径解析 | 108 |
| `buildRunner.ts` | 执行构建 (spawn + 流式 + kill tree) | 159 |
| `liveCoding.ts` | 触发 Live Coding 热重载 | 47 |
| `launchEditor.ts` | 跨平台启动 UE Editor | 58 |
| `taskProvider.ts` | VS Code Task 注册 | 118 |

---

### 2.2 符号表

#### 类型 (Interfaces / Types)

| 符号 | 文件 | 说明 |
|---|---|---|
| `UBTArgs` | `types.ts` | UBT 参数: project, target, platform, configuration, ubtPath |
| `UBTCommand` | `types.ts` | UBT 命令: file, args, cwd?, env? |
| `BuildResult` | `types.ts` | 构建结果: exitCode, durationMs, output[], diagnostics[] |
| `ParsedDiagnostic` | `types.ts` | 解析的诊断: file, line, column?, severity, code, message, raw |
| `BuildOptions` | `types.ts` | 构建选项: signal?, onProgress?, onOutput? |
| `LiveCodingOptions` | `liveCoding.ts` | Live Coding 选项: engineRoot, platform, projectPath |
| `LaunchOptions` | `launchEditor.ts` | Editor 启动选项: engineRoot, platform, projectPath, extraArgs? |
| `BuildHandles` | `index.ts` | 构建句柄: taskProvider |

#### 类型别名

| 符号 | 文件 | 说明 |
|---|---|---|
| `BuildResult_` | `buildRunner.ts` | Result 风格: `{ok:true, value}` \| `{ok:false, error}` |

#### 类 (Classes)

| 符号 | 文件 | 关键方法 |
|---|---|---|
| `UBTTaskProvider` | `taskProvider.ts` | `provideTasks()`, `resolveTask()` (implements vscode.TaskProvider) |

#### 函数 (Functions)

| 符号 | 文件 | 说明 |
|---|---|---|
| `activateBuild()` | `index.ts` | 模块激活入口, 注册 TaskProvider |
| `resolveUBTTarget()` | `ubt.ts` | 映射 target 类型 → UBT 目标名 (如 `XianDreamwalkingEditor`) |
| `buildUBTCommand()` | `ubt.ts` | 构造 UBT 命令行参数 |
| `resolveUBTPath()` | `ubt.ts` | 解析 UBT 脚本路径 (Build.bat / RunUBT.sh) |
| `resolveEditorPath()` | `ubt.ts` | 解析 UnrealEditor 可执行文件路径 |
| `resolveLiveCodingCmd()` | `ubt.ts` | 构造 Live Coding 控制台命令 |
| `runBuild()` | `buildRunner.ts` | 执行 UBT 构建 (spawn + 流式输出 + 进程树管理) |
| `triggerLiveCoding()` | `liveCoding.ts` | 触发 Live Coding (仅 Windows) |
| `isLiveCodingSupported()` | `liveCoding.ts` | 检查当前平台是否支持 Live Coding |
| `launchEditor()` | `launchEditor.ts` | 跨平台启动 UnrealEditor (detached) |
| `buildTaskArgs()` | `taskProvider.ts` | 快捷构造 UBT 任务参数 |

---

### 2.3 对外依赖

#### 内部模块依赖

```
@core/config       ← BuildConfiguration, BuildPlatform, BuildTarget (taskProvider.ts, types.ts, liveCoding.ts, launchEditor.ts)
@core/logger       ← Logger (index.ts)
@core/config       ← Config (index.ts, taskProvider.ts)
@detection         ← DetectionHandles (index.ts), UprojectScanner, EngineDiscovery (taskProvider.ts)
@parsers/msvcParser ← MsvcParser (buildRunner.ts)
@parsers/ubtParser  ← UbtParser (buildRunner.ts)
./types            ← UBTArgs, UBTCommand, BuildResult, ParsedDiagnostic, BuildOptions (多个文件)
./ubt              ← resolveEditorPath, resolveLiveCodingCmd (launchEditor.ts, liveCoding.ts)
./taskProvider     ← UBTTaskProvider, buildTaskArgs (index.ts)
```

#### 第三方 / npm 依赖

| 包 | 使用文件 | 用途 |
|---|---|---|
| `vscode` | `index.ts`, `taskProvider.ts` | VS Code API (TaskProvider, Task, ProcessExecution, tasks) |

#### Node.js 内置模块依赖

| 模块 | 使用文件 |
|---|---|
| `node:path` | `ubt.ts` |
| `node:child_process` (`spawn`, `execFile`) | `buildRunner.ts`, `liveCoding.ts`, `launchEditor.ts` |
| `node:util` (`promisify`) | `buildRunner.ts` |

#### 平台依赖

| 功能 | 平台 | 外部工具 |
|---|---|---|
| .bat 文件执行 | Windows | `cmd.exe /c` |
| kill 进程树 | Windows | `taskkill /F /T /PID` |
| kill 进程组 | POSIX | `process.kill(-pid, SIGTERM)` |
| Editor 启动 | Windows | `cmd /c start` |
| Editor 启动 | Mac | `open -a` |
| Editor 启动 | Linux | 直接 spawn 二进制 |
| Live Coding | Windows only | UnrealEditor-Cmd.exe |

---

## 三、模块间依赖关系图

```
┌──────────────────────────────────────────────────────┐
│  @core/config    @core/logger                        │
│  (BuildPlatform, Config, Logger, etc.)               │
└──────┬──────────────────────────────┬────────────────┘
       │                              │
       ▼                              ▼
┌──────────────┐              ┌──────────────┐
│  detection/  │              │   build/     │
│              │──────────────▶│              │
│  types.ts    │ DetectionHandles │ types.ts    │
│  uproject... │              │  ubt.ts     │
│  engine...   │              │  buildRunner│
│  vsBuild...  │              │  liveCoding │
│  workspace...│              │  launchEdit.│
│  index.ts    │              │  taskProv.  │
└──────┬───────┘              │  index.ts   │
       │                      └──────┬───────┘
       │                             │
       │         ┌───────────────────┘
       │         │
       ▼         ▼
┌─────────────────────────────┐
│  @parsers/                  │
│  msvcParser, ubtParser      │
└─────────────────────────────┘
```

**关键依赖链:**
- `build/index.ts` → `@detection` 获取 `DetectionHandles` (含 scanner, discovery)
- `build/taskProvider.ts` → `@detection` 获取 `UprojectScanner`, `EngineDiscovery`
- `build/buildRunner.ts` → `@parsers/msvcParser`, `@parsers/ubtParser` 解析构建输出
- 两个模块都依赖 `@core/config` 和 `@core/logger`

---

## 四、设计要点总结

### detection 模块
1. **单一信息源**: 完全信任 `.code-workspace` 的 `folders[]` 配置，不做猜测性扫描
2. **JSON5 容忍**: `.uproject` 使用 `json5` 解析 (UE 允许注释/尾逗号/单引号)
3. **跨会话持久化**: `WorkspaceContext` 用 VS Code Memento API 记住用户选择
4. **备用 API**: `engineLocator.ts` 提供注册表/文件系统扫描，当前未被主流程使用
5. **Windows 特化**: `vsBuildTools.ts` 用 `vswhere.exe` 定位 MSVC 工具链

### build 模块
1. **进程树管理**: `buildRunner.ts` 完整处理跨平台进程终止 (Windows `taskkill /T`, POSIX `kill(-pid)`)
2. **placeholder Task**: `UBTTaskProvider` 当前为占位实现，Phase 4 将接入真实 UBT 调用
3. **跨平台启动**: `launchEditor.ts` 处理 Win/Mac/Linux 三种平台的 Editor 启动方式
4. **Live Coding 仅 Windows**: `triggerLiveCoding()` 在其他平台抛出错误
5. **Result 风格**: `BuildResult_` 使用 `{ok, value/error}` 模式，避免 throw
