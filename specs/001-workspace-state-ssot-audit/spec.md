# Feature Specification: WorkspaceState 单一真相源合规审计

**Feature Branch**: `[001-workspace-state-ssot-audit]`

**Created**: 2026-07-26

**Status**: Draft

**Input**: User description: "b workspacestate" — 把 `src/core/workspace.ts` 已有实现包成一个 feature，按 Spec Kit 主链路（specify → plan → tasks）描述清楚后跑 `/speckit.analyze` 与 `/speckit.converge`，给出宪法 §II / §III / §IV / §V 的遵循情况报告与剩余补漏任务。

## User Scenarios & Testing _(mandatory)_

### User Story 1 - 把已实现的 WorkspaceState 包成可审计 feature (Priority: P1)

**Why this priority**: 没有 feature 工件，`/speckit.analyze` 与 `/speckit.converge` 无法运行；宪法遵循验证的第一步是把当前实现写成可机器读取的 spec/plan/tasks。

**Independent Test**: `specs/001-workspace-state-ssot-audit/{spec.md,plan.md,tasks.md}` 三个文件都存在，且 PowerShell 前置脚本 `.specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks` 在仓库根执行返回 `FEATURE_DIR` 与可用文档列表，不报错。

**Acceptance Scenarios**:
1. **Given** 仓库根目录、已存在的 `src/core/workspace.ts` 实现，**When** 用户发出 `b workspacestate` 并按主链路生成工件，**Then** `/speckit.specify` 之后 `specs/001-workspace-state-ssot-audit/spec.md` 含完整 User Stories / Functional Requirements / Success Criteria；`/speckit.plan` 之后 `plan.md` 含五项宪法 Check + 技术上下文 + 数据模型 + quickstart；`/speckit.tasks` 之后 `tasks.md` 含按用户故事分阶段、`T###` + `[P]`/`[US#]` 标签的 checklist。
2. **Given** 三个工件齐全，**When** 跑 `/speckit.analyze`，**Then** 输出覆盖报告（覆盖率、严重度、宪法对齐发现、CRITICAL 数量）。
3. **Given** analyze 报告，**When** 跑 `/speckit.converge`，**Then** `tasks.md` 末尾追加 `Phase N: Convergence` 段，每条新任务标注 `<source-ref>` 与 `<gap-type>`，旧任务不被改写。

---

### User Story 2 - 验证五项宪法门对 WorkspaceState 的覆盖 (Priority: P2)

**Why this priority**: WorkspaceState 是宪法 §II 的核心交付物，必须能被 `/speckit.analyze` 的 Constitution Alignment 段覆盖；这是仓库当前治理最深的一处 SSoT。

**Independent Test**: `/speckit.analyze` 的报告「Constitution Alignment Issues」段包含五条命中：Windows-only Unreal scope / `WorkspaceState`+`ClangdOps` 边界 / 双语 i18n+日志+生命周期+原子写 / 确定性验证 / 最小依赖；每条命中有 source-ref、gap-type、severity、recommendation。

**Acceptance Scenarios**:
1. **Given** analyze 报告，**When** 检查 Principle II（SSO），**Then** 应至少包含：派生 getter 全部走 `WorkspaceState`、调用方不再直读 `vscode.workspace.workspaceFile/workspaceFolders`、`detection.workspaceContext.getSelected*` 已收敛到 `workspace.selectedProject/selectedEngine`、`.clangd` 写入仍由 `ClangdOps` 持有。
2. **Given** analyze 报告，**When** 检查 Principle III（UX/lifecycle），**Then** 应包含：派生 getter 触发 `vscode.window.showWarningMessage`（已去重）、`dispose()` 释放通知 Set 并清空字段、`context.subscriptions` 注册。
3. **Given** analyze 报告，**When** 检查 Principle IV（验证），**Then** 应包含：`test/unit/core/workspace.test.ts` 覆盖 selected* getter/setter、dispose 后回 null、detection.ready 时序；并指出是否缺少 build/clangd 烟雾记录。

---

### User Story 3 - 生成 Convergence 补漏任务清单 (Priority: P3)

**Why this priority**: 即使 WorkspaceState 自身测试覆盖完整，调用方（clangd / commands / ui）可能存在直读路径、未走 `workspace.resolveSelected*` 重复模式等问题；converge 把这些以追加任务的形式落到 `tasks.md`，便于 implement 补齐。

**Independent Test**: `tasks.md` 末尾追加 `## Phase N: Convergence` 段，新增任务数为 N（> 0 时），每条 `- [ ] T### <desc> per <source-ref> (<gap-type>)` 格式严格遵守，旧任务 0 修改。

**Acceptance Scenarios**:
1. **Given** 代码与 spec/plan/tasks 的差异，**When** 跑 `/speckit.converge`，**Then** 至少识别并追加：调用方直接 `detection.workspaceContext.getSelected*` 而未走 `workspace.selectedProject/selectedEngine` 的位置；ESLint 未锁但源码里残留的 `path.join(..., '.clangd')` 硬编码；dispose 链路未注册的 `eventEmitter`（如新增）。
2. **Given** analyze + converge 报告，**When** 用户进入下一轮 `/speckit.implement`，**Then** 可执行 Convergence 阶段新增的 T### 任务而不污染原始任务清单。

---

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST 暴露 `@core/workspace` 别名下的 `WorkspaceState` 类，作为项目/引擎/工作区状态的唯一真相源，承载 Level 0 根源字段（`workspaceFile` / `workspaceFolders` / `projectFolder` / `engineFolder` / `project` / `engine`）、Level 1 派生路径（`workspaceRoot` / `projectDir` / `projectFile` / `projectName` / `engineRoot` / `engineVersion`）、Level 2 `.clangd` 相关（`clangdConfigPath` / `clangdHelperDir` / `clangdPerfCachePath` / `compileCommandsDir` / `compileCommandsPath`）、Level 3 补全文件路径（`macroHelperPath` / `ueClangdCompatPath` / `addCompletionsPath` / `addMacroCompletionsPath` / `completionHelperPath` / `defaultCompletionsPath`）、用户选择（`selectedProject` / `selectedEngine` / `setSelectedProject` / `setSelectedEngine`）、解析助手（`resolveSelectedProject` / `resolveSelectedEngine`）。
- **FR-002**: System MUST 在构造函数订阅 `detection.ready` Promise，resolve 时通过 `setResult` 同步注入根源信息；构造前访问任意派生 getter MUST 返回 `null` 且 NOT 触发 warning。
- **FR-003**: System MUST 在 `_resolve` 检测到 injected=true 但字段确为 null 时，调用 `vscode.window.showWarningMessage('从 .uproject 重新生成工作区')`（**无按钮**），整 session 内同一字段只弹一次（`_notifiedFields` 去重）。
- **FR-004**: System MUST 实现 `vscode.Disposable`，`dispose()` 后所有派生 getter 返回 `null`、setter 变 no-op 不抛错、重复 dispose 幂等。
- **FR-005**: System MUST 暴露 `selectedProject` / `selectedEngine` 通过 `workspaceContext.memento` 持久化；`setSelectedProject(undefined)` / `setSelectedEngine(undefined)` 显式清除选择；未注入 `workspaceContext` 时 setter 为 no-op 且写一条 `[workspace]` 前缀 warning。
- **FR-006**: System MUST 暴露 `resolveSelectedProject(projects)` / `resolveSelectedEngine(engines)`，收口命令层 `projects.find(p => p.path === workspace.selectedProject)` 重复模式；未设置时返回 `undefined`，由调用方决定 fallback 策略。
- **FR-007**: System MUST 禁止调用方在派生字段上自行 `path.join` 或硬编码拼接；ESLint `no-restricted-syntax` + `no-restricted-imports` 锁定 `vscode.workspace.workspaceFile/workspaceFolders/getWorkspaceFolder` 与 `detection.workspaceContext.getSelected*/set*/setEngine` 等绕过路径。
- **FR-008**: System MUST 在 `extension.ts` 由扩展上下文一次构造并 push 到 `context.subscriptions`；模块内部禁止自建重复实例（参考 `@core/AGENTS.md` Logger 约定）。
- **FR-009**: System MUST 在 `extension.ts` 注入时同时传入 `workspaceContext: detection.workspaceContext`，保证 `selectedProject` / `selectedEngine` 在生产代码下可用。
- **FR-010**: System MUST 在测试中通过 `makeFakeMemento()` / `makeFakeDetection()` 工具构造最小可用 `detection.handle`，覆盖 selected* getter/setter、dispose 后回 null、detection.ready 时序、未注入 `workspaceContext` 边角场景。

### Key Entities _(include if feature involves data)_

- **WorkspaceState**: 项目/引擎/工作区状态聚合根；持有 6 个 Level 0 根源字段 + 6 个 Level 1 派生 + 5 个 Level 2 `.clangd` + 6 个 Level 3 补全 + 2 个用户选择 + 2 个解析助手；生命周期经 `dispose()` 释放。
- **WorkspaceField**: 23 个字段名 union type（`workspaceFile` / `workspaceFolders` / … / `defaultCompletionsPath`），用作 `_notifiedFields` 去重键与 `_resolve` field 参数。
- **WorkspaceStateOptions**: 构造选项；包含 `detection: { ready: Promise<DetectionResult> }`、`workspaceContext?: WorkspaceContext`、`logger: Logger`；`workspaceContext` 在生产中必传。
- **DetectionResult**: `detection.ready` resolve 类型；包含 `projects: ProjectInfo[]` / `engines: EngineInstall[]` / `workspaceFile?: string` / `workspaceRoot?: string` / `workspaceFolders: WorkspaceFolderInfo[]` / `projectFolder: WorkspaceFolderInfo | null` / `engineFolder: WorkspaceFolderInfo | null`。
- **WorkspaceContext**: `detection` 子模块持有；负责 `selectedProject` / `selectedEngine` 的 Memento 持久化；通过 `memento.update()` 跨实例持久化。

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: `/speckit.analyze` 报告覆盖 10 个 `FR-###`，每个 `FR-###` 至少对应 1 个 `T###` 任务（覆盖率 ≥ 100%）。
- **SC-002**: `/speckit.analyze` 报告 CRITICAL 数为 0，或每条 CRITICAL 都在 `tasks.md` 的 Convergence 段找到对应 `T###`（缺失前提明示）。
- **SC-003**: `/speckit.converge` 追加任务总数 N ≥ 0；当 `tasks.md` 旧任务数 M 满足 `tasks_appended`，则 `N ≥ 1` 且至少一条 gap-type 为 `contradicts` 的任务标 CRITICAL 并排在最前。
- **SC-004**: `npm run typecheck` / `npm run lint` / `npm run test:unit` 三件 quality gate 全部 PASS，且 `test/unit/core/workspace.test.ts` 通过（覆盖率 ≥ 当前基线）。
- **SC-005**: Constitutional 5 项门均能映射到 spec.md 的对应 FR：Windows-only（FR-001 派生语义）、SSoT（FR-007 ESLint 锁定）、UX/lifecycle（FR-003 警告 + FR-004 dispose）、Verification（FR-010 测试 + SC-004 门禁）、Minimal Dep（FR-007 不引入新依赖）。

## Assumptions

- 假设目标运行平台为 Windows 10/11；Unreal Engine 5.2+；MSVC 工具链；Windows SDK；VS Code 1.85+；Node.js 18+（宪法 §I）。
- 假设 `detection.ready` 一定能在合理时间内 resolve（不会无限挂起）；如果挂起，派生 getter 返回 `null` 但不报警（避免误判暂态为空为真实缺失）。
- 假设 `workspaceContext.memento` 的持久化由 VS Code 自身管理；本类不直接操作 `globalState` / `workspaceState`。
- 假设 ESLint 锁规则（`.eslintrc.json` 的 `no-restricted-syntax` + `no-restricted-imports`）已生效并覆盖 FR-007 列出的绕过路径；新约束需在 `/speckit.constitution` 之外追加。
- 假设现有 `test/unit/core/workspace.test.ts` 12 个 describe/it 块代表 WorkspaceState 当前行为的"黄金真相"；新增测试不删除现有块，仅追加。
- 不假设调用方会自行派生路径；所有派生 MUST 经 `WorkspaceState` getter（参见 FR-007 与 `@core/AGENTS.md`）。