---
phase: 4
context_date: 2026-08-26
gathered_by: inline_brownfield (gsd:plan-phase orchestrator 内联会话)
mode: mvp
granularity: coarse
depends_on:
  - Phase 1 (REM-001 Wave 1 P0 已闭环)
source_artifacts:
  - REMEDIATION-PLAN.md (deprecated historical, source of truth for Wave 2-5 task 列表)
  - AUDIT-REPORT.md (deprecated historical, source of truth for 43+ finding)
  - .planning/REQUIREMENTS.md (REM-002/003/004/005 v1 优先级登记)
  - .planning/ROADMAP.md (Phase 4 success criteria)
  - AGENTS.md (Phase 8/9 SSoT 收尾现状; 仓库陷阱 12 条; SubprocessRegistry 4 类豁免)
  - .planning/PROJECT.md §扩展原则 I-V (宪法 verbatim)
---

# Phase 4 上下文 — 修复轨道收尾

## 阶段目标(ROADMAP verbatim)

> 完成 REMEDIATION-PLAN Wave 2–5 全部 task 验证,把 43+ audit finding 全部闭环。

## 设计上下文(代替 discuss-phase,inline 决策)

### 决策 A — task 来源真源

**Wave 2–5 task 列表来源 = REMEDIATION-PLAN.md**。该文件已被 GOV-002 commit `f7bc1a0` 标记 deprecated(`AGENTS.md` 头 顶部"治理依据" 段指向 `.planning/PROJECT.md`),但**保留物理存在**(PROJECT.md §Out of Scope 严禁删除)。Phase 4 把它视为历史档案的**task 列表源**(新决策登在 `.planning/` 内,旧决策登在 REMEDIATION-PLAN 内) — 这是 deprecated 状态下的合规用法。

### 决策 B — 用户决策沿用 REMEDIATION-PLAN § 十二(2026-07-16)

REM-001 (Phase 1 Wave 1) 已完成的扩展决策:

- **H4 升级** = T2.1 已扩展为"完全删 completionMode 设置"。**已部分闭环于 Phase 1**(commit 5d282e8 + AGENTS.md 仓库陷阱 #2 + #11 已登记),T2.1 在本 phase 仅做"回归验证 + 收尾清扫"
- **M2 搁置** = T5.1 跳过(Wave 5 中此 task 不执行)。proxy/AGENTS.md "汉化 TODO 未落地" 声明继续保持。Phase 4 在 T5.1 标注 `gap_closure: false, skipped_by_decision: M2-2026-07-16`
- **T5.3 = A** = 按文件大小降序拆分 god 文件(compileCommands 1002 → bridge 692 → controlPanel.html.ts 615 → config 317 → workspace 307)
- **H3 决策 A / M3 决策 A** = 在 Wave 2/3 内执行,本 phase 不跳过

### 决策 C — 单 plan 单 wave,且 wave 内并行

- ROADMAP Phase 4 标 `4 plans(每个 Wave 一个 plan)`;REMEDIATION-PLAN 自标 "Wave 2 内部 8 task 全可独立并行"
- Phase 4 实行 plan = wave 边界,plan 内 task 可并行(本仓库无 parallelize 调度,但 plan 撰写时就按"任务可独立执行"写 action)
- Wave 之间有依赖(T5.3 改 compileCommands.ts 会冲突 Wave 4 T4.5),需用文件锁约定:同一文件不在不同 wave 同步改

### 决策 D — 不开 RESEARCH.md(节省 MCP 检索耗能)

Phase 4 task 全是已知仓库内清理型,有明确 source path + 验收。不需要外部知识:
- MSVC 正则(M4/T4.7)— 已在 AGENTS.md 仓库陷阱 #7 锁定 pattern 与位置
- completionMode 设置(H4/T2.1)— 已在 Phase 1 commit 5d282e8 + AGENTS.md 仓库陷阱 #2 + #11 闭环
- 汉化 TODO(M2/T5.1)— 搁置决策已知
- god 文件拆分(T4.5/T5.3)— 文件清单已知

符合 plan-phase §5 "Skip research if --skip-research or RESEARCH already exists"。

### 决策 E — must_haves.truths 来源

Wave 2–5 task 表的每条 task 在 plan-check 阶段都被纳入 `must_haves.truths`,并标注 H/M/L 优先级(对应审计 finding severity)+ 来源(AUDIT-REPORT 章节)。

## 范围 & 红线

### IN scope

- src/ 下任何 ts 文件的明确清理(Wave 2/3/4/5 task 涉及的所有路径)
- test/ 下测试更新(每个 task 改动后必须同步测试或写新测试)
- package.json(M3 卸 dead deps + T2.1 删 completionMode 设置若未在 Phase 1 完整闭环)
- AGENTS.md / README.md / CONTRIBUTING.md(T3.1/T3.4 文档重写)
- i18n 资源(T4.1 47 处硬编码字符串迁移 + T2.4 删 dead keys)

### OUT of scope(Phase 4 红线)

- 物理删除 REMEDIATION-PLAN.md / AUDIT-REPORT.md / .specify/ / .omp/commands/speckit.* —— PROJECT.md §Out of Scope 严禁
- 改宪法五原则 § 扩展原则 —— 任何 amend 须单独 phase
- 复活历史兼容函数(`populateAddCompletions`、`headerWatcher`、`writeClangdConfig`、`findClangdConfig`、`toggleCompletionMode`)—— AGENTS.md §Out of Scope 严禁
- 改 `package.json#platforms: ["win32"]`(Windows-First 边界)—— 宪法 I 红线
- 写 macOS / Linux 支持代码(虽然 Phase 3 RFC 决策 = No-Go,本 phase 严禁)—— 宪法 I 红线
- 引入新运行时依赖 —— 宪法 V "Minimal, Traceable, Reversible Evolution" 红线
- 改 MCP 模块整体架构(MCP-001 决策: 仅维持现状 + 缺陷修复)

## 与其他 Phase 的关系

- **Phase 1 (REM-001 Wave 1 P0)**: 已闭环。Phase 4 是 Wave 1 之后 wave。本 phase 部分 task(H4-B) 是补完 Phase 1 决策的落地收尾,不重复 Phase 1 已闭环 task。
- **Phase 2 (GOV-002/003)**: 已闭环。Phase 4 复用其决策(GOV-002 deprecated 横幅不影响本 phase 对 REMEDIATION-PLAN.md 的"作为历史档案 task 源"用法)
- **Phase 3 (PLAT-001)**: 已闭环,No-Go 决策;本 phase 与 PLAT-002 v2 不冲突
- **Phase 5 (下一里程碑规划)**: 接收 Phase 4 闭环结果,做 v2 评估。本 phase 末尾需标记 `passed` 让 Phase 5 可以启动

## Wave 依赖映射(决定 plan 顺序 + commit 串行)

| Wave | Task 数 | 文件冲突风险 | 后续 Wave 是否受影响 |
|------|--------|------------|--------------------|
| Wave 2 P1 | 8 (T2.1 已升级 H4-B;T2.2-T2.8 待办) | 改 package.json + Config.completionMode 引用点 + 3 个死别名 | 是(T4.1 i18n 引用 key 名敏感) |
| Wave 3 P2 | 5 (T3.1-T3.5 文档) | 仅 AGENTS.md / README.md / test 注释 | 否 |
| Wave 4 P3 | 9 (T4.1-T4.9 架构) | 大面积动 src/ + 拆 compileCommands.ts 1002 行 | 是(T5.3 依赖 T4.5 后的 compileCommands) |
| Wave 5 P4 | 4 (T5.1 跳过,T5.2-T5.5) | ueDiagnosticWatcher / god 文件 / MCP 测试 | 否 |

按依赖排序:Wave 2 → Wave 3 → Wave 4 → Wave 5。Wave 3 文档改可与 Wave 2 并行,但 ROADMAP 4 plans 按 Wave 编号。

## 完成态 = Phase 4 success criteria(verifier 句)

1. Wave 2 P1 高价值 8 task 全部验证通过(typecheck + lint + unit + build + 单一 atomic commit)
2. Wave 3 P2 文档对齐 5 task 全部验证通过
3. Wave 4 P3 架构债务 9 task 全部验证通过
4. Wave 5 P4 长期 5 task 全部验证通过(4 task 完成,T5.1 显式 skipped_with_reason)
5. AUDIT-REPORT.md 全部 43+ finding 标记闭环或 v2 推迟(在 04-VERIFICATION.md 表格中逐条对照)

## 风险与回滚

每个 plan 用一个 atomic commit(总 4 atomic commits + 1 final 04-VERIFICATION.md commit = 5 commits)。任何 plan 跑挂则上一个 commit 即回滚点。Phase 4 不做 squash merge,保持 audit 串清晰。
