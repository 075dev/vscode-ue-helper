# build 模块知识库

## 模块概述

**UBT 构建与 Live Coding 集成**，负责：
- 构造 Unreal Build Tool 命令行
- 流式输出构建进程日志
- 解析 MSVC 诊断到 VS Code 问题面板
- Task Provider (Ctrl+Shift+B)
- Live Coding 热重载触发
- Unreal Editor 启动

## 核心文件

| 文件 | 职责 |
|---|---|
| `ubt.ts` | UBT 路径解析、命令行构造 |
| `buildRunner.ts` | 实际执行 UBT 进程、流式输出、诊断解析 |
| `taskProvider.ts` | VS Code Task Provider 实现 (Ctrl+Shift+B) |
| `liveCoding.ts` | Live Coding 热重载触发 (Windows) |
| `launchEditor.ts` | Unreal Editor 跨平台启动 |
| `types.ts` | 构建相关类型定义 |

## UBT 命令结构

```bash
UnrealBuildTool.exe
  <TargetName>
  <Platform>     # Win64 / Mac / Linux
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

使用 `execa` 库执行子进程，实时流式输出：

```typescript
interface BuildResult_ {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  diagnostics: ParsedDiagnostic[];  // 解析后的错误/警告
}
```

**诊断解析管道**：
```
UBT stdout 行
  └── msvcParser.parseLine()  → 提取 file:line:col:severity:message
       └── 写入 VS Code 问题面板
```

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

## Live Coding (Windows Only)

Live Coding 是 UE5 的热重载机制，通过命令行触发：

```powershell
UnrealEditor.exe <path>.uproject -Execute="LiveCoding.Recompile"
```

**检测支持**：
- Windows 平台：支持
- Mac/Linux：不支持 → `isLiveCodingSupported()` 返回 false

**注意**：Editor 必须正在运行，命令通过进程间通信触发重编译。

## Editor 启动

跨平台启动 Unreal Editor：

| 平台 | 命令 |
|---|---|
| Windows | `UnrealEditor.exe <uproject>` |
| Mac | `UnrealEditor.app/Contents/MacOS/UnrealEditor <uproject>` |
| Linux | `UnrealEditor-Linux-DebugGame <uproject>` |

启动选项：
- `-log`: 显示日志窗口
- `-stdout`: 输出到 stdout
- 其他 UE 命令行参数

## 诊断解析

### MSVC 错误格式
```
filename.cpp(123,45): error C1234: message text
filename.cpp(678): warning W567: message text
```

解析器提取：
- `file`: 绝对路径
- `line`: 行号
- `column`: 列号 (可选)
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
  platform: string;
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
1. Output Channel 实时流式输出
2. 状态栏显示 "Building..." + 取消按钮
3. 诊断实时推入 Problems 面板
4. 完成后显示成功/失败通知
