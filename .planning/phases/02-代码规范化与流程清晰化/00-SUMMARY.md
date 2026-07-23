# Pre-Plan 0: ueLinkManager 收尾 (Phase 2 启动前置)

**Status:** COMPLETE
**Date:** 2026-07-23
**Scope:** Plan 外工作,Phase 2 启动前置 gate (用户选择 "先收尾 ueLinkManager 再开 Phase 2")
**Files modified:** `src/clangd/ueLinkManager.ts`, `src/clangd/index.ts`, `test/unit/clangd/ueLinkManager.test.ts`

## 为什么需要这一步

`/gsd-execute-phase 02` 启动前,工作区有 2 个 untracked 文件 (`ueLinkManager.ts` + `ueLinkManager.test.ts`),全部 Phase 2 plan 验收都需要 `npm run lint` 0 错 + `npm run test:unit` 全绿。这 2 个文件产生:

- 25 个 lint 错误 (esbuild 输出: 全部 25)
- 7 个 test 失败 (`ueLinkManager.test.ts`)
- 1 个预存 test 失败 (`ueMacroCompletionProvider.test.ts`, 7月23日 H4-B 决定后回归)

baseline 状态:**lint 25 errors, test 8 failed (819 total)**。

用户决策: "先收尾 ueLinkManager 再开 Phase 2" (不修 = 验收硬卡死)。

## Root Cause 分析 (2 个生产 bug)

### Bug A: Windows 路径分隔符 (阻塞 7/11 测试)

`ueLinkManager.ts` 的 `onDidSave` + `onDidSaveForTestAsync` 用 `^Source\/` 正则匹配相对路径。Windows 上 `path.relative('C:\\proj', 'C:\\proj\\Source\\MyProj\\MyActor.h')` 返回 `'Source\\MyProj\\MyActor.h'`(反斜杠),正则 `^Source\/` 不匹配 → 函数早退 → `vscode.workspace.fs.stat` 永远不被调 → 所有断言失败。

**修复:** 在正则检查前 `rel.split(path.sep).join('/')` 标准化,两个路径分支都修。

### Bug B: activateClangd 早退导致 registerCompletionItemProvider 不可达

`src/clangd/index.ts:activateClangd` 在 line 173-182 有一对早退 (`if (workspace) return ...; return ...;`),line 194 的 `registerUeMacroCompletionProvider()` 是**死代码**(永远走不到)。H4-B 简化 completionMode 时引入,测试 `ueMacroCompletionProvider.test.ts:161` 期望调一次,实际 0 次。

**修复:** 把早退改成 `let ueLink: UeLinkManager | undefined; if (workspace) { ueLink = ... }`,然后末尾的 `return` 用 spread 把 `ueLink` 条件性带出(`...(ueLink ? { ueLink } : {})`)。`ClangdHandles` 接口的 `ueLink?: UeLinkManager` 已经允许可选,无需改接口。

## 修改清单

### `src/clangd/ueLinkManager.ts`

1. **路径标准化 (Bug A):** `onDidSaveForTestAsync` + `onDidSave` 都在正则前加 `const relNorm = rel.split(path.sep).join('/')`。
2. **setTimeout void 包裹 (lint):** 2 处 `setTimeout(() => this.runUht(file), ...)` 改为 `setTimeout(() => { void this.runUht(file); }, ...)` —— 避开 `@typescript-eslint/no-misused-promises`。
3. **dispose 防御:** `setTimeout` 1s 后回到 idle 的 callback 加 `if (!this.disposed)` 守门,避免 dispose 后还改状态。

### `src/clangd/index.ts`

1. **早退改成条件性 ueLink (Bug B):** `if (workspace) { ... return ... }` 改为 `let ueLink: UeLinkManager | undefined; if (workspace) { ueLink = ... }`,末尾 `return { completionMode, backup, proxyManager, ...(ueLink ? { ueLink } : {}) }`。这样 `registerUeMacroCompletionProvider` / `registerUeReflectionLinter` / `PerfStatusBar` / `IncrementalFileWatcher` 全部可达。

### `test/unit/clangd/ueLinkManager.test.ts`

1. **修复 test (j) (project/engine 未选):** `makeWorkspace({ selectedProject: null, selectedEngine: null })` 因 `??` 默认值兜底 → selectedProject 实际为非 null。改为直接构造 `nullWorkspace` 对象(符合测试意图:selectedProject/Engine 真的为空)。
2. **修复 test (e) (triggerReparse):** 期望 `path.normalize('C:/proj')` 但 Windows 上 `path.dirname('C:\\proj\\MyProj.uproject')` 返回 `C:\\proj`(反斜杠)。改为 `path.dirname(path.join(PROJECT_DIR, 'MyProj.uproject'))` 跨平台一致。
3. **修复 test (d) (throttled):** `mgr.onDidSaveForTest(...)` 漏 `await` → `expect(state).toBe('throttled')` 在异步链 settle 之前跑。补 `await`。
4. **全部 onDidSaveForTest 调用补 await (lint no-floating-promises):** 13 处 `mgr.onDidSaveForTest(...)` 全部加 `await`(其中 2 处原本就有,新增 11 处 await)。
5. **vi.mocked 安全化 (lint unsafe-return + unbound-method):** 2 处 mock factory 显式 `: unknown` 返回类型;`mockStatReturning` / `mockReadFileReturning` / test (b) 提取到 `const statMock` / `const readFileMock` 再调用,加 4 处 `// eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock accessor`。
6. **移除诊断用 console.log:** test (b) 原本有 6 个 `[BEFORE]/[AFTER]` console.log(我诊断时加的),替换为正经 `expect(statMock).toHaveBeenCalled()` 断言。

## 验证结果

| Gate | 修前 | 修后 |
|---|---|---|
| `npm run lint` | 25 errors | **0 errors** |
| `npm run typecheck` | 0 errors | **0 errors** |
| `npm run test:unit` | 8 failed / 819 total | **0 failed / 819 total** |

具体到本 pre-plan 范围:
- `ueLinkManager.test.ts`: 11/11 pass (修前 4/11)
- `ueMacroCompletionProvider.test.ts`: 4/4 pass (修前 3/4)
- 其它 70 个 test 文件:无 regression

## 后续影响

- 打开 Phase 2 三个 plan 的验收 (lint 0 / typecheck 0 / test 全绿) 已具备。
- 改动全部在 `ueLinkManager` + `clangd/index.ts` + 对应测试,未碰 `AGENTS.md` / 根 `package.json` / 任何 Phase 2 计划范围文件。
- 8 个模块 AGENTS.md 数字校正仍是 backlog (per CONTEXT §Deferred Ideas),不在本 pre-plan 范围。
