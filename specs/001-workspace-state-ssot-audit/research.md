# Research: WorkspaceState 单一真相源合规审计

## Decision

不修改 `src/core/workspace.ts` 源码；本 feature 的产出仅为：

1. `specs/001-workspace-state-ssot-audit/{spec.md, plan.md, tasks.md}` 三件工件
2. `/speckit.analyze` 报告（宪法对齐 + 覆盖率 + 严重度）
3. `/speckit.converge` 在 `tasks.md` 末尾追加的 Convergence 阶段任务清单

任何源码改动走后续 `/speckit.implement` 阶段或 `/speckit.constitution` amendment 流程。

## Rationale

- **现有实现已稳定**：13 import / 36 callers 已生产；Phase 8+9 已收尾（参见 `src/core/AGENTS.md` §"WorkspaceState"）
- **用户意图是"验证宪法遵循"，而非"重构"**：单纯做代码重构会违反 Principle V「Minimal, Traceable, Reversible Evolution」
- **遵循宪法优先级**：`.specify/memory/constitution.md` > spec > plan > 实现；audit 是符合宪法优先级链的合规动作

## Alternatives considered

| 备选 | 描述 | 拒绝原因 |
|---|---|---|
| A | 直接走 `/speckit.constitution` 加严 Principle II 表述 | 宪法文本已与实现对齐；不必要的版本膨胀 |
| B | 重构 WorkspaceState 让 getter 改名 / 拆分类 | 破坏 36 callers；违反 Principle V 最小可逆演进 |
| C | 写一份 AD 文档说明 WorkspaceState 边界 | 接受：作为 `data-model.md` 的实体模型承载 |
| D | 直接修改 `src/core/workspace.ts` 加 i18n 双语 key | 拒绝：超出"audit"范围；保留为 tasks.md 内的 Convergence 任务 |

## Findings

### F1: warning 文案未走 i18n（potential FR-011 缺口）

**位置**：`src/core/workspace.ts:417` 私有方法 `_missingMessage()`

```typescript
private _missingMessage(_field: WorkspaceField): string {
  return '从 .uproject 重新生成工作区';
}
```

**问题**：硬编码中文字符串，违反宪法 §III「Every user-visible string MUST use the bilingual `en` and `zh` i18n resources」。

**严重度**：HIGH（虽然只在缺失根信息时弹一次，仍是用户可见字符串）

**建议**：新增 `t('workspace.missingRoot', undefined)` 双语 key；en + zh 同步添加。`@i18n` 当前未暴露该 key，故这是缺口。

**追踪**：作为 Phase 2: Foundational → FR-011 在 `tasks.md` 体现。

### F2: `resolveSelected*` 未在调用方实际使用

**位置**：`src/core/workspace.ts:226` / `src/core/workspace.ts:235`

**问题**：`resolveSelectedProject(projects)` / `resolveSelectedEngine(engines)` 在 spec.md FR-006 描述为"收口命令层 `projects.find(p => p.path === workspace.selectedProject)` 重复模式"，但 `src/commands/_resolve.ts:36-50` 的 `legacyFindProject` / `legacyFindEngine` 仍走 `detection.workspaceContext.getSelected*` 而非 `workspace.resolveSelected*`。

**严重度**：MEDIUM（功能等价但 SSoT 路径未收敛到 WorkspaceState）

**建议**：`src/commands/_resolve.ts` 的 `resolveProjectOrPick` / `resolveEngineOrPick` 在传入 `workspace` 时优先调 `workspace.resolveSelected*`，未传时保留 `legacyFind*` fallback。

**追踪**：tasks.md Phase 3 → T-ResolveProject 任务。

### F3: ESLint 锁规则覆盖率待 verify

**位置**：仓库根 `.eslintrc.json`（具体 pattern 待 grep 验证）

**问题**：FR-007 要求 ESLint 锁定以下绕过路径，但仓库当前锁规则覆盖范围需 verify：
- `vscode.workspace.workspaceFile` 直读
- `vscode.workspace.workspaceFolders` 直读
- `vscode.workspace.getWorkspaceFolder(...)` 直读（除构造 vscode.Task）
- `detection.workspaceContext.getSelectedProject/Engine` 直读
- `detection.workspaceContext.setProject/Engine/set*` 直写
- `path.join(root, '.clangd')` 等文件路径拼接

**严重度**：MEDIUM（ESLint 是治理的关键执行点）

**建议**：analyze 阶段 grep `.eslintrc.json` 验证 6 条 pattern；若有缺失，追加对应 `no-restricted-syntax` / `no-restricted-imports` 规则。

**追踪**：tasks.md Phase 3 → T-EslintVerify 任务。

## Decisions Mapped to Constitution

| Principle | Decision | Evidence |
|---|---|---|
| §I Windows-First | 仅审计 Windows-only 路径 | spec.md FR-001 + plan.md Technical Context |
| §II SSoT | audit 不破坏 SSoT；识别 F2 | spec.md FR-007 + research F2 |
| §III UX/Logs/Lifecycle | 识别 F1 (i18n 缺口) | research F1 |
| §IV Verification | 三件 quality gate 必跑 | quickstart.md Scenario 2 |
| §V Minimal/Traceable | audit 只读；不改源码 | research Decision |

## Open Questions

无。已有信息足够完成 audit。

## References

- `.specify/memory/constitution.md` v1.0.1（5 项原则）
- `src/core/workspace.ts`（13 import / 36 callers）
- `src/core/AGENTS.md` §"WorkspaceState"
- `src/commands/_resolve.ts`（legacyFind* fallback 路径）
- `test/unit/core/workspace.test.ts`（12 个 describe/it 块）
- `test/unit/core/ssot.test.ts`（13 个回归守卫）