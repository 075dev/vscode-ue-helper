# Codebase Concerns

**Analysis Date:** 2026-07-23
**Project:** VSCodeUEHelper (VS Code extension, Windows-only, UE 5.2+ C++)
**Repo:** `D:/AIWorkSpace/VScodePlugin/VSCodeUEHelper`
**Source:** AGENTS.md (13 仓库陷阱) + AUDIT-REPORT.md (43 findings) + REMEDIATION-PLAN.md (32 tasks, 部分已落地)

> **重要现实校准**:审计报告标注为 **2026-07-16**,REMEDIATION-PLAN 中 T1.1/T1.2/T2.1/T2.6/T4.7 等 P0/P1 任务在 2026-07-23 已落地(查证:`test:integration` 已从 `package.json` 删,`.bak` 已 gitignore,`Config.completionMode` getter 简化为 `return 'slow'`,`commands/index.ts:100` 改用动态计数,MSVC 正则同步)。本表区分 **"原始 concern"**(审计/AGENTS 标记)与 **"当前实际状态"**(2026-07-23)。

---

## Tech Debt

**`Config.completionMode` 死分支 + API 表面未收口:**
- Issue: `src/core/config.ts:137-139` getter 硬返回 `'slow'` 字面量,但类型签名仍是 `'slow'` 单成员;`@core/...` 大量 caller 仍读 `config.completionMode` 判断分支;`package.json` 设置已删(审计 H4-B 决策)。
- Why: Phase 8 决定 fast/slow 合并为 slow,只改了 getter 没改 UI/日志。
- Impact: 任何基于 `config.completionMode === 'fast'` 的新代码都是死分支 bug 风险;TS 已不可能误用,但 ESLint/CodeQL 看到读取点会误判。
- Fix approach: 完成 T2.1 + T2.7,把 `Config.completionMode` 整个 getter 删除(`src/ui/controlPanel.ts` / `src/commands/createProject.ts` / `src/commands/showProjectInfo.ts` 改读静态常量);或者继续保留 getter + 注释严禁条件分支。
- Current state(2026-07-23): getter 已简化,但 caller 仍在读。**半解决**。

**`src/clangd/compileCommands.ts` 1002 行 god 文件:**
- Issue: 单文件承担 UBT -ProjectFiles 执行、缓存层、fallback 路径、symlink、vscode.tasks 集成 5+ 职责。
- Why: 早期快速实现,未按职责拆分。
- Impact: 单元测试覆盖率低(仅 1 个测试文件);任何小改动可能影响不相关功能;新贡献者 onboarding 成本高。
- Fix approach: T4.5 拆分为 `compileCommands/{task,cache,symlink,fingerprint}.ts` 4 个子模块,公共 API 保持不变。

**`src/build/{application,infrastructure}/` DDD 空壳:**
- Issue: `src/build/application/index.ts` 与 `infrastructure/index.ts` 各只有 2 行注释占位;实际业务代码全在 `src/build/` 顶层。
- Why: 命名早期想用 DDD 三层结构,实际未实施。
- Impact: 外部代码 `import { runBuild } from '@build'` 跳过 application/infrastructure;AGENTS.md 撒谎误导新人把"handler"放错地方。
- Fix approach: T3.3 选项 A(最小,推荐):删 2 个空目录 + AGENTS.md 改"分层规划中"。

**6 个汉化 TODO 僵尸承诺:**
- Issue: `src/clangd/proxy/localization.ts:79/91/103` + `src/clangd/proxy/bridge.ts:676/685/694` 6 处函数体直接 `return item;` / `return msg;`,注释写"后续实现"。
- Why: Phase 早期规划 hover 词典汉化,6 个扩展 LSP 响应类型(Completion/SignatureHelp/InlayHint)未排期。
- Impact: 控制面板默认开启汉化 → hover 在 UE 类型上**部分失效**,用户投诉"Hover 没汉化"会成为预期内 bug;新贡献者看到 TODO 以为是"接龙任务"会浪费时间。
- Fix approach: T5.1 选项 A(推荐,2h):删 panel UI 汉化 toggle + AGENTS.md 改"目前仅 hover 词典生效";选项 B(2-3 天):填充 6 个 TODO。
- Deadline: **未排期**。

**`resources/README.md` 描述过时:**
- Issue: 仍提到已删除的 `ue5-fast.json`(第 8 行)、`banner.png`(第 9 行未提但 icon.png 标 `(TODO)` 128×128 marketplace icon)。
- Why: Phase 7 删 `ue5-fast.json` 后,README 未同步。
- Impact: 新人按 README 找 `ue5-fast.json` → 文件不存在 → 困惑;icon TODO 与实际 icon 占位符状态不一致。
- Fix approach: 重写 resources/README.md(与 T3.4 README 重写合并,各 5 min 工时)。

**MSVC 错误正则双源不再"必须同步"但 AGENTS.md 仍声明:**
- Issue: 审计 M4 指出两份正则有差异(`(.*)` vs `(.*?)`、`\s+` vs `\s*`)。T4.7 已同步(`package.json:444` 现在是 `^(.*?)\\((\\d+)(?:,(\\d+))?\\)\\s*:\\s*(error|warning|note|fatal error)\\s+([A-Z]+\\d+)\\s*:\\s*(.*)$` 与 `src/parsers/msvcParser.ts:19` 字面一致)。
- Why: 历史问题,VS Code `problemMatchers` 只对 Task 系统输出生效,本插件不自动 task 消费,`package.json` 那份**永远不会被读到**。
- Impact: AGENTS.md 仓库陷阱 #7 仍说"改一处要同步另一处",但实际只剩一份生效;新贡献者会浪费时间同步两份(其中一份是死代码)。
- Fix approach: T3.5 之后追加 AGENTS.md 修订:"实际生效的是 msvcParser.ts,package.json#problemMatchers 仅作 Task 用户手工配置参考"。
- Current state(2026-07-23): 正则已同步,但 AGENTS.md 注释未跟进。

**`src/core/workspace.ts` 307 行 / `src/core/config.ts` 317 行 / `src/ui/controlPanel.html.ts` 615 行 / `src/clangd/proxy/bridge.ts` 692 行 — 4 个 god 文件未拆分:**
- Issue: 审计 M10 + T5.3 标记,单文件最大接近 700 行。
- Why: 历史累积,未按职责拆分。
- Impact: 测试覆盖难;改动容易越界;新人阅读成本高。
- Fix approach: T5.3 (8-10h),按职责拆 2-3 个子文件,公共 API 保持。

**`populateAddCompletions` 撒谎兼容层已删除(✅ Phase 9 已解决):**
- Issue: 历史函数 `populateAddCompletions` 调 `createCompletionFiles` 生成文件但返回 `{added:0, skipped:0, found:0}` 全 0 stats。
- Current state: Phase 9 SSoT 收尾,`grep populateAddCompletions src/` 零匹配;13 个 `test/unit/core/ssot.test.ts` 回归守卫防复活。
- Why here: AGENTS.md 仓库陷阱 #12 仅作历史档案保留,新代码**不要复活**该函数;新代码直接调 `createCompletionFiles()`。

**`src/clangd/compileCommands.ts` symlink 工作区根路径 → 可能含用户代码路径泄漏到 `.vsix`:**
- Issue: `linkToWorkspaceRoot` 把 compile_commands.json symlink 到 workspace 根,内容包含绝对路径(项目源码位置)。
- Why: clangd 要求 compile_commands.json 在 source root 旁。
- Impact: 打包 `.vsix` 时 `.vscodeignore` 已排除 compile_commands.json(运行时生成),但用户本地磁盘上的 symlink 始终指向包含用户路径的文件 → 安全审计敏感(见"安全"段)。
- Fix approach: 不变(此为设计选择),但需要在 AGENTS.md 加注"发布前 `npm run package` 不应包含 compile_commands.json"。

**`Config.update` 写后读取陷阱 — 已部分缓解但仍存在认知误区:**
- Issue: `src/core/config.ts:269-298` `update()` 内部已经调 `this.refreshRoot()` 写入后立即读 `inspect` 调试。
- Why: VS Code 同进程内 `WorkspaceConfiguration` 实例不主动通知失效,`refreshRoot()` 是手动绕开。
- Impact: AGENTS.md 仓库陷阱 #10 仍声明"必须 refresh",实际 refresh 已内置 — 但**调用方常见误用**(跨实例引用,如把 `config` 传给 callback 闭包)仍会读到旧值。
- Fix approach: 更新 AGENTS.md 第 10 条措辞:"`Config.update` 内部已 refresh;**但**如果跨实例/跨闭包缓存 `config` 引用,读到的仍是旧值"。

---

## Known Bugs

**汉化功能开启但部分失效(用户可见 bug):**
- Symptoms: 控制面板汉化 toggle 开启后,hover 在大多数 UE 类型上是英文(hover 词典生效);但 Completion 弹窗、Signature Help tooltip、Inlay Hint 行内提示**完全不汉化**(因为 TODO 函数 `return item;` / `return msg;` 原样返回)。
- Trigger: 任意 `.h/.cpp` 文件 hover、输入 `.` 触发 completion。
- Workaround: 关闭汉化 toggle(但 UX 体验仍不一致)。
- Root cause: 6 个 LSP 响应本地化函数未实现。
- Files: `src/clangd/proxy/localization.ts:84-110`, `src/clangd/proxy/bridge.ts:689-700`。
- Blocked by: T5.1 决策(选项 A 删 toggle / 选项 B 实现)。

**MSVC 诊断行号偏差(架构性):**
- Symptoms: Problems 面板点击跳转,行号偶有 ±1 偏移。
- Trigger: MSVC 报告 1-based,VS Code 0-based;解析器已减 1,但 UBT 输出 `[N/M]` 上下文行混在一起时偶尔失败。
- Workaround: 无。
- Root cause: `src/parsers/msvcParser.ts:19` 正则未对 `[N/M]` 上下文行做剥离。
- Files: `src/parsers/msvcParser.ts:18-23`。
- Severity: 低频(实测 P2)。

**`Config.update` 跨实例读取 bug(理论存在,未实测):**
- Symptoms: 模块 A 写入配置,模块 B 通过 `getConfig()` 拿到新 Config 实例,立即读到旧值。
- Trigger: 异步 callback 链:`moduleA.update() → 后续 moduleB.read()` 中间无 await 或 moduleB 缓存了 moduleA 的 config 引用。
- Workaround: 写后显式 `await` + 调用方获取新 `Config` 实例。
- Root cause: `refreshRoot()` 只刷新内部 `this.root`,不影响外部已缓存引用。
- Files: `src/core/config.ts:269-298`。

**`fileWatcher` 测试在没 mock chokidar 时挂死:**
- Symptoms: `npm run test:unit -- fileWatcher` 不结束或超时。
- Trigger: 新增 fileWatcher 测试但未在 `test/unit/setup.ts` 注册 chokidar mock。
- Workaround: 显式 `vi.mock('chokidar')`。
- Root cause: chokidar 启动真实 fs watcher 会保持进程存活。
- Files: `test/unit/setup.ts`(已 mock),`src/clangd/fileWatcher.ts`。
- Severity: 仅开发体验,不影响生产。

---

## Security Considerations

**`out/` 构建产物可能含用户代码绝对路径:**
- Risk: `out/clangdProxy.js` 经 esbuild 打包,虽然源码不嵌入,但 sourcemap 路径若生成在 `out/` 可能包含用户项目路径。
- Current mitigation: `.vscodeignore` 已排除 `*.map`;`npm run clean` 不清 `out/extension.js` + `out/clangdProxy.js`,但 `npm run build` 内部先 clean 再 bundle。
- Recommendations: 打包前确认 `out/` 内无 `*.map`(可在 `scripts/clean-out.mjs` 加 strict 检查)。
- Files: `.vscodeignore:1-13`, `scripts/clean-out.mjs`。

**MCP 服务器边界条件 — 不熟悉的人会以为 always-on:**
- Risk: `src/mcp/lifecycle.ts` 仅在检测到 `CURSOR_TRACE_ID` / `CURSOR_USER_DATA_DIR` / `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_SSE_PORT` 环境变量时启动 MCP;普通 VS Code 用户打开本扩展**MCP 是 no-op**,但贡献者写 MCP 相关代码时容易以为 always-on。
- Current mitigation: env var 检测在 `src/mcp/lifecycle.ts:21-22`。
- Recommendations: 新增 MCP 测试时 mock env var;AGENTS.md 仓库陷阱 #5 已记录。
- Files: `src/mcp/lifecycle.ts`, `src/commands/showProjectInfo.ts:15`。

**`ueDiagnosticWatcher` 拼接参数注入风险(P4 长期项):**
- Risk: `src/clangd/proxy/ueDiagnosticWatcher.ts:301-310` 拼接 `buildTargetName` / `projectFile` 直接传 UBT 调 UBT CLI,理论上特殊字符可注入命令行。
- Current mitigation: 无白名单校验。
- Recommendations: T5.2 任务(30 min)拼接前对 `buildTargetName` / `projectFile` 做白名单 `[\w./\\:-]` 校验或转义,恶意输入抛 `UBTArgsValidationError`。
- Severity: P4,因为 watcher 只读 UE 内部构建事件,不暴露外部输入。

**`package.json#repository.url` 占位符泄漏:**
- Risk: `package.json:9` 是 `https://github.com/YOUR_USERNAME/vscode-ue-helper.git` 占位符,发布到 marketplace 会暴露占位 URL。
- Current mitigation: 无。
- Recommendations: T4.9 (1 min) 替换为真实 GitHub URL。
- Severity: 低(发布前必改)。

---

## Performance Bottlenecks

**UE 项目首次索引耗时(用户关切):**
- Problem: 打开 UE 5.x 项目时 clangd 全量索引(数万头文件)耗时数分钟;UE5 头文件量大、宏爆炸、UHT 生成文件循环 include 严重。
- Measurement: 经验值 1-5 分钟(取决于机器),用户拒绝 Rider 是因为"打开项目时索引太慢、内存占用严重"。
- Cause: clangd 需解析所有 PCH/UHT 头;preparse-includes 配置虽然到位(`resources/preparse-includes/ue5-slow.json` 49 header list),但首次仍需全量扫描。
- Improvement path:
  1. ✅ 已采用:`.clangd` 中 `CompileFlags.Add` 配 `--preparse=...` 让 SharedPCH / addMacroCompletions.h 优先缓存(参考 `src/clangd/clangdOps.ts`)。
  2. ✅ Live Coding 5s 节流(`src/build/liveCoding.ts`),避免 UBT 抖动导致频繁 reindex。
  3. ✅ UHT 重生成走 proxy 端 `UeDiagnosticWatcher` 被动触发(`src/clangd/proxy/ueDiagnosticWatcher.ts`),而非主动 watcher — Phase 8 决策,避免不必要的触发。
  4. ⚠️ 待优化:`compileCommands.json` 缓存 fingerprint 命中率未实测,首次 cold start 仍是 P0 痛点。

**LSP 代理进程开销:**
- Problem: 双 esbuild 输出 `out/clangdProxy.js` 作为独立子进程,每次 LSP 请求都需经 stdio 代理。
- Measurement: `npm run perf:baseline` / `perf:after` / `perf:diff` 工具已就绪(`scripts/measure-proxy-overhead.mjs`),< 1% 偏差算通过。
- Cause: 代理层汉化、log 转发。
- Improvement path: `npm run perf:diff` 已 baseline;后续 PR 必跑。

**`src/core/workspace.ts` 全量备份 .code-workspace:**
- Problem: 启用 `autoBackupWorkspace`(默认 true)时,UBT 刷新触发备份整个 `.code-workspace` 文件。
- Cause: 防 UBT 覆盖保护。
- Improvement path: 实测开销低(单文件 IO),非瓶颈。

---

## Fragile Areas

**`src/clangd/proxy/bridge.ts` —— LSP 消息转发 + 汉化插桩:**
- Why fragile: 692 行单文件,Localize 多种 LSP 响应类型(hover/completion/signatureHelp/inlayHint/diagnostic)共享 clone 深拷贝路径,任何一个 LSP 消息格式变更都会触发回归;且汉化函数 `applyLocalizationToXxx` 6 个 TODO 直接 return(僵尸)。
- Common failures: LSP 版本升级(clangd 14 → 15+)字段名变更;新增消息类型未 hook。
- Safe modification: 新增 LSP 响应本地化函数时必须测:`test/unit/clangd/proxy/bridge.test.ts`;cloneResult 深拷贝逻辑谨慎改动。
- Test coverage: 有 bridge.test.ts 但 6 个 TODO 函数零覆盖。
- Files: `src/clangd/proxy/bridge.ts:600-700`。

**`src/core/config.ts` —— VS Code WorkspaceConfiguration 包装层:**
- Why fragile: `refreshRoot()` 手动绕开 VS Code 同进程失效通知;依赖 `inspect()` 多级 fallback(`workspaceFolderValue ?? workspaceValue ?? globalValue ?? defaultValue`);跨实例引用语义不直观。
- Common failures: 多 folder / 无 focus 文件夹 / 受限 workspace 时 `update` 静默失败(代码已有 debug log 但易忽略)。
- Safe modification: 改 update 路径必须测 `test/unit/core/config.test.ts`;改 refreshRoot 必须考虑外部缓存。
- Test coverage: `test/unit/core/config.test.ts`(完整)。
- Files: `src/core/config.ts:269-319`。

**`src/clangd/compileCommands.ts` —— 1002 行 god 文件(详见 Tech Debt):**
- Why fragile: 5+ 职责耦合;UBT 进程 fork + 缓存 + symlink + vscode.tasks 集成。
- Common failures: UBT 进程超时未 kill、symlink 在 Windows 上权限问题、缓存 fingerprint 失效。
- Safe modification: T4.5 拆分后,**先**建子模块测试,**后**迁移逻辑。
- Test coverage: 1 个测试文件,覆盖率偏低。

**`src/build/liveCoding.ts` —— Live Coding 热重载 5s 节流:**
- Why fragile: 节流窗口与 UBT 重生成节奏强耦合;Phase 8 改为 proxy 端被动触发(`UeDiagnosticWatcher`),若 watcher 漏事件则 Live Coding 错过。
- Common failures: 节流窗口过短导致频繁 reindex、过长导致用户感知延迟。
- Safe modification: 改节流参数必跑性能测试 + 真实 UE 项目验证。
- Files: `src/build/liveCoding.ts`。

**`src/mcp/lifecycle.ts` —— MCP 服务器 env var 边界:**
- Why fragile: 依赖 4 个 env var(`CURSOR_TRACE_ID` / `CURSOR_USER_DATA_DIR` / `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_SSE_PORT`)任一存在即启动;新增 env var 时易漏。
- Common failures: 用户在 Cursor 之外的环境(Cline/Aider/Windsurf)也想用 MCP,但未识别。
- Safe modification: T4.3 把 `detectHost` 抽到 `@core/runtime-detect` 集中管理。
- Test coverage: 缺失(T5.4 待补)。

**`src/clangd/diagnostics/io.ts:54/91` —— YAML/JSON 解析 `as unknown` 强转:**
- Why fragile: `yaml.parse(text) as unknown` / `JSON.parse(text) as unknown` 无 schema 校验;若 `.clangd` 损坏或外部篡改,后续 `result.xxx` 会运行时崩溃。
- Common failures: 用户手编 `.clangd` 格式错误 → 启动崩溃。
- Safe modification: T4.8 用 zod 或 io-ts 做 schema 校验。
- Files: `src/clangd/diagnostics/io.ts:54, 91`。

---

## Scaling Limits

**UE 项目 header 数量上限:**
- Current capacity: UE 5.x 中型项目 ~5,000 headers,大型项目(AAA) ~50,000 headers。
- Limit: clangd index 单进程内存 ~2-4 GB(默认 rlimit);超过后 OOM 退出。
- Symptoms at limit: clangd 进程消失、status bar 红 X、`Diagnose Clangd Project` 报内存超限。
- Scaling path: `.clangd` 中调 `--limit-results` / `--query-driver` 缩减索引面;preparse-includes 头文件最小化(49 → 30)。

**测试套件执行时间:**
- Current capacity: 71 测试文件(~12k 行测试代码),`npm run test:unit` 实测 ~30s(vitest 并行)。
- Limit: v8 coverage 阈值 80/80/75/80 强制,加 coverage 后 ~60s。
- Symptoms at limit: CI 慢但仍可接受。
- Scaling path: 分层跑 test:unit -- shard;非 CI 路径可跳过 coverage。

**`out/` 构建体积:**
- Current capacity: 实际 `.vsix` 体积 ~350 KB(从 `vscode-ue-helper-0.1.0.vsix` 实测)。
- Limit: VS Code marketplace 单包 < 25 MB 限制;目前远低。
- Scaling path: 审计 M3 指出 `execa/neverthrow/xstate` 三个未使用 runtime 依赖可卸载,预计 .vsix 减小 100-200KB;但 T2.2 在 remediation plan 中标 5 min,**实际未执行**(2026-07-23 查 `package.json` 仍含 6 个 runtime 依赖)。

---

## Dependencies at Risk

**`execa / neverthrow / xstate` 三个 0 引用 runtime 依赖:**
- Risk: 仓库白带 ~150MB node_modules;安全审计面增加;`package.json` 声明未使用违反 hygiene。
- Impact: 仓库体积膨胀,CI 慢。
- Migration plan: T2.2 (5 min) `npm uninstall execa neverthrow xstate` + 验证 `grep -RE 'from ["'\''](execa|neverthrow|xstate)' src/` 零匹配。
- Current state(2026-07-23): **未执行**,`package.json` 仍含 6 个 runtime 依赖。

**`@modelcontextprotocol/sdk`:**
- Risk: MCP SDK 1.x → 2.x API breaking(协议在演进)。
- Impact: 6 个 MCP tool handler 全部失效。
- Migration plan: 关注 SDK release notes;6 个 tool handler 集中在 `src/mcp/`,可一次性迁移。

**`chokidar`:**
- Risk: chokidar 3 → 4 计划中(API 较稳定)。
- Impact: `src/clangd/fileWatcher.ts` / `generatedHeaderWatcher.ts` / `ueDiagnosticWatcher.ts` 3 处使用。
- Migration plan: 升级时跑 `npm run test:unit` 验证;vitest setup.ts mock 需同步。

**`vscode` engine 兼容:**
- Risk: `engines.vscode` 锁定 `^1.85.0`(2024 初);VS Code 新版 LSP API 变更可能引入 deprecation warning。
- Impact: 启动时控制台 warning,功能不受影响。
- Migration plan: 跟 VS Code 月度 release;`@types/vscode` 同步升级。

---

## Missing Critical Features

**汉化深度(仅 hover 词典生效):**
- Problem: Completion / SignatureHelp / InlayHint 三类 LSP 响应未汉化;用户开启汉化后体验不一致。
- Current workaround: 用户关闭汉化 toggle。
- Blocks: 中文用户群体的完整体验。
- Implementation complexity: T5.1 选项 A(2h 删 toggle)/ 选项 B(2-3 天真实现)。
- Status: **未排期**。

**e2e 测试覆盖(extension 激活流程):**
- Problem: 仅单元测试(71 文件),无 `@vscode/test-electron` 端到端测试;激活流程、UI 状态栏按钮渲染未验证。
- Current workaround: 手动 F5 启动。
- Blocks: 重构信心;`WorkspaceState` / `ClangdOps` 大改无回归保护。
- Implementation complexity: T5.5 (4h) `test/e2e/extension.test.ts`。
- Status: **未排期**。

**MCP 测试覆盖:**
- Problem: 6 个 tool handler + detectHost 边界条件无测试。
- Current workaround: 手动在 Cursor/Claude Code 中验证。
- Blocks: MCP 协议演进时无回归保护。
- Implementation complexity: T5.4 (3-4h) 新建 `test/unit/mcp/{tools,lifecycle,index}.test.ts`。
- Status: **未排期**。

**marketplace 128×128 图标:**
- Problem: `resources/icon.png` 67 字节占位符;插件市场展示空白图标。
- Current workaround: 用户必须靠扩展名识别。
- Blocks: 第一印象 / 商店评分。
- Implementation complexity: T1.3 (20 min) ImageMagick 或 Photoshop 生成。
- Current state(2026-07-23): icon 仍为 67 字节,**未执行** T1.3。

---

## Test Coverage Gaps

**`src/mcp/` 模块(0 覆盖):**
- What's not tested: 6 个 MCP tool handler + `detectHost` 边界(env var 4 种组合)+ MCP server 生命周期。
- Risk: 协议演进或 refactor 时无回归保护。
- Priority: High(MCP 是用户可见功能)。
- Difficulty: 需要 mock `@modelcontextprotocol/sdk` 的 transport 层。

**`src/clangd/proxy/bridge.ts` 6 个 TODO 函数(0 覆盖):**
- What's not tested: `localizeCompletionResult` / `localizeSignatureHelpResult` / `localizeInlayHintResult` / `applyLocalizationToCompletion` / `applyLocalizationToSignatureHelp` / `applyLocalizationToInlayHint`。
- Risk: 因为永远 return 原值,测试也"通过",掩盖汉化功能缺失。
- Priority: Medium(配合 T5.1 选项 A 删函数即可消除)。
- Difficulty: 若选项 B 实现,需要构造 LSP mock 响应。

**`src/clangd/compileCommands.ts` god 文件:**
- What's not tested: 1002 行中只有 1 个测试文件覆盖部分路径;UBT fork、symlink、cache fingerprint 边界未覆盖。
- Risk: 拆分(T4.5)前每次改动都需手动 F5 验证。
- Priority: Medium。
- Difficulty: 拆分后子模块独立测试。

**e2e 流程(0 覆盖):**
- What's not tested: `src/extension.ts` activate 顺序、UI 状态栏按钮渲染、DetctionHandles ready Promise 竞态。
- Risk: 重构激活顺序无回归保护。
- Priority: Medium。
- Difficulty: T5.5 用 `@vscode/test-electron` 4h 投入。

**`src/build/{application,infrastructure}/` 空壳:**
- What's not tested: 空目录,无测试需求。
- Why here: T3.3 决策点;若选 A(删空壳),无需测试;若选 B(真迁移),需要按 DDD 层补测试。

---

## 严重度总览(2026-07-23 当前)

| 严重度 | 状态 | 项目 | 来源 |
|--------|------|------|------|
| 🔴 P0 CRITICAL | ✅ 已解决 | `npm test` 跑坏(原 C1) | T1.1 (package.json test 改 unit-only) |
| 🟠 P1 HIGH | ✅ 已解决 | `.bak` 跟踪但未 ignore | T1.2 |
| 🟠 P1 HIGH | ✅ 已解决 | `Config.completionMode` getter 三目同值 | T2.1 |
| 🟠 P1 HIGH | ✅ 已解决 | `commands/index.ts:100` 撒谎 20 | T2.6 |
| 🟠 P1 HIGH | ✅ 已解决 | MSVC 正则双源不严格同步 | T4.7 |
| 🟡 P2 MEDIUM | ⚠️ 半解决 | i18n 大面积绕过(47 处) | T4.1 (4h, 未排期) |
| 🟡 P2 MEDIUM | ⚠️ 未解决 | 6 个汉化 TODO 僵尸 | T5.1 (未排期) |
| 🟡 P2 MEDIUM | ⚠️ 未解决 | 3 个 0 引用 runtime 依赖 | T2.2 (未执行) |
| 🟡 P2 MEDIUM | ⚠️ 未解决 | icon.png 67 字节占位 | T1.3 (未执行) |
| 🟡 P2 MEDIUM | ⚠️ 未解决 | 跨层引用 5 处 | T4.2/T4.3/T4.4 (部分执行) |
| 🟢 P3 LOW | ⚠️ 文档滞后 | AGENTS.md 仓库陷阱 #1/#7/#10/#11 措辞与现状脱节 | 文档同步 |
| 🟢 P3 LOW | ⚠️ 未解决 | README.md 17KB 整体过时 | T3.4 (未执行) |
| 🟢 P3 LOW | ⚠️ 未解决 | ESLint 105 warnings(test/ 占 78 个 `!` 断言) | 分批消除 |
| 🔵 P4 LONG | ⚠️ 未排期 | god 文件拆分 | T5.3 |
| 🔵 P4 LONG | ⚠️ 未排期 | MCP / e2e 测试 | T5.4 / T5.5 |
| 🔵 P4 LONG | ⚠️ 未排期 | ueDiagnosticWatcher 白名单校验 | T5.2 |

---

## 待办 / 已排期(全量)

| Task | 工时 | 来源 | 状态(2026-07-23) |
|------|------|------|-------------------|
| T1.1 删 test:integration | 5 min | REMEDIATION-PLAN | ✅ 已完成 |
| T1.2 .bak gitignore | 5 min | REMEDIATION-PLAN | ✅ 已完成 |
| T1.3 icon.png 128×128 | 20 min | REMEDIATION-PLAN | ⚠️ 未执行(67 字节仍占位) |
| T1.4 proxyManager.test.ts:216 lint | 5 min | REMEDIATION-PLAN | ⚠️ 未实测 |
| T2.1 completionMode getter 简化 | 10 min | REMEDIATION-PLAN | ✅ 已完成 |
| T2.2 卸载 3 个 0 引用依赖 | 5 min | REMEDIATION-PLAN | ⚠️ 未执行 |
| T2.3 删 2 个 @deprecated | 5 min | REMEDIATION-PLAN | ⚠️ 未实测 |
| T2.4 删 3 个 headerWatcher i18n key | 5 min | REMEDIATION-PLAN | ⚠️ 未实测 |
| T2.5 删 3 个死别名 | 15 min | REMEDIATION-PLAN | ⚠️ 未实测 |
| T2.6 commands 日志动态计数 | 10 min | REMEDIATION-PLAN | ✅ 已完成 |
| T2.7 WorkspaceState 实现 Disposable | 30 min | REMEDIATION-PLAN | ⚠️ 未实测 |
| T3.1 19 命令数文档同步 | 45 min | REMEDIATION-PLAN | ⚠️ 未执行 |
| T3.2 Config.update 文档示例 | 5 min | REMEDIATION-PLAN | ⚠️ 未实测 |
| T3.3 删 DDD 空壳 | 20 min | REMEDIATION-PLAN | ⚠️ 未执行 |
| T3.4 重写 README.md | 60 min | REMEDIATION-PLAN | ⚠️ 未执行(17KB 文档过时) |
| T4.1 47 处 i18n 迁移 | 4h | REMEDIATION-PLAN | ⚠️ 未执行 |
| T4.2 ParsedDiagnostic 抽 core | 1h | REMEDIATION-PLAN | ⚠️ 未实测 |
| T4.3 detectHost 抽 core | 30 min | REMEDIATION-PLAN | ⚠️ 未实测 |
| T4.4 workspace 相对路径改别名 | 5 min | REMEDIATION-PLAN | ⚠️ 未实测 |
| T4.5 compileCommands 拆分 | 4-6h | REMEDIATION-PLAN | ⚠️ 未执行 |
| T4.6 populateAddCompletions 迁移 | 30 min | REMEDIATION-PLAN | ✅ 已完成(Phase 9) |
| T4.7 MSVC 正则同步 | 10 min | REMEDIATION-PLAN | ✅ 已完成 |
| T4.8 消除剩余 `as unknown` 3 处 | 1.5h | REMEDIATION-PLAN | ⚠️ 部分完成(T2.7 关联) |
| T4.9 repository.url 占位符 | 1 min | REMEDIATION-PLAN | ⚠️ 未执行 |
| T5.1 6 个汉化 TODO 决策 | 2h(A) / 2-3 天(B) | REMEDIATION-PLAN | ⚠️ 未排期 |
| T5.2 ueDiagnosticWatcher 白名单 | 30 min | REMEDIATION-PLAN | ⚠️ 未排期 |
| T5.3 拆 4 个 god 文件 | 8-10h | REMEDIATION-PLAN | ⚠️ 未排期 |
| T5.4 MCP 测试 | 3-4h | REMEDIATION-PLAN | ⚠️ 未排期 |
| T5.5 e2e extension | 4h | REMEDIATION-PLAN | ⚠️ 未排期 |
| T6.1 全量回归 QA | 1h | REMEDIATION-PLAN | ⚠️ 待所有 wave 完成 |

---

*Concerns audit: 2026-07-23*
*基于 AGENTS.md (2026-07-23 last-modified) + AUDIT-REPORT.md (2026-07-16, 43 findings) + REMEDIATION-PLAN.md (2026-07-16, 32 tasks) + 实测 grep/git 检查*
*Update as issues are fixed or new ones discovered*
