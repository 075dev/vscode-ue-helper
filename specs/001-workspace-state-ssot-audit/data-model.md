# Data Model: WorkspaceState

## Entities

### WorkspaceState（聚合根）

**字段（Level 0 根源）**：

| 字段 | 类型 | 来源 | 不可变性 |
|---|---|---|---|
| `_workspaceFile` | `string \| null` | `detection.ready` → `setResult().workspaceFile` | private |
| `_workspaceFolders` | `WorkspaceFolderInfo[]` | `setResult().workspaceFolders` | private |
| `_projectFolder` | `WorkspaceFolderInfo \| null` | `setResult().projectFolder` | private |
| `_engineFolder` | `WorkspaceFolderInfo \| null` | `setResult().engineFolder` | private |
| `_project` | `ProjectInfo \| null` | `setResult().projects[0]` | private |
| `_engine` | `EngineInstall \| null` | `setResult().engines[0]` | private |
| `_workspaceContext` | `WorkspaceContext \| null` | 构造 options；可空 | private |

**字段（运行时）**：

| 字段 | 类型 | 用途 |
|---|---|---|
| `_notifiedFields` | `Set<WorkspaceField>` | warning 去重键 |
| `_injected` | `boolean` | 是否已 `setResult` |
| `_disposed` | `boolean` | 是否已 `dispose` |

**派生 getter（Level 1）**：

| getter | 返回类型 | 派生路径 |
|---|---|---|
| `workspaceRoot` | `string \| null` | `path.dirname(workspaceFile)` |
| `projectDir` | `string \| null` | `_projectFolder.absPath` ?? `path.dirname(project.path)` |
| `projectFile` | `string \| null` | `_project.path` ?? `path.join(projectDir, projectName + '.uproject')` |
| `projectName` | `string \| null` | `_projectFolder.name` ?? basename(project.path) 去掉 `.uproject` 后缀 |
| `engineRoot` | `string \| null` | `_engineFolder.absPath` ?? `_engine.path` |
| `engineVersion` | `string \| null` | `_engine.version` |

**派生 getter（Level 2 `.clangd`）**：

| getter | 返回类型 | 派生路径 |
|---|---|---|
| `clangdConfigPath` | `string \| null` | `path.join(projectDir, '.clangd')` |
| `clangdHelperDir` | `string \| null` | `path.join(projectDir, '.vscode', 'vscodeuehelper')` |
| `clangdPerfCachePath` | `string \| null` | `path.join(projectDir, '.vscode', 'clangd-perf-cache')` |
| `compileCommandsDir` | `string \| null` | `clangdHelperDir` |
| `compileCommandsPath` | `string \| null` | `path.join(clangdHelperDir, 'compile_commands.json')` |

**派生 getter（Level 3 补全）**：

| getter | 返回类型 | 派生路径 |
|---|---|---|
| `macroHelperPath` | `string \| null` | `path.join(clangdHelperDir, 'macroCompletionHelper.h')` |
| `ueClangdCompatPath` | `string \| null` | `path.join(clangdHelperDir, 'ueClangdCompat.h')` |
| `addCompletionsPath` | `string \| null` | `path.join(clangdHelperDir, 'addCompletions.h')` |
| `addMacroCompletionsPath` | `string \| null` | `path.join(clangdHelperDir, 'addMacroCompletions.h')` |
| `completionHelperPath` | `string \| null` | `path.join(clangdHelperDir, 'completionHelper.cpp')` |
| `defaultCompletionsPath` | `string \| null` | `path.join(clangdHelperDir, 'defaultCompletions.h')` |

**派生 getter（用户选择）**：

| getter | 返回类型 | 派生路径 |
|---|---|---|
| `selectedProject` | `string \| null` | `_workspaceContext?.getSelectedProject() ?? null` |
| `selectedEngine` | `string \| null` | `_workspaceContext?.getSelectedEngine() ?? null` |

**方法**：

| 方法 | 签名 | 行为 |
|---|---|---|
| `setResult(result)` | `(result: DetectionResult) => void` | 同步注入根源信息；写日志 `[workspace] injected: ...` |
| `setSelectedProject(project)` | `(project: ProjectInfo \| undefined) => Promise<void>` | 持久化到 `memento`；未注入 workspaceContext 时 no-op + warning |
| `setSelectedEngine(engine)` | `(engine: EngineInstall \| undefined) => Promise<void>` | 持久化到 `memento`；未注入 workspaceContext 时 no-op + warning |
| `resolveSelectedProject(projects)` | `(projects) => ProjectInfo \| undefined` | 在 projects 中查找持久化选择 |
| `resolveSelectedEngine(engines)` | `(engines) => EngineInstall \| undefined` | 在 engines 中查找持久化选择 |
| `dispose()` | `() => void` | 清空所有字段 + 去重 Set；幂等 |
| `_resolve<T>(field, resolver)` | 私有 | 通用 "注入前=null" + "注入后缺失=warning 去重" |
| `_notifyMissing(field)` | 私有 | 调 `vscode.window.showWarningMessage` + 加入去重 Set |
| `_missingMessage(field)` | 私有 | 返回 warning 文案（**当前硬编码**） |
| `_resetForTest()` | 测试辅助 | 等价于 dispose 但保留 _disposed=false |

**状态机**：

```text
[uninjected]
   │ detection.ready.resolve()
   ▼
[injected] ──workspace.setSelectedProject(p)──▶ [injected]（memento 持久化）
   │ workspace.dispose()
   ▼
[disposed]
   │ any access → no-op
   ▼
[disposed]
```

### WorkspaceField（union type，23 个字段标识符）

```typescript
type WorkspaceField =
  | 'workspaceFile' | 'workspaceFolders' | 'projectFolder' | 'engineFolder'
  | 'project' | 'engine'
  | 'projectDir' | 'projectFile' | 'projectName' | 'engineRoot'
  | 'engineVersion' | 'workspaceRoot'
  | 'clangdConfigPath' | 'clangdHelperDir' | 'clangdPerfCachePath'
  | 'compileCommandsDir' | 'compileCommandsPath'
  | 'macroHelperPath' | 'ueClangdCompatPath' | 'addCompletionsPath'
  | 'addMacroCompletionsPath' | 'completionHelperPath' | 'defaultCompletionsPath';
```

**用途**：作为 `_notifiedFields: Set<WorkspaceField>` 的元素 + `_resolve` 第一参数。

### WorkspaceStateOptions（构造选项）

```typescript
interface WorkspaceStateOptions {
  detection: { ready: Promise<DetectionResult> };
  workspaceContext?: WorkspaceContext;
  logger: Logger;
}
```

**约束**：
- `detection` 必传
- `workspaceContext` 可选；**生产代码（`extension.ts`）必传**以收敛 selection 访问
- `logger` 必传

### DetectionResult（`detection.ready` resolve 类型）

```typescript
type DetectionResult = {
  projects: ProjectInfo[];
  engines: EngineInstall[];
  workspaceFile?: string;
  workspaceRoot?: string;
  workspaceFolders: WorkspaceFolderInfo[];
  projectFolder: WorkspaceFolderInfo | null;
  engineFolder: WorkspaceFolderInfo | null;
};
```

### WorkspaceContext（detection 子模块持有）

| 方法 | 签名 | 用途 |
|---|---|---|
| `getSelectedProject()` | `() => string \| undefined` | 读 Memento 持久化项目路径 |
| `getSelectedEngine()` | `() => string \| undefined` | 读 Memento 持久化引擎路径 |
| `setProject(p)` | `(project: ProjectInfo \| undefined) => Promise<void>` | 写入 Memento（`undefined` 显式清除） |
| `setEngine(e)` | `(engine: EngineInstall \| undefined) => Promise<void>` | 写入 Memento（`undefined` 显式清除） |

## Validation Rules

1. 派生 getter MUST 在 `_injected=false` 时返回 `null`，**NOT 触发 warning**（暂态 vs 真实缺失区分）
2. 派生 getter MUST 在 `_injected=true` 但解析为 null/[] 时通过 `_notifyMissing` 报警
3. warning 文案 MUST 整 session 同 field 只弹一次（`_notifiedFields` 去重）
4. `dispose()` 后所有 getter MUST 返回 `null`，setter MUST no-op 不抛错
5. `_disposed=true` 时 `dispose()` MUST 幂等

## Relationships

```text
extension.ts ──creates──▶ WorkspaceState (push to context.subscriptions)
                          │
                          ├──reads──▶ DetectionHandles.ready
                          ├──reads──▶ WorkspaceContext (memento: selected*)
                          ├──logs──▶ Logger (prefix [workspace])
                          │
                          └──consumed by──▶ ClangdOps / Commands / UI / MCP
                                              (36 callers; all via @core/workspace)
```

## Identified Gaps (from research.md)

| Gap | Location | Severity | Resolution Task |
|---|---|---|---|
| F1: warning 文案未走 i18n | `_missingMessage()` 硬编码 | HIGH | Phase 2: Foundational |
| F2: `resolveSelected*` 未被调用方使用 | `_resolve.ts` 仍走 legacy | MEDIUM | Phase 3: T-ResolveProject / T-ResolveEngine |
| F3: ESLint 锁规则覆盖待 verify | `.eslintrc.json` 6 条 pattern | MEDIUM | Phase 3: T-EslintVerify |