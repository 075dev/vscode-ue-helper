# Quickstart: WorkspaceState 单一真相源合规审计

## Prerequisites

- **平台**：Windows 10/11
- **运行时**：Node.js 18+、npm、PowerShell（pwsh）
- **路径别名**：仓库根 `tsconfig.json` 已声明 `@core` / `@detection` 等别名；本特性不引入新源文件故无需额外配置

## Validation Scenarios

### Scenario 1: 前置脚本能识别 feature

```bash
cd "D:/AIWorkSpace/VScodePlugin/VSCodeUEHelper"
pwsh -NoProfile -File .specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks
```

**期望输出**（节选）：

```json
{
  "FEATURE_DIR": "D:/AIWorkSpace/VScodePlugin/VSCodeUEHelper/specs/001-workspace-state-ssot-audit",
  "AVAILABLE_DOCS": ["spec.md", "plan.md", "tasks.md"]
}
```

如果报 `Feature directory not found`：确认 `specs/001-workspace-state-ssot-audit/` 下三个文件齐备。

### Scenario 2: 三件 quality gate

```bash
npm run typecheck   # PASS；src/core/workspace.ts 不新增 TS 错误
npm run lint        # PASS；ESLint 锁规则不触发新告警
npm run test:unit   # PASS；test/unit/core/workspace.test.ts 12 个 describe/it 块全过
```

**期望**：

- `test/unit/core/workspace.test.ts` 通过
- `test/unit/core/ssot.test.ts`（13 个回归守卫）通过
- 全局覆盖率不下降（baseline 见 `vitest.config.ts`）

### Scenario 3: `/speckit.analyze`

按命令运行约束输出报告，覆盖：

- 10 个 FR-### 的覆盖率表
- 5 项宪法门的对齐情况
- 严重度分级（CRITICAL/HIGH/MEDIUM/LOW）
- Next Actions

### Scenario 4: `/speckit.converge`

按命令运行约束在 `tasks.md` 末尾追加 `## Phase N: Convergence` 段：

- 旧任务 0 修改（grep 旧 T### 完整保留）
- 新任务每条格式：`- [ ] T### <desc> per <source-ref> (<gap-type>)`
- CRITICAL 任务排在最前
- 至少包含 research.md F1（warning i18n 化）的对应任务

### Scenario 5: 验证未变更实现

```bash
git diff --stat src/core/workspace.ts
# 期望：no changes
git diff --stat specs/001-workspace-state-ssot-audit/
# 期望：3 个新增文件（spec.md / plan.md / tasks.md）+ Phase N Convergence 段
```

## Expected Outcomes

| Outcome | Verification |
|---|---|
| 三个工件齐全 | `ls specs/001-workspace-state-ssot-audit/` |
| 三件 quality gate 全 PASS | `npm run typecheck && npm run lint && npm run test:unit` |
| analyze 报告 CRITICAL 数 = 0 | 报告 "Critical Issues Count" 字段 |
| converge 追加 N ≥ 0 条任务 | `tasks.md` 末尾 `## Phase N: Convergence` 段 |
| `src/core/workspace.ts` 字节级未变 | `git diff src/core/workspace.ts` |
| `src/core/AGENTS.md` 未变 | `git diff src/core/AGENTS.md`（reference docs 不在 audit 范围） |

## Rollback

如需回滚本次 audit：

```bash
rm -rf specs/001-workspace-state-ssot-audit/
```

**注意**：本 audit 不修改任何应用源代码；删除仅影响 specs 目录与 `.specify/feature.json`。无运行时回滚需求。

## Failure Handling

| 失败信号 | 根因 | 处理 |
|---|---|---|
| 前置脚本 `Feature directory not found` | 目录缺失 | 确认 `specs/001-workspace-state-ssot-audit/{spec,plan,tasks}.md` 存在 |
| `npm run typecheck` 报新错误 | 引入新 TS 类型未声明 | audit 不应改源码；如发生，停止并 revert |
| analyze CRITICAL > 0 | 严重缺口 | 在 tasks.md Phase 3+ 追加修复任务并走 `/speckit.implement` |
| converge 追加 0 任务 | 代码已对齐 spec/plan/tasks | 这是 `converged` 结局，无需补漏 |