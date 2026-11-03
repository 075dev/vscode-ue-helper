---
review: add-003
slug: clangd-locator
review_round: 2
verdict: approved
reviewed_at: 2026-10-03
base: main
head: 5be8301
round1_head: 8da7eaf
round1_verdict: criticals_found
diff_stat: 9 files, +873/-187 (代码主体 bbbc5b0,6 文件 +744/-185)
reviewer: ql-reviewer(独立上下文)
---

# 评审报告 add-003:ClangdLocator 统一 clangd 路径解析

## 评审深度定档

STANDARD(默认档)。理由:6 个代码文件 +744/-185,不满足 THOROUGH 升档条件(≤20 文件、非 strictness HEAVY、未触及 auth/schema/.env/密钥路径)。抽查 + 廉价命令取证,未重跑全量测试(理由:验证报告 fresh 于 HEAD 前一提交,其后仅 docs 变更,工作区干净,无 stale 疑点;已亲自抽查 3 个被改测试文件与 typecheck)。

## DoneClaim 探测(防假绿)

| 键 | 结果 | 证据 |
|----|------|------|
| stale_state | 未命中 | HEAD = 8da7eaf = 报告提交;bbbc5b0 之后仅 planning 文档变更 |
| dirty_worktree | 未命中 | `git status` → nothing to commit, working tree clean |
| misleading_success_output | 未命中 | 亲测 3 个被改测试文件 36/36 绿(locator 12 + resolver 12 + proxyManager 12),断言为真实行为断言(返回值/IO 次数),非"仅 mock 被调用";对账 1332(基线)+12+3 = 1347 与报告吻合 |

---

## 结论一:契约/范围合规 —— 通过(1 项 minor 附注)

**越界检查:全部干净。**

| 检查项 | 结果 | 证据 |
|--------|------|------|
| openapi.yaml / event-flow.md 未动 | ✓ | `git diff main..HEAD --name-only` 无契约文件;diff 仅 9 个文件(2 planning 决策/报告、5 src、2 test) |
| 无新增命令/MCP 端点 | ✓ | diff 无 commands/mcp 文件 |
| setSystemIncludes.ts 零改动 | ✓ | `git diff main -- src/commands/setSystemIncludes.ts` 输出 0 行(亲测) |
| 默认 LLVM 目录唯一份(验收 7) | ✓ | `grep -rln "ProgramFiles(x86)" src/` 仅 `src/clangd/locator/clangdLocator.ts`(亲测) |
| findClangdExecutable/buildDefaultClangdSearchRoots 代码零残留 | ✓ | grep 命中 7 处全为注释性说明(亲测逐一核对) |

**验收 8 条逐条:**

1. **typecheck + 全量测试** — typecheck 0 错误(本轮亲测复跑,干净退出);全量 1347 用例未重跑(非 stale,见 DoneClaim;报告对账吻合),抽查 3 个被改测试文件 36/36 亲测绿。**通过**
2. **懒探测/缓存/失效** — locator 测试:构造后 execFile=0 且 fileExists=0(L62-72);两次视图 execFile=1(L74-87);Promise.all 并发 execFile=1(L89-100);invalidate 后 execFile=2(L102-114)。**通过**
3. **resolveRealClangd 优先级 + launcher 排除** — 候选顺序 override>configured>current>backup>where>PATH>default(realClangdResolver.ts:132-142);launcher 命中拒 reason=proxyLauncher(realClangdResolver.ts:109-112);notFound 携带 checkedCandidates(realClangdResolver.ts:126-129);proxyManager notFound 仍 throw 阻断写入(proxyManager.ts resolveRealClangdPath switch)。**通过**
4. **locateClangDriver 推导** — InstalledDir→clang++.exe 分支与"clangd 缺失返回 null 且不跑 --version(execFile=1)"均有测试锁定(locator 测试 L180-213)。**通过**
5. **proxyManager 消费 locator** — 私有 resolve 改走 locator,buildDefaultClangdSearchRoots 已删,notFound 仍 throw 且 error 日志新增 checkedCandidates(增强,非回归)。**通过**
6. **windowsSdk 消费 locator** — findClangdExecutable/readInstalledDir 代码体删除,resolveClangExecutable 改 `findClangdShared` + `locateClangDriverFrom`;discoverSystemIncludes 对外签名不变(diff 可见);execFile/promisify import 清理后 typecheck 干净证明无残留引用。**通过**
7. **默认目录唯一份** — 见上表(亲测)。**通过**
8. **where 进统一候选链,备份后、PATH 前** — buildCandidates 中 whereCommand 位于 backupClangdPath 之后、pathEnv 之前(realClangdResolver.ts:137-139);timeout 5_000 真实传入 execFile opts(clangdLocator.ts:115-118),非测试专用桩。**通过**(附注 minor-1:无测试断言 timeout 值,数值未被锁定)

**minor-附注(范围文档内部张力,归正确性结论处置):** 验收 3 的候选链包含 override,但范围边界"缓存失效"条目只列了 `vscodeUEHelper.clangdPath` + enable/disable 钩子——实现按窄清单执行,衍生出正确性结论的 critical(见下)。

---

## 结论二:正确性 —— 不通过(1 critical,3 minor)

### CRITICAL-1:override 配置变更不触发缓存失效,reapply/enable 读到 stale 路径(回归)

**证据链(全部亲测核对):**

1. proxyManager 构造器失效监听仅覆盖两个键(bbcb5b0 diff,proxyManager.ts):
   ```ts
   e.affectsConfiguration('vscodeUEHelper.clangdPath') || e.affectsConfiguration('clangd.path')
   ```
2. override 是另一个兄弟键:`clangdProxy.realClangdPath`(src/core/config.ts:218-221 `get clangdProxyRealClangdPath()`),`affectsConfiguration('vscodeUEHelper.clangdPath')` 不匹配同级子树;
3. locator 把 override 作为候选且仅在探测时求值(clangdLocator.ts:332 `getProxyOverridePath?.()`),结果被 `probePromise` 缓存(clangdLocator.ts:292-297);
4. 触达路径真实存在:src/commands/enableClangdProxy.ts:89-91 —— proxy 已激活时命令走 `reapply()` → `resolveRealClangd()` 命中上次 enable 留下的缓存。

**后果:** 用户改 `vscodeUEHelper.clangdProxy.realClangdPath` 后再次执行 enableClangdProxy(幂等 reapply 路径),proxy 仍以**旧的**真实 clangd 路径启动,无任何告警。main 上每次 enable/reapply 同步现解析,override 变更下次 enable 即生效——本变更加缓存后引入静默 stale 读,**属回归**。

**决策/范围不免罪:** D8 tradeoff 字段自认"漏挂监听会读到过期路径",但监听清单漏掉了自己候选链里的 override 源;验收清单未列出不等于正确性豁免。

**修复指引(一行 + 一测):** 监听条件补 `e.affectsConfiguration('vscodeUEHelper.clangdProxy.realClangdPath')`;或在 enable()/reapply() resolve 之前 invalidate;补一个"变更 override → invalidate → 重探测读到新值"的测试。

### 缓存语义专项核查(任务指定疑点逐条)

- **invalidate 与 in-flight probe 竞态:** `invalidate()` 同清 probePromise/driverPromise(clangdLocator.ts:323-326)。in-flight 旧 probe 完成后结果仅存在于旧 promise 的 awaiting 方,不回写任何字段;新调用开新探测。**无缓存污染** ✓
- **driverPromise 依赖 stale probePromise?** 不成立——invalidate 两键同清;新 driverPromise 的 IIFE 调 `this.resolveRealClangd()` 时取到的是新 probePromise。**无 stale 链** ✓
- **resolveIo undefined 覆盖:** 逐字段只赋非 undefined 值(clangdLocator.ts:81-87),`io: { fileExists: deps.fileExists }` 透传 undefined 时保留 `fs.existsSync` 缺省,与旧 `deps.fileExists ?? fs.existsSync` 语义一致 ✓
- **where 失败静默:** `catch {}` → null(clangdLocator.ts:124-127),where 是可选候选级、不可用(POSIX)跳过属设计内,非吞错误反模式 ✓
- **timeout 真实生效:** 5_000 硬编码进 execFile opts(clangdLocator.ts:117、148),走 node child_process 原生 timeout ✓(缺测试锁定,见 minor-1)
- **launcher 排除语义:** proxy 链路 locator 持 launcherPath,enable 后 clangd.path=launcher 会被拒(proxyLauncher reason);类视图 locateClangDriver 共享同一 probe 故同样排除 ✓。`findClangdShared` 不排除 launcher 但其候选只来自 `vscodeUEHelper.clangdPath`(windowsSdk 传参)与 where/PATH/默认目录,clangd.path 永不进入该链,launcher 无法渗入 SDK 链路 ✓

### windowsSdk 行为等价性(迁移前后逐项比对)

| 输入场景 | 迁移前 | 迁移后 | 等价? |
|----------|--------|--------|-------|
| 配置存在 | 直接返回(零子进程) | 短路返回(clangdLocator.ts:232-236) | ✓ |
| 配置存在但文件缺失 | warn 后 where→PATH→默认 | 静默降级同序(resolver 内记 checkedCandidates 但被 findClangdShared 丢弃) | 结果等价;**日志差异见 minor-3** |
| where 失败/无匹配 | catch→继续 | catch→null→继续 | ✓ |
| PATH 遍历 | 仅 `clangd.exe` | pathCandidates 仅 `clangd.exe`(realClangdResolver.ts:165) | ✓ |
| 默认目录 | 3 根 + clangd.exe | 同(DEFAULT_LLVM_SEARCH_ROOTS) | ✓ |
| InstalledDir 存在 | clang++→clang | 同序(clangdLocator.ts:186-192) | ✓ |
| InstalledDir 缺失 | sibling clang++→clang→clangd | 同序(clangdLocator.ts:199-206) | ✓ |
| 存在性检查 | async fs.access | sync existsSync | 结果等价 |

**注意:windowsSdk 无专属测试文件(test/unit/clangd/ 下无 windowsSdk.test.ts),等价性结论基于逐行代码比对 + 全量测试报告,非测试锁定。**

### minor 发现

- **minor-1:** where 的 5s timeout 无测试断言(两测试文件的 fake execFile 均忽略 opts)。验收 8 的"带 5s 超时"仅由实现保证,数值漂移不会被测试捕获。登记不修或顺手补一行断言。
- **minor-2:** probePromise 一旦 reject 会被永久缓存(clangdLocator.ts:293-296 无 catch/清空逻辑),后续调用直接复用 rejected promise 直至 invalidate。触发条件仅 deps getter 抛错(vscode 配置读取,概率极低),且 notFound 走 typed 结果不抛。鲁棒性注记,登记不修。
- **minor-3:** locateClangDriver 负缓存 + windowsSdk 日志丢失:(a) `--version` 瞬时失败(如超时)会缓存 null 直至 invalidate——当前类视图无生产消费方,影响面为零;(b) 旧链路"using clangdPath from config" info 与"clangdPath from config not found" warn 两条日志在新链路丢失。登记不修。

### AI 代码套路清单(S1-S8)扫描结果

**已对照 8 条,未命中。** 逐条:S1 无硬编码假数据(两处消费链数据均真实到 fs/子进程,locator 测试的注入 IO 仅测试内);S2 不适用(无端点)且 proxyManager/windowsSdk 接线真实(diff 可见);S3 无设计外吞错误(whereClangd/readInstalledDir 的 catch 为候选级可选语义,文档化);S4 不适用(契约面空);S5/S8 不适用(无 schema);S6 测试断言行为结果(返回值、IO 次数、候选顺序)而非 mock 调用;S7 `grep -E "TODO|FIXME|placeholder|lorem|临时|示例数据"` 于 diff 新增行零命中(亲测 exit=1)。

---

## 结论三:代码库一致性 —— 通过(3 minor,其中 2 条已在上文登记)

- **命名/Logger 前缀:** `[clangdLocator]`/`[proxyManager]`/`[windowsSdk]` 与周边一致;`[add-003]`/`[add-003 / D8]` 标注惯例与既有 `[Phase 8]`/`[P1-2]` 风格吻合 ✓
- **注释语言与密度:** 中文头注释 + 设计原则段,与 windowsSdk.ts/proxyManager.ts 既有风格一致;迁移处均留"原 X 已迁移/删除"墓碑注释 ✓
- **测试风格:** Given/When/Then 三段式与存量 resolver/proxyManager 测试一致 ✓
- **import 纪律:** clangd/index.ts 未动(vscode type-only 保持);配置监听内聚 proxyManager(其本就 `import * as vscode`)✓
- **C1 决策(短探测不接 SubprocessRegistry):** clangdLocator.ts:22-23 头注释显式声明"await + close 短探测,不接 registry",与 windowsSdk.ts 头注释决策一致 ✓
- **minor-4(一致性):** `invalidateLocator()`(proxyManager.ts:191-196)全仓零调用方,是死公共方法;且其 jsdoc 称"装配处(clangd/index.ts)在配置变更时调用"与事实(构造器内联挂监听)矛盾。建议:删方法或改为如实注释(可与 CRITICAL-1 修复同批顺手处理)。
- **minor-5(一致性):** fill-report 与 D8 表述 locateClangDriver"供 windowsSdk",实际 windowsSdk 走 `findClangdShared`+`locateClangDriverFrom` 无状态组合,类视图 `locateClangDriver()` 无生产消费方(仅测试)。语义等价、非缺陷,但"两个视图"的消费接线与文档表述有偏差,待 diagnoseProject 接入时收敛。登记不修。

---

## 裁定

**verdict: criticals_found**(1 critical / 0 major / 5 minor)

| 级别 | 数量 | 编号 |
|------|------|------|
| critical | 1 | CRITICAL-1 override 失效缺口(reapply/enable 读 stale) |
| major | 0 | — |
| minor | 5 | minor-1 timeout 无测试锁定;minor-2 rejected promise 缓存;minor-3 负缓存+日志丢失;minor-4 死方法+过时注释;minor-5 类视图消费接线与文档偏差 |

**处置建议:**

- **CRITICAL-1:当场修**(一行监听条件 + 一个失效测试用例),修后仅需复审 proxyManager 失效路径与新增测试,无需全量重审;
- minor-1/minor-4:可随 CRITICAL-1 同批低成本顺手处理;
- minor-2/minor-3/minor-5:登记不修,留待 diagnoseProject 接入 locator 时统一收敛。

**其余结论:** 契约/范围合规通过(无越界、验收 8 条逐条有据);正确性除 CRITICAL-1 外缓存语义、launcher 排除、windowsSdk 等价性均核查通过;一致性整体良好。

---

# 复审 Round 2(2026-10-03,范围:5be8301,仅 proxyManager 失效路径)

## 复审范围与 diff 覆盖核验

提交 5be8301 共 4 文件:本报告入库 + proxyManager.ts(监听条件+注释/-13)+ 2 个测试文件。**无越界文件**(src 代码仅 proxyManager.ts 一处触及,恰为指定范围)。

| 上轮 finding | 处置声明 | 核验结果 | 证据 |
|--------------|----------|----------|------|
| CRITICAL-1 override 失效缺口 | 监听补第三键 | **已解决** | proxyManager.ts:113-119 条件新增 e.affectsConfiguration("vscodeUEHelper.clangdProxy.realClangdPath"),键名与 config.ts:219 clangdProxy.realClangdPath 一致(节 vscodeUEHelper);注释同步登记回归原因 |
| minor-4 死方法 + 过时注释 | 删除 | **已解决** | invalidateLocator() 整体删除(diff -13 行段);上轮已证全仓零调用方,typecheck 0 错误佐证无残留引用 |
| minor-1 timeout 无锁定 | 补测试 | **已解决** | clangdLocator.test.ts makeIo 记录 opts.timeout,新用例断言 execFileTimeouts === [5_000, 5_000](where + --version 两个调用点),实现值漂移将被捕获 |

## 修复质量与回归探测

- **回归钉成立性:** proxyManager.test.ts 新用例捕获构造器真实注册的 onDidChangeConfiguration 监听,注入 mock locator,三键逐一 fire 断言 invalidate 各被调用 1 次,并含反向断言(无关键 → 不触发)。被测对象即"监听→invalidate"接线本身,非空测 mock,不属 S6。通过
- **新引入问题扫描:** proxyManager 逻辑改动仅一行条件 + 注释 + 删方法;this.locator getter(注入/内部构造两态)不变;launcher 排除、notFound 阻断、enable/disable 钩子均未触及。无新问题。
- **测试卫生备注(不立级):** 新用例的 vi.spyOn(onDidChangeConfiguration).mockImplementation 未显式恢复,vitest 配置无全局 restoreMocks、文件无 afterEach。当前泄漏窗口为零(用例位于文件末尾、vitest 跨文件环境隔离、全量绿佐证);若未来在该 describe 之后追加依赖真实配置监听的用例需注意恢复。与仓库既有测试惯例一致(全仓本无 restoreMocks),不改。
- **DoneClaim 探测:** 工作区干净(HEAD = 5be8301);亲测 locator 13 + proxyManager 13 = 26/26 绿,与声明"定向 26/26"一致;全量 1349 = 1347 + 2 新用例,对账吻合,未重跑(非 stale)。

## Round 2 裁定

**verdict: approved**(0 critical / 0 major / 0 new minor;1 条不立级测试卫生备注)

CRITICAL-1 已解决,minor-1/4 已解决,minor-2/3/5 维持上轮"登记不修"处置。add-003 三结论最终状态:

1. 契约/范围合规 —— 通过(round 1 结论不变)
2. 正确性 —— 通过(CRITICAL-1 修复有回归钉锁定)
3. 代码库一致性 —— 通过(minor-4 已清;minor-5 维持登记)
