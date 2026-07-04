# Phase 7 性能基线快照

**状态：** 占位文档（per Phase 7 PLAN B 任务 7B-03）
**生成时间：** 2026-07-04
**维护者：** GSD 自动化 / VSCode UE Helper 性能优化

---

## § 概述

本文档记录 Phase 7（clangd 性能优化）的关键性能基线数据，作为后续 verify-work 阶段在真实工程上跑测后回填的骨架。

Phase 7 包含两个 PLAN：
- **PLAN A（07-01）**：内容哈希指纹 + 增量缓存层 + 状态栏三段可视化
- **PLAN B（07-02）**：UBT 调用细化插桩 + 文件变更增量扫描 + LSP Proxy 协同偏差验证

两条 PLAN 共同落地 **3 层性能基础设施**：
1. 缓存层（fingerprint + CompileCommandsCache + HeaderCache）
2. 状态栏层（PerfStatusBar 三段 + dev/prod 模式切换）
3. 协同测量层（chokidar 增量扫描 + ProxyOverheadMeter + 测量脚本）

**决策依据（per D-10「按需启动并发合并」）：**
- 本文档产出的真实 perf 数据用于决定是否在 Phase 8+ 实施 UBT 子进程并发合并
- 数据来源：手动在真实 UE 工程上跑测（`npm run perf:baseline` + `npm run perf:after` + `npm run perf:diff`）
- 验证脚本：`scripts/measure-proxy-overhead.mjs`

---

## § 测试环境

> 此节待 verify-work 阶段在真实工程上跑测后回填。

| 项 | 值 |
|---|---|
| 开发机 CPU | 待填 |
| 开发机内存 | 待填 |
| Node 版本 | 待填 |
| VS Code 版本 | 待填 |
| UE 工程名 | 待填 |
| UE 引擎版本 | 待填 |
| 源文件总数（含 .h/.cpp） | 待填 |
| 插件文件总数 | ~70（基线 67 + PLAN A +8 + PLAN B +3） |
| 单元测试数 | 588（基线 555 + PLAN A 14 + PLAN B 19） |

---

## § 测试场景

> 此节描述在真实工程上跑测时的标准场景。

1. **首次激活**（冷启动）：
   - 删除 `.vscode/clangd-perf-cache/` 整个目录
   - F5 启动 Extension Development Host
   - 等待 `compile_commands.json` 生成完成
   - 记录：compile_commands.json 生成耗时（期望 < 5s）

2. **二次激活**（指纹命中）：
   - 不删除 `.vscode/clangd-perf-cache/`
   - F5 再次启动
   - 记录：compile_commands.json 生成耗时（期望 < 200ms 走 fast-path）
   - 记录：preparse 缓存命中率（期望 > 80%）

3. **增量扫描**（保存文件）：
   - 在工程中编辑任意 `.h` 文件并保存
   - 状态栏显示 `[Incr: 🟢 ~120ms]` 形式（per D-15 + D-17）
   - 记录：chokidar debounce 触发到 perfLog.recordIncrementalScan 的延迟（期望 < 200ms）

4. **Proxy 协同偏差**：
   - 在 master 分支（无 PLAN A 改动）跑 `npm run perf:baseline > baseline.json`
   - 切到当前分支（有 PLAN A + PLAN B 改动）跑 `npm run perf:after > after.json`
   - 跑 `npm run perf:diff baseline.json after.json`
   - 记录：p50 / p95 / p99 / mean / memory 偏差（期望 < 1% per CLANGD-01-04）

---

## § 基线数据

> **此节为占位**，数据待真实工程跑测后回填。

### compile_commands.json 生成耗时

| 场景 | 实测 | 期望 | 状态 |
|---|---|---|---|
| 首次激活（无缓存） | 待填 ms | < 5000 ms | 待测 |
| 二次激活（指纹命中 fast-path） | 待填 ms | < 200 ms | 待测 |

### preparse 缓存命中率

| 场景 | 实测 | 期望 | 状态 |
|---|---|---|---|
| 首次激活 | 待填 % | - | 待测 |
| 二次激活 | 待填 % | > 80 % | 待测 |

### 增量扫描延迟

| 场景 | 实测 | 期望 | 状态 |
|---|---|---|---|
| 保存 .h 后状态栏 `[Incr: Xms]` | 待填 ms | < 200 ms | 待测 |
| 连续 5 个文件保存合并单次 flush | 待填 ms | < 200 ms | 待测 |

### proxy 协同偏差（per CLANGD-01-04）

| 维度 | 偏差% | 期望 | 状态 |
|---|---|---|---|
| P50 延迟 | 待填 % | < 1 % | 待测 |
| P95 延迟 | 待填 % | < 1 % | 待测 |
| P99 延迟 | 待填 % | < 1 % | 待测 |
| Mean 延迟 | 待填 % | < 1 % | 待测 |
| 内存 RSS | 待填 % | < 1 % | 待测 |

---

## § 决策依据

### D-10「按需启动并发合并」的真实数据

| 信号 | 决策 | 数据来源 |
|---|---|---|
| compile_commands.json 平均耗时 < 5s | 不实施并发合并 | 首次激活耗时 |
| prepare 缓存命中率 > 80% | 二次激活走 fast-path，跳过 UBT | preparse 命中率 |
| 增量扫描延迟 < 200ms | 不需要后台预编译 | chokidar debounce 延迟 |
| proxy 协同偏差 < 1% | PLAN A 注入零开销 | proxy 测量脚本 |

**当前决策（占位）：**
- [ ] 数据收集完成后，由 maintainer 在此处填写最终决策
- [ ] 若所有维度达预期 → 不实施并发合并（D-10 默认值）
- [ ] 若首次激活 > 10s → 考虑 UBT 后台预编译
- [ ] 若增量扫描延迟 > 200ms → 考虑减少 debounce 时长或扩大 ignored 数组

---

## § 验证命令

```bash
# 1. 单元测试
npm run test:unit

# 2. 编译
npm run build

# 3. 类型检查
npm run typecheck

# 4. LSP 代理偏差测量
npm run perf:baseline        # 输出 .vscode/clangd-perf-cache/proxy-baseline.json
npm run perf:after           # 输出 .vscode/clangd-perf-cache/proxy-after.json
npm run perf:diff <a> <b>    # 对比两个 JSON 文件
```

---

## § 相关文件

- `src/clangd/perfLog.ts`：性能埋点单例 + dev 模式持久化
- `src/clangd/perfProxy.ts`：LSP Proxy 协同偏差测量器
- `src/clangd/fileWatcher.ts`：chokidar 增量扫描器
- `src/clangd/compileCommands.ts`：5 阶段细化插桩
- `src/ui/perfStatusBar.ts`：三段性能状态栏
- `scripts/measure-proxy-overhead.mjs`：proxy 测量脚本

---

*Phase: 07-clangd-performance-optimization*
*Plan: 07-02*
*Completed: 2026-07-04（占位骨架，真实数据待 verify-work 阶段回填）*
