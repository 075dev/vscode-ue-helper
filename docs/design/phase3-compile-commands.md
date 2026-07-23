# Phase 3 Design: compileCommands 重构

**Phase 编号**: 3
**REQ-IDs**: PERF-01
**估算**: 6-8h

## 为什么拆

`src/clangd/compileCommands.ts` 当前 1002 行,是仓库最大单文件(超过 Phase 2 列出的"中型 god 文件"标准 500+ 行)。问题:

- **职责混杂**: 同一文件包含 UBT 调用 / 符号链接 / cache 持久化 / fallback 生成 / 错误重试 5 类独立关注点
- **测试粒度差**: 1024 字符的 `parseLine` 函数与 200 行的 `generateCompileCommands` 流程并存,单测要么过大(集成)要么过小(细节)
- **新人 onboarding 难**: 改 1 个细节(例:cache TTL 改 1h → 6h)需要先读完 1000 行才能下手

## 拆什么

按职责拆为 5 个文件(预计):

| 新文件 | 行数估算 | 职责 |
|---|---|---|
| `ubtRunner.ts` | ~150 | 跑 UBT `-ProjectFiles` 子进程,流式输出,超时与重试 |
| `compileCommandsParser.ts` | ~100 | 解析 UBT 输出 + `.code-workspace` 关联 |
| `compileCommandsCache.ts` | ~120 | cache 持久化(读 / 写 / TTL 失效 / mtime 比对) |
| `compileCommandsFallback.ts` | ~200 | UBT 失败时的 fallback DB 生成(已有部分代码,提升为独立模块) |
| `compileCommands.ts` (保留) | ~250 | 编排:UBT → 解析 → cache → fallback → 写盘,作为外部 API |

`index.ts` 重新导出保持 `from '@clangd'` API 兼容。

## Tradeoffs

- **+ 5 个文件替代 1 个**: 每个文件单一职责,测试可单文件级,新人 onboarding 看 1 个 250 行文件就能上手
- **+ 25 个原函数 + 5 个新文件 + 新增 ~30 个导出**: 模块边界清晰
- **− 跨文件调用链更长**: `generateCompileCommands` 编排从 1 个函数变 5 个文件 → 跳读要 `go to definition` 多次
- **− 公共 API 表面变了**: 现有 22 个 callers 用 `import { generateCompileCommands } from '@clangd/compileCommands'`,新结构需要 22 处 import 同步更新(或保留 `compileCommands.ts` re-export)

## 决策依据

- **为什么现在拆**: Phase 2 完成(AGENTS.md / ESLint / Result/errors 基础设施就位)后,引入新 god 文件拆分是低风险时机
- **为什么不拆得更细**: 5 个文件是合理粒度;再细(如把 `cache.mtime` 单独成文件)会变 over-engineering
- **为什么保留 `compileCommands.ts` 编排层**: 外部 API 兼容性,避免 22 callers 改 import

## 验收 (迁移完成后)

- `src/clangd/compileCommands.ts` ≤ 300 行
- 5 个新文件每个 ≤ 250 行
- `npm run test:unit` 全绿(原 22 个测试 + 新增单测 ≥ 5 个)
- 22 callers 0 改动(用 re-export 兼容)
- 性能不退步(`npm run perf:before/after` P99 ±5%)

## 风险

- **R1 (Medium)**: 跨文件 mock 复杂度增 —— Mitigation: 5 个新文件用 `vi.mock` 独立测试,集成测试保留在 `compileCommands.ts` 编排层
- **R2 (Low)**: re-export 增加包大小 —— Mitigation: esbuild tree-shake,死代码 0 字节
- **R3 (Low)**: 22 callers 误删 `compileCommands.ts` —— Mitigation: `index.ts` re-export 守住,删文件直接失败
