# Plan 02-01: 代码风格 + 目录结构规范化

**Status:** COMPLETE
**Date:** 2026-07-23
**Wave:** 1
**Decisions:** D-05 (ESLint 补漏) / D-06 (命名扫查) / D-07 (中文 JSDoc) / D-08 (DDD 空壳验证) / D-09 (AGENTS.md vs 实际同步) / D-10 (死别名清理)

## 修改清单

### `.eslintrc.json` (D-05)
- `no-explicit-any`: `warn` → **`error`**。仓库现有 1 处 `any` 在 `src/clangd/perfLog.ts:95` (`vscode as any`),已带 `eslint-disable-next-line`,升级后无新错。
- 新增 `consistent-type-imports`: **`warn`** (而不是 error,见下)。配置 `prefer: "type-imports"`, `fixStyle: "inline-type-imports"`。

### D-05 Step C 降级决策 (commit message 必读)

启用 `consistent-type-imports: error` 触发 **126 个新错误**(92 个可自动修复,34 个需手改)。**≥ 5 即按 plan 规则降级**:本 plan 范围是 D-05 收口,不是 type-import 大规模改写,降回 `warn`,留 126 个 warning 暴露所有违规点。`npm run lint --fix` 一键可全清,延后到独立 PR 收口。

### D-06 命名扫查报告

- **文件名 (kebab-case vs camelCase):** 0 处违反. `buildRunner.ts` / `taskProvider.ts` / `liveCoding.ts` 是 camelCase (TS 命名习惯,可接受);`src/build/domain/**/*.entity.ts` / `.vo.ts` 是 DDD value-object 命名约定,合规。
- **export 命名:** 0 处违反. classes/types PascalCase, functions camelCase, 全合规。
- **UPPER_SNAKE 常量:** `src/clangd/compileCommands*.ts` 多处(`MAX_CACHE_BYTES` / `TASK_TYPE` / `FILE_NAME_COMPILE_COMMANDS` 等),全部 TS/JS 约定,合规。

**D-06: 0 代码改动, 仅记录扫查结果。**

### D-07 中文 JSDoc 扫查报告

- **147 个 export 函数/类/接口/类型/常量 缺 5 行内中文注释**。`src/build/domain/` (DDD 实体)、`src/clangd/proxy/` (std io)、`src/ui/` 等模块最严重。
- **≥ 10 处** 触发 plan 规则: **0 代码改动**,扫查结果记录在 SUMMARY,补 JSDoc 推迟到 Plan 02-02 task 1 统一做(那里会做完整 index 重导出扫查,可顺手补)。

### D-08 DDD 空壳验证

- `src/build/application/` + `src/build/infrastructure/`: **不存在** (已删)。
- `src/build/AGENTS.md` 行 171-193 DDD 章节文字: **准确** (per `.planning/codebase/CONCERNS.md` T3.3 选项 A, 7月23日已落地),**不动**。

### D-09 AGENTS.md vs 实际布局同步

补全 5 个模块 AGENTS.md 缺失条目 (按"AGENTS.md 只列核心文件,不全列"原则 + 已有"支持文件"section 风格):

| 模块 | 新增条目 |
|---|---|
| `src/core/AGENTS.md` | `runtime-detect.ts` (AI 宿主检测, Phase 11 T4.3 抽离) |
| `src/commands/AGENTS.md` | `refreshProjectExplorer` + `openProjectExplorerFile` 2 个命令;新增"支持文件"段含 `_resolve.ts` + `firstRunInit.ts` |
| `src/clangd/AGENTS.md` | `types.ts` / `modifyRspFiles.ts` / `createRspMatchers.ts` / `proxyLogChannel.ts` / `proxyLogTailer.ts` |
| `src/clangd/proxy/AGENTS.md` | `cliRuntime.ts` |
| `src/ui/AGENTS.md` | `controlPanel.html.ts` / `controlPanelMessages.ts` / `perfStatusBar.ts` / `projectExplorer.ts` / `projectExplorerFs.ts` |

**AGENTS.md "核心文件"段格式不变** —— 表格就是表格, 不强改列表。

### D-10 死别名清理

- `grep -rE "from ['\"]@(platform|rules)(/|')" src test` → **0 匹配**。
- `grep -E "@(platform|rules)" esbuild.config.mjs vitest.config.ts tsconfig.json` → **0 匹配** (三处都已清)。
- `@platform` / `@rules` 已是死别名,0 改动。

## 验证

| Gate | 结果 |
|---|---|
| `npm run lint` | 0 errors, 126 warnings (consistent-type-imports) |
| `npm run typecheck` | 0 errors |
| `npm run test:unit` | **819/819 passed** (72 test files) |
| 0 个 `package.json` 变更 | ✓ |
| 0 个新 runtime 依赖 | ✓ |
| 0 个 `tsconfig.json` 变更 | ✓ (D-10 三处都已清) |

## 风险 + 偏差

- **D-05 consistent-type-imports 降级到 warn**:如上,126 错误是 sweep 后的真实存量,降级是 plan 约定的渐进式收紧路径。`npm run lint --fix` 一键全清 92 个,剩 34 个需手改 (import 既有 value 又当 type 的情形)。
- **D-07 中文 JSDoc 扫查 147 处** 全量补工作量超出本 plan sweep 范围(2-3 小时起步),按 plan 推迟到 02-02。AGENTS.md "代码注释强制中文" 硬约束没破,只是 147 处存量为历史欠账。
- **D-09 AGENTS.md 改动**: 13 项仓库陷阱(根 AGENTS.md)未动,只动 5 个模块 AGENTS.md,符合 plan prohibitions。

## 后续衔接

- Plan 02-02 (TS strict + API surface) 与本 plan 独立,不同文件,可直接执行。重点:Result<T,E> + 错误码体系 + 任意一个 any 收口 + 中文 JSDoc 批量补。
- Plan 02-03 (文档 + ADR) 与本 plan 独立,可直接执行。
