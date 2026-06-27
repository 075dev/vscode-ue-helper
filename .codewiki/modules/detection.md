# detection 模块文档

## 基本信息
- **路径**: `src/detection/`
- **文件数**: 10
- **语言**: TypeScript
- **职责**: 项目+引擎发现——插件的**数据根基**。完全信任 `.code-workspace` 的 `folders[]` 顺序，不做文件系统扫描。

## 符号表

### 导出函数/类

| 符号名 | 文件:行号 | 类型 | 说明 |
|--------|----------|------|------|
| activateDetection | `src/detection/index.ts` | function | 入口，返回 `DetectionHandles` |
| UprojectScanner | `src/detection/uprojectScanner.ts` | class | 扫描/解析 .uproject（JSON5） |
| EngineDiscovery | `src/detection/engineDiscovery.ts` | class | 引擎版本发现 |
| EngineLocator | `src/detection/engineLocator.ts` | class | 引擎路径定位 |
| WorkspaceContext | `src/detection/workspaceContext.ts` | class | 工作区上下文 |
| VsBuildTools | `src/detection/vsBuildTools.ts` | class | VS Build Tools 检测 |

### 导出类型

| 类型名 | 文件:行号 | 说明 |
|--------|----------|------|
| DetectionHandles | `src/detection/index.ts` | `{scanner, discovery, vsBuildTools, workspaceContext, ready: Promise<DetectionResult>}` |
| DetectionResult | `src/detection/types.ts` | `{projects: ProjectInfo[], engines: EngineInfo[]}` |
| ProjectInfo | `src/detection/types.ts` | `{path, name, engineAssociation, modules, raw}` |
| EngineInfo | `src/detection/types.ts` | 引擎版本信息 |

### 导出函数（工具）

| 函数名 | 文件:行号 | 签名 | 说明 |
|--------|----------|------|------|
| readWorkspaceEntries | `src/detection/workspaceFolders.ts` | `readWorkspaceEntries(workspaceFile): [{name, path}]` | 解析 `.code-workspace` 的 `folders[]` |
| classifyFolders | `src/detection/workspaceFolders.ts` | `classifyFolders(folderPaths)` | 区分项目/引擎目录（兼容保留） |
| readBuildVersion | `src/detection/workspaceFolders.ts` | `readBuildVersion(engineRoot): string` | 解析 `Build.version` → `"5.8.0"` |

## 核心流程（index.ts IIFE）

```
1. vscode.workspace.workspaceFile               [src/detection/index.ts]
2. readWorkspaceEntries → folders[]              [workspaceFolders.ts]
3. folders[0] → 项目根 + .uproject 路径          [index.ts]
4. UprojectScanner.parseFromPath(uprojectPath)   [uprojectScanner.ts]
   └─ JSON5.parse (非严格 JSON)                  [uprojectScanner.ts]
5. folders[1] → 引擎根 + Build.version 路径       [index.ts]
6. readBuildVersion(engineRoot) → "5.8.0"        [workspaceFolders.ts]
7. 返回 DetectionResult
```

## 失败处理策略

| 情况 | 行为 | 置信度 |
|------|------|--------|
| `workspaceFile` 为空 | `logger.error`，返回 `{projects:[], engines:[]}` | 🟢确定 |
| `folders[0]` 缺失 | `logger.error`，返回空 | 🟢确定 |
| `.uproject` 不存在 | `logger.error`，返回 `{projects:[], engines:[]}` | 🟢确定 |
| `folders[1]` 缺失 | `logger.error`，仍返回 project（engines 空） | 🟢确定 |
| `Build.version` 不存在 | `logger.error`，返回 `{projects, engines:[]}` | 🟢确定 |

## 对外依赖

| 依赖模块 | 导入的符号 | 用途 |
|----------|-----------|------|
| @core/logger | Logger | 记录检测日志 |
| @core/config | Config | 读取配置 |
| @parsers | UprojectParser | .uproject 解析 |
| json5 | JSON5.parse | 非严格 JSON 解析 |
| fs (Node) | readFile | 文件读取 |

## 被依赖情况

被几乎所有模块依赖——detection 是数据源：
- `extension.ts` — 第一个激活的业务模块
- `build/` — 需要项目/引擎路径
- `clangd/` — 需要引擎版本和 SDK 信息
- `ui/` — `await detection.ready` 后渲染状态栏
- `commands/` — 所有命令需要项目上下文
