<!-- Parent: ../AGENTS.md -->
# build 模块知识库

> 治理参考：`.specify/memory/constitution.md`。本模块是宪法 §I（Windows-First Unreal Scope）与 §III（Localized, Observable, Resource-Safe UX）的硬约束落地点：**仅 Windows** —— UE 5.2+、MSVC 工具链、Windows SDK。Mac / Linux 不在产品范围。即使 `BuildPlatform` 类型上仍存在 `'Mac' | 'Linux'` 历史分支，运行时路径与 UI 入口都以 Windows only 为准；遗留分支保留仅为类型兼容，不应作为新代码决策依据（宪法 §V：reversible evolution，避免扩大兼容面）。

## 模块概述

**UBT 构建 + Live Coding + Editor 启动集成**（Windows-only），负责：
- 构造 Unreal Build Tool 命令行
- 流式输出构建进程日志
- 解析 MSVC 诊断到 VS Code 问题面板
- Task Provider（`Ctrl+Shift+B`）
- Live Coding 热重载触发
- Unreal Editor 启动（Windows）

## 核心文件

| 文件 | 职责 |
|---|---|
| `ubt.ts` | UBT 路径解析、命令行构造 |
| `buildRunner.ts` | 实际执行 UBT 进程、流式输出、诊断解析 |
| `taskProvider.ts` | VS Code Task Provider 实现（`Ctrl+Shift+B`）；从 `WorkspaceState` 同步取项目 / 引擎，解析**真实** UBT 命令 |
| `liveCoding.ts` | Live Coding 热重载触发（**Windows only**） |
| `launchEditor.ts` | Unreal Editor 启动（**Windows only**，直接 spawn `UnrealEditor.exe`，detached） |
| `lock.ts` | 构建互斥锁（build / Live Coding 共用） |
| `lastBuild.ts` | 最近一次构建的进程内快照（MCP `ue_get_build_errors` 的数据源） |
| `types.ts` | 构建相关类型定义（`UBTArgs` / `ParsedDiagnostic` / `BuildResult`） |

## 平台范围

**Windows-only**（宪法 §I）：
- UBT / Live Coding / Editor 启动全部 Windows-only。
- `package.json#platforms: ['win32']`；`vscodeUEHelper.liveCoding` / `setSystemIncludes` 在 `when: isWindows` 下提供。
- `pickPlatform()` UI 选项冻结为 `Win64` 单选；`BuildPlatform` 类型仍包含 `'Mac' | 'Linux'` 是历史保留分支，**新代码不要为这些分支写新逻辑**。

Mac / Linux 平台如果误触发入口，应快速退出 + i18n 友好提示（`t('build.platform.unsupported')` 双语），不抛未受控异常。

## UBT 命令结构

```bash
<engineRoot>/Engine/Build/BatchFiles/Build.bat
  <TargetName>
  <Platform>     # Win64（唯一支持）
  <Configuration> # Debug / DebugGame / Development / Shipping
  -Project="<path>.uproject"
  -waitmutex
  # 可选：-Module="<ModuleName>"（单模块过滤，只编译不链接）
```

### 命令构建器

```typescript
interface UBTArgs {
  project: string;            // .uproject 绝对路径
  target: string;             // e.g. "MyProjectEditor"（resolveUBTTarget 转换后）
  platform: BuildPlatform;    // e.g. "Win64"
  configuration: BuildConfiguration; // e.g. "Development"
  ubtPath: string;            // resolveUBTPath(engineRoot)
  module?: string;            // UBT -Module= 单模块过滤
}

function buildUBTCommand(args: UBTArgs): UBTCommand
// → { file: <Build.bat 路径>, args: [...], cwd?, env? }
```

## BuildRunner 流式执行

使用 Node.js `child_process.spawn` 执行子进程并实时流式输出：

```typescript
interface BuildResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  diagnostics: ParsedDiagnostic[];   // 解析后的错误 / 警告
  durationMs: number;
}
```

**诊断解析管道**：

```
UBT stdout 行
  └── msvcParser.parseLine()   → 提取 file:line:col:severity:message
        └── 写入 VS Code 问题面板（problemsPanel.ts）
```

MSVC 正则定义见 `src/parsers/msvcParser.ts` 与 `package.json#contributes.problemMatchers` —— 修改时**两侧同步**（宪法 Additional Constraints）。

## Task Provider

注册 `ue` 类型的任务提供器，用户按 `Ctrl+Shift+B` 看到构建选项。实现类是 `UBTTaskProvider`（`src/build/taskProvider.ts`），构造时注入 `WorkspaceState`（可选）与 `Config`：

```typescript
class UBTTaskProvider implements vscode.TaskProvider {
  constructor(workspace: WorkspaceState | undefined, config: Config);
  provideTasks(): vscode.ProviderResult<vscode.Task[]>;
  resolveTask(task: vscode.Task): vscode.Task | undefined;
}
```

提供 3 个任务（`TaskScope.Workspace`，problemMatcher `ue-helper-msvc`，MSVC 诊断解析交给 VS Code 侧，不重复实现）：

| 任务名 | task definition | UBT 附加参数 |
|---|---|---|
| `build` | `type: 'ue'` / `taskKind: 'build'` | 无 |
| `rebuild` | `taskKind: 'rebuild'` | `-Rebuild` |
| `clean` | `taskKind: 'clean'` | `-Clean` |

**命令来源 —— 真实 UBT 命令，不是占位任务**：

1. `workspace.projectFile` + `workspace.engineRoot` —— 项目 / 引擎路径取自 `WorkspaceState`（SSoT），provider 内不拼路径；
2. `resolveUBTPath(engineRoot)` → `<engineRoot>/Engine/Build/BatchFiles/Build.bat`；
3. `resolveUBTTarget(projectFile, config.target)` → 具体 target 名（如 `MyProjectEditor`）；
4. `buildUBTCommand({ project, target, platform, configuration, ubtPath })` → `{ file, args }`，任务 `cwd` 取项目目录。

Windows 上 `.bat` 不能直接 `spawn`（Node 抛 `EINVAL`），因此要用 `cmd.exe` 包装。**但不能**用常见的 `cmd.exe /d /s /c "<整条命令单串>"` 写法：

- VS Code 的 `ProcessExecution` 走**非 shell**分支（官方源码 `terminalTaskSystem.ts`：「When we have a process task there is no need to quote arguments」），`args` 原样交给进程，`windowsVerbatimArguments` 为 `false` → Node/libuv 的 `quote_cmd_arg` 会给含空格/引号的参数加引号、把内部 `"` 转义成 `\"`；
- `cmd.exe /c` 只在「引号总数**恰好两个**」时整对保留引号，否则剥掉首尾引号。引擎路径（`C:\Program Files\Epic Games\UE_5.x`）与项目路径通常都含空格 → 两个含空格参数 → 引号总数 4 → cmd 剥掉首尾 → 路径被截断 → 任务报 `The network path was not found.`

**现在的做法**：整条 UBT 命令放进环境变量 `VSCODEUEHELPER_UBT_CMD`，命令行只留一个**不含空格、不含引号**的变量引用 `%VSCODEUEHELPER_UBT_CMD%`（Node 不对它做任何转义），cmd 展开后拿到的正是 `"<Build.bat>" <UBT 参数…>` 标准形态。实测六种形态中只有「环境变量」与「临时 .bat 包装」能跑通，取前者是因为不留临时文件、无需清理。

> 这与 `buildRunner.ts` 的做法**不同**是有原因的：`buildRunner` 用 Node 直接 `spawn`（`windowsVerbatimArguments: true`，自己拼好命令行不转义），所以它可以自己控制引号；Task 侧没有这个开关可用。

**未就绪态**：`workspace` 未注入，或 `projectFile` / `engineRoot` 任一缺失 → `provideTasks()` 返回**空数组**，表现为「没有可用的构建任务」；不提供误导性的占位任务，也不抛错。

**接线**：`activateBuild(context, config, logger, detection, workspace?)` 把 `workspace` 注入 provider，`src/extension.ts` 调用时传入 `WorkspaceState` —— 该参数可选（老调用方 / test 兼容），未注入时 provider 不提供任何任务。

**已知边界（勿当缺陷）**：Task 路径**直接 spawn UBT**，不经过 `commands/build.ts` 的 `executeBuild` 管线 —— 因此它不参与 `lock.ts` 的构建互斥锁，也**不写构建快照**（MCP 的 `ue_get_build_errors` 读不到 Task 构建的结果）。彻底统一需要把 Task 改成 `vscode.CustomExecution` 回调 `executeBuild`（架构级改动，另排期）。

## Live Coding（Windows only）

Live Coding 是 UE5 的热重载机制，通过命令行触发：

```powershell
UnrealEditor.exe <path>.uproject -Execute="LiveCoding.Recompile"
```

**支持**：
- Windows 平台：✅（`isLiveCodingSupported()` → true）
- Mac / Linux：❌ 不在产品范围 —— **直接视为不支持**。

Editor 必须正在运行，命令通过进程间通信触发重编译。

## 构建互斥锁（build / Live Coding 共用）

UBT 同一时间只能跑一个。`build` / `rebuild` / `clean` 与 `liveCoding` 都是 spawn UBT 进程，并发时 UHT 代码生成阶段会交叉写 `Intermediate/Build/` 下的 `.generated.h`，表现为随机出现的 `unknown type name 'FID_...'` 假诊断。

`src/build/lock.ts` 导出三个函数（模块级单状态，**进程内**锁，不是跨进程文件锁）：

```typescript
isBuildLocked(): boolean; // 当前是否有构建在跑
tryLockBuild(): boolean;  // 抢锁；返回 false = 已有构建在跑，调用方应快速拒绝
unlockBuild(): void;      // 释放（幂等）
```

约定：

1. **真正 spawn UBT 之前**才加锁（解析项目 / 引擎阶段不加，避免长时间占锁）；
2. 拿到锁的调用方必须在 `finally` 里 `unlockBuild()`；
3. 「已持锁方再调同一条路径」（build 的「编辑器运行中 → 转发 Live Coding」）走 `alreadyLocked` 参数 —— 不重复加锁，也不重复释放；
4. 抢锁失败 → **快速拒绝**（`cmd.buildInFlight` 提示 + `EC_OPERATION_CANCELLED`），不排队。

## 构建快照（lastBuild）

`src/build/lastBuild.ts` 保存**最近一次构建尝试**的进程内快照，是 MCP 工具 `ue_get_build_errors` 的唯一数据源（MCP server 与扩展宿主同进程，直接读内存）。写入点唯一：`src/commands/build.ts`。

- `buildId`：每次尝试一个（`newBuildId()`，`node:crypto` 的 `randomUUID`）；`startedAtIso`：构建开始时刻（ISO 8601）。两者同时写进 `LastBuildSnapshot` 与 `BuildErrorsSummary`。
- **早退也写快照**：没选到项目 / 没选到引擎 / 并发守卫拒绝 / 用户取消 / 转发 Live Coding —— 这些路径都会补写一条失败快照。不写的话 MCP 端读到的是上一次的旧结果，agent 会误判「这次编译通过了」。
- 构建进行中：`markBuildInProgress(buildId)` 标记，`getInProgressBuildId()` 非空时 MCP 回 `reason='build-in-progress'`（而不是返回上一轮快照）；结束时 `clearBuildInProgress(buildId)` —— **buildId 不匹配时不清**，防止旧构建的收尾抹掉新构建的标记。
- `resetLastBuildSnapshot()` 同时清掉快照与进行中标记（测试 / 卸载用）。

## Editor 启动（Windows only）

Windows 启动 Unreal Editor —— **直接 spawn 可执行文件**，不经 shell：

```typescript
const editorPath = resolveEditorPath(engineRoot, platform); // <engineRoot>/Engine/Binaries/Win64/UnrealEditor.exe
spawn(editorPath, [projectPath, ...extraArgs], { detached: true, stdio: 'ignore', windowsHide: false });
```

- **不走 `cmd /c start`**：`cmd.exe` 会把参数里的 `&` / `|` / `^` / `%` 当元字符拆词（实测 `D:\R&D\My.uproject` 被截断成 `D:\R`，而含空格的路径反而安全）。直接 spawn `.exe` 时路径原样传递。
- **启动失败可感知**：spawn 失败是异步 `'error'` 事件（不是同步 throw），监听它并 `reject`；不监听的话失败会被静默吞掉，用户只看到「启动成功」。成功路径在 500 ms（`SPAWN_SETTLE_MS`）后 resolve，resolve 之后才到达的 `error` 被忽略。
- 进程 **detached** —— 不等 Editor 退出；`unref()` 让扩展进程不被该子进程句柄挂住。
- Editor 生命周期归用户：不接入 `SubprocessRegistry`，插件 deactivate 不杀用户手动启动的编辑器。

> 类型 / 历史保留：`BuildPlatformType` 上仍有 `'Mac' | 'Linux'` 字面量，`ubt.ts#resolveEditorPath` 也保留对应分支以兼容类型推断。**新代码禁止依赖 Mac/Linux 启动路径**；非 Windows 路径必须早退并发出 i18n 提示。

## 诊断解析

### MSVC 错误格式

```
filename.cpp(123,45): error C1234: message text
filename.cpp(678): warning W567: message text
```

解析器提取：
- `file`: 绝对路径
- `line`: 行号
- `column`: 列号（可选）
- `severity`: error / warning / note
- `code`: C1234 / W567
- `message`: 消息文本

### UBT 摘要行

```
Total build time: 12.34 seconds (X actions, Y executed)
```

解析出构建时间和统计数据。

## 关键类型

```typescript
interface UBTArgs {
  target: string;
  platform: string;          // 实际上固定 'Win64'
  configuration: string;
  projectPath: string;
  extraArgs?: string[];
}

interface ParsedDiagnostic {
  file: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'note';
  code?: string;
  message: string;
}

interface BuildResult {
  success: boolean;
  exitCode: number;
  diagnostics: ParsedDiagnostic[];
  durationMs: number;
}
```

## 构建进度反馈

构建期间：
1. Output Channel 实时流式输出（`[build]` 前缀）
2. 状态栏显示 `$(sync~spin) Building...` + 完成后 `$(check) Build OK` 或 `$(error) N errors`
3. 诊断实时推入 Problems 面板（构建前 `clearAll()`）
4. 完成后显示成功 / 失败通知（双语 `t('build.notify.*')`）

## 资源清理与生命周期

- 所有 `StatusBarItem`、Task、Diagnostic、watcher 必须 push 到 `context.subscriptions`（宪法 §III）。
- BuildRunner 内的 child process 句柄在命令结束、失败或取消时由 `BuildRunner` 内部终止；调用层不直接持有或重复释放。
- 日志前缀固定 `[build]`；附加上下文要能定位 target / platform / phase。

## SSoT（宪法 §II）

- 命令 handler 通过 `WorkspaceState` 拿 `selectedProject` / `engineRoot` / `uprojectPath`，**不**直接读 `vscode.workspace.workspaceFile`。
- `ubtPath` 由 `src/build/ubt.ts` 内部基于 `WorkspaceState.engineRoot` 派生，**禁止**在调用方层拼接。
- 编译相关解析（MSVC / UBT / linker）集中在 `@parsers`，本模块只调用，不重新实现。

## DDD 分层（未启用）

`src/build/` **未启用 DDD 分层**。`application/`、`infrastructure/` 空壳已删除（H3 决策 A，见 REMEDIATION-PLAN §十二）。`domain/` 参考骨架已于 2026-10-25 删除 —— 它零生产代码消费，唯一使用者是它自己的单元测试，属于投机抽象（宪法 §V：禁投机抽象）。

**当前目录结构**：

```
src/build/
├── index.ts                       主入口
├── buildRunner.ts                 流式执行 UBT 进程
├── editorDetect.ts                UnrealEditor 进程检测（编辑器感知构建）
├── lastBuild.ts                   最近一次构建快照（MCP 读错误的数据源）
├── launchEditor.ts                Windows Editor 启动
├── liveCoding.ts                  Windows 热重载
├── lock.ts                        构建互斥锁（build / Live Coding 共用）
├── taskProvider.ts                Ctrl+Shift+B
├── ubt.ts                         UBT 命令构造
└── types.ts                       公共类型 (UBTArgs / ParsedDiagnostic / BuildResult)
```

**已知状态**：
- 业务代码**从 `src/build/` 顶层 import**（`import { runBuild } from '@build'`）。
- 何时重新引入 DDD 三层待业务复杂度增长时再评估（宪法 §V：minimal evolution，禁投机抽象）。
