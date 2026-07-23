# Phase 1: 文档质量校正 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-23
**Phase:** 1-文档质量校正
**Areas discussed:** AGENTS.md 仓库陷阱措辞校准

---

## AGENTS.md 仓库陷阱措辞校准

**入口选择**(4 个 gray area 选哪个深入)

| Option | Description | Selected |
|--------|-------------|----------|
| AGENTS.md 仓库陷阱 | #1/#7/#10/#11/#12 措辞校准(5 处) | ✓ |
| 模块 AGENTS.md 数字校正 | 7+ 个数字 (38/9/72/16.3k/9/22) | |
| resources/README.md | 删 ue5-fast.json / banner.png 描述 | |
| 漂移防护机制 | grep guard / pre-commit hook | |

**User's choice:** AGENTS.md 仓库陷阱
**Notes:** 用户倾向选"内容"而非"形式" — 仓库陷阱是历史真实事故,改措辞有"反漂移"价值;数字校正是机械化,README 重写范围大;防护机制是元层面,放后续。

---

**#1 校准粒度**

| Option | Description | Selected |
|--------|-------------|----------|
| 单行追加(与 #12 风格一致) | 末尾加斜体拄释,标 T1.1 闭环 | ✓ |
| 重写为当前状态 | 完全重写句子描述 2026-07-23 现状 | |
| 删除 #1 | T1.1 闭环后 #1 是历史档案 | |

**User's choice:** 单行追加(推荐)
**Notes:** 最小视觉干扰;保留 #1 作为历史档案(T1.1 闭环前为什么这条是 trap)。

---

**拄释风格**

| Option | Description | Selected |
|--------|-------------|----------|
| 斜体拄释(与 #12 一致) | `*(T1.1 闭环 2026-07-23: ...)*` | ✓ |
| 破折号 + emoji 标记 | `— ✅ T1.1 闭环` | |
| 删除线重写 | `~~已坏~~ — 已闭环` | |

**User's choice:** 斜体拄释(与 #12 一致)
**Notes:** #12 已示范;风格统一,新读者立刻看懂"斜体部分是闭环状态"。

---

**Phase 1 范围**

| Option | Description | Selected |
|--------|-------------|----------|
| 同步动 #2/#7/#10 | 一次校准 4 处,防御性 | ✓ |
| 只改 #1 | 严格最小扩散 | |
| 同改 #1 + 14 行 | 顺手把状态速览的 21 改 22 | |

**User's choice:** 同步动 #2/#7/#10
**Notes:** 用户反向选批量校准(从原"只改 #1 最小"反转);决策是"批量 PR 更干净";#14 状态速览数字 (21 → 22) 暂不动(数字校正属于 Phase 2 DOC-03 范围,见 Deferred Ideas)。

---

## Claude's Discretion

- 4 处拄释的具体措辞由 Claude 起草(基于 CONCERNS.md 2026-07-23 校准段,见 CONTEXT.md D-01/02/03/04)
- 校准后是否追加 "Last updated" footer:否(AGENTS.md 已有 git log,加 footer 是噪音)
- #11 (与 #2 同主题) 不合并:保留两个互补视角(#2 是配置/资源视角,#11 是 API surface 视角)

## Deferred Ideas

| Idea | Reason | Target |
|------|--------|--------|
| DOC-03 数字校正 | 机械化,批量处理,避免与 #1/#2/#7/#10 混在一起 | Phase 2 续做 |
| DOC-01 resources/README.md 重写 | 范围大(整文),需独立 phase | Phase 2 续做 |
| 漂移防护机制 (grep guard / pre-commit hook) | 元层面,需用户单独决策 | Phase 2 独立 task |
| #3-#6 / #8 / #9 / #13 措辞 | 暂无漂移 | 未来若漂移再单独校准 |
| #11 闭环标记 | 实际 API 收口在 Phase 2 DEBT-01 | Phase 2 DEBT-01 完成后回标 |
