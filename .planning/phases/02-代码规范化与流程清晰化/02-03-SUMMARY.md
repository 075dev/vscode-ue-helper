# Plan 02-03: 文档流程 + ADR + 调试/发布规范化

**Status:** COMPLETE
**Date:** 2026-07-23
**Wave:** 1 (no deps)
**Decisions:** D-16 (CONTRIBUTING.md) / D-17 (PR 模板) / D-18 (commit msg 规范) / D-19 (DEBUG.md) / D-20 (RELEASE.md) / D-21 (.vscodeignore 检查) / D-22 (ADR 目录 + 3 份) / D-23 (Phase 3-6 design doc)

## 修改清单

### 新文件 (12 个)

| 文件 | 行数 | 内容 |
|---|---|---|
| `CONTRIBUTING.md` | 200 | 10 章节 onboarding:环境 / 依赖 / 命令 / 风格 / commit / PR / review / 自检 / 调试发布 / ADR |
| `.github/PULL_REQUEST_TEMPLATE.md` | 39 | Phase 勾选 / 影响模块 / 测试步骤 / Screenshots / Breaking Changes / Checklist 6 字段 |
| `docs/DEBUG.md` | 110 | EDH 启动 / 日志位置 / proxy attach / 6 类常见问题 / 性能内存 / Bug 报告 |
| `docs/RELEASE.md` | 125 | 7 段:checklist / CHANGELOG / version bump / vsce / Marketplace / rollback / 验证 / 跟进 |
| `docs/adr/README.md` | 39 | ADR 目录说明 + 模板 + 3 项已采纳 ADR 索引 + 11 项决策追溯策略 |
| `docs/adr/0001-phase-8-ssot.md` | 70 | Phase 8 SSoT 决策:背景 / 决策 / 3 个被证伪方案 / 后果 / 参考 |
| `docs/adr/0002-phase-9-clangdops.md` | 60 | Phase 9 ClangdOps 决策:背景 / 决策 / 3 个被证伪方案 / 后果 / 参考 |
| `docs/adr/0003-live-coding-throttle.md` | 60 | Live Coding 5s 节流决策:背景(实测数据) / 决策 / 4 个被证伪方案 / 后果 / 参考 |
| `docs/design/phase3-compile-commands.md` | 65 | Phase 3 拆 1002 行 compileCommands.ts:为什么 / 拆什么(5 文件) / tradeoffs / 验收 / 风险 |
| `docs/design/phase4-god-files.md` | 65 | Phase 4 拆 4 个中型 god 文件(workspace / config / controlPanel / bridge) |
| `docs/design/phase5-live-coding-ai.md` | 60 | Phase 5 Live Coding + AI 集成(规则引擎,零 LLM 依赖) |
| `docs/design/phase6-i18n-decision.md` | 70 | Phase 6 汉化 TODO 决断(选 A:下架承诺,4-6h,优于选 B 8-12h) |

### 修改文件 (2 个)

| 文件 | 改动 |
|---|---|
| `AGENTS.md` | 追加 1 段:"## Commit message 规范"(Conventional Commits, 中文 summary 优先, ~16 行) |
| `.vscodeignore` | 新增 2 行:`.cursor/` + `.github/**` 排除(防 PR 模板 / AI 规则误进 .vsix) |

## D-16 CONTRIBUTING.md 决策

按 plan 模板,内容覆盖 10 章节:环境准备(Win 强制 + Node 18+ + UE 5.2+) / 依赖安装(4 个 runtime deps + DEBT-02 已卸 3 个) / 常用命令(8 个 npm script 含 build/watch/typecheck/lint/format/test/package) / 风格硬约束 / commit 规范(7 个 type) / PR 流程(5 步) / review checklist(9 项) / 提交前自检 / 调试发布入口 / ADR 背景索引。零依赖新增。

## D-17 PR 模板

6 字段:Phase 勾选(6 个 Phase + Other) / 影响模块(9 项) / 测试步骤 / Screenshots / Breaking Changes / Checklist(7 项)。模板聚焦"新增功能 → 测试 → 文档同步 → 中文注释"全链路,引导 reviewer 按 CONTRIBUTING.md §7 走。

## D-18 commit msg 规范

在 `AGENTS.md` §风格与约定 段末尾追加 "## Commit message 规范" 段:

- 格式: `<type>(<scope>): <中文 summary>`
- 7 个 type: feat / fix / chore / docs / refactor / test / perf
- Scope 可选: build / clangd / commands / core / detection / mcp / ui / i18n
- 4 个示例(含仓库已有 `chore(assets): ...` 先例)
- 引用 `CONTRIBUTING.md` §5 详细说明

13 条仓库陷阱完整保留(grep 13 个编号各 ≥ 1 匹配,trap #12 是 `~~strike~~` 形式)。

## D-19 DEBUG.md

5 段:EDH 启动 / 4 类日志位置表 / proxy attach 4 步 / 6 类常见问题(含 4.4 显式引用 ueLinkManager H1 状态栏按钮 + 4.5 `.code-workspace` 检测) / 性能内存 / Bug 报告 6 项信息。

## D-20 RELEASE.md

8 段:checklist(10 项) / CHANGELOG 手动模板(Keep a Changelog 格式,含 Phase 2 已落地项示例) / version bump(semver 规则 + 仓库当前 0.1.0 → 0.2.0 建议) / vsce package / Marketplace / 4 步回滚 / 验证 / 跟进。**不创建 CHANGELOG.md**(per D-20),RELEASE.md §2 给出模板,首次发布前手动创建空文件。

## D-21 .vscodeignore 检查

- 现状 42 行,已覆盖源码 / 配置 / 文档 / AI 辅助文件 30+ 项
- 遗漏:**`.github/**` + **`.cursor/`** 2 项
- 补 2 行:`.cursor/` + `.github/**`(含注释,标注 Phase 2 Plan 02-03 D-21 决策依据)
- 行数变化: 42 → 44(≤ 3 行预算,符合 plan acceptance_criteria #5)

## D-22 ADR 目录 + 3 份关键追溯

3 份关键决策(per CONTEXT §Claude's Discretion):

- **0001 Phase 8 SSoT**:WorkspaceState 单一真相源,13 import / 36 callers
- **0002 Phase 9 ClangdOps**:.clangd 唯一写入 API,删 writeClangdConfig / findClangdConfig
- **0003 Live Coding 5s 节流**:放弃完美单文件 UHT,实测 3-4s 物理下界

每份含 5 字段:背景 / 决策 / 被证伪方案(3-4 个) / 后果(正负) / 参考。后续 phase 增删重要决策时,补 ADR NNNN 递增。

**不追溯** 8 项(11 - 3):实施细节 + 性能权衡,已在 commit message + 代码注释 + CONCERNS.md 中说明。

## D-23 Phase 3-6 design doc

4 份,每份 1-2 段(per CONTEXT §Claude's Discretion 详略):为什么拆 / 拆什么 / tradeoffs / 决策依据 / 验收 / 风险。

- **phase3-compile-commands.md**: 拆 1002 行 `compileCommands.ts` 为 5 文件
- **phase4-god-files.md**: 拆 4 个中型 god 文件(workspace / config / controlPanel / bridge) 为 12 文件
- **phase5-live-coding-ai.md**: 规则引擎(零 LLM 依赖) + MCP 2 个新工具
- **phase6-i18n-decision.md**: 选 A 下架汉化(4-6h),优于选 B 填充(8-12h)—— 决策依据详述

## 验证

| Gate | 结果 |
|---|---|
| `npm run lint` | **0 errors**, 126 warnings (consistent-type-imports 存量,Plan 02-01 显式推迟) |
| `npm run typecheck` | **0 errors** |
| `npm run test:unit` | **843/843 passed** (74 test files) — 测试 0 改动 |
| 0 个 `package.json` 变更 | ✓ |
| 0 个新 runtime 依赖 | ✓ |
| AGENTS.md 13 条仓库陷阱完整保留 | ✓ (grep 13 编号各 ≥ 1) |
| 0 个 `.github/workflows/` 创建 | ✓ (per D-03) |
| 0 个 `CHANGELOG.md` 创建 | ✓ (per D-20,RELEASE.md §2 模板) |

## 风险 + 偏差

- **Phase 6 design 推荐选项 A(下架汉化)**:是设计 doc 的"建议"而非"决策",真要执行时需用户拍板。本 plan 0 代码改动,只是把决策选项与依据写清楚。
- **`.vscodeignore` `.cursor/` 是预防性添加**:仓库当前无 `.cursor/`,但 per PROJECT.md §MCP-03 未来会写 Cursor AI 规则,提前排除避免 .vsix 污染。
- **CONTRIBUTING.md §3 提到 `npm run test:integration`**:已标"已坏,只跑 unit",与 AGENTS.md 仓库陷阱 #1 一致,无矛盾。

## 后续衔接

- 新人 onboarding: `CONTRIBUTING.md` → `AGENTS.md` → 模块 AGENTS.md → `DEBUG.md`(开发期) / `RELEASE.md`(发布期)
- 架构演进: `docs/adr/NNNN-*.md` 是"为什么这样选"的索引,新决策时补 ADR
- Phase 3-6 启动时: 开发先读 `docs/design/phaseN-*.md` 4 字段(为什么 / 拆什么 / tradeoffs / 决策依据),再开 plan
- 汉化决断(Phase 6) 在 Phase 6 启动前可由用户调整(本 plan 写"建议 A",不锁死)
