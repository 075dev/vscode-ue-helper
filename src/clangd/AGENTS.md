# clangd 模块知识库

## 模块概述

**clangd 智能提示集成**，负责：
- 生成 `compile_commands.json` (通过 UBT)
- 写入 `.clangd` 配置文件
- Preparse-includes UE 宏补全文件系统
- 工作区备份防 UBT 覆盖
- fast/slow 补全模式切换

## 核心文件

| 文件 | 职责 |
|---|---|
| `clangdConfig.ts` | 读/写 `.clangd` 配置，系统包含路径管理 |
| `compileCommands.ts` | 跑 UBT 生成 compile_commands.json |
| `completionMode.ts` | fast/slow 模式控制器 + 状态栏 |
| `completionFiles.ts` | UE 宏补全文件系统 (addCompletions.h 等) |
| `preparseIncludes.ts` | 打包的头文件列表 (curated vs comprehensive) |
| `workspaceBackup.ts` | 备份/恢复 .code-workspace 防 UBT 覆盖 |
| `windowsSdk.ts` | MSVC + Windows SDK 路径发现 |

## 关键数据流

### compile_commands.json 生成
```
executeGenerateCompileCommands()
  └── generateCompileCommands()
       ├── 跑 UBT -ProjectFiles
       └── linkToWorkspaceRoot()  → 符号链接到工作区根
```

### 补全模式切换
```
executeToggleCompletionMode()
  └── CompletionModeController.toggle()
       ├── 切换 config.completionMode
       ├── 重写 .clangd 的 CompileFlags.Add
       └── refresh 状态栏
```

## Fast vs Slow 模式

| 维度 | Fast (curated) | Slow (comprehensive) |
|---|---|---|
| 头文件数 | ~18 个 | ~49 个 |
| 索引速度 | 快 | 慢 |
| 宏覆盖 | 常用核心宏 | 几乎所有 UE 宏 |
| 默认 | ✅ | ❌ |

## .clangd 配置结构

```yaml
CompileFlags:
  Add:
    - --target=x86_64-pc-windows-msvc
    - -std=c++20
    - ... 更多 flag
    - -include${workspaceFolder}/.vscode/unreal-clangd/addCompletions.h
  Remove:
    - -W*
    - /W*
Diagnostics:
  UnusedIncludes: Strict
  MissingIncludes: Strict
InlayHints:
  Enabled: Yes
  ParameterNames: Yes
  DeducedTypes: Yes
```

## 系统包含路径发现

Windows 上需要 MSVC 和 Windows SDK 头文件让 clangd 找到 `#include <windows.h>` 等。

发现顺序：
1. `vswhere.exe` → MSVC 安装路径
2. 枚举 `Microsoft Visual Studio/<version>/BuildTools/VC/Tools/MSVC/<version>/include`
3. Windows SDK `Program Files (x86)/Windows Kits/10/Include/<version>/um` + `/ucrt`

## 工作区备份机制

UBT 跑 `-ProjectFiles` 时会**重写** `.code-workspace`，丢失用户的引擎文件夹配置。

解决方案：
1. UBT 运行前：备份 `.code-workspace` 到临时文件
2. UBT 完成后：从备份恢复
3. backup 实例注入 UBT 调用链

## 关键类型

```typescript
interface ClangdConfig {
  CompileFlags: { Add: string[]; Remove: string[] };
  Diagnostics: { UnusedIncludes: string; MissingIncludes: string };
  InlayHints: { Enabled: string; ParameterNames: string; DeducedTypes: string };
}

interface CompileCommandsEntry {
  directory: string;
  command: string;
  file: string;
}

type CompletionMode = 'fast' | 'slow';
```
