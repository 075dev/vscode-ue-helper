# Implementation Plan: WorkspaceState 单一真相源合规审计

**Branch**: `[001-workspace-state-ssot-audit]` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-workspace-state-ssot-audit/spec.md`

**Note**: This plan is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

把 `src/core/workspace.ts`（已实现 13 import / 36 callers 的 Phase 8 + 9 SSoT）包成可审计的 SDD feature：写 spec/plan/tasks，跑 `/speckit.analyze` 做宪法对齐 + 覆盖率扫描，再跑 `/speckit.converge` 把代码 vs spec/plan/tasks 的差距以追加任务形式落到 `tasks.md`。不修改现有实现；以"识别缺口 + 列出补漏任务"为产出。

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 18+（`tsconfig.json#compilerOptions.strict + noUncheckedIndexedAccess + noImplicitReturns`）

**Primary Dependencies**: VS Code API 1.85+、`@core/workspace`、`@detection/workspaceContext`、`@detection/types`；测试用 Vitest + `vi.fn()` mock

**Storage**: VS Code `Memento`（`workspaceContext` 内部），跨实例持久化 `selectedProject` / `selectedEngine`

**Testing**: `npm run typecheck`、`npm run lint`、`npm run test:unit`；适用时 `npm run build`；本特性不涉及 build/clangd 行为变更故不要求 Windows Unreal 烟雾

**Target Platform**: Windows 10/11；Unreal Engine 5.2+；VS Code 1.85+；Node.js 18+（宪法 §I 硬边界）

**Project Type**: VS Code desktop extension with an independent Node.js LSP proxy

**Performance Goals**: N/A（只读审计 + 任务清单产出，不引入运行时路径）

**Constraints**: Windows-only support；strict TypeScript；Chinese comments + exported-function JSDoc；path aliases（`@core` / `@detection`）；bilingual user-visible strings（`en` + `zh`）；`WorkspaceState` + `ClangdOps` SSoT；no speculative runtime dependencies；遵循宪法 §I–§V 五项门

**Scale/Scope**: 单文件 13 import / 36 callers；23 个字段 union type；3 层派生（Level 0/1/2/3）；产出 ≤ 50 行 Convergence 任务清单

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- [x] **I. Windows-First Unreal Scope** — 本特性目标 Windows 10/11 / UE 5.2+ / MSVC / Windows SDK / VS Code 1.85+ / Node 18+；不引入 macOS/Linux 承诺；WorkspaceState 派生路径全部基于 detection 层 `.code-workspace` 识别（已是 UE/Windows 路径语义）。
- [x] **II. Single Sources of Truth and Boundary Discipline** — WorkspaceState 是宪法 §II 的核心交付层；调用方经 ESLint `no-restricted-syntax` + `no-restricted-imports` 锁定不可直读 `vscode.workspace.workspaceFile/workspaceFolders/getWorkspaceFolder` 或 `detection.workspaceContext.getSelected*/set*/setEngine`；`.clangd` 写入仍由 `ClangdOps` 持有。
- [x] **III. Localized, Observable, Resource-Safe UX** — 用户文案「从 .uproject 重新生成工作区」目前是硬编码字符串；需检查是否走 `t('workspace.missing', ...)` 双语 key（**潜在 FR-011 缺口**）。日志前缀 `[workspace]` + 子区域细分（已在 `setResult` / `setSelectedProject(no-op)` / `dispose` 内应用）。`dispose()` 释放 `_notifiedFields` Set + 清空字段；实例由 `extension.ts` push 到 `context.subscriptions`。`WorkspaceState` 不直接写 `.clangd` 或 `compile_commands.json`，写入仍走 `ClangdOps._atomicWrite`，不破坏原子写保证。
- [x] **IV. Verification Gates Before Delivery** — 已有 `test/unit/core/workspace.test.ts` 覆盖 selected* getter/setter + dispose + detection.ready 时序 + 未注入 workspaceContext 边角；`npm run typecheck` + `npm run lint` + `npm run test:unit` 三件门禁必跑。本特性不涉及 build/clangd 行为变更故不要求 Windows Unreal 烟雾；若在 implement 阶段发现需修改 build/clangd 行为，按宪法 §IV 补 Windows Unreal 烟雾或记录缺失前提。
- [x] **V. Minimal, Traceable, Reversible Evolution** — 不引入新依赖；不引入新抽象（仅复用 `WorkspaceContext`）；本特性以只读审计 + 追加任务清单为产出，不修改源码。如发现破坏性改动（新增字段、重命名 getter、移除 setSelectedProject 等），需走 `/speckit.constitution` amendment。

**Gate Result**: `PASS` is required before research and again after design. 任何 unchecked gate MUST 在 Complexity Tracking 解决或 plan 终止。

**Re-evaluation after design**: 本 plan 不引入新代码，只产出 spec/plan/tasks + analyze/converge 报告。所有 MUST 规则继续保持 PASS。**潜在发现**：FR-011（硬编码 warning 文案 i18n 化）已被 `tasks.md` 的 `Phase 2: Foundational` 任务覆盖。

## Project Structure

### Documentation (this feature)

```text
specs/001-workspace-state-ssot-audit/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── core/              # WorkspaceState 所在地；横切基础设施
│   ├── workspace.ts   # [Phase 8+9] 项目/引擎/工作区状态 SSoT
│   └── workspace.test.ts  # (在 test/unit/core/ 下)
├── detection/         # 持有 WorkspaceContext，提供 detection.ready
├── clangd/            # ClangdOps 消费 WorkspaceState（.clangd 写入 SSoT）
├── commands/          # 命令层经 _resolve.ts 走 workspace.selectedProject/selectedEngine
├── ui/                # QuickPick / StatusBar / Webview 消费 WorkspaceState
└── mcp/               # MCP tools.ts 走 silent 模式（包 4 预留）

test/unit/             # Vitest 测试镜像 src/
├── core/workspace.test.ts  # 12 个 describe/it 块，覆盖 selected* / dispose / ready / 边角
└── core/ssot.test.ts       # WorkspaceState + ClangdOps 单一真相源回归守卫（13 用例）
```

**Structure Decision**: 使用现有 single-extension layout。本 feature 不引入新源文件；仅写 spec/plan/tasks 三件 + 跑 analyze/converge 产出报告。任务清单中识别到的补漏项（如 FR-011 i18n 化）由后续 implement 阶段处理。

## Phase 0: Outline & Research

1. **Extract unknowns from Technical Context**: 无新增 NEEDS CLARIFICATION；现有实现已稳定。
2. **Generate research.md**：

```markdown
# Research: WorkspaceState 单一真相源合规审计

## Decision
不修改源码；只产出 spec/plan/tasks + analyze + converge 报告。

## Rationale
- 现有实现已通过 Phase 8+9 收尾，13 import / 36 callers 已稳定
- 用户意图是"验证宪法遵循"，而非"重构"
- 任何源码改动都应走 `/speckit.constitution` amendment + implement 流程

## Alternatives considered
- A. 直接走 `/speckit.constitution` 加严 Principle II 表述 → 拒绝：宪法文本已与实现对齐
- B. 重构 WorkspaceState 让 getter 改名 → 拒绝：破坏 36 callers；违反 Principle V 最小可逆演进
- C. 写一份 AD 文档说明 WorkspaceState 边界 → 接受：本 plan 在 data-model.md 承载

## Findings
- 潜在缺口 1: 「从 .uproject 重新生成工作区」warning 文案硬编码，未走 `t('workspace.missing', ...)` 双语 key（FR-011 待补）
- 潜在缺口 2: `resolveSelectedProject/resolveSelectedEngine` 仅在 spec.md FR-006 描述，调用方（`src/commands/_resolve.ts`）未实际使用；需要 converge 阶段识别
- 潜在缺口 3: ESLint 锁规则未在仓库根 `.eslintrc.json` 完整覆盖（如 `path.join`/`vscode.workspace.workspaceFile` 等具体 pattern）；需要 verify
```

**Output**: `research.md`

## Phase 1: Design & Contracts

**Prerequisites**: `research.md` complete

1. **Extract entities from feature spec** → `data-model.md`：

```markdown
# Data Model: WorkspaceState

## Entities

### WorkspaceState（聚合根）
- **字段（Level 0 根源）**：`_workspaceFile: string | null` / `_workspaceFolders: WorkspaceFolderInfo[]` / `_projectFolder: WorkspaceFolderInfo | null` / `_engineFolder: WorkspaceFolderInfo | null` / `_project: ProjectInfo | null` / `_engine: EngineInstall | null`
- **字段（用户选择）**：`_workspaceContext: WorkspaceContext | null`
- **字段（运行时）**：`_notifiedFields: Set<WorkspaceField>` / `_injected: boolean` / `_disposed: boolean`
- **派生 getter（Level 1）**：`workspaceRoot` / `projectDir` / `projectFile` / `projectName` / `engineRoot` / `engineVersion`
- **派生 getter（Level 2 .clangd）**：`clangdConfigPath` / `clangdHelperDir` / `clangdPerfCachePath` / `compileCommandsDir` / `compileCommandsPath`
- **派生 getter（Level 3 补全）**：`macroHelperPath` / `ueClangdCompatPath` / `addCompletionsPath` / `addMacroCompletionsPath` / `completionHelperPath` / `defaultCompletionsPath`
- **派生 getter（用户选择）**：`selectedProject` / `selectedEngine`
- **方法**：`setResult(result)` / `setSelectedProject(project)` / `setSelectedEngine(engine)` / `resolveSelectedProject(projects)` / `resolveSelectedEngine(engines)` / `dispose()` / `_resolve<T>(field, resolver)` / `_notifyMissing(field)` / `_missingMessage(field)` / `_resetForTest()`
- **状态机**：`uninjected → injected(injected=true) → disposed(injected=false, all cleared)`

### WorkspaceField（union type）
- 23 个字段标识符，作为 `_notifiedFields` 去重键与 `_resolve` 第一参数

### WorkspaceStateOptions（构造选项）
- `detection: { ready: Promise<DetectionResult> }`
- `workspaceContext?: WorkspaceContext`（生产必传）
- `logger: Logger`

### DetectionResult（detection.ready resolve 类型）
- `projects: ProjectInfo[]` / `engines: EngineInstall[]`
- `workspaceFile?: string` / `workspaceRoot?: string`
- `workspaceFolders: WorkspaceFolderInfo[]`
- `projectFolder: WorkspaceFolderInfo | null` / `engineFolder: WorkspaceFolderInfo | null`

### WorkspaceContext（detection 子模块）
- 持有 `memento: vscode.Memento`
- 方法：`getSelectedProject()` / `getSelectedEngine()` / `setProject(p)` / `setEngine(e)`

## Validation Rules
- 派生 getter MUST 在 `_injected=false` 时返回 `null`（不报警）
- 派生 getter MUST 在 `_injected=true` 但解析为 null/[] 时通过 `_notifyMissing` 报警（整 session 同 field 一次）
- `dispose()` 后所有 getter MUST 返回 `null`，setter MUST no-op 不抛错
- `_disposed=true` 时 `dispose()` MUST 幂等

## State Transitions
```
[uninjected] --detection.ready.resolve()--> [injected]
[injected] --workspace.setSelectedProject(p)--> [injected] (memento 持久化)
[injected] --workspace.dispose()--> [disposed]
[disposed] --(any access)--> [disposed] (no-op)
```
```

2. **Define interface contracts** → `contracts/`：

```typescript
// contracts/WorkspaceState.contract.ts
import type { WorkspaceState } from '@core/workspace';
import type { ProjectInfo, EngineInstall } from '@detection/types';

/**
 * WorkspaceState 公共契约
 *
 * 调用方 MUST 遵守：
 * 1. 派生路径一律经 WorkspaceState getter，禁止 path.join 拼接
 * 2. 用户选择经 workspace.selectedProject / selectedEngine，禁止读 detection.workspaceContext.getSelected*
 * 3. 写入用户选择经 workspace.setSelectedProject / setSelectedEngine，禁止直接调 detection.workspaceContext.set*
 * 4. 实例经 extension.ts push 到 context.subscriptions，禁止自建
 */
export interface WorkspaceStateContract {
  // Level 0 根源
  readonly workspaceFile: string | null;
  readonly workspaceFolders: WorkspaceFolderInfo[];
  readonly projectFolder: WorkspaceFolderInfo | null;
  readonly engineFolder: WorkspaceFolderInfo | null;
  readonly project: ProjectInfo | null;
  readonly engine: EngineInstall | null;

  // Level 1 派生
  readonly workspaceRoot: string | null;
  readonly projectDir: string | null;
  readonly projectFile: string | null;
  readonly projectName: string | null;
  readonly engineRoot: string | null;
  readonly engineVersion: string | null;

  // Level 2 .clangd
  readonly clangdConfigPath: string | null;
  readonly clangdHelperDir: string | null;
  readonly clangdPerfCachePath: string | null;
  readonly compileCommandsDir: string | null;
  readonly compileCommandsPath: string | null;

  // Level 3 补全
  readonly macroHelperPath: string | null;
  readonly ueClangdCompatPath: string | null;
  readonly addCompletionsPath: string | null;
  readonly addMacroCompletionsPath: string | null;
  readonly completionHelperPath: string | null;
  readonly defaultCompletionsPath: string | null;

  // 用户选择
  readonly selectedProject: string | null;
  readonly selectedEngine: string | null;
  setSelectedProject(project: ProjectInfo | undefined): Promise<void>;
  setSelectedEngine(engine: EngineInstall | undefined): Promise<void>;

  // 解析助手
  resolveSelectedProject(projects: readonly ProjectInfo[]): ProjectInfo | undefined;
  resolveSelectedEngine(engines: readonly EngineInstall[]): EngineInstall | undefined;

  // 生命周期
  setResult(result: DetectionResult): void;
  dispose(): void;
  readonly isInjected: boolean;
  readonly isDisposed: boolean;
}
```

3. **Create quickstart validation guide** → `quickstart.md`：

```markdown
# Quickstart: WorkspaceState 合规审计

## Prerequisites
- Windows 10/11；Node.js 18+；npm
- 仓库根可执行 `npm install`

## Validation Scenarios

### Scenario 1: 跑通前置脚本
```bash
cd "D:/AIWorkSpace/VScodePlugin/VSCodeUEHelper"
pwsh -NoProfile -File .specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks
# 期望输出 JSON，含 FEATURE_DIR = "specs/001-workspace-state-ssot-audit"，AVAILABLE_DOCS 含 spec.md/plan.md/tasks.md
```

### Scenario 2: 跑 typecheck / lint / unit
```bash
npm run typecheck   # PASS
npm run lint        # PASS
npm run test:unit   # PASS；test/unit/core/workspace.test.ts 12 个 describe/it 块全过
```

### Scenario 3: 跑 analyze 与 converge
```bash
/speckit.analyze    # 输出覆盖报告 + 宪法对齐发现
/speckit.converge   # 追加 Phase N: Convergence 任务清单
```

### Scenario 4: 验证未变更实现
```bash
git diff --stat src/core/workspace.ts
# 期望：no changes（仅产出 specs/001-workspace-state-ssot-audit/{spec,plan,tasks}.md）
```

## Expected Outcomes
- 三件 quality gate 全 PASS
- `/speckit.analyze` 报告 CRITICAL 数 = 0（FR-001..FR-010 + FR-011 缺口均在 tasks.md 反映）
- `/speckit.converge` 追加 N ≥ 0 条 Convergence 任务，旧 tasks 0 修改
- `src/core/workspace.ts` 字节级未变
```

**Output**: `data-model.md`、`contracts/WorkspaceState.contract.ts`、`quickstart.md`

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified.** Every exception MUST
> name the violated principle, owner, expiry/review date, evidence, and simpler alternative rejected.

| Violation                               | Why Needed                                 | Simpler Alternative Rejected Because           |
| --------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| 无（所有五项门 PASS）                    | N/A                                        | N/A                                            |

## Key Rules

- 严格只读：`/speckit.analyze` + `/speckit.converge` 不修改源码
- 五项宪法门 BLOCKING：任何 `FAIL` 必须在 Complexity Tracking 解决
- 治理优先级：`.specify/memory/constitution.md` > 本 plan > spec.md > 模板
- 历史档案保留：Phase 8 / 9 的旧 commit message / AGENTS.md 标注保留作为指引

## Done When

- [x] spec.md / plan.md / data-model.md / contracts/ / quickstart.md / research.md 齐全
- [x] tasks.md（Phase 2 产物，由 `/speckit.tasks` 生成）
- [x] Constitution Check 五项门 PASS 或 Complexity Tracking 显式登记
- [x] 跑 `/speckit.analyze` 输出报告
- [x] 跑 `/speckit.converge` 输出追加任务
- [x] quality gate（typecheck/lint/test:unit）证据记录