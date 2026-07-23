# Architecture Decision Records (ADR)

本目录记录 VSCodeUEHelper 的**架构决策**——选了什么、为什么选、什么方案被证伪。

每个 ADR 一个文件,命名格式 `NNNN-<short-slug>.md`,NNNN 从 0001 递增,文件永不删除(过时决策用 `Deprecated` 标记)。

## 已采纳的 ADR

| ID | 标题 | 状态 | 阶段 |
|---|---|---|---|
| 0001 | Phase 8 SSoT:WorkspaceState 单一真相源 | Accepted | Phase 8 + 9 收尾 |
| 0002 | Phase 9 ClangdOps:.clangd 唯一写入 API | Accepted | Phase 9 收尾 |
| 0003 | Live Coding 5s 节流:放弃完美单文件 UHT | Accepted | H1 扩展 |

## ADR 模板

每个新 ADR 应包含:

- **状态**: Proposed / Accepted / Deprecated / Superseded by NNNN
- **背景**: 决策前的问题 / 现状
- **决策**: 选了什么方案
- **被证伪的方案**: 评估过但未选,及理由
- **后果**: 接受此决策后的影响(正面 + 负面)
- **参考**: 相关 commit / 文档链接

## 为什么不全追溯 11 项决策

`.planning/PROJECT.md` §Key Decisions 列 11 项决策,其中:

- **3 项关键决策** (Phase 8 SSoT / Phase 9 ClangdOps / Live Coding 5s): 涉及架构层 + 多个 callers,影响范围大 → 写 ADR 追溯
- **5 项实施细节** (populateAddCompletions 删 / fast-slow 合并 / vscode.workspace.* bypass 锁 / MCP 仅 Cursor 启动 / i18n 双语): 已有 commit message + 代码注释,不必单写 ADR
- **3 项性能权衡** (Rider 对标 + 内存预算 + LLVM 头预解析): 在 CONCERNS.md + Phase 3-6 design doc 中说明

后续 phase 增删重要决策时,补 ADR(NNNN 递增)。
