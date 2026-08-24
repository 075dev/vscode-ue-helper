# Roadmap: VSCodeUEHelper 治理迁移与修复轨道

## Overview

本路线图面向 VSCodeUEHelper v0.1.x → v0.2.x 阶段。起于 **`.planning/` 工作流重启**与
**`.specify/constitution.md` 治理迁移**，终于 **REMEDIATION-PLAN 全部 Wave 闭环** 与
**macOS 工具链探测 RFC 草案**。每个 Phase 交付一项端到端能力，符合用户指定的 Vertical
MVP 模式 + Coarse 粒度（3–5 phases）。Phase 1–4 涵盖 v1 全部需求，Phase 5 涵盖 v2 需求
与里程碑收尾。

## Phases

- [x] **Phase 0: 治理迁移启动** — `.planning/` 重建、constitution 迁入、`config.json` 与
  `REQUIREMENTS.md` 落盘（**当前已完成**：`db498c3` + `b0919da` + `59fb431`）
- [ ] **Phase 1: P0 必修闭环** — Wave 1 全部 4 task 验证证据 + 门禁绿（REM-001）
- [ ] **Phase 2: 治理迁移完结** — GOV-002 标 deprecated + GOV-003 AGENTS/README 同步
  + MCP-001 现状确认（独立可并行的小 phase）
- [ ] **Phase 3: 平台边界探索** — PLAT-001 macOS 工具链探测 RFC 草稿
- [ ] **Phase 4: 修复轨道收尾** — REM-002/003/004/005 Wave 2–5 推进（5min~ 单项 task
  单 phase 拆分；与宪法 IV "Verification Gates" 对齐）
- [ ] **Phase 5: 下一里程碑规划** — v2 需求（API-001 / PERF-001）评估与 v0.2.0 / 1.0.0
  路线图设计

## Phase Details

### Phase 0: 治理迁移启动 ✅

**Goal**: 完成 `.planning/` 工作流重建，把 `.specify/constitution.md` 5 条核心原则迁入
`.planning/PROJECT.md` "扩展原则"章节，建立 REQ-ID 唯一真源。
**Depends on**: Nothing（first phase）
**Status**: Complete
**Completed**: 2026-08-18

**Requirements**: GOV-001（完成度：已落盘待最终一致性核对）
**Success Criteria**:
  1. `.planning/PROJECT.md` 存在且包含 "扩展原则" 章节 verbatim 迁移自
     `.specify/memory/constitution.md`
  2. `.planning/REQUIREMENTS.md` 存在，包含 v1 / v2 / Out of Scope 三组
  3. `.planning/config.json` 存在，含 mode / granularity / parallelization / commit_docs
  4. `git log` 含 `docs: initialize project` + `chore: add project config` + 
     `docs: define v1 requirements` 三条 atomic commit

**Plans**: 1 plan（即本次 `/gsd-new-project` 会话本身）

Plans:
- [x] 00-01: `.planning/` 重建（已完成）

### Phase 1: P0 必修闭环

**Goal**: 完成 REMEDIATION-PLAN Wave 1 P0 必修全部 4 task，建立 CI/发布的稳定基线。
**Depends on**: Phase 0
**Mode**: mvp
**Requirements**: REM-001
**Success Criteria**:
  1. `npm run typecheck` exit 0
  2. `npm run lint` exit 0（0 error，warning ≤ 已登记基线）
  3. `npm run test:unit` exit 0（71 文件 / ~12k 行）
  4. `npm run build` exit 0（双产物 `out/extension.js` + `out/clangdProxy.js` 生成）
  5. `npm test` 不再调用已删除的 `test:integration`（按 AGENTS.md 仓库陷阱 #1）
**Plans**: 2 plans

Plans:
- [ ] 01-01: Wave 1 Task 1.1–1.2（删 `test:integration` 脚本 + `test` alias 到 `test:unit`）
- [ ] 01-02: Wave 1 Task 1.3–1.4（其他 P0 必修 task，如 Config.update 文档与代码同步、命令数量统一最后一项）

### Phase 2: 治理迁移完结

**Goal**: 把 `.specify/`、`REMEDIATION-PLAN.md`、`AUDIT-REPORT.md` 正式标 deprecated，更新
`AGENTS.md` / `README.md` 的治理指向，确认 MCP 维持现状。
**Depends on**: Phase 0（与 Phase 1 可并行；独立小 phase）
**Mode**: mvp
**Requirements**: GOV-002, GOV-003, MCP-001
**Success Criteria**:
  1. `.specify/constitution.md` 首行可见 deprecation 横幅
  2. `REMEDIATION-PLAN.md` 首行可见 deprecation 横幅
  3. `AUDIT-REPORT.md` 首行可见 deprecation 横幅
  4. `AGENTS.md` 头部"治理依据"段指向 `.planning/PROJECT.md`
  5. `README.md` "Governance" 段指向 `.planning/PROJECT.md`
  6. MCP 工具集与启动策略与 `MCP-001` 描述一致；如不一致触发 fix
**Plans**: 1–2 plans

Plans:
- [ ] 02-01: GOV-002 三文件标 deprecated + GOV-003 AGENTS/README 同步（单 commit 链）
- [ ] 02-02: MCP-001 现状核对 + 对照测试（按需）

### Phase 3: 平台边界探索

**Goal**: 产出 macOS 工具链探测可行性 RFC 草稿，明确宪法 I 边界扩展所需的前置条件。
**Depends on**: Phase 0（独立；与 Phase 1/2 可并行）
**Mode**: mvp
**Requirements**: PLAT-001
**Success Criteria**:
  1. `.planning/rfc/PLAT-001-macos-toolchain-detection.md` 文件存在
  2. RFC 包含 Go / No-Go 决策清单与缓解措施
  3. RFC 明确"不构成修宪依据"边界
  4. RFC 与宪法 I "Windows-First Unreal Scope" 一致性自检通过
**Plans**: 1 plan

Plans:
- [ ] 03-01: 撰写 macOS 工具链探测 RFC 草稿

### Phase 4: 修复轨道收尾

**Goal**: 完成 REMEDIATION-PLAN Wave 2–5 全部 task 验证，把 43+ audit finding 全部闭环。
**Depends on**: Phase 1
**Mode**: mvp
**Requirements**: REM-002, REM-003, REM-004, REM-005
**Success Criteria**:
  1. Wave 2 P1 高价值 8 task 全部验证通过
  2. Wave 3 P2 文档对齐 5 task 全部验证通过
  3. Wave 4 P3 架构债务 9 task 全部验证通过
  4. Wave 5 P4 长期 5 task 全部验证通过
  5. AUDIT-REPORT.md 全部 43+ finding 标记闭环或 v2 推迟
**Plans**: 4–5 plans（每个 Wave 一个 plan）

Plans:
- [ ] 04-01: Wave 2 P1 高价值（REM-002）
- [ ] 04-02: Wave 3 P2 文档对齐（REM-003）
- [ ] 04-03: Wave 4 P3 架构债务（REM-004）
- [ ] 04-04: Wave 5 P4 长期（REM-005）

### Phase 5: 下一里程碑规划

**Goal**: 在 v1 全部需求闭环后，评估 v2 需求与 v0.2.0 / 1.0.0 路线图。
**Depends on**: Phase 4
**Mode**: mvp
**Requirements**: REM-* (剩余 deferred), PLAT-002, API-001, PERF-001
**Success Criteria**:
  1. v2 需求优先级排序 + 进入下一里程碑 roadmap
  2. PLAT-001 RFC 决策落地（Go / No-Go）
  3. v0.2.0 / 1.0.0 公共 API 稳定性评估（如宪法 V 要求）
  4. 覆盖率提升计划（按 AGENTS.md "FIX-PLAN 阶梯校准"）
**Plans**: 1 plan

Plans:
- [ ] 05-01: 下一里程碑规划 + ROADMAP.md 重排

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5（Phase 2 与 Phase 3 实际可与 Phase 1
并行启动，但路线图表以数字序展示）

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. 治理迁移启动 | 1/1 | Complete | 2026-08-18 |
| 1. P0 必修闭环 | 0/2 | Not started | - |
| 2. 治理迁移完结 | 0/1 | Not started | - |
| 3. 平台边界探索 | 0/1 | Not started | - |
| 4. 修复轨道收尾 | 0/4 | Not started | - |
| 5. 下一里程碑规划 | 0/1 | Not started | - |

---
*Last updated: 2026-08-18 after brownfield initialization*
