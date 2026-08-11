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
| `taskProvider.ts` | VS Code Task Provider 实现（`Ctrl+Shift+B`） |
| `liveCoding.ts` | Live Coding 热重载触发（**Windows only**） |
| `launchEditor.ts` | Unreal Editor 启动（**Windows only**，`cmd /c start` detached） |
| `types.ts` | 构建相关类型定义（`UBTArgs` / `ParsedDiagnostic` / `BuildResult`） |
| `domain/` | 参考用领域层（entities / value-objects / events） |

## 平台范围

**Windows-only**（宪法 §I）：
- UBT / Live Coding / Editor 启动全部 Windows-only。
- `package.json#platforms: ['win32']`；`vscodeUEHelper.liveCoding` / `setSystemIncludes` 在 `when: isWindows` 下提供。
- `pickPlatform()` UI 选项冻结为 `Win64` 单选；`BuildPlatform` 类型仍包含 `'Mac' | 'Linux'` 是历史保留分支，**新代码不要为这些分支写新逻辑**。

Mac / Linux 平台如果误触发入口，应快速退出 + i18n 友好提示（`t('build.platform.unsupported')` 双语），不抛未受控异常。

## UBT 命令结构

```bash
UnrealBuildTool.exe
  <TargetName>
  <Platform>     # Win64（唯一支持）
  <Configuration> # Debug / DebugGame / Development / Shipping
  -Project="<path>.uproject"
  -WaitMutex -FromMsBuild
```

### 命令构建器

```typescript
function buildUBTCommand(
  target: string,           // e.g. "MyProjectEditor"
  platform: string,         // e.g. "Win64"
  config: string,           // e.g. "Development"
  uprojectPath: string,
  ubtPath: string,
): UBTCommand
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

注册 `ue` 类型的任务提供器，用户按 `Ctrl+Shift+B` 看到构建选项：

```typescript
class UBTTaskProvider implements vscode.TaskProvider {
  provideTasks(): vscode.ProviderResult<vscode.Task[]>
  resolveTask(task: vscode.Task): vscode.ProviderResult<vscode.Task>
}
```

任务定义包含：
- `target`: Editor / Game / Server / Client
- `config`: Debug / DebugGame / Development / Shipping
- `action`: build / rebuild / clean
- `platform`: 固定 `Win64`

## Live Coding（Windows only）

Live Coding 是 UE5 的热重载机制，通过命令行触发：

```powershell
UnrealEditor.exe <path>.uproject -Execute="LiveCoding.Recompile"
```

**支持**：
- Windows 平台：✅（`isLiveCodingSupported()` → true）
- Mac / Linux：❌ 不在产品范围 —— **直接视为不支持**。

Editor 必须正在运行，命令通过进程间通信触发重编译。

## Editor 启动（Windows only）

Windows 启动 Unreal Editor：

```
cmd /c start "" <UnrealEditor.exe> <path>.uproject>
```

进程 detached —— 不等 Editor 退出；spawn 后 setTimeout 500 ms 即可 resolve。

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

## DDD 分层（参考）

`src/build/` 当前**未启用 DDD 分层**。`application/`、`infrastructure/` 空壳已删除（H3 决策 A，见 REMEDIATION-PLAN §十二）。`domain/` 仅作参考目录存在。

**当前目录结构**：

```
src/build/
├── index.ts                       主入口
├── buildRunner.ts                 流式执行 UBT 进程
├── launchEditor.ts                Windows Editor 启动
├── liveCoding.ts                  Windows 热重载
├── taskProvider.ts                Ctrl+Shift+B
├── ubt.ts                         UBT 命令构造
├── types.ts                       公共类型 (UBTArgs / ParsedDiagnostic / BuildResult)
└── domain/                        参考用领域层（含 entities / value-objects / events）
```

**已知状态**：
- `domain/entities/ubt-task.entity.ts` 有完整测试（`test/unit/build/domain/entities/ubt-task.entity.test.ts`），可作为后续 DDD 迁移参考。
- 业务代码**继续从 `src/build/` 顶层 import**（`import { runBuild } from '@build'`），不走 `domain/` 路径。
- 何时重新引入 DDD 三层待业务复杂度增长时再评估（宪法 §V：minimal evolution，禁投机抽象）。
