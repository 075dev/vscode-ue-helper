# VSCodeUEHelper 项目系统性审阅报告

> 审阅日期:2026-08-11
> 审阅方式:Ralph 循环 + 7 个并行模块审阅 agent + 主 agent 一手深度审阅
> 审阅范围:`src/` 全部 144 个 TS 文件(约 23.4k 行)、`test/unit/` 82 个测试文件(约 19.9k 行)、`package.json`、根 AGENTS.md 与 9 个模块 AGENTS.md、`doc/` 与 `docs/` 全部文档
> 证据要求:每条发现均带 `文件:行号` 证据,关键发现经交叉验证(阅读源码确认或 node 实测复现)

---

## 1. 审阅范围与方法

| 维度 | 覆盖 |
| --- | --- |
| 架构层 | `extension.ts` 入口、激活顺序、模块依赖方向、SSoT 收敛度、deactivate 生命周期、子进程清理链 |
| core | Logger / Config / WorkspaceState / SubprocessRegistry / command-registry / result / errors |
| detection | uprojectScanner / engineDiscovery / vsBuildTools / workspaceContext / workspaceFolders |
| build | ubt / buildRunner / taskProvider / liveCoding / launchEditor / domain/ |
| clangd | 全部 56 个文件(compileCommands、proxy、completionFiles、uhtGeneration、ueLinkManager、windowsSdk 等) |
| commands+ui | 22 个命令处理器、statusBar、controlPanel、projectExplorer、quickPicks |
| parsers/mcp/i18n/rules | 4 个 parser、MCP server/tools/lifecycle、双语 locale(223 key)、rules 生成器 |
| 测试质量 | 82 个测试文件抽样 + 覆盖率配置 + mock 质量 + 关键路径缺测 |
| 文档一致性 | 14 条仓库陷阱、数量声明、模块职责表 vs 实际代码 |

验证方式:源码精读 + `node` 实测复现(正则/占位符/引号剥离)+ grep 全仓库交叉验证 + `npm run typecheck / lint / test:unit` 真实执行。

---

## 2. 基线验证结果(US-001)

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | ❌ **14 个错误**(真实退出码 2) | 12 个在测试文件 + 2 个在 `scripts/extract-ue-docs.ts` |
| `npm run lint` | ❌ **33 errors + 141 warnings**(退出码 1) | 含 no-floating-promises ×3、await-thenable ×7、unbound-method 若干、no-unsafe-member-access ×4 |
| `npm run test:unit` | ✅ 82 文件 / 1020 测试全过 | 8.0s |
| `npm run build` | 未单独重跑(clean+bundle 基线) | — |

**结论:基线不健康。** 文档宣称的"typecheck 必须零错误"门禁当前长期红灯。lint 的 33 个 error 中,`await-thenable`(await 非 Promise 值)类错误通常对应真实逻辑缺陷,值得逐条排查。

> 注:首次执行用 `| tail` 管道误读了退出码(取到 tail 的 0),重跑确认真实退出码后才确定基线结论。审阅文档以此为准。

---

## 3. 严重问题(错误级,确定的功能缺陷 / 崩溃 / 资源泄漏 / 安全)

### E1. clangd 代理本地化:反引号标识符保护损坏,原文丢失 + NUL 控制字符泄漏【已 node 复现】

- 文件:`src/clangd/proxy/genericTranslator.ts:366-369`
- 问题:
  ```ts
  result = result.replace(/`([^`]+)`/g, (_m, _id) => {
    identifiers.push(`\x00ID${identifiers.length}\x00`);   // ← 压入占位符自身,丢弃捕获的 _id
    return `\x00ID${identifiers.length - 1}\x00`;
  });
  ```
  与上方 `\x00` 保护分支(:361-364)和下方单引号分支(:371-374,正确 `push('${cap}')`)对比,反引号分支把占位符 token 压入 `identifiers` 而非捕获内容。
- 实测:`use of undeclared identifier \`Foo\`; did you mean \`Bar\`?` → 输出 `use of undeclared identifier \u0000ID0\u0000; did you mean \u0000ID1\u0000?`。经 `localization.ts:38/49` 作用于**所有 clangd 诊断消息与 CodeAction title**。
- 影响:含反引号的诊断在 Problems 面板原文丢失 + 不可见控制字符;后续句式匹配基于被污染文本。
- 修复:`identifiers.push(\`\`${_id}\`\`)`(与单引号分支同构),补反引号/混合场景单测。

### E2. buildRunner 用 `cmd.exe /c` 包装 .bat,路径含空格时引号被剥,构建必然失败

- 文件:`src/build/buildRunner.ts:69-71`(参数由 `src/commands/build.ts:62-68` 传入)
- 问题:Node 自动给含空格参数加双引号后,实际命令形如 `cmd.exe /c "D:\UE 5.5\...\Build.bat" "-Project=D:\My Games\Proj.uproject" ...`。cmd.exe `/c` 的引号规则:超过 2 个引号时进入"老行为",**剥离行首引号并删行尾引号** → cmd 尝试执行 `D:\UE`,报"不是内部或外部命令"。
- 影响:**引擎与项目路径同时含空格**(UE 项目最常见布局:引擎装在 Program Files、项目在带空格目录)时构建 100% 失败。现有单测全部用无空格路径,掩盖了缺陷。
- 修复:整条命令拼成单个引号包裹字符串 + `windowsVerbatimArguments: true`;或跳过 shell 直接 `dotnet UnrealBuildTool.dll`。补含空格路径测试。

### E3. `.code-workspace` 用严格 `JSON.parse` 解析,JSONC(注释/尾逗号)导致整个检测静默降级

- 文件:`src/detection/index.ts:116-117`(失败路径 :229-240)
- 问题:VS Code 的 `.code-workspace` 是 JSONC(允许注释、尾逗号,用户常手工编辑),`JSON.parse` 抛错后 catch 吞掉并 resolve **全空结果(含 `workspaceFile: undefined`)**。
- 影响:检测整体降级为"未打开 .code-workspace"形态——状态栏显示 No Project/No Engine 警告,`showProjectInfo` 误判并引导用户重新生成工作区,真实原因只在日志一行。**本项目 `uprojectScanner.ts:16-18` 已记载过同一教训(改用 JSON5.parse),此处原样重现。**
- 修复:改用 `JSON5.parse`(json5 已在 dependencies);失败时单独 log 具体语法错误。

### E4. `showClangdProxyStatus` 的"当前激活"显示配置启用状态,与实际激活恒相反

- 文件:`src/commands/showClangdProxyStatus.ts:38/75`(配合 `src/clangd/proxy/status.ts:20-41`、`enableClangdProxy.ts:92-96`)
- 问题:状态模型 `ClangdProxyStatus` 无 `active` 字段,`status.active` 被写成 `status.enabled`;而 `enableClangdProxy` **故意不写** `clangdProxy.enabled` 配置 → 启用后 enabled 恒 false → 命令输出"配置启用: 否 / 当前激活: 否",与真实状态完全相反。控制面板(`controlPanel.ts:443`)用独立的 `isActive || enabled` 派生,两处显示互相矛盾。
- 修复:buildStatus 增加 `active` 字段(取 `settingsManager.isUsingOurLauncher`),两行分别用 `enabled` 与 `active`。

### E5. `generateCompileCommands` 取消 QuickPick 后静默回退到第一个项目继续执行完整生成管线

- 文件:`src/commands/generateCompileCommands.ts:56`
- 问题:`project = (await pickProject(projects)) ?? projects[0];` — 用户取消选择(undefined)时命令不中止,而是对 `projects[0]` 跑 UBT 生成 + symlink + 补全文件整条管线(耗时数分钟、写盘)。
- 影响:多项目工作区下取消后仍对错误项目执行破坏性操作;与 `_resolve.ts` 其他命令"取消 → 提示 + 返回"语义不一致。
- 修复:取消时 `return`;仅在 `projects.length === 1` 时 auto-pick。

### E6. Logger 对 Error 对象序列化输出 `{}`,错误详情全部丢失(跨模块)

- 文件:`src/core/logger.ts:123-129`(`format()`)
- 问题:`JSON.stringify(Error)` 返回 `'{}'`。以下调用点的错误信息在 Output 面板与 console 里都变成 `{}`:
  - `extension.ts:77`(firstRunInit)、`extension.ts:127`(Activation failed)
  - `commands/disableClangdProxy.ts:48`、`commands/enableClangdProxy.ts:82/101`
  - `detection/index.ts:230`(pre-warm failed)
- 影响:所有失败诊断信息丢失,用户排障无据(相比之下 `clangdOps.ts:154` 用 `err instanceof Error ? err.message : String(err)` 的写法是正确的)。
- 修复:`format()` 对 `instanceof Error` 特判输出 `name: message`;或全仓库统一改用 message 模板。

### E7. `Logger.setLevel` 无任何调用点,`lspLoggingLevel` 设置是死设置

- 文件:`src/core/logger.ts:105`(定义);grep 全仓库 `setLevel` 仅 logger.ts 自身
- 问题:`vscodeUEHelper.lspLoggingLevel` 设置存在(Config getter、package.json 暴露),但**没有任何代码把设置值传给 Logger**。Logger 恒为 `'info'` 级,用户设 `debug` 完全无效。
- 修复:激活流程里 `logger.setLevel(config.lspLoggingLevel)` 并订阅配置变化。

### E8. 链接器致命错误 `LINK : fatal error LNKxxxx` 两个正则均漏检

- 文件:`src/parsers/msvcParser.ts:23`、`src/parsers/linkerParser.ts:15`
- 问题:`LINKER_RE` 的 severity 组不含 `fatal error`;实测 `LINK : fatal error LNK1104: cannot open file 'UE5Editor.exe'` MISS,而 `LINK : warning LNK4099: ...` MATCH(不对称)。`MSVC_RE` 的备选里明明有 `fatal error`(`msvcParser.ts:19`),唯独链接器分支漏了。
- 影响:LNK1104(文件被占用)等链接器最常见致命错误进不了 Problems 面板。
- 修复:severity 组补 `fatal error`(`normalizeSeverity` 已支持),补测试用例。

### E9. `uprojectParser` 注释声称 JSON5 实际用 `JSON.parse`(死代码内潜伏历史 bug)

- 文件:`src/parsers/uprojectParser.ts:5/25`
- 问题:注释写"同样用 JSON5.parse",实现是 `JSON.parse`。真实 UE .uproject 允许注释/尾逗号。当前模块零调用方(死代码),一旦未来接回即复现 E3 同类问题。
- 修复:改用 `JSON5.parse` 或删除该重复实现。

### E10. typecheck 门禁整体失效(14 个错误,12 个在测试文件)

- 文件:`test/unit/core/workspace.test.ts:332-334/424-426/487/489`、`test/unit/ui/controlPanel.test.ts:849/873/896`、`test/unit/ui/controlPanel.html.test.ts:197`、`scripts/extract-ue-docs.ts:26/74`
- 问题:`tsconfig.json` include 含 `test/**/*.ts`,文档声称"typecheck 必须零错误"。根因:
  - workspace.test.ts fixture 缺 `WorkspaceFolderInfo.path` 字段(类型定义在 `src/detection/types.ts:56-65`,真实构造点 `detection/index.ts:129-138` 永远填全四字段)——**实现对、测试错**;
  - controlPanel.test.ts 的 `createDeps()` 工厂返回类型未含 `clangdOps`(`controlPanel.ts:27` 有该字段)——**实现正确,测试本地工厂类型过期**;
  - `scripts/extract-ue-docs.ts` 缺 `@types/glob` + `string|undefined` 不兼容。
- 影响:门禁红灯掩盖真实类型回归;新代码改动被 14 个噪音错误淹没。
- 修复:补 fixture 字段、`createDeps()` 标注 `ControlPanelDeps`、删未用变量、`npm i -D @types/glob`。

### E11. 覆盖率阈值 80/80/75/80 与现状矛盾,`npm run test:coverage` 大概率失败

- 文件:`vitest.config.ts:13-24`、`package.json#scripts.test:coverage`
- 问题:coverage include 为 `src/**/*.ts`,而 src 有 **5349 行(22.8%)位于没有任何同名测试文件的模块**(windowsSdk 536 行、controlPanelMessages 292、createRspMatchers 246、cliArgs 231、setSystemIncludes 205、modifyRspFiles 192、vsBuildTools 180、generatedHeaderWatcher 175、engineDiscovery 157、checks 152、uprojectScanner 140、compileCommandsCache 128、taskProvider 113 等),这些文件覆盖率≈0%,其余文件需近乎 100% 行覆盖才能凑到 80%——数学上不可达。
- 影响:"覆盖率门槛"作为测试体系信任背书,从未有通过证据。
- 修复:跑一次 `test:coverage` 确认现状;要么补测试(工程量大),要么如实调整阈值并在 AGENTS.md 注明。

### E12. 文档级错误(3 条,详情见 §7)

- "21 个命令"在 6+ 份文档过期(实际 22,`package.json:47-194` / `commands/index.ts:56-103` 均为 22)
- README 声称"状态栏 11 个按钮",实际 8 个(`statusBar.ts:95-126` 8 处 createStatusBarItem)
- `doc/02-modules.md:118` 声称 buildRunner"用 execa",实际 `node:child_process`(execa 已卸载,CONTRIBUTING 自己声明"零引用 runtime 依赖")

---

## 4. 逻辑不合理处(警告级,边界脆弱 / 大概率出问题 / 违反声明契约)

### 4.1 进程与生命周期

- **W1. SubprocessRegistry"优雅杀进程树,3s 升级强杀"注释与实现矛盾**:`subprocessRegistry.ts:187` 第一刀就是 `taskkill /F /T`(`/F` 即强杀),不存在"优雅"阶段,第二刀 `taskkill /F /PID` 基本冗余。头注释(:15)与实现(:186-215)自相矛盾,维护者会误判两级语义。
- **W2. `register()` 在 dispose 后静默丢弃**:`subprocessRegistry.ts:101-105` 注释承诺"仅 warn 日志,不抛错",但代码直接 `return`,无任何日志(registry 无 logger 依赖)。deactivate 中途 detached spawn 被无声丢弃。
- **W3. `register()` 查重线性扫描,可 O(1) 化**:`subprocessRegistry.ts:113-117` for 循环遍历查重。由于 `entries` 是 `Set<RegistryEntry>`(每次 register 新建包装对象),`Set.add` 无法自动按 child 去重,当前查重循环是**必要的**——但可重构为 `Set<ChildProcess>` + `Map<ChildProcess, label>` 实现 O(1) 查重。
- **W4. WorkspaceBackup 是僵尸类**:`clangd/index.ts:157` `new WorkspaceBackup(workspace?.projectFile ?? '')` — 构造时 detection 未 ready,projectFile 恒为 `''`;`snapshot()/restore()/startWatching()` 全仓库零调用(文件头注释自认"Phase 5 待接入");`autoBackupWorkspace` 设置(default true)却在误导用户备份生效。
- **W5. launchEditor"detach 保活"与"注册 registry 杀掉"语义矛盾**:`launchEditor.ts:35` 注释"Detach so killing our extension doesn't kill the editor",同时 `sharedSubprocessRegistry.register(child, 'Unreal Editor launch')` — deactivate 时 taskkill 进程树。二选一并写决策记录。
- **W6. ueDiagnosticWatcher 30s 清理 timer 未跟踪**:`proxy/ueDiagnosticWatcher.ts:572-579` 的 `setTimeout(...,30000)` 无句柄,dispose 不清理 → proxy 退出最多延迟 30s,期间向已关闭 bridge 发消息。
- **W7. `handles.discovery` 在 ready 前被整体替换**:`detection/index.ts:85/214` 构造时创建空 candidates 实例,IIFE 末尾替换;`build/index.ts:44` 恰好在 ready 前捕获旧实例(目前因 taskProvider 恰好忽略而侥幸无害,教科书级"引用将被替换对象"陷阱)。
- **W8. Live Coding 功能整体不完整**:`liveCoding.ts:24-26` `projectPath` 参数传入从未使用;spawn 全新 UnrealEditor.exe 不可能 attach 运行中实例(无 `-Project=` 参数);spawn 无 `error` 监听(:26-37),失败被吞 300ms 后 `commands/liveCoding.ts:61` 无条件弹成功。
- **W9. `executeShellTask` 无超时 + abort 不终止 UBT 任务**:`compileCommands/task.ts:179-206` 任务卡死时 `generateCompileCommands` 永久挂起;取消后孤儿 UBT 继续跑并写引擎根 compile_commands.json。

### 4.2 缓存与正确性

- **W10. 引擎根 compile_commands.json 多项目共享串味**:`compileCommands.ts:294-307` candidates[0]=引擎根文件;`compileCommands/cache.ts:70-77` 命中条件仅 fingerprint + 文件存在,无引擎标识 → 项目 A 激活时可能拿到项目 B 生成的 DB,错误完全静默(cache HIT)。
- **W11. fingerprint 覆盖缺口**:`fingerprint.ts:133-175` 不收集 `.uplugin`、`.uprojectdirs`、引擎 `Build.version` → 插件变更/引擎升级后缓存仍命中陈旧 DB。
- **W12. mtime 跳过逻辑失真**:`ueLinkManager.ts:289-296` VS Code 每次保存都重写文件,mtime 几乎必然变化,"Ctrl+S 无变化 → 0ms 跳过"的注释承诺与实现不符。
- **W13. fallback DB command 字符串未处理空格/反斜杠**:`compileCommandsFallback.ts:617-646` `-I${p}` 与 `-include <compatPath>` 直接拼空格分隔串,含空格路径在 clangd tokenize 下拆裂——最需要兜底的场景(新项目/UBT 挂)恰恰不可用。

### 4.3 状态机与 UI 反馈

- **W14. 并发构建无互斥**:`commands/build.ts:89` 无 in-flight 守卫,连点两次/MCP+UI 同时触发会并行 spawn 两个 UBT(第二个被 `-waitmutex` 阻塞),且第二次的 `clearDiagnostics()` 清掉第一次的诊断。
- **W15. 用户取消构建被渲染为"构建失败"**:`commands/build.ts:123-132` 只按 exitCode 分支,取消(taskkill 杀树)与真实失败无法区分,每次都弹误导性失败警告。
- **W16. statusBar 构建反馈是死代码**:`statusBar.ts:283-316` `showBuilding()/showBuildResult()` 零调用点(测试注释自认"当前未接线");且 showBuildResult 的 `setTimeout` 在 dispose 时未清理。
- **W17. 状态栏 selection 变化后永不刷新**:`ui/index.ts:187` `renderFull` 仅激活时调用一次;WorkspaceState 明确"未持有任何 emitter",重新选项目/引擎后状态栏显示旧值直到 reload。
- **W18. ueLinkManager 节流缺 running 守卫**:`ueLinkManager.ts:326-359` 节流基准是 UHT **完成**时间,UHT 运行期间再保存反射头可并发启动第二个 UHT,与状态机文档"5s 内合并成 1 次"矛盾。

### 4.4 输入健壮性

- **W19. proxy 可被畸形 URI 打崩**:`bridge.ts:341-346`、`ueDiagnosticWatcher.ts:96-101` `decodeURIComponent` 无 try/catch,非法百分号编码抛 URIError → proxy 进程崩溃 → clangd 扩展重启循环。
- **W20. `.code-workspace` folders 含 null 条目 → TypeError → 全空降级**:`detection/index.ts:120-122` 一个坏条目让"无 workspace 文件"与"解析失败"无法区分。
- **W21. Build.version 缺失时仍 push `version='unknown'` 引擎**:`detection/index.ts:194-211` `fs.access` 失败仅日志,`readBuildVersion` 返回 null 仍 push;违反模块自述契约(AGENTS.md:128"读不到 → engines = []")。状态栏显示"UE unknown"无警告。
- **W22. `readBuildVersion` 无字段类型校验**:`workspaceFolders.ts:102-117` 字段缺失产出 `"5.undefined.undefined"` 版本串;`engineDiscovery.ts:121-129` 有校验,两处不一致。
- **W23. controlPanel 损坏消息无 payload 校验**:`controlPanel.ts:131` `void handleMessage(msg)` 无 catch;batchSave 对非数组 updates 直接 TypeError → 面板挂起;`:240/250/362` `?? msg.key` 击穿 CONFIG_KEY_MAP 白名单(任意配置 key 可写)。
- **W24. webview 每次显隐整页重载丢表单**:`controlPanel.ts:135-142` 重新赋值 `.html`,`retainContextWhenHidden: true`(:64)被抵消。
- **W25. 用户选择路径 `===` 字符串比较,Windows 大小写敏感**:`workspace.ts:226-241` `resolveSelectedProject/Engine` 用 `p.path === path` 比较,持久化 path 与下次扫描结果大小写不一致(如 `E:\Dream` vs `e:\dream`)时选择失效。
- **W26. t() 的 string 兜底重载使"TS 拦截漏 key"声明失效**:`i18n/index.ts:43-44` 任意字符串通过编译,漏 key 只能靠手工脚本。

### 4.5 死代码与契约漂移

- **W27. VsBuildTools 生产路径零调用**:`vsBuildTools.ts` `findAll()/findLatest()` 无任何调用方(实际 MSVC 发现走 `clangd/windowsSdk.ts` 另一套实现);且 `-latest` 参数与"查所有版本"注释矛盾、`sort().reverse()` 对 `14.9.x` vs `14.40.x` 字典序误排。
- **W28. MCP 模块生产不可达**:`mcp/index.ts:14-16` 自认 dead code(extension.ts 无 activateMCP 调用);`server.ts:53` `StdioServerTransport` 占 `process.stdout` — 若未来在 extension host 内接入会污染宿主 IPC。工具 description 全部硬编码英文,en/zh.json **0 个 `mcp.*` key**。
- **W29. `ue_build` 非法 mode 静默降级为 build**:`mcp/tools.ts:143-146` agent 传 `'rebuiild'` 等错字时静默执行 build,测试还把该行为固化为预期。
- **W30. src/rules 死代码 + 规则内容分叉**:`src/commands/installRules.ts` 自带 `RULES_CONTENT`(:15)与 `src/rules/cursorRules.ts` 的 `UE_HELPER_RULES_MDC` 分叉;installRules.ts:55-56 写出的 `.mdc` **缺 Cursor 必需的 frontmatter**(带 frontmatter 的正确内容反而在死代码里)。
- **W31. CompletionModeController 残留**:`completionMode.ts:52` 构造函数忽略参数(注入无效,靠事后 setConfig);`refresh()/dispose()` 空实现;`clangd/index.ts:228-231` 监听已删除的设置 `vscodeUEHelper.completionMode`(永不触发)。
- **W32. clangdHeaderWatcher.enabled 死设置**:`package.json:432-437` + `config.ts:234-235` getter,仓库内零消费方,仍在设置 UI 与 README 暴露。
- **W33. linkerParser 死代码且方言不符**:`linkerParser.ts:16` `undefined reference to` 是 GCC/Clang 方言,Windows/MSVC 永不匹配;唯一测试还放在 `test/unit/core/config.test.ts`(错位目录)。
- **W34. HeaderCache 零调用者**:`headerCache.ts` 全仓库无调用点,AGENTS.md 声称的协同设计未接线。
- **W35. 大量检测死代码**:`uprojectScanner.scan`、`workspaceFolders.readWorkspaceFolders/classifyFolders/findUProjectIn/hasBuildVersion`、`engineDiscovery.discover` 系列均零调用;classifyFolders 的 role 分类(靠文件存在性)与 index.ts 的硬规则(靠 path/name)语义已分叉,AGENTS.md 职责表失实。

### 4.6 测试体系缺口(警告级,详见 §6)

- W36. 检测核心(engineDiscovery/uprojectScanner/vsBuildTools)零测试
- W37. buildRunner 核心解析逻辑零测试(4 个测试只测注册/taskkill,流解析/结果组装零执行,还遗留真实 3s 定时器)
- W38. windowsSdk(536 行,全仓最大无测试文件)/ setSystemIncludes / modifyRspFiles / workspaceBackup 零测试
- W39. subprocessRegistry 3s 升级强杀路径无测试(测试刻意绕过)
- W40. MCP server/lifecycle 传输层零测试

---

## 5. 架构不合理处(结构性 / 演进性)

### A1. 依赖注入风格破碎:构造注入被忽略 + 事后 setter 补丁

`new CompletionModeController(config)` 忽略参数(`completionMode.ts:52`),实际依赖靠 `setConfig()` 事后注入;`commands/index.ts:47-49` 又防御式地 `typeof setConfig === 'function'` 补一次。同类模式:`ui/index.ts:72-76` 用 `{} as WorkspaceState` 伪造依赖(类型断言掩盖"未注入"分支)。注入链路混乱是多次重构(Phase 8→9)的残留,建议收敛为构造注入 + 可选依赖显式 null。

### A2. 入口对模块资源零管理,`void` hack 遍地

`extension.ts:111-112` `void build; void ui;` 抑制未使用警告;`clangd/index.ts:206` `void workspace;`。入口拿到模块句柄却不用——模块资源全部靠内部 push subscriptions,入口无法统一观察/验证激活结果。建议激活函数统一返回可观察的 handles(如 build/ui 当前返回结构),删除 `void` hack。

### A3. `deactivate()` 是死代码

`extension.ts:27` `disposables` 数组从未被 push,`deactivate()`(:135-145)的 while 循环遍历空数组——实际清理全靠 context.subscriptions 逆序 dispose。删除死代码或真正接入(如统一日志、perf flush)。

### A4. 事件机制缺失:WorkspaceState 无 emitter

selection 变化(选项目/引擎)没有任何通知路径(见 W17),状态栏、projectExplorer 都拿不到变更。单一真相源应该同时是"变更发布源"——建议 WorkspaceState 增加轻量 selection 变更事件。

### A5. `handles.discovery` 引用替换模式(见 W7)

同一句柄在生命周期中途被整体替换,持有旧引用的调用方拿到空实例。应构造时一次性注入或惰性解析。

### A6. 项目/引擎解析的双重来源可能不一致

`workspace.ts:250-259` `projectDir` 优先 `projectFolder.absPath`,fallback `dirname(project.path)`;`setResult` 里 `_project = projects[0]` 与 `_projectFolder` 来自 detection 的不同解析路径。若两者指向不同项目,.clangd 写 A、compile_commands 指向 B,静默错乱。当前 projects 恒 ≤1 掩盖了问题,但该结构是隐患。

### A7. 文档宣称"已收敛"但 13 处 `getSelected*` 直读仍在

`AGENTS.md:16` 声称"29 处收敛",实测 `commands/generateCompileCommands.ts:61/70`、`showProjectInfo.ts:52/60`、`_resolve.ts:40/48`、`setSystemIncludes.ts:51`、`controlPanel.ts:153/157/402/406`、`ui/index.ts:133/137` 共 13 处直读(部分以 `workspace?.x ?? detection...` 回退形式)。SSoT 收尾声明与实际不符,`_resolve` 实际只被 6 个命令文件 import(声称 10 个)。

### A8. MCP 按"已实现功能"对外描述,实际未接线(见 W28)

文档契约与实现脱节,接入前必须处理 stdout 归属与 i18n 契约。

### A9. 双份命令构造逻辑无对齐守卫

`domain/value-objects/build-target.vo.ts:30-37` 与 `ubt.ts:33-46` 的 switch 逐分支重复;`domain/entities/ubt-task.entity.ts:120-129` 与 `ubt.ts:48-61` 参数布局重复。AGENTS.md 声明 domain 仅作参考、业务不 import——但两份逻辑漂移时无测试强制对齐。另 `ubt-task-id.vo.ts:12` 依赖 `globalThis.crypto`(Node 17.6+ 已默认暴露,但显式 `import { randomUUID } from 'node:crypto'` 仍是更稳妥的写法,可消除对运行时全局的依赖)。

### A10. 工程化门禁名存实亡

typecheck 红灯(E10)、覆盖率阈值不可达(E11)、lint 33 errors 未清、无 CI 无 pre-commit(AGENTS.md 自己声明)——文档宣称的"验证门禁"目前全部靠人工自觉。建议至少加一个本地 pre-push 脚本跑 typecheck+lint+test。

---

## 6. 测试体系评估(US-009)

### 正面

- `test/unit/setup.ts` vscode 全局 mock 完整(含 chokidar mock,落实陷阱 #6);单例隔离处理正确(controlPanel resetInstance、buildRunner fresh registry、mcp setMCPContext(null))
- framing.test.ts(27 用例)、clangdOps.test.ts(真实临时目录 + YAML 往返)、uhtGeneration.test.ts(真实 fs 骨架 + spawnFn 注入)质量高,断言与实现逐行对应
- i18n 双语 key 完整性极佳:en/zh 各 223 个 key,集合完全一致,零单边 key;149 个 t() 字面量 key 全部存在

### 缺口(除 §4.6 的 5 条外)

- msvcParser 测试缺 chunk 边界(半行分喂 + flush)、fatal error/note、LNK 两行上下文、"N>" 前缀用例(多进程 msbuild 输出常见 `2>c:/path/file.cpp(3): error` 被解析为 file=`2>c:/path/file.cpp`,Problems 无法跳转)
- `workspaceEngines.test.ts` 文件名与所测模块不符(实际测 workspaceFolders.ts),破坏 src/test 镜像约定
- ssot.test.ts 是源码文本正则型守卫(`expect(src).toMatch(/get\s+selectedProject.../)`),格式化/重命名即误报,建议改反射式断言
- uhtGeneration 内部 timeoutMs 超时路径未测,case (c) 遗留真实 60s 定时器
- 陷阱 #7(MSVC 正则双源同步)无自动化守卫
- `test/unit/commands/clangdProxyCommands.test.ts.bak` 残留文件应物理删除

---

## 7. 文档一致性评估(US-010)

### 正向(验证通过)

- 陷阱 #1/#2/#3/#4/#5/#6/#9/#10/#11/#12 共 10 条逐字验证与代码一致
- MSVC 正则:`msvcParser.ts:19` 与 `package.json:462` **逐字符一致**(但文档转录的字面量是旧版,见下)
- v8 阈值配置、双 bundle 架构、`platforms: ["win32"]`、repository.url 占位符等声明属实
- 激活顺序主体与 `extension.ts` 一致(细节出入见 W41)

### 漂移(错误 3 条见 E12,警告 17 条精选)

- **W41. 测试统计全面漂移**:71 文件/约 12k 行 → 实际 82 文件/19562 行/1017 用例;"13 import/36 callers" 实际 33 处 import/38 文件;"13 个 ssot 守卫 + 12 个 workspace 测试" 实际 15/38;proxy"17 个测试文件"实际 18
- **W42. 陷阱 #13/#14 行号全部过期**:bridge.ts 汉化 TODO 行号 676/685/694 → 实际 687/696/705;豁免清单 task.ts/windowsSdk.ts 行号漂移约 15-18 行
- **W43. 陷阱 #7 正则字面量转录过期**:AGENTS.md/doc-02 引用 `^(.*)\(...\):\s+`(贪婪),实际 `^(.*?)\(...\)\s*:\s*`(非贪婪 + `\s*`),照抄文档会写出不同行为的正则
- **W44. proxy-launcher.sh 已不生成,6 处文档仍声称 .bat/.sh 双产物**(esbuild.config.mjs:93 明确"不再生成 Unix .sh")
- **W45. doc/01 声称"Phase 8 迁移中 writeClangdConfig 保留兼容"**,实际 Phase 9 已删(grep 仅注释提及)
- **W46. dev-guide 声称".bak 未 gitignore"**,与 .gitignore:31(`*.bak`)及陷阱 #4 矛盾
- **W47. "新增命令 4 步"与 commands/AGENTS.md "5 步"文档间互相矛盾**(CONTRIBUTING 还明示"见 commands/AGENTS.md")
- **W48. 其他**:doc/02 launchEditor"按平台分支"实际仅 Windows;doc/02 clangdConfig"写/读 .clangd"实际纯渲染无 I/O;eslintrc"3 类 syntax bypass"实际 4 条;激活顺序文档缺 subscriptions 推送步骤、runFirstTimeInit/ControlPanel 先后颠倒;mcp/AGENTS.md 环境检测代码块指向错文件(src/core/runtime-detect.ts);DEBUG.md 引用"陷阱 #11"编号错误;ADR 0002 API 形态(mutate(root,...)/setAddFlag)与实际签名不符未标修订;vsix 内容清单漏 nls 文件、含已不存在的 .sh;perfStatusBar 在 doc/02 两个模块表重复列出;ClangdOps"4 个核心 API"实际 6 个(含 readText/applyAddFlags)

---

## 8. 优化建议(建议级精选)

1. **t() 插值 `$` 特殊语义篡改**(`i18n/index.ts:56`):`String.replace` 中 `$&`/`$$`/`$'` 有特殊含义,参数值含 `$` 时文案被破坏(实测 `path$&name` → `path{0}name`)。改为函数替换 `text.replace(re, () => String(v))`。
2. **msvcParser buffer 无上限**(`msvcParser.ts:26/34-37`):超长无换行输出内存无限增长,建议 1MB 上限。
3. **`Config.clangdProxyLocalizationMode` 'override' 分支死代码**(`config.ts:206-209`):package.json enum 仅 `append/zh-only`;非法值无校验直通。
4. **`Config.showWelcomeOnActivation` 死 getter**:从未使用,删除。
5. **`Config.update()` 的 inspect 校验用引用比较**(`config.ts:288`):数组/对象值在 VS Code 深拷贝下 `!==` 必然误报,建议深比较或仅提示。
6. **`extension.ts` welcome 弹窗与 firstRunInit 两套初始化逻辑并存**,职责边界不清晰,建议合并。
7. **`_resolve` 的字段成功解析时解除通知锁**(`workspace.ts:390`)设计良好,但 detection 失败时 getter 静默返回 null 不弹错——建议失败时至少一条 warning 日志路径可查。
8. **uninstall 递归删除 `.vscode/vscodeuehelper`**(`uninstall.ts:46-47`)会删掉 `completionFiles.ts:487-512` 声明"保留用户编辑"的 addCompletions.h/addMacroCompletions.h,删除前先移出用户文件。
9. **firstRunInit `markInitializedInWorkspace` 用 `JSON.stringify` 回写**(`firstRunInit.ts:160-166`):读用 json5 容忍注释、写用 JSON.stringify 毁注释,应 jsonc 定点修改;且标记失败仍 reload(:248-262),与文件头"失败不重启"声明矛盾。
10. **nls 与 title@zh 两套命令本地化机制并存**(仅 openTerminalInNewWindow 走 nls),建议统一。
11. **`iconFor` 对无扩展名文件 slice(-1)**(`projectExplorer.ts:237`):lastIndexOf=-1 时取末字符,应直接返回 file 图标。
12. **config 任意变化全量刷新 Project Explorer 树**(`ui/index.ts:90-94`),建议按 key 过滤或 debounce。
13. **openTerminalInNewWindow 的 view/item/context 传参形态**:explorer 菜单传 `vscode.Uri`,而 Project Explorer 的 view/item 菜单按 VS Code 约定传 tree item(无 `fsPath`),取不到路径时命令面板无参调用只能返回"无效路径"提示;`moveIntoNewWindow` 移动"活动终端"存在时序竞态(可能移错终端)。
14. **disableClangdProxy 的 clangd.restart 失败误报"禁用失败"**(设置已恢复,restart 失败是 clangd 扩展未激活等外围原因),应与 enable 侧一致的 warn 语义。
15. **zh.json 16 个 key 双语嵌入风格不一致**(通知类消息显示"中文 / English"冗余),建议明确"可观测类双语、交互类单语"边界。
16. **`handles.discovery`/`isLauncherInstall` 两处赋值相反**(index.ts:207 false vs engineDiscovery.ts:102 true),quickPicks 显示相互矛盾的标注。
17. **`runExeca` reject 语义名不副实**(vsBuildTools.ts:47-49 err 时也 resolve),命名误导。
18. **5.2+ 硬依赖无代码门禁**:全仓库无版本比较逻辑,`workspace.engineVersion` 无消费方;要么加门禁要么删文档表述。
19. **MSVC "N>" 前缀混入 file 路径**(msvcParser.ts:71/74 实测 `2>c:/path/file.cpp(3)` 解析出 file=`2>c:/path/file.cpp`),剥离正则应处理 `(?:\d+>)?`。
20. **`buildRunner` abort 监听器未在 close 时移除**(buildRunner.ts:88-94);env spread 死代码(:74)。

---

## 9. 模块总体评估

| 模块 | 评价 | 关键风险 |
| --- | --- | --- |
| core | 结构清晰,SSoT 方向正确 | logger Error 序列化、setLevel 死设置、registry 注释矛盾 |
| detection | 信任模型实现与文档一致 | JSONC 解析、Build.version 容错、死代码多、零单测 |
| build | 结构良好、注册链符合架构 | cmd.exe 引号剥离(E2)、Live Coding 不完整、并发无互斥 |
| clangd | 质量最高的模块,`.clangd` 收敛到位、framing 严谨 | 本地化占位符损坏(E1)、畸形 URI 崩溃、缓存串味 |
| commands+ui | 22 命令与 package.json 严格一致 | proxy 状态显示恒错、取消语义、controlPanel 消息校验 |
| parsers | 正则无回溯风险、双源一致 | LINK fatal error 漏检、JSON5 假死 |
| mcp | 测试扎实但整体未接线 | stdout 归属、i18n 契约、mode 校验 |
| i18n | 223/223 key 零漂移,维护极佳 | `$` 替换语义、类型门禁失效 |
| 测试 | 两极分化:已覆盖处质量高,体系有系统性盲区 | typecheck 红灯、覆盖率不可达、高危模块 0 保护 |
| 文档 | 核心架构描述可信 | 数量/行号系统性漂移,6+ 处错误 |

---

## 10. 优先修复路线图

### P0(功能错误,先修)

1. **E1** genericTranslator 反引号占位符(一行修复 + 单测)
2. **E2** cmd.exe /c 引号剥离(含空格路径构建失败——最大用户影响)
3. **E3** `.code-workspace` 改用 JSON5.parse
4. **E6+E7** logger Error 序列化 + setLevel 接线(诊断能力重建)
5. **E4** showClangdProxyStatus 状态字段修正
6. **E10** typecheck 12 个测试错误修复(门禁恢复)
7. **E8** LINK fatal error 漏检

### P1(逻辑不合理,近期)

8. **W10/W11** 缓存加引擎标识 + 指纹补 .uplugin/引擎版本
9. **W14/W15** 构建并发互斥 + 取消语义
10. **W19** proxy decodeURIComponent 防护
11. **W21/W22** 引擎识别容错(无效引擎不 push / 字段校验)
12. **W17** WorkspaceState 增加 selection 变更事件(A4)
13. **W27** vsBuildTools 接入或删除
14. **W29** ue_build mode 校验
15. **W30** rules 分叉收敛(installRules 消费 @rules + frontmatter)

### P2(架构与工程化,规划)

16. **A1/A2/A3** 依赖注入收敛、入口句柄管理、deactivate 死代码清理
17. **A10** 本地门禁脚本(pre-push:typecheck + lint + test)
18. **E11** 覆盖率阈值实测校准
19. **W4** WorkspaceBackup 接线或删除(连 autoBackupWorkspace 设置)
20. **W28** MCP 接入(先解决 stdout 归属 + i18n)
21. 文档一次集中校准(命令数 22、按钮 8、测试统计、陷阱 #13/#14 行号、.sh 删除、正则字面量)

---

## 11. 正面确认(做得好的,建议保持)

1. **SSoT 收敛方向正确**:`.clangd` 写入确实验证无旁路(grep commands/ui/core/build 无直接写),ClangdOps 的 mutate/原子写/缺失弹错设计合理
2. **子进程清理链完整**:三条 spawn 路径全部注册 SubprocessRegistry;AbortSignal → taskkill 进程树链路设计正确;豁免清单"短探测 + Promise 框定"的实质成立
3. **proxy framing 严谨**:26 个边界用例覆盖,协议层无粘包/截断问题
4. **i18n key 管理优秀**:223/223 双语零漂移
5. **正则工程严谨**:无灾难性回溯(实测 5 万括号行 <5ms)、双源逐字符一致
6. **测试基础设施扎实**:setup.ts mock 完整、单例隔离规范、若干测试达集成级质量
7. **文档体系整体可信**:14 条陷阱 10 条逐字验证通过,激活顺序主体、双 bundle、平台声明均属实

---

*审阅结论:该仓库架构方向正确、工程意识强(注释/文档/测试密度远超同类插件),主要问题集中在「文档与实现漂移」「死代码残留」「少数健壮性漏洞」三类。E1/E2/E3/E6 四条为优先修复项。*
