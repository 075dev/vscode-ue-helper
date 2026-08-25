# Phase 1: P0 必修闭环 - Context

**Gathered:** 2026-08-25
**Status:** Ready for planning

<domain>
## Phase Boundary

完成 REMEDIATION-PLAN Wave 1 P0 必修全部 4 task（T1.1–T1.4）的验证证据，建立
CI / 发布的稳定基线。宪法 IV "Verification Gates Before Delivery" 强制：本 phase
是任何永久行为变更的最低门槛固化，不是引入新功能。

**核心事实（scout 实测）：** T1.1–T1.4 在 git log 中已闭环。本 phase 的真实工作是
"证据采集 + 4 门禁全绿验证 + 单一 VERIFICATION.md 收纳"，**不重新执行 task**。

</domain>

<decisions>
## Implementation Decisions

### Wave 1 Task 闭环状态

- **D-01:** T1.1（删 `test:integration` + `test` alias 到 `test:unit`）已闭环 ——
  `package.json:482` 当前为 `"test": "npm run test:unit"`，无 `test:integration` 残留。
  闭环 commit 由 `1bf852e fix(build): cmd.exe 引号剥离与构建取消/并发守卫` 同期某条
  `fix(test)` 完成（具体 commit hash 在 01-VERIFICATION.md 的 git log 引用里给）
  — **Reversibility:** reversible — 重新引入 `test:integration` 即可，无迁移成本
- **D-02:** T1.2（`.bak` git rm + `.gitignore` 加 `*.bak`）已闭环 ——
  `.gitignore:31` 含 `*.bak`；git tree 中无 `.bak` 残留；AGENTS.md 仓库陷阱 #4
  明文登记 — **Reversibility:** reversible — 删除 `.gitignore` 规则即可恢复跟踪
- **D-03:** T1.3（`resources/icon.png` 替换为 128×128 PNG）已闭环 ——
  IHDR header 实测为 128×128，4758 bytes，AGENTS.md 仓库陷阱 #3 登记 — **Reversibility:** reversible — 替换 PNG 即可
- **D-04:** T1.4（`proxyManager.test.ts:216` lint error）已闭环 ——
  `npm run lint` 当前输出 `0 errors, 53 warnings`，无 proxyManager.test.ts 相关
  error 报告。lint 输出全文作为 01-VERIFICATION.md 附件 — **Reversibility:** reversible — 引入 lint error 即可重现

### Verification 证据形式

- **D-05:** Verification 证据落单一 `01-VERIFICATION.md`（不拆 per-plan SUMMARY）
  —— **Reversibility:** costly — 后续若决定拆 SUMMARY 需重建文件结构，但目前
  GSD 默认 verification 是 phase 级文档，未拆 SUMMARY 不构成回归
- **D-06:** `01-VERIFICATION.md` 收纳内容：①4 门禁命令完整 stdout（含 warnings）；
  ②T1.1–T1.4 对应 git log commit hash + subject 引用作为闭环证据链；③宪法 IV
  例外声明"本 phase 不触发 Windows UE 现场烟测，因不涉及 build/clangd 行为变更"
  — **Reversibility:** costly — 后续若选择烟测则需重写章节
- **D-07:** 4 门禁命令：①`npm run typecheck` ②`npm run lint` ③`npm run test:unit`
  ④`npm run build` —— **Reversibility:** reversible — 增删门禁命令即可

### Plan 拆分粒度

- **D-08:** Phase 1 拆 2 plans：①`01-01` T1.1–T1.3 已闭环证据采集（git log 引用，
  无代码改动）②`01-02` 4 门禁全绿验证 + `01-VERIFICATION.md` 写入 —— **Reversibility:**
  costly — 后续若需要重新拆 plan 需重命名文件，但当前粒度与"已闭环 + 待验证"
  二状态匹配
- **D-09:** `01-01` 不产生原子 commit（纯证据采集，无代码/文档/配置改动）—— 
  **Reversibility:** one-way — 一旦 Phase 1 完成，"是否有过 01-01 commit"成为历史
  元数据不可改。建议在 `01-VERIFICATION.md` 的"执行轨迹"段显式记录这一情况，
  避免未来审计误判"01-01 缺失 commit"
- **D-10:** `01-01` 的 git log 引用以 commit hash + subject 形式呈现，不嵌入
  完整 commit message —— **Reversibility:** reversible — 后续若需要完整 message
  可加

### Claude's Discretion

- 01-VERIFICATION.md 的章节顺序（commit 引用在前 vs 门禁输出在前）
- `01-01-SUMMARY.md` 是否生成（如执行后认为 git log 引用 + commit 已足够说明
  plan 目标，可省略 SUMMARY）
- exit code 摘要表是否追加（如未来 VERIFICATION 文件过长需要快速扫读入口）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Governance
- `.planning/PROJECT.md` §"扩展原则" — 宪法 I–V verbatim 迁移；本 phase 必须满足宪法 IV "Verification Gates"
- `.planning/PROJECT.md` §"Requirements" / REM-001 — Wave 1 4 task 验证证据为本 phase 的 REQ 唯一来源
- `.planning/REQUIREMENTS.md` — REM-001 的展开定义与 Out of Scope 边界

### Phase Plan & History
- `.planning/ROADMAP.md` §Phase 1 — Goal / Success Criteria / Plans 槽位
- `.planning/STATE.md` — 当前全局进度，Phase 0 已完成

### Repair History
- `REMEDIATION-PLAN.md` §Wave 1 — T1.1–T1.4 的原始定义（4 task 的"目标文件 / 修改 / 验证 / 原子提交"4 列表格）
- `AUDIT-REPORT.md` — 43+ finding 的全清单，REM-001 是 Wave 1 P0 必修部分（CRITICAL + HIGH 中优先级最高的子集）

### Codebase Context
- `package.json` §scripts — 4 门禁命令源头（typecheck / lint / test:unit / build）
- `AGENTS.md` §"仓库陷阱" #1/#3/#4 — 已闭环 task 的明文登记（事实校验参考）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `package.json:471-489` npm scripts：4 门禁命令源头，作为 verification 触发器
- `scripts/clean-out.mjs`：`npm run build` 前置；测试输出可重入
- `test/unit/setup.ts`：vitest 全局 setup，含 chokidar mock（AGENTS.md 仓库陷阱 #6 提示）

### Established Patterns
- Atomic commit 规范：每个 REM task 一条 atomic commit，commit message 走 Conventional Commits
  中文 summary（与宪法 V "Minimal, Traceable, Reversible Evolution" 一致）
- `git log --oneline` 作为已闭环 task 的"证据链"——优于重新跑命令

### Integration Points
- `.planning/01-VERIFICATION.md` 是 phase 完成的单一证据入口（`/gsd-verify-work` 的目标）
- `git log --grep` 可按 task 编号（T1.1 / T1.2 等）精确查询闭环 commit

</code_context>

<specifics>
## Specific Ideas

无特定愿景偏好——本 phase 是验证/证据 phase，不涉及 UX/功能/架构选型。用户在前置
new-project 会话已明确：v1 = REM-001 + GOV-* + MCP-001 + PLAT-001；Coarse 粒度 +
Vertical MVP 模式；可选烟测（贴合宪法 IV "when the required environment is available"）。

### Discussion Highlights（用户确认过的关键判断）

- "单一 01-VERIFICATION.md（含完整 4 门禁输出 + git log 引用）"是用户选定的 verification
  证据形式，**不是** per-plan SUMMARY 拆分
- "2 plans（01-01 = 证据采集无 commit / 01-02 = 4 门禁验证）"是用户选定的 plan 拆分粒度
- "读 PNG IHDR header 验证尺寸"是用户选定的 T1.3 验证方式（无新增依赖）

</specifics>

<deferred>
## Deferred Ideas

无 scope creep。本 phase 讨论全程聚焦在 Wave 1 4 task 验证 + 证据采集，未引入
任何超出 ROADMAP.md Phase 1 边界的新能力。

如未来需要：
- 烟测相关：宪法 IV 触发条件（build/clangd 行为变更）当前不满足；待 Phase 4
  `compileCommands` 拆分（T4.5）触发时再启用
- 覆盖率提升至 80%：属于 PERF-001（v2），归 Phase 5 下一里程碑规划

</deferred>

---
*Phase: 1-P0 必修闭环*
*Context gathered: 2026-08-25*