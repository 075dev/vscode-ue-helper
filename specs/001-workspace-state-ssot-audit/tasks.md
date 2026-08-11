---
description: 'Task list template for feature implementation'
---

# Tasks: WorkspaceState 单一真相源合规审计

**Input**: Design documents from `/specs/001-workspace-state-ssot-audit/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: 本特性为**只读 audit + 任务清单产出**，无源码修改。所有 `T###` 任务均处于 audit/converge 边界，**不引入新的永久行为或公共契约变更**，故按 spec.md FR-010 + 宪法 §IV "documentation-only changes MAY omit tests" 原则，**不强制生成测试任务**。已存在的 `test/unit/core/workspace.test.ts`（12 个 describe/it 块）作为审计基线，必须保持 PASS（见 Phase 2 T004）。

**Organization**: 按用户故事（US1/US2/US3）分阶段；宪法 §I/§II/§III/§IV/§V 捕获任务散落于 Foundational 与 Polish 阶段。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions
- Every task MUST name observable acceptance evidence or point to the story's independent test

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- 本特性仅产出 specs 目录下的三件工件 + 跑 analyze/converge 命令，不写应用源代码

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and constitution-aligned scaffolding

- [ ] T001 验证 `.specify/extensions.yml` 不存在（钩子静默跳过；constitution 路径）
- [ ] T002 验证 `specs/001-workspace-state-ssot-audit/{spec.md, plan.md, tasks.md}` 三件存在
- [ ] T003 [P] 验证 PowerShell 前置脚本可识别本 feature：`pwsh -NoProfile -File .specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks` 返回 `FEATURE_DIR` 与 `AVAILABLE_DOCS`
- [ ] T004 [P] 在仓库根跑 `npm run typecheck` / `npm run lint` / `npm run test:unit` 三件 quality gate，记录输出（基线证据）

**Checkpoint**: Phase 1 完成 = 前置脚本 OK + quality gate PASS。

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T005 验证 `.specify/memory/constitution.md` 现行版本 ≥ 1.0.1 且包含 §II 单一真相源原则；记录 `RATIFICATION_DATE` 仍为 TODO 的现状（不解决本任务）
- [ ] T006 [P] 验证 ESLint 锁规则覆盖 FR-007 列出的 6 条 path：`vscode.workspace.workspaceFile/workspaceFolders/getWorkspaceFolder` / `detection.workspaceContext.getSelectedProject/Engine/setProject/Engine/set*` / `path.join(root, '.clangd')`；记录缺失项（如有）
- [ ] T007 [P] 验证 `src/core/workspace.ts` 的 23 个派生 getter 全部走 `path.dirname` / `path.join` 而无外部硬编码（FR-001 实现合规）
- [ ] T008 [P] 在仓库根 grep `src/` 范围，识别所有 `detection.workspaceContext.getSelected*` / `setProject` / `setEngine` 的直接调用点；与 `workspace.selectedProject` / `selectedEngine` / `setSelected*` 调用点对比，输出 diff
- [ ] T009 [P] grep `src/clangd/` 与 `src/ui/` 范围，识别所有 `path.join(..., '.clangd')` / `path.join(..., 'compile_commands.json')` 等硬编码拼接；与 `workspace.clangdConfigPath` / `compileCommandsPath` 调用对比
- [ ] T010 [P] 检查 `src/i18n/locales/{en,zh}.json` 是否已有 `workspace.missingRoot` 键；记录缺失（FR-011 缺口预备）
- [ ] T011 [P] 记录 `src/commands/_resolve.ts` 的 `legacyFindProject` / `legacyFindEngine` 是否在传入 `workspace` 时优先调 `workspace.resolveSelected*`（FR-006 缺口预备）

**Checkpoint**: Foundation ready - audit 任务可开始。

## Phase 3: User Story 1 - 把已实现的 WorkspaceState 包成可审计 feature (Priority: P1)

**Goal**: 完成 audit feature 的产物：spec.md / plan.md / tasks.md 三件 + analyze + converge 报告

**Independent Test**: `specs/001-workspace-state-ssot-audit/` 目录下三个文件齐备；`/speckit.analyze` 输出报告；`/speckit.converge` 追加任务清单

### Tests for User Story 1

> 本 US 不引入永久行为变更，按宪法 §IV + spec.md FR-010 "documentation-only changes MAY omit tests" 原则，本 US 无测试任务。已存在 `test/unit/core/workspace.test.ts` 12 个 describe/it 块作为审计基线。

### Implementation for User Story 1

- [ ] T012 [US1] 验证 `specs/001-workspace-state-ssot-audit/spec.md` 含完整 User Stories / Functional Requirements (10 条) / Success Criteria (5 条) / Assumptions / Key Entities
- [ ] T013 [US1] 验证 `specs/001-workspace-state-ssot-audit/plan.md` 含 Technical Context + 5 项 Constitution Check（全 PASS）+ Phase 0/1 + Project Structure + Complexity Tracking
- [ ] T014 [US1] 验证 `specs/001-workspace-state-ssot-audit/research.md` 含 Decision / Rationale / Alternatives / Findings（F1/F2/F3）
- [ ] T015 [US1] 验证 `specs/001-workspace-state-ssot-audit/data-model.md` 含 5 个实体（WorkspaceState / WorkspaceField / WorkspaceStateOptions / DetectionResult / WorkspaceContext）+ Validation Rules + Relationships
- [ ] T016 [US1] 验证 `specs/001-workspace-state-ssot-audit/contracts/WorkspaceState.contract.ts` 是 type-only，含 23 字段 + 6 类方法
- [ ] T017 [US1] 验证 `specs/001-workspace-state-ssot-audit/quickstart.md` 含 5 个 Scenario + Expected Outcomes + Rollback + Failure Handling

**Checkpoint**: User Story 1 is functional and independently testable

---

## Phase 4: User Story 2 - 验证五项宪法门对 WorkspaceState 的覆盖 (Priority: P2)

**Goal**: 跑 `/speckit.analyze` 输出宪法对齐 + 覆盖率 + 严重度报告

**Independent Test**: `/speckit.analyze` 命令输出报告 "Constitution Alignment Issues" 段含五条命中（每条带 source-ref/gap-type/severity/recommendation）；"Coverage Summary Table" 覆盖全部 FR-###

### Tests for User Story 2

> 本 US 跑只读分析命令，无源码修改；按 spec.md FR-010 原则不强制测试。analyze 报告本身即是证据。

### Implementation for User Story 2

- [ ] T018 [P] [US2] 验证 analyze 报告对 Principle I（Windows-First Unreal Scope）的命中：spec.md FR-001 + plan.md Technical Context 体现 Windows 10/11 / UE 5.2+ / MSVC / VS Code 1.85+ / Node 18+ 边界
- [ ] T019 [P] [US2] 验证 analyze 报告对 Principle II（SSO）的命中：FR-007 ESLint 锁规则 + T008/T009 调用点 diff 结果
- [ ] T020 [P] [US2] 验证 analyze 报告对 Principle III（UX/Logs/Lifecycle）的命中：FR-003 warning + FR-004 dispose + FR-011 i18n 缺口
- [ ] T021 [P] [US2] 验证 analyze 报告对 Principle IV（Verification）的命中：FR-010 测试 + SC-004 quality gate 记录
- [ ] T022 [P] [US2] 验证 analyze 报告对 Principle V（Minimal/Traceable）的命中：FR-007 不引入新依赖 + audit 不改源码
- [ ] T023 [US2] 汇总 analyze 报告的 Coverage Summary Table：FR-001..FR-011 各对应 ≥ 1 个 T### 任务（覆盖率 100%）
- [ ] T024 [US2] 汇总 analyze 报告的 Metrics：Total Requirements / Total Tasks / Coverage % / Ambiguity / Duplication / Critical Issues

**Checkpoint**: User Story 2 is functional and independently testable

---

## Phase 5: User Story 3 - 生成 Convergence 补漏任务清单 (Priority: P3)

**Goal**: 跑 `/speckit.converge` 在 tasks.md 末尾追加 `Phase N: Convergence` 段，每条新任务标注 source-ref + gap-type

**Independent Test**: `tasks.md` 末尾出现 `## Phase N: Convergence` 段；旧 T001-T024 任务 0 修改；新任务格式严格遵守 `- [ ] T### <desc> per <source-ref> (<gap-type>)`

### Tests for User Story 3

> 本 US 跑只读分析命令，无源码修改；converge 报告与追加任务即证据。

### Implementation for User Story 3

- [ ] T025 [US3] 跑 `/speckit.converge` 命令，验证 tasks.md 末尾追加 `Phase N: Convergence` 段
- [ ] T026 [P] [US3] 验证旧任务 T001-T024 字节级未变（diff 校验）
- [ ] T027 [P] [US3] 验证新任务 ID 不与旧任务冲突（converge 必须用 `T{M+1:03d}` 格式）
- [ ] T028 [P] [US3] 验证新任务 CRITICAL 排在最前（宪法违规任务优先）
- [ ] T029 [US3] 汇总 Convergence 阶段产出：新任务总数 N（≥ 0）、gap-type 分布（missing/partial/contradicts/unrequested）、severity 分布、source-ref 分布

**Checkpoint**: User Story 3 is functional and independently testable

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: 记录 audit 全部产出与 quality gate 证据

- [ ] T030 [P] 在 specs/001-workspace-state-ssot-audit/conclusion.md 写入 audit 总结：US1/US2/US3 状态 + analyze 关键发现 + converge 新任务数 + quality gate 记录 + 后续 implement 建议
- [ ] T031 [P] 验证 `src/core/workspace.ts` 字节级未变（`git diff`）
- [ ] T032 [P] 验证 `src/core/AGENTS.md` 未变（reference docs 不在 audit 范围）
- [ ] T033 跑最终 quality gate：`npm run typecheck && npm run lint && npm run test:unit`（基线确认 audit 未引入退化）
- [ ] T034 [P] 记录 unavailable prerequisites（本特性不要求 Windows Unreal 烟雾；按宪法 §IV "missing prerequisites MUST be reported" 明示）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - No dependencies on US1 (audit 任务彼此独立)
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Depends on US2 (analyze 报告产出后才能 converge)

### Within Each User Story

- Tests MUST be written and FAIL before implementation for permanent behavioral changes（本特性无源码修改故不适用）
- 验证任务优先于汇总任务
- 独立任务标 [P] 可并行

### Parallel Opportunities

- T001-T004 (Phase 1) 可部分并行
- T006-T011 (Phase 2) 全部 [P]，可并行
- T018-T022 (Phase 4) 全部 [P]，可并行
- T026-T028 (Phase 5) 全部 [P]，可并行
- T030-T032 (Polish) 全部 [P]，可并行

---

## Implementation Strategy

### Audit-First Strategy

1. **Setup**: T001-T004 前置检查 + 三件 quality gate 基线
2. **Foundational**: T005-T011 数据收集（grep / diff / record）
3. **User Story 1**: T012-T017 验证三件工件齐全（已写）
4. **User Story 2**: T018-T024 跑 `/speckit.analyze` 输出报告
5. **User Story 3**: T025-T029 跑 `/speckit.converge` 输出追加任务
6. **Polish**: T030-T034 总结 + 最终 quality gate

### Verification Strategy

| 验证点 | 方法 | 期望 |
|---|---|---|
| 前置脚本 | `pwsh ... check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks` | 返回 `FEATURE_DIR` |
| TypeScript | `npm run typecheck` | PASS |
| ESLint | `npm run lint` | PASS |
| Vitest | `npm run test:unit` | PASS（含 workspace.test.ts 12 块） |
| analyze | `/speckit.analyze` | 输出报告 |
| converge | `/speckit.converge` | tasks.md 追加 Phase N |
| 实现未变 | `git diff src/core/workspace.ts` | no changes |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to a specific user story for traceability
- Each user story MUST be independently completable and testable
- 本 audit 不修改应用源代码，所有 task 都是 verification / summary 类
- 任何发现的具体缺口（i18n / resolveSelected* / ESLint 锁规则）已记录在 research.md F1/F2/F3，并在 tasks.md 后续 Convergence 段追加补漏任务

## Phase 6: Convergence

**Source**: `/speckit.converge` against `spec.md` / `plan.md` / `tasks.md` / code in `src/` (read-only)
**Generated**: 2026-07-26
**Severity ordering**: CRITICAL → HIGH → MEDIUM → LOW. Constitution violations emitted first per `speckit.converge` operating contract.

### CRITICAL (宪法 §II 违规 — 必须先修)

- [ ] T035 收敛 `src/ui/controlPanel.ts:152-159` 的 `legacyFindProject/legacyFindEngine` 到 `workspace.resolveSelectedProject/resolveSelectedEngine` per Constitution II (contradicts)
- [ ] T036 收敛 `src/ui/index.ts:125-132` 的 `legacyFindProject/legacyFindEngine` 到 `workspace.resolveSelectedProject/resolveSelectedEngine` per Constitution II (contradicts)
- [ ] T037 改写 `src/commands/_resolve.ts:36-50` 的 `legacyFindProject/legacyFindEngine` 在传入 `workspace` 时优先调 `workspace.resolveSelected*`，未注入 workspaceContext 时保留一次性 fallback + `eslint-disable` 注释 per Constitution II (contradicts)
- [ ] T038 改写 `src/commands/generateCompileCommands.ts:60-71` 的 `detection.workspaceContext.getSelectedProject/Engine` 调用到 `workspace.selectedProject/selectedEngine` per Constitution II (contradicts)
- [ ] T039 改写 `src/commands/showProjectInfo.ts:51-62` 的 `detection.workspaceContext.getSelectedProject/Engine` 调用到 `workspace.selectedProject/selectedEngine` per Constitution II (contradicts)
- [ ] T040 改写 `src/ui/controlPanel.ts:402-409` 的 `workspace?.selectedProject ?? detection.workspaceContext.getSelectedProject()` 短路为 `workspace.selectedProject`（`workspace` 在生产必传）per Constitution II (contradicts)
- [ ] T041 在 `.eslintrc.json` 新增 `no-restricted-syntax` 锁 `detection.workspaceContext.getSelectedProject/getSelectedEngine/setProject/setEngine` 直读/直写，附豁免 `src/core/workspace.ts` 与 `src/detection/workspaceContext.ts` per FR-007 + Constitution II (missing)

### HIGH (宪法 §III + FR-011 缺口)

- [ ] T042 在 `specs/001-workspace-state-ssot-audit/spec.md` 增补 FR-011：warning 文案 MUST 走 `t('workspace.missingRoot', undefined)` 双语 key per Constitution III (missing)
- [ ] T043 在 `src/i18n/locales/en.json` 新增 `workspace.missingRoot` key，en 文案 `"Regenerate the workspace from .uproject and reopen"` per Constitution III (missing)
- [ ] T044 在 `src/i18n/locales/zh.json` 新增 `workspace.missingRoot` key，zh 文案 `"从 .uproject 重新生成工作区并重新打开"` per Constitution III (missing)
- [ ] T045 改写 `src/core/workspace.ts:417` 的 `_missingMessage()` 走 `@i18n` 的 `t('workspace.missingRoot', undefined)`，并构造 Logger 时传入 i18n 实例（如未注入则 fallback 保留硬编码 + warning）per Constitution III + FR-011 (contradicts)
- [ ] T046 在 `test/unit/core/workspace.test.ts` 新增测试块：`_missingMessage()` 返回 `t(...)` 调用，i18n mock 注入后文案等于期望 per FR-011 (missing)

### MEDIUM (SSoT 收口与 ESLint 锁规则补强)

- [ ] T047 收敛 `src/commands/setSystemIncludes.ts:51` 的 `workspace?.selectedEngine ?? detection.workspaceContext.getSelectedEngine()` 短路为 `workspace.selectedEngine`（生产必传）per Constitution II (contradicts)
- [ ] T048 收敛 `src/clangd/compileCommands.ts:295-306` 的 5 条 `path.join(engineRoot/projectDir, ...)` candidates 到 `workspace.compileCommandsPath` 主导 + 1-2 条 fallback per Constitution II (partial)
- [ ] T049 改写 `src/clangd/diagnoseProject.ts:53` 的 `workspace?.clangdConfigPath ?? path.join(projectDir, '.clangd')` 短路为 `workspace.clangdConfigPath`（`workspace` 在 `diagnoseProject` 调用栈必传）per Constitution II (contradicts)
- [ ] T050 改写 `src/clangd/compileCommands/symlink.ts:43-44` 的 `workspace?.clangdHelperDir ?? path.join(projectDir, ...)` 短路为 `workspace.clangdHelperDir` per Constitution II (contradicts)
- [ ] T051 改写 `src/commands/createProject.ts:248-249` 的 `workspace?.compileCommandsPath ?? path.join(...)` 短路为 `workspace.compileCommandsPath` per Constitution II (contradicts)
- [ ] T052 改写 `src/commands/uninstall.ts:44-46` 的 `path.join(root, '.clangd')` / `path.join(root, 'compile_commands.json')` 硬编码到 `workspace.clangdConfigPath` / `compileCommandsPath`（uninstall 必须先注入 workspace）per Constitution II (contradicts)
- [ ] T053 在 `.eslintrc.json` 新增 `no-restricted-syntax` 锁 `path.join(..., '.clangd' | 'compile_commands.json' | '.vscode', 'vscodeuehelper')` 模式，附豁免 `src/core/workspace.ts` 派生 getter 自身 per FR-007 + Constitution II (missing)
- [ ] T054 在 `specs/001-workspace-state-ssot-audit/tasks.md` Phase 4 增补 T022a：验证 analyze 对 Constitution III 的 i18n 命中 per FR-011 (missing)
- [ ] T055 在 `specs/001-workspace-state-ssot-audit/spec.md` FR-006 增补 "fallback = silent 时跳过 auto-pick 与 picker，仅 showWarning；非 silent 时按现有 `resolveProjectOrPick/resolveEngineOrPick` 流程" per B1 (missing)
- [ ] T056 在 `src/core/AGENTS.md` 增补 "[SSoT lock verified by .eslintrc.json no-restricted-syntax + no-restricted-imports]" 引用，更新禁止模式表与 ESLint 锁规则对齐 per F1 (partial)

### LOW (术语一致性 + 工件精度)

- [ ] T057 在 `specs/001-workspace-state-ssot-audit/spec.md` Assumptions 增补 "用户可见文案 MUST 走 `src/i18n/locales/{en,zh}.json`，未走 i18n 的硬编码视为缺口（FR-011）" per F2 (partial)
- [ ] T058 在 `specs/001-workspace-state-ssot-audit/conclusion.md` 写入 audit 总结，包含 D1/D2/A1/C2 的修复任务列表（T035-T052）+ i18n 任务清单（T042-T046）per Polish T030 (partial)

### Convergence Metrics

| Metric | Value |
|---|---|
| Total Convergence tasks | 24 (T035-T058) |
| CRITICAL | 7 (T035-T041) |
| HIGH | 5 (T042-T046) |
| MEDIUM | 10 (T047-T056) |
| LOW | 2 (T057-T058) |
| gap-type: contradicts | 14 (T035-T040, T045, T047, T049-T052) |
| gap-type: missing | 9 (T041, T043, T044, T046, T053, T054, T055, T056, T058) |
| gap-type: partial | 1 (T048) — research.md F2 candidate |
| Constitution principle: II | 15 |
| Constitution principle: III | 5 |
| Constitution principle: V | 2 (T055, T058) |

### Next Steps after Convergence

- **P0 (立即)**: 走 `/speckit.implement` 按 T035-T041 顺序执行（CRITICAL 优先）；每完成一组跑 `npm run typecheck && npm run lint && npm run test:unit`。
- **P1**: T042-T046 完成 FR-011 i18n 化（spec 增补 + 双语资源 + 源码改写 + 测试）。
- **P2**: T047-T056 收敛 SSoT 短路路径与 ESLint 锁规则补强。
- **P3**: T057-T058 术语一致性与 audit 总结。
- **验证**: 跑完后 `/speckit.converge` 二次扫描，期望 "✅ Converged — the implementation satisfies the spec, plan, and tasks."
- 避免在 audit 阶段改源码；所有源码改动走 `/speckit.implement` 阶段或 `/speckit.constitution` amendment