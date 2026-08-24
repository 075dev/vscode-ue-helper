# VSCodeUEHelper 需求清单（v1 / v2 / Out of Scope）

> **生成时间**：2026-08-18（brownfield initialization）
> **上下文**：本次 `/gsd-new-project` 重建 `.planning/`，目标是把分散在
> `.specify/constitution.md`、`AGENTS.md`、`REMEDIATION-PLAN.md`、`AUDIT-REPORT.md`
> 的治理职责全部收敛到 `.planning/PROJECT.md` + 本文件。`REMEDIATION-PLAN.md`
> 转为 deprecated 历史档案，本文件为唯一需求真源。
> **Traceability**：本文件 REQ-ID 由 Roadmap 阶段填入 `→ Phase X.Y` 引用。

## v1 Requirements

### 修复轨道（来源：REMEDIATION-PLAN.md Wave 1 P0 必修）

- [ ] **REM-001**：完成 Wave 1 P0 必修全部 4 task 的验证证据（`npm run typecheck` /
  `lint` / `test:unit` / `build` 全绿 + 现场烟测如适用）
  - 涉及文件（按 REMEDIATION-PLAN.md 一阶段原描述）：`package.json`（T1.1 删
    `test:integration`、`test` alias 到 `test:unit`）、可能存在的 T1.2 / T1.3 / T1.4
  - 验收证据：4 个本地门禁命令 exit 0；自验证脚本（如有）输出 PASS

### 治理迁移（来源：本 new-project 会话决策）

- [ ] **GOV-001**：把 `.specify/memory/constitution.md` v1.0.1 的 5 条核心原则 + 5 条
  开发工作流 verbatim 迁移到 `.planning/PROJECT.md` "扩展原则"章节（在 PROJECT.md 中已
  完成初稿落盘，本 task 负责最终一致性核对 + Sync Impact Report 增补）
  - 验收：`.planning/PROJECT.md` 第 "扩展原则" 章节存在；措辞与 normative 强度与原文
    一致；Deviations 全部登记在 Sync Impact Report

- [ ] **GOV-002**：在 `.specify/constitution.md`、`REMEDIATION-PLAN.md`、`AUDIT-REPORT.md`
  三个文件顶部插入 `> DEPRECATED: moved to .planning/PROJECT.md on 2026-08-18` 横幅
  - 验收：3 个文件首行可见 deprecation 横幅；不修改文件其他内容；不物理删除

- [ ] **GOV-003**：更新 `AGENTS.md` 头部 "治理依据" 段、README.md "Governance" 段指向
  `.planning/PROJECT.md`（与 constitution I 的"Windows-First Unreal Scope"一致行文）
  - 验收：两处更新 commit 清晰可追溯；本文件不被重复指向

### MCP 现状确认（来源：本 new-project 会话决策）

- [ ] **MCP-001**：维持现有 6 工具（`ue_build` / `ue_launch_editor` / `ue_live_coding` /
  `ue_generate_compile_commands` / `ue_show_project_info` / `ue_set_system_includes`）+
  Cursor / Claude Code 环境变量嗅探启动策略
  - 验收：在 `.planning/PROJECT.md` Out of Scope 区登记"不扩张 MCP"；本 task 仅记录
    决策、无代码改动；如发现现状偏离描述则触发 fix

### 平台边界探索（来源：本 new-project 会话决策）

- [ ] **PLAT-001**：撰写 macOS 工具链探测可行性 RFC 草稿（仅产出 markdown，不动代码）
  - 描述关键风险点：Xcode clang vs MSVC clang 差异、include path 探测、UBT 在
    非 Windows 下不存在、`package.json#platforms: ["win32"]` 边界、与宪法 I 的关系
  - 验收：`.planning/rfc/PLAT-001-macos-toolchain-detection.md` 文件存在；列出
    Go / No-Go 决策清单与缓解措施；**不构成修宪依据**

## v2 Requirements

> 以下需求已识别但暂不在 v1 范围。具体 Phase 调度由 Roadmap 决定。

- [ ] **REM-002**：完成 Wave 2 P1 高价值全部 8 task 验证（5min~ 单项，单 phase 推进）
- [ ] **REM-003**：完成 Wave 3 P2 文档对齐全部 5 task（README / AGENTS 校准 +
  仓库陷阱条目同步，含 GOV-003 之外的文档更新）
- [ ] **REM-004**：完成 Wave 4 P3 架构债务全部 9 task（DDD 三层实质化 / `Config.update`
  文档同步 / 死别名与死 i18n key 清理 等）
- [ ] **REM-005**：完成 Wave 5 P4 长期全部 5 task（macOS 路径探测 RFC 后续 / 公共 API
  稳定性审视等）
- [ ] **PLAT-002**：[PENDING PLAT-001 RFC 通过后] 完整 macOS 工具链支持（需宪法 I 修正）
- [ ] **API-001**：v0.2.0 / v1.0.0 公共 API 重新审视 + ADR（仅在 GOV-003 后评估）
- [ ] **PERF-001**：vitest 覆盖率阈值提升至 80%（按 `AGENTS.md` "FIX-PLAN 阶梯校准"）

## Out of Scope

- ✗ 立即修宪扩张到 macOS / Linux（需先有正式 RFC + 用户复核，且需 `.planning/PROJECT.md`
  "扩展原则"章节同步修订）
- ✗ 物理删除 `.specify/` 或 `.omp/commands/speckit.*`（会立即破坏 Spec Kit 命令注册）
- ✗ 物理删除 `REMEDIATION-PLAN.md` / `AUDIT-REPORT.md` 文件（保留为历史档案）
- ✗ 重写 MCP 模块整体架构（仅维持现状 + 缺陷修复）
- ✗ 引入新运行时依赖（除非有具体边界问题且走宪法 V "Minimal, Traceable, Reversible
  Evolution" 流程）
- ✗ 复活历史 `.planning/` 中已被移除的兼容函数（例：`populateAddCompletions`、
  `headerWatcher`、`writeClangdConfig`、`findClangdConfig`、`toggleCompletionMode`）

## Traceability（Roadmap 阶段填入）

| REQ-ID | Phase 映射 | 备注 |
|--------|-----------|------|
| _Roadmap 写入后填入_ | _Phase X.Y_ | _引用 PLAN.md 任务编号_ |

---
*Last updated: 2026-08-18 after brownfield initialization*
