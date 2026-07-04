---
phase: 7
slug: clangd-performance-optimization
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run test/unit/clangd/perfLog.test.ts test/unit/clangd/fingerprint.test.ts test/unit/clangd/compileCommandsCache.test.ts` |
| **Full suite command** | `npm run test:unit` |
| **Estimated runtime** | ~15-25 seconds (full suite baseline: 498 tests in 35 files, ~10s on developer machine) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <changed-test-file>`
- **After every plan wave:** Run `npm run test:unit` (full suite, ensures no regression on existing 498 tests)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds for targeted test, ~15s for full suite

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 7A-01 | A | 1 | CLANGD-01-04 | T-7-01 | SHA256 内容哈希（无明文路径泄露） | unit | `npx vitest run test/unit/clangd/fingerprint.test.ts` | ❌ W0 | ⬜ pending |
| 7A-02 | A | 1 | CLANGD-01-04 | T-7-02 | perfLog 路径白名单（仅写 `.vscode/clangd-perf-cache/`） | unit | `npx vitest run test/unit/clangd/perfLog.test.ts` | ❌ W0 | ⬜ pending |
| 7A-03 | A | 1 | CLANGD-01-04 | T-7-03 | perfLog 大小限制（>100MB 触发轮转） | unit | `npx vitest run test/unit/clangd/perfLog.test.ts` | ❌ W0 | ⬜ pending |
| 7A-04 | A | 2 | CLANGD-01-01 | T-7-04 | 指纹命中时跳过 UBT 进程启动 | unit | `npx vitest run test/unit/clangd/compileCommandsCache.test.ts` | ❌ W0 | ⬜ pending |
| 7A-05 | A | 2 | CLANGD-01-02 | T-7-04 | 缓存未命中时正常触发 UBT | unit | `npx vitest run test/unit/clangd/compileCommandsCache.test.ts` | ❌ W0 | ⬜ pending |
| 7A-06 | A | 3 | CLANGD-01-02 | T-7-04 | headerCache 按 mtime 增量填充 | unit | `npx vitest run test/unit/clangd/headerCache.test.ts` | ❌ W0 | ⬜ pending |
| 7A-07 | A | 3 | CLANGD-01-02 | — | 头指纹命中直接复用结果 | unit | `npx vitest run test/unit/clangd/headerCache.test.ts` | ❌ W0 | ⬜ pending |
| 7A-08 | A | 3 | CLANGD-01-04 | T-7-04 | `.clangd` 配置注入 `.cache` 共享路径 | unit | `npx vitest run test/unit/clangd/clangdConfig.test.ts` | ❌ W0 | ⬜ pending |
| 7A-09 | A | 4 | CLANGD-01-01 | — | 状态栏三段渲染（绿/黄/红阈值） | unit | `npx vitest run test/unit/ui/statusBarPerf.test.ts` | ❌ W0 | ⬜ pending |
| 7A-10 | A | 4 | CLANGD-01-01 | — | `showPerfInStatusBar` 设置切换 | unit | `npx vitest run test/unit/ui/statusBarPerf.test.ts` | ❌ W0 | ⬜ pending |
| 7A-11 | A | 4 | — | — | i18n 双语状态栏文案 | unit | `npx vitest run test/unit/i18n/perfStatusBar.test.ts` | ❌ W0 | ⬜ pending |
| 7A-12 | A | 5 | CLANGD-01-04 | T-7-05 | 集成测试：模拟激活流（指纹命中 fast path） | integration | `npx vitest run test/integration/clangd/compileCommandsFastPath.test.ts` | ❌ W0 | ⬜ pending |
| 7B-01 | B | 1 | CLANGD-01-04 | T-7-04 | perfProxy 埋点 4 个外部命令入口 | unit | `npx vitest run test/unit/clangd/perfProxy.test.ts` | ❌ W0 | ⬜ pending |
| 7B-02 | B | 2 | CLANGD-01-01 | — | UBT 调用细化阶段插桩（UBT 调用 / preparse IO / 缓存查询） | unit | `npx vitest run test/unit/clangd/compileCommands.test.ts` | ❌ W0 | ⬜ pending |
| 7B-03 | B | 2 | CLANGD-01-01 | — | chokidar 100ms debounce + clangd FileStatus 关联 | unit | `npx vitest run test/unit/clangd/fileWatcher.test.ts` | ❌ W0 | ⬜ pending |
| 7B-04 | B | 3 | CLANGD-01-03 | — | 增量扫描延迟 < 200ms（事件触发延迟测量） | unit | `npx vitest run test/unit/clangd/fileWatcher.test.ts` | ❌ W0 | ⬜ pending |
| 7B-05 | B | 3 | CLANGD-01-03 | — | 集成测试：模拟文件变更（onDidChange → 完成耗时） | integration | `npx vitest run test/integration/clangd/incrementalScan.test.ts` | ❌ W0 | ⬜ pending |
| 7B-06 | B | 4 | CLANGD-01-04 | — | proxy 协同偏差验证：PLAN A 注入前后偏差 < 1% | benchmark | `node scripts/measure-proxy-overhead.mjs` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/clangd/fingerprint.test.ts` — SHA256 哈希 + 内容变更检测
- [ ] `test/unit/clangd/perfLog.test.ts` — 双载体输出 + 路径白名单 + 大小限制
- [ ] `test/unit/clangd/compileCommandsCache.test.ts` — 缓存命中/未命中路径
- [ ] `test/unit/clangd/headerCache.test.ts` — mtime 增量 + 头指纹命中
- [ ] `test/unit/clangd/clangdConfig.test.ts` — `.clangd` 注入 `.cache` 路径
- [ ] `test/unit/clangd/perfProxy.test.ts` — perfProxy 埋点
- [ ] `test/unit/clangd/fileWatcher.test.ts` — chokidar debounce
- [ ] `test/unit/clangd/compileCommands.test.ts` — UBT 阶段插桩
- [ ] `test/unit/ui/statusBarPerf.test.ts` — 状态栏三段 + 阈值
- [ ] `test/unit/i18n/perfStatusBar.test.ts` — 双语文案
- [ ] `test/integration/clangd/compileCommandsFastPath.test.ts` — 激活流 fast path
- [ ] `test/integration/clangd/incrementalScan.test.ts` — 增量扫描集成测试
- [ ] `scripts/measure-proxy-overhead.mjs` — proxy 偏差基准脚本
- [ ] `package.json` — `vscodeUEHelper.showPerfInStatusBar` setting 注册
- [ ] `.gitignore` — 排除 `.vscode/clangd-perf-cache/`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| compile_commands.json 生成 < 5s（>5000 文件） | CLANGD-01-01 | 需要实际 UE 大型工程（无 CI mock） | 在大型 UE 工程（如 Lyra/Valley）激活扩展，验证状态栏首段显示绿；记录 `perf-log.json` 总耗时 |
| preparse 缓存命中率 > 80% | CLANGD-01-02 | 需真实 .h 头文件访问 | 二次激活后查看状态栏第二段 `PI cache: ≥80%` |
| 增量扫描延迟 < 200ms | CLANGD-01-03 | 需真实文件变更事件 | 在编辑器保存 .h/.cpp，状态栏第三段 `Incr: <200ms` |
| vscode-clangd + proxy 协同零开销 | CLANGD-01-04 | 需 LSP 协议栈真实通信 | 运行 `scripts/measure-proxy-overhead.mjs` 验证偏差 < 1% |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s (full suite)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---

*Generated: 2026-07-04 by /gsd-plan-phase 7*
*Source: Phase 7 RESEARCH.md §Validation Architecture + D-17/D-18*