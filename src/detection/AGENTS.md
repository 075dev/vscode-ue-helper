# detection 模块知识库

## 模块概述

**项目/引擎检测层**，插件启动的第一个业务模块。负责：
- 从 `.code-workspace` 解析项目和引擎路径
- 读取 `.uproject` 文件
- 读取 UE 的 `Build.version`
- VS Build Tools 发现 (Windows)
- 向其他模块暴露 `ready: Promise<DetectionResult>`

## 核心文件

| 文件 | 职责 |
|---|---|
| `index.ts` | activateDetection 入口 |
| `uprojectScanner.ts` | 解析 `.uproject` JSON（json5，支持 trailing commas），`scan(folderPaths)` 强制要求 folderPaths |
| `engineDiscovery.ts` | 引擎路径验证与版本读取（基于 .code-workspace 声明的路径） |
| `workspaceContext.ts` | 工作区状态持久化（context.workspaceState） |
| `workspaceFolders.ts` | 解析 .code-workspace folders[]，分配 role（project / engine / unknown） |
| `vsBuildTools.ts` | Windows 上 MSVC 工具链发现（vswhere.exe，编译器相关，非项目/引擎） |
| `types.ts` | ProjectInfo / EngineInstall / WorkspaceFolderInfo / VSInstallation |

## 关键架构：信任 .code-workspace

**重要设计决策**：不做文件系统扫描，完全信任 `.code-workspace` 的配置。

```
folders[0] = 项目根目录
  └── 找 name + ".uproject"

folders[1] = UE 引擎根目录
  └── 读 Engine/Build/Build.version 拿版本号
```

**原因**：UE 项目通常很大，递归扫描会卡顿；workspace 配置是显式的用户意图。

## DetectionHandles 结构

```typescript
export interface DetectionHandles {
  scanner: UprojectScanner;
  discovery: EngineDiscovery;
  vsBuildTools: VsBuildTools;
  workspaceContext: WorkspaceContext;
  ready: Promise<DetectionResult>;
}

export interface DetectionResult {
  /** 解析后的项目（来自 path === '.' 的 folder） */
  projects: ProjectInfo[];
  /** 解析后的引擎（来自 name === 'UE5' 的 folder） */
  engines: EngineInstall[];
  /** .code-workspace 文件绝对路径（来自 vscode.workspace.workspaceFile） */
  workspaceFile: string | undefined;
  /** .code-workspace 文件所在目录 */
  workspaceRoot: string | undefined;
  /** 解析后的 folders[] 全部条目（含 project/engine 识别后的 role） */
  workspaceFolders: WorkspaceFolderInfo[];
  /** 识别为项目的 folder（path === '.'） */
  projectFolder: WorkspaceFolderInfo | null;
  /** 识别为引擎的 folder（name === 'UE5'） */
  engineFolder: WorkspaceFolderInfo | null;
}
```

## Promise 设计模式

`activateDetection()` 返回后立即返回 handles，但 `ready` Promise 还在 resolve：

```typescript
// extension.ts
const detection = activateDetection(...);  // 同步返回
// detection.ready 还在 pending
activateUI(...);  // UI 层内部 await detection.ready 才渲染
```

**避免的竞态**：UI 不会在检测完成前显示空状态。

## UprojectScanner

解析 `.uproject` (JSON5 格式，因为 Epic 用了 trailing commas)：

```typescript
interface ProjectInfo {
  name: string;           // 项目名
  path: string;           // .uproject 绝对路径
  engineAssociation: string;  // EngineAssociation 字段
  modules: string[];      // 项目模块列表
}
```

使用 `json5` 库解析，避免标准 JSON 不支持的 trailing commas。

## EngineDiscovery

```typescript
interface EngineInstall {
  path: string;           // 引擎根目录绝对路径
  version: string;        // 例如 "5.3.2"
  isLauncherInstall: boolean;  // 是否 Epic Launcher 安装
}
```

读取 `Engine/Build/Build.version` (JSON) 拿版本号。

## VsBuildTools (Windows only)

通过 `vswhere.exe` 发现 MSVC 安装：

```powershell
vswhere.exe -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64
```

输出包含 `installationPath` → 拼接 `VC/Tools/MSVC/<version>/bin/Hostx64/x64`。

## 错误处理策略

**每个检测步骤失败不崩溃整个插件**：

- `.uproject` 不存在 → `projects = []` + 日志 error
- `Build.version` 读不到 → `engines = []` + 日志 error
- vswhere 失败 (非 Windows) → 静默忽略

UI 层根据空结果显示警告，但其他功能仍可用。

## 持久化 (WorkspaceContext)

用户选择的配置（如首选引擎版本）存在 `context.workspaceState`，跨会话保留：

```typescript
// 存
this.state.update('vscodeUEHelper.selectedEngine', enginePath);
// 取
this.state.get<string>('vscodeUEHelper.selectedEngine');
```
