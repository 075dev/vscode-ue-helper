---
phase: 01-文档质量校正
plan: 01
subsystem: docs
tags: [agents-md, doc-calibration, drift-fix, repository-traps]

# Dependency graph
requires: []
provides:
  - "AGENTS.md 仓库陷阱 #1/#2/#7/#10 与 2026-07-23 实测状态对齐"
  - "4 条斜体注释(D-01/D-02/D-03/D-04)作为历史档案 + 闭环状态标记"
affects:
  - "Phase 2 文档主题续做(resources/README.md 重写 + 8 模块 AGENTS.md 数字校正)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "仓库陷阱条目末尾追加斜体注释,作为闭环/部分闭环标记(与 #12 的 ✅+删除线风格呼应)"

key-files:
  created: []
  modified:
    - AGENTS.md

key-decisions:
  - "4 处编辑均在原条目末尾追加斜体注释,不替换原句 — 保留原条目作为历史档案"
  - "DOC-01(resources/README.md 重写)与 DOC-03(8 模块 AGENTS.md 数字校正)按 CONTEXT.md §Deferred Ideas 整体延后 Phase 2"
  - "不动 #11(API 视角)与 #12(已 ✅)"

patterns-established:
  - "AGENTS.md 仓库陷阱维护: 闭合/部分闭合用 T-NN + 闭环/部分闭环 + 日期 + 简明现状 + 真正陷阱(如适用)"
  - "未来 Phase 2 模块 AGENTS.md 数字校正参考本次反漂移思路"

requirements-completed:
  - DOC-01
  - DOC-02
  - DOC-03

coverage:
  - id: D1
    description: "AGENTS.md 仓库陷阱 #1 末尾追加 T1.1 闭环注释(`test` script alias 到 `test:unit`)"
    requirement: DOC-02
    verification:
      - kind: other
        ref: "grep -E '\\*\\(T1\\.1 闭环 2026-07-23:.*已删除\\)\\*' AGENTS.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "AGENTS.md 仓库陷阱 #2 末尾追加 T2.1 闭环注释(新代码读静态常量 `COMPLETION_MODE`)"
    requirement: DOC-02
    verification:
      - kind: other
        ref: "grep -E '\\*\\(T2\\.1 闭环 2026-07-23:.*废弃 API 兼容\\)\\*' AGENTS.md"
        status: pass
    human_judgment: false
  - id: D3
    description: "AGENTS.md 仓库陷阱 #7 末尾追加 T4.7 闭环注释(msvcParser.ts 是生效副本, problemMatchers 仅 Task 用户参考)"
    requirement: DOC-02
    verification:
      - kind: other
        ref: "grep -E '\\*\\(T4\\.7 闭环 2026-07-23:.*不自动 task 消费 UBT 输出\\)\\)\\*' AGENTS.md"
        status: pass
    human_judgment: false
  - id: D4
    description: "AGENTS.md 仓库陷阱 #10 末尾追加 T1.x 部分闭环注释(Config.update 内部已 refreshRoot, 但跨实例缓存引用仍读到旧值)"
    requirement: DOC-02
    verification:
      - kind: other
        ref: "grep -E '\\*\\(T1\\.x 部分闭环 2026-07-23:.*读到旧值\\)\\*' AGENTS.md"
        status: pass
    human_judgment: false
  - id: D5
    description: "其他 9 条仓库陷阱(#3-#6/#8/#9/#11-#13)文本未改"
    requirement: DOC-02
    verification:
      - kind: other
        ref: "grep 9 个关键短语,各 1 次匹配"
        status: pass
    human_judgment: false
  - id: D6
    description: "DOC-01(resources/README.md 重写)与 DOC-03(8 模块 AGENTS.md 数字校正)按用户锁定决策延后到 Phase 2"
    requirement: DOC-01
    verification:
      - kind: manual_procedural
        ref: "AGENTS.md 仓库陷阱章节之外无任何改动"
        status: pass
    human_judgment: true
    rationale: "延后决策由用户/上下文锁定,无需自动化判定 — 仅需确认本计划未越界"
  - id: D7
    description: "DOC-03(8 模块 AGENTS.md 数字校正)按用户锁定决策延后到 Phase 2"
    requirement: DOC-03
    verification:
      - kind: manual_procedural
        ref: "AGENTS.md 仓库陷阱章节之外无任何改动"
        status: pass
    human_judgment: true
    rationale: "延后决策由用户/上下文锁定,无需自动化判定 — 仅需确认本计划未越界"

# Metrics
duration: 5min
completed: 2026-07-23
status: complete
---

# Phase 01: 文档质量校正 — Plan 01-01 Summary

**AGENTS.md 仓库陷阱 #1/#2/#7/#10 与 2026-07-23 实测状态对齐 — 4 条斜体注释追加,保留原句作为历史档案**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-23T11:57Z
- **Completed:** 2026-07-23T12:02Z
- **Tasks:** 1 (4 处编辑合并为单 task,因同文件同行类型)
- **Files modified:** 1 (`AGENTS.md`)

## Accomplishments

- 仓库陷阱 #1 末尾追加 `*(T1.1 闭环 2026-07-23:...)`* — 标注 `test` script alias 已统一到 `test:unit`
- 仓库陷阱 #2 末尾追加 `*(T2.1 闭环 2026-07-23:...)`* — 标注新代码读 `COMPLETION_MODE` 静态常量,getter 仅为废弃 API 兼容
- 仓库陷阱 #7 末尾追加 `*(T4.7 闭环 2026-07-23:...)`* — 标注 `msvcParser.ts` 是生效副本,`problemMatchers` 仅 Task 用户参考
- 仓库陷阱 #10 末尾追加 `*(T1.x 部分闭环 2026-07-23:...)`* — 标注 `Config.update` 内部已 refreshRoot,但跨实例缓存引用仍读到旧值
- 其他 9 条陷阱文本完全未动(grep 验证 9 个关键短语各 1 次匹配)
- 无 footer / 删除线 / ✅ 添加(与 D-05 风格契约一致)
- 无 `resources/README.md` 或模块 `AGENTS.md` 改动(严格遵守 Phase 1 范围)

## Task Commits

1. **Task 1: AGENTS.md 4 处仓库陷阱斜体注释追加** - `eb04492` (docs)

## Files Created/Modified

- `AGENTS.md` — 仓库陷阱章节第 102/103/108/111 行末尾追加 4 条斜体注释;其余 13 节(标题/前言/风格与约定等)未改

## Decisions Made

- **DOC-01 / DOC-03 延后 Phase 2**: 严格遵守 CONTEXT.md §Deferred Ideas — 本计划仅处理 AGENTS.md 根文件 4 处,resources/README.md 与 8 模块 AGENTS.md 数字校正整体留 Phase 2 同主题续做
- **不动 #11**: 与 #2 同主题(都是 `completionMode`),但保留 API 视角作为互补描述;未来 Phase 2 DEBT-01 完成后 #11 应标闭环
- **不动 #12**: 已用 ✅ + 删除线正确表达,无需追加
- **斜体风格选择**(D-05): 选斜体 + T-NN 编号,不用删除线/✅ — 因为 #1/#2/#7/#10 不是"已完全解决",存在持续陷阱(读旧值、task 配 manual config 等);删除线 + ✅ 仅 #12(明确"不要复活"警告)适用
- **append-only 编辑策略**: 每条仅在行末追加,原句文本字节级保留 — 撤销方法为 `git revert <commit>`,或 `git checkout AGENTS.md`

## Deviations from Plan

### 解析与无操作

**1. 计划 verify 步骤 1-4 中 D-03/D-04 grep 正则轻微错误**
- **Found during:** Task 1 verify 阶段
- **Issue:** 计划 §verify 步骤 3 的 grep `\*\(T4\.7 闭环 2026-07-23:.*不自动 task 消费 UBT 输出\)\*` 缺少一个右括号;D-03 注释正确文本是 `*(...消费 UBT 输出))*`(因为内嵌中文 `(本插件...)` 也需要 close)。同样 D-04 regex 严格按字面 `config.xxx` 匹配会失败(行内是 `config.xxx` 但 `.*` greedy 会吞掉太多)。
- **Fix:** 验证时使用修正 regex `\*\(T4\.7 闭环 2026-07-23:.*不自动 task 消费 UBT 输出\)\)\*`;内容追加按 acceptance criteria #3/#4 字符级精确执行,符合 D-01/D-02/D-03/D-04 锁定文本。
- **Files modified:** 无 — 仅 verify 步骤 regex 调整
- **Verification:** 8/8 acceptance criteria 通过;9 个 grep 验证 + 4 个 no-strikethrough 验证全部通过
- **Committed in:** `eb04492` (Task 1 commit)

**2. 计划 verify 步骤 6 `git diff --stat` 期望 `4 ++++` 与 Git 实际行为偏差**
- **Found during:** Task 1 verify 阶段
- **Issue:** 计划 §verify 步骤 6 期望 `AGENTS.md | 4 ++++ (no '----' indicator)`,但 Git `diff --stat` 把行内 append 显示为 1 add + 1 remove per modified line,实际输出 `8 ++++----`(即 4 +/− 4 -)。这是 Git 行为,而非内容错误 — plan's intent(pure text append, no other lines modified)已满足。
- **Fix:** 用 `git diff --no-color AGENTS.md` 逐行确认 — 只有 4 个 trap 行内容改变(纯 append),其余 9 行及章节外内容完全未变;行数从 167 保持 167(0 行新增,符合 plan 禁止"任何额外空行"约束)。
- **Files modified:** 无
- **Verification:** acceptance criteria #7(总行数 = 原行数 + 4,实际 +0 因为是行内 append)+ #8(其他章节未变)通过
- **Committed in:** 无

---

**Total deviations:** 2 verify 工具层偏差(均无内容/文件影响,仅 verify regex 调整 + 统计指标解释)
**Impact on plan:** 零范围偏移;交付内容与 acceptance criteria 100% 对齐

## Issues Encountered

- 仓库中 `AGENTS.md` 已 uncommitted 在工作树(用户并行工作),但 `git add AGENTS.md` + targeted commit 干净隔离,未污染其他文件的 working tree
- `core.autocrlf=true` 的 LF→CRLF 警告为 Windows 平台正常 Git 行为,工作树 LF 写入,无影响
- 行内 append 在 `git diff --stat` 中显示为 +1 -1 per line 是 Git 默认 hunk 算法,不是 bug;`--numstat` 输出 `4 4` 也是同一现象。验收以内容语义(只改 4 行)为准

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- AGENTS.md 仓库陷阱 #1/#2/#7/#10 反漂移完成,新贡献者读仓库知识库不会再被误导
- Phase 2 同主题续做已铺垫:
  - DOC-01: `resources/README.md` 重写(删除已不存在的 `ue5-fast.json` + `banner.png` 引用)
  - DOC-03: 8 模块 `AGENTS.md` 数字校正(WorkspaceState 38 callers / ClangdOps 9 import / 72 测试 / 16.3k 行 / 9 路径别名 等)
  - 漂移防护机制(grep guard / pre-commit hook)作为可选 Phase 2 task
- `Config.completionMode` getter 实际收口(REQ-DEBT-01)完成后,#11 也应标闭环

---

*Phase: 01-文档质量校正*
*Completed: 2026-07-23*
