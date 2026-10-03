---
fill: add-003
slug: clangd-locator
status: done
built_at: 2026-10-03
mode: inline(主会话亲自实现)
commit: bbbc5b0
---

# 构建报告 add-003:ClangdLocator 统一 clangd 路径解析

## 模式偏离说明

ql-add 步骤 4 原定派发 `ql-builder-coordinator` 走波次并行。协调器(全新上下文)步骤 0 门控
检出:本上下文无 `ql-builder-worker` 子代理类型可用(可用工具仅 Bash/Read/TodoWrite 等,
无 Agent 派发工具),并行通道断裂;协调器按铁律零副作用移交决策权。主会话评估:

- 本任务是**单域紧耦合改造**(locator 接口设计直接决定 proxyManager/windowsSdk 两处接线),
  天然不可并行切分,多 worker 无收益;
- 参照 phase-1 验证阶段先例(编排通道不可用 → 主会话内联,见 verification.md 模式偏离记录),
  转为**主会话内联实现**,验收逐条亲测留痕。

## 变更清单(commit bbbc5b0,6 文件 +744/-185)

| 文件 | 变更 |
|------|------|
| `src/clangd/locator/clangdLocator.ts`(新) | ClangdLocator 类(懒探测+缓存+失效、两视图)、DEFAULT_LLVM_SEARCH_ROOTS(唯一份)、whereClangd(5s 超时)、readInstalledDir/locateClangDriverFrom(自 windowsSdk 迁移)、findClangdShared(windowsSdk 专用,配置命中零子进程短路) |
| `src/clangd/proxy/realClangdResolver.ts` | 内核增强:新增 `whereCommand` 候选级(备份后、PATH 前);`launcherPath` 可选化(SDK 场景缺省跳过排除);纯函数与依赖注入设计保持 |
| `src/clangd/windowsSdk.ts` | findClangdExecutable/readInstalledDir 删除;resolveClangExecutable 改消费 findClangdShared + locateClangDriverFrom;execFile/promisify import 清理;头注释子进程清单更新(4 处 → 2 处) |
| `src/clangd/proxyManager.ts` | 私有 resolveRealClangdPath 异步化改走 locator(notFound 仍 throw 阻断写入,并记录 checkedCandidates);buildDefaultClangdSearchRoots 删除;deps.locator 可注入(缺省内部构造,行为兼容);enable/disable 后 invalidate;构造时挂 `vscodeUEHelper.clangdPath`/`clangd.path` 配置变更监听(clangd/index.ts 保持 vscode type-only import,监听内聚本文件) |
| `test/unit/clangd/locator/clangdLocator.test.ts`(新) | 12 用例:懒探测零 IO、缓存共享、并发共享、invalidate、launcher 排除、notFound checkedCandidates、whereCommand 级、locateClangDriver 两分支、findClangdShared 短路/退化/null |
| `test/unit/clangd/proxy/realClangdResolver.test.ts` | +3 用例(whereCommand 优先级、备份优先于 where、launcherPath 缺省不排除);makeInput 支持 whereClangdPath 透传与 launcherPath 显式缺省;既有 9 用例未动 |

## 验收清单逐条自测(fresh evidence,主会话亲测)

| # | 验收项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | typecheck + 全量测试 | **PASS** | `npm run typecheck` 0 错误;`npx vitest run` 112 文件/1347 用例全绿(基线 1332 + locator 12 + resolver 3 = 1347 对账吻合)。注:首次全量出现 1 failed(createProject UHT 子进程类),连续两轮重跑全绿,判定既有偶发非本次引入 |
| 2 | 懒探测/缓存/失效 | **PASS** | locator 测试:构造后 execFile=0 且 fileExists=0;两次视图调用 execFile=1;并发 Promise.all execFile=1;invalidate 后 execFile=2 |
| 3 | resolveRealClangd 优先级与 launcher 排除 | **PASS** | resolver 12 用例(override→configured→current→backup→where→PATH→default 全链);launcher 命中拒 reason=proxyLauncher;notFound 携带 checkedCandidates;proxyManager notFound 仍 throw 阻断(既有测试绿) |
| 4 | locateClangDriver 推导 | **PASS** | locator 测试:InstalledDir → clang++.exe;clangd 缺失返回 null 且不运行 --version(execFile=1) |
| 5 | proxyManager 消费 locator | **PASS** | buildDefaultClangdSearchRoots 已删(grep 零命中);既有 proxyManager.test.ts 不传 locator 走内部构造路径全绿(行为兼容) |
| 6 | windowsSdk 消费 locator | **PASS** | findClangdExecutable 代码零残留(grep 命中均为注释说明);discoverSystemIncludes 签名不变;`git diff main -- src/commands/setSystemIncludes.ts` 为空 |
| 7 | 默认目录列表唯一份 | **PASS** | `grep -rln "ProgramFiles(x86)" src/` 仅 `src/clangd/locator/clangdLocator.ts` 一处 |
| 8 | where 进统一候选链 | **PASS** | resolver 测试:where 位于备份后、PATH 前(whereCommand source);locator 测试同;execFile 注入 timeout 5_000 |

## 行为变化登记(相对改造前)

1. **proxy 链路新增 where 候选级**(D8 设计的行为统一点):原 6 级 → 7 级,备份值之后、
   PATH 之前插入 `where clangd` 结果。proxyManager.enable 多一次 ms 级子进程探测
   (5s 超时上限),`where` 不可用(POSIX)时静默跳过。
2. **enable/disable 后 locator 缓存失效**:新增内部行为,无外部可见变化。
3. 其余外部行为(36 端点 envelope、错误码、launcher 排除、notFound 阻断)不变。

## 遗留

- diagnoseProject 复用 locator 的 checkedCandidates 诊断信息(add-003 范围边界外,未做)
- detectSystemIncludesWithEngineRecommendation(windowsSdk 内,无外部调用方)沿用 discoverSystemIncludes,
  自动受益于统一链,未单独改造
