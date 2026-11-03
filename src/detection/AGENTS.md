<!-- Parent: ../AGENTS.md -->
# detection 模块知识库

> 治理参考：`.specify/memory/constitution.md`。Detection 是宪法 §II（Single Sources of Truth and Boundary Discipline）的"事实采集层"：派生路径统一交由 `WorkspaceState` 暴露；本模块 **只产生原始事实**，不向 `.clangd` 写入任何东西，不直接被 UI / 命令消费业务路径，全部由 `@core/workspace` 代理转发（避免散落的 `vscode.workspace.workspaceFile` 直读）。

## 模块概述

**项目 / 引擎检测层**，插件启动的第一个业务模块。负责：

- 从 `.code-workspace` 解析项目和引擎路径
- 读取 `.uproject` 文件
- 读取 UE 的 `Build.version`
- 向其他模块暴露 `ready: Promise<DetectionResult>`

## 核心文件

| 文件                  | 职责                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`            | `activateDetection` 入口                                                                                                                                                            |
| `uprojectScanner.ts`  | 解析 `.uproject` JSON（json5，支持 trailing commas），`scan(folderPaths)` 强制要求 `folderPaths`                                                                                    |
| `engineDiscovery.ts`  | 引擎路径验证与版本读取（基于 `.code-workspace` 声明的路径）                                                                                                                         |
| `workspaceContext.ts` | 工作区状态持久化（`context.workspaceState`）。**注意**：业务层不应直读 `getSelected*` —— 走 `WorkspaceState.selectedProject` / `selectedEngine` getter（参见 `src/core/AGENTS.md`） |
| `workspaceFolders.ts` | 解析 `.code-workspace#folders[]`，分配 role（`project` / `engine` / `unknown`）                                                                                                     |
| `types.ts`            | `ProjectInfo` / `EngineInstall` / `WorkspaceFolderInfo`                                                                                                          |

## 关键架构：信任 .code-workspace

**重要设计决策**：不做文件系统扫描，完全信任 `.code-workspace` 的配置。

```
folders[0] = 项目根目录
  └── 找 name + ".uproject"

folders[1] = UE 引擎根目录
  └── 读 Engine/Build/Build.version 拿版本号
```

**原因**：UE 项目通常很大，递归扫描会卡顿；workspace 配置是显式的用户意图。

### 这是前提，不是降级方案（2026-10-21 用户拍板）

`.code-workspace` 硬依赖是**设计意图**，不得以「增强鲁棒性」为由加兜底发现：

- UE 的 C++ 项目**必须**先在 UE 编辑器里执行 **Generate Visual Studio project files**
  （UBT `-ProjectFiles`）才会产出 `.sln/.vcxproj`；同一流程同时生成 `.code-workspace`。
  换句话说，`.code-workspace` 是 UE 生成的权威产物，插件读取它是读取「用户意图」，
  不是在猜。
- 因此**不要**引入：注册表扫描、Epic 安装目录搜索、`mcp_engine.txt` 之类的引擎路径兜底。
  那些属于「脱离工作区独立运行」的形态（独立 MCP server / CLI 工具），与本插件定位不符。
- 检测为空时的**正确动作**是让用户去生成 / 核对 `.code-workspace`（`folders[]` 的
  `path === '.'` 是项目、`name === 'UE5'` 是引擎），而不是插件替用户猜。
- 用户可见文案必须指向这个动作。**禁止**出现「请手动设置 `vscodeUEHelper.engineRoot`」
  之类的引导 —— `engineRoot` **不是**本插件的设置项（`package.json` 中无此键），
  引擎路径只来自 `folders[]`。


## DetectionHandles 结构

```typescript
export interface DetectionHandles {
  scanner: UprojectScanner;
  discovery: EngineDiscovery | null; // IIFE 检测完成后一次性赋值；ready 前为 null
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
  /** 解析后的 folders[] 全部条目（含 project / engine 识别后的 role） */
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
new WorkspaceState({ detection, logger }).subscribeReady();   // UI 内 await
```

**避免的竞态**：UI 不会在检测完成前显示空状态。

## UprojectScanner

解析 `.uproject`（JSON5 格式，因为 Epic 用了 trailing commas）：

```typescript
interface ProjectInfo {
  name: string; // 项目名
  path: string; // .uproject 绝对路径
  engineAssociation: string; // EngineAssociation 字段
  modules: string[]; // 项目模块列表
}
```

使用 `json5` 库解析，避免标准 JSON 不支持的 trailing commas。

## EngineDiscovery

```typescript
interface EngineInstall {
  path: string; // 引擎根目录绝对路径
  version: string; // 例如 "5.3.2"
  isLauncherInstall: boolean; // 是否 Epic Launcher 安装
}
```

读取 `Engine/Build/Build.version`（JSON）拿版本号。

## 错误处理策略

每个检测步骤失败不崩溃整个插件：

- `.uproject` 不存在 → `projects = []` + `logger.error('[detection] .uproject missing: ...')`
- `Build.version` 读不到 → `engines = []` + `logger.error(...)`

UI 层根据空结果显示警告，但其他功能仍可用。

## 持久化（WorkspaceContext）

用户选择的配置（首选引擎版本等）存在 `context.workspaceState`，跨会话保留：

```typescript
// 存
this.state.update('vscodeUEHelper.selectedEngine', enginePath);
// 取（业务层不直读！见下方 SSoT 约束）
this.state.get<string>('vscodeUEHelper.selectedEngine');
```

## SSoT 约束（宪法 §II）

| ❌ 禁止                                                | ✅ 改用                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| 命令层 / UI 层 `vscode.workspace.workspaceFile` 直读   | `workspace.workspaceFile`（`WorkspaceState` getter）                     |
| `detection.workspaceContext.getSelectedProject()` 直读 | `workspace.selectedProject` / `workspace.selectedEngine`                 |
| `detection.workspaceContext.setProject(...)` 直写      | `workspace.setSelectedProject(...)` / `workspace.setSelectedEngine(...)` |
| 任意位置 `path.join(root, '.clangd')` 临时拼路径       | `workspace.clangdConfigPath` / `workspace.compileCommandsPath`           |

ESLint 锁规则见仓库根 `.eslintrc.json`（`no-restricted-syntax` / `no-restricted-imports`）。

## 资源清理与可观察性

- 所有 watcher、disposable 必须 push 到 `context.subscriptions`（宪法 §III）。
- 日志前缀 `[detection]`；失败原因（`reason` 字段）必须出现在日志 / 通知中。
- 用户可见错误通知使用 i18n key（`t('detection.error.*')`），**双语同步**。
