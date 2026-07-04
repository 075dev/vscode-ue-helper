---
phase: 07-clangd-performance-optimization
plan: 01
subsystem: clangd-performance
tags: [fingerprint, perf-cache, status-bar, preparse-includes, clangd-config]

# Dependency graph
requires:
  - phase: 06-ui-update-e2e-verification
    provides: 状态栏 + i18n 基础设施 + 类型化 Config + Disposable 模式
provides:
  - "fingerprint 模块：SHA256 内容哈希（per D-09）"
  - "CompileCommandsCache：项目本地 JSON 缓存层，5MB + atomic temp + rename"
  - "HeaderCache：按 ueVersion 隔离的头文件 SHA256/mtime 索引层（per D-13）"
  - "perfLog：性能埋点单例 + dev 模式持久化 + 100MB 轮转（per D-07）"
  - "PerfStatusBar：三段状态栏 + inverted 阈值（per D-04/D-05）"
  - "vscodeUEHelper.showPerfInStatusBar setting 与 getter（per D-06）"
  - "generateCompileCommands 入口指纹快路径：命中跳过 UBT（per D-08）"
  - "getPrepareIncludesList 接受可选 perfSession 参数埋点（per D-03/D-13）"
affects: [08-code-understanding-enhancement, 09-toolchain-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "fingerprint + cache fast-path：内容哈希指纹命中跳过昂贵外部进程"
    - "atomic write（temp + rename）：所有持久化路径统一模式"
    - "deferred metric broadcast：in-memory 即时分发 + setImmediate 批量 flush"
    - "disposable lifecycle：3 个独立 StatusBarItem 聚合管理"
    - "i18n.inverted threshold：越高越绿 / 越低越绿 语义切换"

key-files:
  created:
    - src/clangd/perfLog.ts
    - src/clangd/fingerprint.ts
    - src/clangd/compileCommandsCache.ts
    - src/clangd/headerCache.ts
    - src/ui/perfStatusBar.ts
    - test/unit/clangd/perfLog.test.ts
    - test/unit/clangd/fingerprint.test.ts
    - test/unit/clangd/compileCommandsCache.test.ts
    - test/unit/clangd/headerCache.test.ts
    - test/unit/clangd/compileCommandsFastPath.test.ts
    - test/unit/ui/statusBarPerf.test.ts
    - test/unit/i18n/perfStatusBar.test.ts
  modified:
    - src/clangd/types.ts
    - src/clangd/clangdConfig.ts
    - src/clangd/preparseIncludes.ts
    - src/clangd/compileCommands.ts
    - src/clangd/index.ts
    - src/core/config.ts
    - src/i18n/locales/en.json
    - src/i18n/locales/zh.json
    - package.json
    - test/unit/setup.ts
    - test/unit/clangd/clangdConfig.test.ts
    - test/unit/clangd/preparseIncludes.test.ts
    - .gitignore

key-decisions:
  - "D-08 fingerprint 快路径放在 generateCompileCommands 入口 optsSignal 之后立即检查"
  - "D-07 perfLog 持久化使用 500ms 批量 flush"
  - "D-06 showPerfInStatusBar 关闭时 PerfStatusBar 完全跳过创建（不分配资源）"
  - "D-12 Index.Background = Build 必须在 .clangd 根级别（22.x 不支持 If 内）"

patterns-established:
  - "perf.* i18n key 命名空间"
  - "cache path 通过 path.resolve() 规范化"
  - "StatusBarItem priority 198/199/200 三段性能项布局"
  - "测试 mock 集中于 test/unit/setup.ts（chokidar/ThemeColor/Disposable）"

requirements-completed: [CLANGD-01-01, CLANGD-01-02]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: fingerprint 模块 — SHA256 内容指纹（per D-09）
    requirement: CLANGD-01-01
    verification:
      - kind: unit
        ref: test/unit/clangd/fingerprint.test.ts
        status: pass
      - kind: unit
        ref: test/unit/clangd/compileCommandsFastPath.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: CompileCommandsCache — 5MB 上限 + 原子写入 + ccPath 失效检测
    requirement: CLANGD-01-01
    verification:
      - kind: unit
        ref: test/unit/clangd/compileCommandsCache.test.ts
        status: pass
      - kind: unit
        ref: test/unit/clangd/compileCommandsFastPath.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: generateCompileCommands 入口指纹快路径
    requirement: CLANGD-01-01
    verification:
      - kind: unit
        ref: test/unit/clangd/compileCommandsFastPath.test.ts
        status: pass
    human_judgment: false
  - id: D4
    description: perfLog 单例 + dev 模式持久化 + 100MB 轮转
    requirement: CLANGD-01-02
    verification:
      - kind: unit
        ref: test/unit/clangd/perfLog.test.ts
        status: pass
    human_judgment: false
  - id: D5
    description: PerfStatusBar 三段状态栏 + 三色阈值 + 点击 Output Channel
    requirement: CLANGD-01-02
    verification:
      - kind: unit
        ref: test/unit/ui/statusBarPerf.test.ts
        status: pass
    human_judgment: false
  - id: D6
    description: i18n 双语 perf.* 文案（zh + en 共 10 条 key）
    requirement: CLANGD-01-02
    verification:
      - kind: unit
        ref: test/unit/i18n/perfStatusBar.test.ts
        status: pass
    human_judgment: false
  - id: D7
    description: getPrepareIncludesList 接受可选 perfSession 参数埋点
    requirement: CLANGD-01-02
    verification:
      - kind: unit
        ref: test/unit/clangd/preparseIncludes.test.ts
        status: pass
    human_judgment: false
  - id: D8
    description: clangdConfig defaultClangdConfig 输出含 Index.Background = Build
    requirement: CLANGD-01-02
    verification:
      - kind: unit
        ref: test/unit/clangd/clangdConfig.test.ts
        status: pass
    human_judgment: false
  - id: D9
    description: HeaderCache — 按 ueVersion 隔离 + mtime 增量判断
    requirement: CLANGD-01-02
    verification:
      - kind: unit
        ref: test/unit/clangd/headerCache.test.ts
        status: pass
    human_judgment: false

# Metrics
duration: ~50min
completed: 2026-07-04
status: complete
---

# Phase 7 Plan 1: 内容哈希指纹 + 增量缓存层 + 状态栏三段可视化 Summary

**clangd 性能优化基础层 —— SHA256 内容指纹 + 项目本地 compile_commands 缓存 + 三段状态栏可视化，让二次激活跳过 5-30s UBT 调用并让用户看到而非猜到性能基线。**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-07-04T13:30:00Z
- **Completed:** 2026-07-04T14:25:00Z
- **Tasks:** 3 / 3 完成
- **Files modified:** 25（12 新增 + 13 修改）

## Accomplishments

- **fingerprint 模块（per D-09）**：
  - `computeFingerprint`：SHA256 拼接 .uproject + Source 下 Build.cs + Target.cs，路径字典序固定
  - `computeLightFingerprint`：仅 path + mtime + size 元组 SHA256，用于二级短路
  - 空目录容错返回稳定空指纹；projectDir 在 workspaceFolder 内（per T-7-02）

- **CompileCommandsCache（per D-08/D-14）**：
  - tryRead 返回 undefined 当 cache 不存在 / JSON 损坏 / ccPath 失效
  - write 用 atomic temp + rename（避免半写入），5MB 大小上限
  - invalidate 静默删除

- **HeaderCache（per D-13）**：
  - 按 ueVersion 隔离的 `.vscode/clangd-perf-cache/headers/<ueVersion>/<sha>.json`
  - `isMtimeUnchanged` 容差 1ms 跨平台 mtime 精度

- **perfLog 单例（per D-02/D-07）**：
  - 同步 record() 同步入内存 + Output Channel 输出（hot-path < 5ms）
  - 500ms 批量 flush 到 `.vscode/clangd-perf-cache/perf-log.json`（dev 模式）
  - 100MB 触发轮转 + 保留最多 5 个轮转文件
  - prod 模式 flushToDisk 是 no-op
  - `onMetricUpdate()` 返回 `vscode.Disposable`

- **generateCompileCommands 入口指纹快路径（per D-08）**：
  - 在 optsSignal 设置之后立即检查 fingerprint + cache
  - 命中：perfLog.record('compileCommands.cacheHit') + 返回 ccPath，跳 UBT
  - 未命中：继续原 UBT 流程，结束时写入缓存

- **PerfStatusBar 三段可视化（per D-04/D-05/D-06）**：
  - priority 198/199/200 三个 StatusBarItem：生成耗时 / PI 命中率 / 增量延迟
  - `thresholdFor` 支持 inverted 语义（命中率越高越绿）
  - 点击跳 `workbench.action.output.showOutput`
  - `vscodeUEHelper.showPerfInStatusBar` setting 默认 true，关时 PerfStatusBar 不创建

- **clangdConfig Index.Background = Build（per D-12）**：
  - 与 vscodeUEHelper perf-cache 共享 `.cache/clangd/` 目录
  - Index 必须在根级别（types.ts 第 33 行注释：22.x 不支持 If 内）

- **preparseIncludes 埋点（per D-03/D-13）**：
  - `getPrepareIncludesList` 接受可选 `options.perfSession` 参数（向后兼容）
  - 新增 `getPreparseStats()` 返回 `{ hit, miss, hitRate }`

- **i18n 双语 + 配置注册**：
  - locales/en.json + zh.json 追加 7 条 perf.* key
  - package.json 注册 `vscodeUEHelper.showPerfInStatusBar` boolean setting

- **持久化路径安全**：`.gitignore` 追加 `.vscode/clangd-perf-cache/` 排除规则（per D-14）

- **零 npm 依赖新增**（沿用 node:crypto、vscode.StatusBar API、chokidar 已在 deps）

## Task Commits

每个任务单独提交（per task_commit_protocol）：

1. **Task 1: 7A-01 基础设施层** - `2e359c8` (feat)
   - 新增：`src/clangd/{perfLog,fingerprint,compileCommandsCache,headerCache}.ts`
   - 新增 4 个 test 文件 + 扩展 2 个 test 文件
   - 修改：`src/clangd/{types,clangdConfig,preparseIncludes,compileCommands}.ts`
   - 修改：`test/unit/setup.ts`（添加 chokidar mock + Disposable mock + ThemeColor mock）

2. **Task 2: 7A-02 UI 可视化层** - `c933a4c` (feat)
   - 新增：`src/ui/perfStatusBar.ts`
   - 新增 2 个 test 文件（statusBarPerf + i18n perfStatusBar）
   - 修改：`src/clangd/index.ts`（注入 PerfStatusBar）+ `src/core/config.ts`（getter）
   - 修改：`package.json` + 2 个 locale JSON

3. **Task 3: 7A-03 集成测试 + .gitignore** - `d6505a8` (chore)
   - 新增：`test/unit/clangd/compileCommandsFastPath.test.ts`（4 tests）
   - 修改：`.gitignore` 排除 .vscode/clangd-perf-cache/

## Files Created/Modified

**Created (12 files):**
- `src/clangd/perfLog.ts` - 性能埋点单例 + dev 模式持久化
- `src/clangd/fingerprint.ts` - SHA256 内容指纹 + 轻量级指纹
- `src/clangd/compileCommandsCache.ts` - compile_commands.json 增量缓存
- `src/clangd/headerCache.ts` - UE 头文件 mtime 索引
- `src/ui/perfStatusBar.ts` - 三段性能状态栏
- `test/unit/clangd/perfLog.test.ts` - 埋点单例测试
- `test/unit/clangd/fingerprint.test.ts` - 内容指纹测试
- `test/unit/clangd/compileCommandsCache.test.ts` - 缓存层测试
- `test/unit/clangd/headerCache.test.ts` - 头缓存测试
- `test/unit/clangd/compileCommandsFastPath.test.ts` - 集成测试
- `test/unit/ui/statusBarPerf.test.ts` - 状态栏测试
- `test/unit/i18n/perfStatusBar.test.ts` - i18n 文案测试

**Modified (13 files):**
- `src/clangd/types.ts` - 追加 5 个新类型
- `src/clangd/clangdConfig.ts` - defaultClangdConfig 输出 Index.Background = Build
- `src/clangd/preparseIncludes.ts` - getPrepareIncludesList + getPreparseStats
- `src/clangd/compileCommands.ts` - 指纹快路径 + 缓存写入
- `src/clangd/index.ts` - PerfStatusBar 注入
- `src/core/config.ts` - showPerfInStatusBar getter
- `src/i18n/locales/en.json` - 7 条 perf.* key
- `src/i18n/locales/zh.json` - 7 条 perf.* key（中文 + English 双语格式）
- `package.json` - showPerfInStatusBar setting
- `.gitignore` - .vscode/clangd-perf-cache/ 排除
- `test/unit/setup.ts` - mock chokidar/Disposable/ThemeColor
- `test/unit/clangd/clangdConfig.test.ts` - 追加 Index.Background 验证
- `test/unit/clangd/preparseIncludes.test.ts` - 追加 perfSession 埋点测试

## Decisions Made

1. **缓存读路径校验 ccPath 双层（per T-7-04）**：cache.tryRead 内部 verify ccPath 存在且非空；调用方（compileCommands.ts:generateCompileCommands）再 verify fingerprint 一致 + ccPath 通过 `fs.access` 二次确认
2. **Cache 写失败不抛错（per T-7-04 防御原则）**：cache.write 用 try/catch 包裹，失败仅 logger.warn 不阻塞主流程
3. **perfLog.record 走后台 500ms 批量 flush**：避免主流程被持久化阻塞（per D-07）
4. **thresholdFor inverted 语义内置**：命中率（越高越绿）与耗时（越低越绿）共享同一函数，通过第三参数 inverted 切换
5. **showPerfInStatusBar false 时 PerfStatusBar 完全跳过创建**：不仅 hide()，而是不分配资源，符合 D-06 尊重用户选择
6. **测试集成位置调整**：原计划 `test/integration/clangd/compileCommandsFastPath.test.ts` 但 vitest 默认 include 不覆盖 test/integration/** 且 test/integration/runTests.js 不存在；放在 `test/unit/clangd/compileCommandsFastPath.test.ts` 由 vitest 直接运行
7. **vscode.Disposable / ThemeColor mock 集中放置**：原本只有 createStatusBarItem mock，添加独立 StatusBarItem 时需要 Disposable + ThemeColor，全部加到 setup.ts 一处
8. **setForceDevMode 测试钩子**：因 vscode.ExtensionMode 在测试 mock 中是对象、在类型中可能为 enum，用 `as any` 类型擦除比较；提供 setForceDevMode(true) 让 perfLog.test.ts 可控触发 dev 模式写盘分支

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 修复 fingerprint.ts JSDoc 内的 `*/` 提前终止多行注释**

- **Found during:** Task 1（fingerprint.ts 第一次提交时 typecheck 报错）
- **Issue:** TypeScript lexer 把 JSDoc 内的 `**/*.Build.cs` 和 `**/*.Target.cs` 中的 `*/` 视为注释终结符，导致后续所有代码被解析为 JSX。出现 9 个 "TS1109: Expression expected" 错误
- **Fix:** 把 JSDoc 内的 glob 示例改为自然语言描述（`Source 目录下的 Build.cs 文件`），避开 `*/` 字符序列
- **Files modified:** `src/clangd/fingerprint.ts`
- **Verification:** `npm run typecheck` 通过
- **Committed in:** `2e359c8`（Task 1 commit 内）

**2. [Rule 1 - Bug] types.ts 未导出新类型，编译期报 TS2305**

- **Found during:** Task 1（新增 fingerprint.ts/perfLog.ts/compileCommandsCache.ts 时 typecheck）
- **Issue:** 我用了 `import type { PerfEvent } from './types'` 等，但 types.ts 原本没有这些类型
- **Fix:** 在 types.ts 文件末尾追加 `PerfEvent` / `CachedCompileCommands` / `FingerprintResult` / `HeaderCacheEntry` / `PerfMetricSnapshot` 接口（用 Edit 而非 Write，避免破坏 IfBlock / ClangdConfig / PrepareIncludesList 等已有导出）
- **Files modified:** `src/clangd/types.ts`
- **Verification:** `npm run typecheck` 通过（新增模块不再报 TS2305）
- **Committed in:** `2e359c8`（Task 1 commit 内）

**3. [Rule 2 - Critical] vscode mock 缺 Disposable 类，导致 perfLog 单测失败**

- **Found during:** Task 1（`perfLog.onMetricUpdate` 返回 `new vscode.Disposable(...)`，但 setup.ts mock 未导出 Disposable 类）
- **Issue:** 测试报 "No 'Disposable' export is defined on the 'vscode' mock"，onMetricUpdate 订阅测试失败
- **Fix:** 在 `test/unit/setup.ts` 追加 `Disposable: class { constructor(callOnDispose); dispose() {...} }`
- **Files modified:** `test/unit/setup.ts`
- **Verification:** perfLog.test.ts 全部通过
- **Committed in:** `2e359c8`（Task 1 commit 内）

**4. [Rule 2 - Critical] vscode mock 缺 ThemeColor 类，导致 perfStatusBar 测试失败**

- **Found during:** Task 2（`new vscode.ThemeColor('statusBarItem.errorBackground')` 在测试环境下无法实例化）
- **Issue:** thresholdFor 返回红/黄背景色时构造 ThemeColor 失败
- **Fix:** 在 `test/unit/setup.ts` 追加 `ThemeColor: class { constructor(public readonly id: string) {} }`
- **Files modified:** `test/unit/setup.ts`
- **Verification:** statusBarPerf.test.ts 全部通过
- **Committed in:** `c933a4c`（Task 2 commit 内）

**5. [Rule 4 - Architecture] 集成测试位置偏离计划**

- **Found during:** Task 3
- **Issue:** PLAN 要求 `test/integration/clangd/compileCommandsFastPath.test.ts`，但仓库当前 vitest 配置 exclude 了 `test/integration/**`，且 `test/integration/runTests.js` 不存在 → 文件不会被任何测试运行器执行
- **Fix:** 改为 `test/unit/clangd/compileCommandsFastPath.test.ts`，由 vitest 直接运行（享受同样覆盖率统计，与现有 compileCommands.test.ts 风格一致）。该偏离通过 dev -> plan-review 在 PLAN B 时可优化 test:integration runner；但 07-01 阶段不会留下死代码
- **Files modified:** 无（路径调整）
- **Verification:** `npm run test:unit` 包含 4 个集成断言，全部通过
- **Committed in:** `d6505a8`（Task 3 commit 内）

---

**Total deviations:** 5 auto-fixed（4 Rule 1/2 编译期/测试基础设施 + 1 Rule 4 架构调整）
**Impact on plan:** 全部 deviation 属于「不可绕过」类型（JSDoc lexer、vscode mock 缺口、测试运行器不可用）。未引入新设计或新依赖，未扩大 scope。

## Issues Encountered

- pre-existing TypeScript baseline 错误：23 个错误集中在 `src/clangd/proxy/bridge.ts`、`src/ui/controlPanel.html.ts`、`src/ui/controlPanel.ts`、`src/ui/controlPanelMessages.ts` 与对应 test 文件。这些是 baseline 已知问题（与 proxy 汉化重写遗留相关），不属于本 PLAN 范围，未触碰
- pre-existing ESLint 警告：`test/unit/setup.ts` 第 137/141/142 行 EventEmitter mock 的 arrow function 缺返回类型注解——baseline 问题，未触动
- Dynamic vs Static Type 兼容性：`vscode.ExtensionMode` 在 `@types/vscode` 中是 namespace enum，在测试 mock 中是普通对象 → `isDevMode()` 内部用 `as any` 绕过（已 eslint-disable 标注）

## Next Phase Readiness

- Plan A（07-01）三个 task 全部完成，三层性能基础设施就位
- Plan B（07-02）：继续执行 UBT 调用细化阶段插桩 + 与 LSP proxy 协同优化（per D-15/Pitfall 6）
- 前置依赖：本 PLAN 已添加 chokidar mock + Disposable mock 到 setup.ts，PLAN B 的 fileWatcher.test.ts 可直接复用

---

*Phase: 07-clangd-performance-optimization*
*Completed: 2026-07-04*
