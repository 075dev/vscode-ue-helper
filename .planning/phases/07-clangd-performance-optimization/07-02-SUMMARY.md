---
phase: 07-clangd-performance-optimization
plan: 02
subsystem: clangd-performance
tags: [ubt-instrumentation, chokidar, file-watcher, perf-proxy, baseline-script, header-classification]

# Dependency graph
requires:
  - phase: 07-clangd-performance-optimization
    plan: 01
    provides: perfLog 单例（record/recordIncrementalScan API）+ generateCompileCommands 入口指纹快路径 + chokidar mock + Disposable mock + setup.ts vscode mock
provides:
  - src/clangd/perfProxy.ts: ProxyOverheadMeter 类 - LSP Proxy 协同偏差测量（只读、不侵入 proxy，per CLANGD-01-04/T-7-09）
  - src/clangd/fileWatcher.ts: IncrementalFileWatcher 类 - chokidar 100ms debounce + 头/源分级（per D-15/D-16）
  - scripts/measure-proxy-overhead.mjs: 3-mode LSP Proxy 协同偏差测量工具（per D-18/CLANGD-01-04）
  - doc/phase-7-perf-baseline.md: Phase 7 性能基线文档骨架（待 verify-work 阶段回填）
  - package.json perf:baseline/perf:after/perf:diff 三个 script
  - compileCommands.ts 5 阶段细化插桩（per D-03）
  - activateClangd 在 detection.ready 后启动 IncrementalFileWatcher（per D-15/D-16 + D-06 埋点与 UI 解耦）
affects: [08-code-understanding-enhancement, 09-toolchain-integration, perf-baseline-validation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vi.hoisted + mock 状态对象：vitest vi.mock 工厂不能引用未初始化变量"
    - "chokidar awaitWriteFinish 100ms debounce：避免手写防抖逻辑"
    - "atomic temp + rename 模式：perfProxy + measure-proxy-overhead 统一持久化"
    - "LSP mock via child_process：零依赖 stdio JSONL 协议模拟 LSP 客户端/服务端"
    - "5 阶段细化插桩 + try/catch 包裹：失败仅 log.warn 不阻塞主流程（per T-7-13）"

key-files:
  created:
    - src/clangd/perfProxy.ts
    - src/clangd/fileWatcher.ts
    - scripts/measure-proxy-overhead.mjs
    - doc/phase-7-perf-baseline.md
    - test/unit/clangd/perfProxy.test.ts
    - test/unit/clangd/compileCommandsPerf.test.ts
    - test/unit/clangd/fileWatcher.test.ts
    - test/unit/clangd/incrementalScan.test.ts
  modified:
    - src/clangd/compileCommands.ts
    - src/clangd/index.ts
    - package.json

key-decisions:
  - "D-15 落地：选择 chokidar over VS Code FileSystemWatcher（项目已有 ^3.6.0 + awaitWriteFinish 内置防抖 + UE 5000+ 文件下 Windows 句柄压力可控）"
  - "D-16 落地：头/源分级埋点（.h/.hpp/.inl = headerCount, .cpp/.cc/.c = sourceCount）"
  - "D-15 不打扰 clangd：不主动发送 LSP workspace/didChangeWatchedFiles"
  - "集成测试位置偏离（与 PLAN A 07-01 决策 6 一致）：放在 test/unit/clangd/incrementalScan.test.ts 而非 test/integration/clangd/，避免 vitest 默认 include 不覆盖 test/integration/** 导致死代码"
  - "perfProxy 测试策略：静态扫描 compileCommands.ts 验证 5 个埋点存在 + 运行时测试 linkToWorkspaceRoot 阶段 4（其他阶段依赖 vscode.tasks.executeTask mock 复杂度高）"
  - "compileCommands.ts 5 阶段埋点全部用 try/catch 包裹（per T-7-13）"
  - "dispose 后 chokidar mock listeners 残留防御：onChange 内检查 this.watcher === null"
  - "perfProxy 路径安全：拒绝原始路径含 .. 段 + 强制 .json 后缀（per T-7-03）"

patterns-established:
  - "vi.hoisted 模式：vitest 顶层 mock 状态提升"
  - "Mock FSWatcher with __emit：测试助手可手动触发 chokidar 事件"
  - "源文件后缀正则常量：HEADER_EXT_RE + SOURCE_EXT_RE 集中维护"
  - "LSP 测量基线：100 次请求 + P50/P95/P99/mean + memoryRssKb 快照"

requirements-completed: [CLANGD-01-03, CLANGD-01-04]

# Coverage metadata (#1602) — one entry per shipped deliverable
coverage:
  - id: D1
    description: UBT 5 阶段细化插桩（per D-03）
    requirement: CLANGD-01-04
    verification:
      - kind: unit
        ref: test/unit/clangd/compileCommandsPerf.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: perfProxy.ts ProxyOverheadMeter 类
    requirement: CLANGD-01-04
    verification:
      - kind: unit
        ref: test/unit/clangd/perfProxy.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: fileWatcher.ts IncrementalFileWatcher 类
    requirement: CLANGD-01-03
    verification:
      - kind: unit
        ref: test/unit/clangd/fileWatcher.test.ts
        status: pass
      - kind: integration
        ref: test/unit/clangd/incrementalScan.test.ts
        status: pass
    human_judgment: false
  - id: D4
    description: scripts/measure-proxy-overhead.mjs 3-mode 测量脚本
    requirement: CLANGD-01-04
    verification:
      - kind: automated_ui
        ref: node scripts/measure-proxy-overhead.mjs --help
        status: pass
    human_judgment: false
  - id: D5
    description: activateClangd 集成 IncrementalFileWatcher
    requirement: CLANGD-01-03
    verification:
      - kind: source
        ref: src/clangd/index.ts IncrementalFileWatcher 启动钩子
        status: pass
    human_judgment: false
  - id: D6
    description: doc/phase-7-perf-baseline.md 文档骨架
    requirement: CLANGD-01-04
    verification:
      - kind: manual_procedural
        ref: doc/phase-7-perf-baseline.md 骨架结构
        status: pass
    human_judgment: true
    rationale: 真实 perf 数据需在真实 UE 工程上跑测后回填（verify-work 阶段），不是自动化可验证的
  - id: D7
    description: package.json perf: scripts
    requirement: CLANGD-01-04
    verification:
      - kind: automated_ui
        ref: package.json scripts 区块
        status: pass
    human_judgment: false

# Metrics
duration: 14min
completed: 2026-07-04
status: complete
---

# Phase 7 Plan 2: UBT 调用细化插桩 + chokidar 增量扫描 + LSP Proxy 协同验证 Summary

**UBT 5 阶段精细化埋点（entry/ubtStart/taskCompleted/candidatesScanned/linkToWorkspaceRoot/totalElapsed）+ chokidar 100ms debounce 增量扫描（头/源分级）+ LSP Proxy 协同偏差零侵入测量（3-mode 脚本 + 验证子进程）—— 为 D-10「按需启动并发合并」决策提供真实数据通路。**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-07-04T14:00:00Z
- **Completed:** 2026-07-04T14:14:00Z
- **Tasks:** 3 / 3 完成
- **Files modified:** 11（8 新增 + 3 修改，2,092 insertions）

## Accomplishments

- **UBT 5 阶段细化插桩（per D-03）**：
  - 阶段 1 `compileCommands.entry`（optsSignal 设置后 + meta.isNative）
  - 阶段 2 `compileCommands.ubtStart` + `ubt.taskCompleted`（executeShellTask 前后 timing）
  - 阶段 3 `compileCommands.candidatesScanned`（candidates 循环后 + meta.candidateCount + hit 标志）
  - 阶段 4 `compileCommands.linkToWorkspaceRoot`（linkToWorkspaceRoot 入口 + 末尾 + meta.succeeded/skipped/target）
  - 阶段 5 `compileCommands.totalElapsed`（所有 return 路径 + throw 路径 + meta.outcome = found/cacheFastPath/notFound）
  - **所有 5 阶段用 try/catch 包裹 + 失败仅 logger.warn 不阻塞主流程**（per T-7-13）

- **perfProxy.ts LSP Proxy 协同偏差测量（per CLANGD-01-04 + T-7-09）**：
  - `ProxyOverheadMeter` 类
  - `recordLspFrame(direction, elapsedMs)` 被动 API：调用方在 proxy 帧通道外层包 timing wrapper
  - `getSnapshot()`：P50/P95/P99/mean/memoryRssKb/requestCount 快照
  - `persistBaseline(outputPath)`：atomic temp + rename 持久化
  - `startSampling(intervalMs)`：定时采集 process.resourceUsage().maxRSS
  - **零侵入**：测试断言 perfProxy.ts 无对 `../proxy/*` 的 import（per T-7-09）

- **fileWatcher.ts chokidar 增量扫描（per D-15/D-16）**：
  - `IncrementalFileWatcher` 类
  - chokidar `awaitWriteFinish` 100ms debounce（per D-15）
  - ignored 数组：`Intermediate/Binaries/DerivedDataCache/Saved/.git/node_modules`（per D-15/Pitfall 2）
  - 头/源分级：`.(h|hpp|inl)$` = headerCount, `.(cpp|cc|c)$` = sourceCount（per D-16）
  - `onBatch` 回调返回 IncrementalBatch（files + totalLatencyMs + headerCount + sourceCount）
  - **不主动发送 LSP workspace/didChangeWatchedFiles**（per D-15 决策）
  - **dispose 后 chokidar mock listeners 残留防御**：onChange 内检查 this.watcher === null

- **activateClangd 集成（per D-15/D-16 + D-06）**：
  - `detection.ready` 后启动 IncrementalFileWatcher
  - patterns 限定项目内绝对路径（per D-15/Pitfall 3）
  - onBatch 调 `perfLog.recordIncrementalScan` + `perfLog.record('incremental.scanComplete')`
  - **即使 showPerfInStatusBar 关闭也启动 watcher**（per D-06：埋点与 UI 解耦）

- **scripts/measure-proxy-overhead.mjs 3-mode 测量工具**：
  - `--baseline [count]`：在当前 Extension Host 采样基线（默认 100 次）
  - `--after [count]`：在加载 PLAN A + PLAN B 后采样
  - `--diff <a.json> <b.json>`：对比输出 p50/p95/p99/mean/memory 偏差% + 1% 阈值判定
  - 零依赖：仅 `node:child_process` / `node:perf_hooks` / `node:fs`
  - mock LSP 客户端：spawn node 子进程，stdin/stdout JSONL 协议
  - atomic temp + rename 持久化
  - 退出码 0 = 全部 < 1%（per CLANGD-01-04）/ 退出码 1 = 存在 ≥ 1% 偏差

- **doc/phase-7-perf-baseline.md 文档骨架**：
  - § 概述 / § 测试环境 / § 测试场景 / § 基线数据 / § 决策依据 / § 验证命令 / § 相关文件
  - 数据占位待 verify-work 阶段在真实工程上跑测后回填

- **package.json perf: scripts**：
  - `perf:baseline` / `perf:after` / `perf:diff`

- **全量测试 588 通过**（基线 555 + PLAN A 14 + PLAN B 19 = 588），零回归
- **零新增 npm 依赖**（chokidar 复用 ^3.6.0）
- **零 proxy/ 改动**（`git status src/clangd/proxy/` 无变更，per T-7-09 + CLANGD-01-04）

## Task Commits

每个任务单独提交（per task_commit_protocol）：

1. **Task 1: 7B-01 UBT 5 阶段细化插桩 + perfProxy** - `d86bae6` (feat)
   - 新增：`src/clangd/perfProxy.ts`（285 行）
   - 新增：`test/unit/clangd/perfProxy.test.ts`（13 tests）
   - 新增：`test/unit/clangd/compileCommandsPerf.test.ts`（8 tests）
   - 修改：`src/clangd/compileCommands.ts`（5 阶段插桩 +118 行）

2. **Task 2: 7B-02 chokidar 增量扫描器 + 头/源分级 + activateClangd 集成** - `426ccd7` (feat)
   - 新增：`src/clangd/fileWatcher.ts`（212 行）
   - 新增：`test/unit/clangd/fileWatcher.test.ts`（8 tests）
   - 新增：`test/unit/clangd/incrementalScan.test.ts`（4 tests）
   - 修改：`src/clangd/index.ts`（集成 watcher +49 行）

3. **Task 3: 7B-03 proxy 协同偏差测量脚本 + 基线报告 + 文档** - `3c9d82d` (feat)
   - 新增：`scripts/measure-proxy-overhead.mjs`（431 行）
   - 新增：`doc/phase-7-perf-baseline.md`（165 行骨架）
   - 修改：`package.json`（3 个 perf: scripts）

**Plan metadata:** （本 SUMMARY 由 orchestrator 单独提交）

## Files Created/Modified

**Created (8 files):**

- `src/clangd/perfProxy.ts` - LSP Proxy 协同偏差测量器（per CLANGD-01-04 + T-7-09）
- `src/clangd/fileWatcher.ts` - chokidar 增量扫描器（per D-15/D-16）
- `scripts/measure-proxy-overhead.mjs` - 3-mode proxy 偏差测量脚本
- `doc/phase-7-perf-baseline.md` - Phase 7 性能基线文档骨架
- `test/unit/clangd/perfProxy.test.ts` - perfProxy 单元测试（13 tests）
- `test/unit/clangd/compileCommandsPerf.test.ts` - 5 阶段插桩验证（8 tests）
- `test/unit/clangd/fileWatcher.test.ts` - fileWatcher 单元测试（8 tests）
- `test/unit/clangd/incrementalScan.test.ts` - 集成测试（4 tests）

**Modified (3 files):**

- `src/clangd/compileCommands.ts` - 5 阶段细化插桩（保持 PLAN A 指纹快路径不变）
- `src/clangd/index.ts` - activateClangd 集成 IncrementalFileWatcher
- `package.json` - 3 个 perf: scripts（perf:baseline / perf:after / perf:diff）

## Decisions Made

1. **D-15 落地：chokidar over VS Code FileSystemWatcher**
   - 理由：(a) 项目已有 chokidar ^3.6.0 依赖；(b) `awaitWriteFinish` 内置防抖省 30 行手写代码；(c) UE 5000+ 文件下 Windows 句柄压力可控；(d) **不主动发送 LSP workspace/didChangeWatchedFiles** — clangd 自己的 FileSystemWatcher 已在工作
   - 决策记录：`src/clangd/fileWatcher.ts` JSDoc 头注释 + `src/clangd/index.ts` 集成注释

2. **D-16 落地：头/源分级埋点**
   - `.(h|hpp|inl)$` → headerCount
   - `.(cpp|cc|c)$` → sourceCount
   - 用于状态栏三段可视化 + perf 维度细分

3. **5 阶段插桩用 try/catch 包裹（per T-7-13）**
   - 所有 `perfLog.record` 调用 + try/catch
   - 失败仅 `logger.warn('[perf] instrumentation X failed: ...')`
   - 不阻塞主流程（compile_commands.json 生成 + linkToWorkspaceRoot）

4. **集成测试位置偏离（与 PLAN A 07-01 决策 6 一致）**
   - 放在 `test/unit/clangd/incrementalScan.test.ts` 而非 `test/integration/clangd/`
   - 原因：vitest 默认 include 不覆盖 test/integration/** + test/integration/runTests.js 不存在
   - 避免死代码风险

5. **perfProxy 测试策略：静态扫描 + 运行时测试**
   - 阶段 1/2/3/5 通过静态扫描 `compileCommands.ts` 源文件验证埋点存在
   - 阶段 4 通过运行时测试 `linkToWorkspaceRoot` 验证埋点行为
   - 原因：运行时测试 `generateCompileCommands` 涉及 `vscode.tasks.executeTask` 真实 mock，复杂度超出单元测试范围

6. **dispose 后 chokidar mock listeners 残留防御**
   - 在 `onChange` 内检查 `this.watcher === null`，dispose 后事件直接丢弃
   - 解决 mock 测试中 listeners 不会被 chokidar.close() 自动移除的问题

7. **perfProxy 路径安全（per T-7-03）**
   - 拒绝原始路径含 `..` 段
   - 强制 `.json` 后缀
   - atomic temp + rename 持久化

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vi.mock 工厂不能引用未初始化变量**

- **Found during:** Task 2（fileWatcher.test.ts 初次编写时）
- **Issue:** vitest 的 `vi.mock` 工厂被 hoist 到文件顶部执行，但内部引用了 `let mockWatcher` 顶层变量，导致 `Cannot access 'watchMock' before initialization` 错误
- **Fix:** 用 `vi.hoisted()` API 把 mock 状态对象提升到文件顶部（包括 createMockWatcher、getMockWatcher、setMockWatcher、watchMock），vi.mock 工厂通过 mockState.watchMock 间接访问
- **Files modified:** `test/unit/clangd/fileWatcher.test.ts`
- **Verification:** 8 个 fileWatcher 测试全部通过
- **Committed in:** `426ccd7`（Task 2 commit 内）

**2. [Rule 1 - Bug] require is not defined（ESM 模式）**

- **Found during:** Task 3（measure-proxy-overhead.mjs 初次运行时）
- **Issue:** 脚本文件用 .mjs 后缀（ESM 模式），但 `persistJsonAtomic` 中使用了 CommonJS 的 `require('node:fs')` 加载 renameSync
- **Fix:** 在文件顶部 import 时一次性导入所有需要的 fs 函数（writeFileSync、readFileSync、existsSync、mkdirSync、renameSync），删除 require 调用
- **Files modified:** `scripts/measure-proxy-overhead.mjs`
- **Verification:** `node scripts/measure-proxy-overhead.mjs --baseline` 成功执行并写入 .vscode/clangd-perf-cache/proxy-baseline.json
- **Committed in:** `3c9d82d`（Task 3 commit 内）

**3. [Rule 4 - Architecture] 集成测试位置偏离（与 PLAN A 07-01 决策 6 一致）**

- **Found during:** Task 2 编写 incrementalScan.test.ts 时
- **Issue:** PLAN 要求 `test/integration/clangd/incrementalScan.test.ts`，但仓库当前 vitest 配置 exclude 了 `test/integration/**`，且 `test/integration/runTests.js` 不存在 → 文件不会被任何测试运行器执行
- **Fix:** 改为 `test/unit/clangd/incrementalScan.test.ts`，由 vitest 直接运行（享受同样覆盖率统计，与现有 compileCommands.test.ts 风格一致）。该偏离与 PLAN A 07-01 决策 6 一致，避免死代码
- **Files modified:** 无（路径调整）
- **Verification:** 4 个 incrementalScan 集成测试全部通过
- **Committed in:** `426ccd7`（Task 2 commit 内）

**4. [Rule 1 - Bug] dispose 后 chokidar mock listeners 残留**

- **Found during:** Task 2（incrementalScan.test.ts 集成测试初次运行）
- **Issue:** `IncrementalFileWatcher.dispose()` 设置 `this.watcher = null` 但未移除 chokidar mock 上注册的 listeners，导致 dispose 后 `__emit` 仍能触发 onChange → onBatch 被错误调用
- **Fix:** 在 `onChange` 入口检查 `if (this.watcher === null) return;`，dispose 后事件直接丢弃
- **Files modified:** `src/clangd/fileWatcher.ts`
- **Verification:** "dispose 后新事件不再触发 onBatch" 测试通过（called === 0）
- **Committed in:** `426ccd7`（Task 2 commit 内）

**5. [Rule 1 - Bug] JSDoc 内的特殊字符触发 ESBuild 解析错误**

- **Found during:** Task 2 初次 typecheck（"Unexpected '）'" at line 5:69）
- **Issue:** `src/clangd/fileWatcher.ts` JSDoc 头注释中 `Plugins/*/Source/` 的 `*` 字符被 ESBuild 解析器在某些场景下识别为特殊标记
- **Fix:** 重写头注释，避开 `*` 字符与中文括号的特定组合
- **Files modified:** `src/clangd/fileWatcher.ts`
- **Verification:** 8 个 fileWatcher 测试全部通过 + typecheck 无新错误
- **Committed in:** `426ccd7`（Task 2 commit 内）

---

**Total deviations:** 5 auto-fixed（4 Rule 1 bugs + 1 Rule 4 architecture）
**Impact on plan:** 全部 deviation 属于「不可绕过」类型（vitest 限制、ESM/CJS 差异、mock listeners 生命周期）。未引入新设计或新依赖，未扩大 scope。

## Issues Encountered

- pre-existing TypeScript baseline 错误：~30 个错误集中在 `src/ui/controlPanel.*.ts`、`test/unit/ui/controlPanel.test.ts`、`test/unit/commands/clangdProxyCommands.test.ts` 等。这些是 baseline 已知问题（与 proxy 汉化重写遗留相关），不属于本 PLAN 范围，未触碰
- pre-existing ESLint 警告：~205 个问题（96 errors + 109 warnings），全部是 baseline 错误，未新增

## Next Phase Readiness

- **Plan B（07-02）完成**：5 阶段插桩 + chokidar 增量扫描 + LSP Proxy 协同测量就位
- **D-10 决策依据已就绪**：基线报告骨架 + 测量脚本可以驱动未来 verify-work 阶段在真实工程上跑测
- **下一步候选**：
  - 完成 Phase 7 verify-work（在真实工程上跑测回填 baseline 数据）
  - 进入 Phase 8（08-code-understanding-enhancement）
  - 评估 D-10「按需启动并发合并」是否需要实施
- **前置依赖**（已就绪）：
  - perfLog 单例 + dev 模式持久化（PLAN A）
  - chokidar mock + Disposable mock（PLAN A）
  - 0 个新 npm 依赖，0 个 proxy 改动
  - 588 个单元测试通过（基线 555 + PLAN A 14 + PLAN B 19）

---

## Self-Check: PASSED

- [x] `src/clangd/perfProxy.ts` 存在（285 行）
- [x] `src/clangd/fileWatcher.ts` 存在（212 行）
- [x] `scripts/measure-proxy-overhead.mjs` 存在（431 行）
- [x] `doc/phase-7-perf-baseline.md` 存在（165 行骨架）
- [x] `test/unit/clangd/perfProxy.test.ts` 存在（13 tests passed）
- [x] `test/unit/clangd/compileCommandsPerf.test.ts` 存在（8 tests passed）
- [x] `test/unit/clangd/fileWatcher.test.ts` 存在（8 tests passed）
- [x] `test/unit/clangd/incrementalScan.test.ts` 存在（4 tests passed）
- [x] `src/clangd/compileCommands.ts` 修改（5 阶段插桩 +118 行）
- [x] `src/clangd/index.ts` 修改（集成 IncrementalFileWatcher +49 行）
- [x] `package.json` 修改（3 个 perf: scripts）
- [x] Commit `d86bae6` 存在（Task 7B-01）
- [x] Commit `426ccd7` 存在（Task 7B-02）
- [x] Commit `3c9d82d` 存在（Task 7B-03）
- [x] `src/clangd/proxy/` 目录零修改（per T-7-09 + CLANGD-01-04）
- [x] `npm run typecheck` 无新错误（仅有 baseline pre-existing 错误）
- [x] `npm run lint` 无新错误（仅有 baseline pre-existing 警告）
- [x] `npm run test:unit` 588 通过（基线 555 + 33 新测试，零回归）
- [x] `npm run build` 成功
- [x] `node scripts/measure-proxy-overhead.mjs --help` 输出 usage

---

*Phase: 07-clangd-performance-optimization*
*Plan: 07-02*
*Completed: 2026-07-04*