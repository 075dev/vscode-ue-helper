# Phase 1: P0 必修闭环 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-25
**Phase:** 1-P0 必修闭环
**Areas discussed:** T1.4 现状核验, Verification 证据形式, Plan 拆分粒度, T1.3 icon.png 尺寸验证

---

## T1.4 现状核验

| Option | Description | Selected |
|--------|-------------|----------|
| 跑 lint 取精确报告（推荐） | 跑 `npm run lint` 后过滤 proxyManager.test.ts 相关行 | ✓ |
| 读源文件判定 | 直接 Read proxyManager.test.ts:200-230 | |
| 接受 0 error 即闭环 | 接受刚才的 lint 输出 0 error 作为闭环证据 | |

**User's choice:** 跑 lint 取精确报告（推荐）
**Notes:** `npm run lint` 输出 "0 errors, 53 warnings"，无 `proxyManager.test.ts` 相关 error
报告——T1.4 已闭环。之后问"继续 T1.4 还是下一灰区"，用户选"下一灰区"。

---

## Verification 证据形式

### 第一问：证据落哪里

| Option | Description | Selected |
|--------|-------------|----------|
| 单一 01-VERIFICATION.md（推荐） | phase 根目录记录：4 门禁命令输出完整 + git log 引用 | ✓ |
| 每个 plan 一个 SUMMARY.md | 粒度细；3 个已闭环 task 几乎无内容 | |
| VERIFICATION + SUMMARY 并存 | 已闭环 3 task git log + 4 门禁在 VERIFICATION；plan SUMMARY 记决定 | |

**User's choice:** 单一 01-VERIFICATION.md（推荐）

### 第二问：VERIFICATION 范围（多选）

| Option | Description | Selected |
|--------|-------------|----------|
| 门禁输出全文 | 完整 stdout/stderr | ✓ |
| 同时录 git log 引用 | T1.1–T1.4 commit hash + subject | ✓ |
| 明示未触发烟测 | 宪法 IV 例外声明 | （默认采纳，未明确表态） |
| exit code 摘要表 | 追加快速扫读入口 | （未表态，列入 Claude's Discretion） |

**User's choice:** 门禁输出全文 + 同时录 git log 引用
**Notes:** 未明示烟测与 exit code 摘要列入"Claude's Discretion"——按宪法 IV 例外默认采纳。

---

## Plan 拆分粒度

### 第一问：REM-001 拆几个 plan

| Option | Description | Selected |
|--------|-------------|----------|
| 2 plans（推荐） | 01-01: T1.1–T1.3 证据；01-02: T1.4 + 4 门禁 | ✓ |
| 4 plans | 每个 task 一个 | |
| 1 plan | 全打包 | |

**User's choice:** 2 plans（推荐）

### 第二问：01-01 与 01-02 拆分点

| Option | Description | Selected |
|--------|-------------|----------|
| 01-01 仅 T1.1–T1.3 证据（推荐） | 边界最清；01-01 不产生原子 commit | ✓ |
| 01-01 含 T1.4 证据 + 4 门禁 | | |

**User's choice:** 01-01 仅 T1.1–T1.3 证据（推荐）
**Notes:** 01-01 不产生原子 commit 在 CONTEXT.md 决策 D-09 显式记录（"one-way" 风险）。

---

## T1.3 icon.png 尺寸验证

| Option | Description | Selected |
|--------|-------------|----------|
| 读 PNG IHDR 头验证（推荐） | node + fs 读前 24 bytes | ✓ |
| 信任 AGENTS.md #3 字面 | 不取独立证据 | |
| 装 sharp 后验证 | 动 npm install | |

**User's choice:** 读 PNG IHDR 头验证（推荐）
**Notes:** 实测 `PNG dimensions: 128x128, file size: 4758 bytes, compliant with 128x128: YES`。
T1.3 已闭环。

---

## Claude's Discretion

- 01-VERIFICATION.md 的章节顺序（commit 引用在前 vs 门禁输出在前）
- `01-01-SUMMARY.md` 是否生成（如执行后认为 git log 引用 + commit 已足够说明 plan 目标，可省略）
- exit code 摘要表是否追加

## Deferred Ideas

无 scope creep。本 phase 讨论全程聚焦在 Wave 1 4 task 验证 + 证据采集，未引入
超出 ROADMAP.md Phase 1 边界的新能力。

未来若触发宪法 IV 烟测（Phase 4 `compileCommands` 拆分 T4.5 时）再启用现场烟测；
覆盖率 80%（PERF-001 / v2）归 Phase 5 下一里程碑规划。