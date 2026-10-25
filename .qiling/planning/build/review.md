---
verdict: approved
verdict_scope: audit19(全仓库审计 19 条缺陷修复,base ddccd64 + 工作区 diff)—— 第 5 轮终审
review_round: 1
reviewed_at: 2026-09-20
base: 263848e
head: ba8a897
range_commits: 20
diff_scope: 51 文件(+2857/-491);src 侧仅 src/commands/*(24 文件)+ src/core/envelope.ts(新增)+ src/mcp/tools.ts,逻辑层(src/build、src/core 其余、src/clangd、src/detection)diff 零改动
strictness: THOROUGH(>20 文件;宪法 C1-C8 全量对照 + S1-S8 全量扫描)
verification_trust: verification.md verified_at_commit(ba8a897)== 当前 HEAD,工作区除 .planning/ 工件外干净 → 无 stale_state / dirty_worktree;PASS 命令未重跑
audit19_review: approved(第 5 轮终审,2026-10-25,0 critical / 0 major / 7 minor;19 条缺陷判定「已修复 19 / 部分修复 0 / 未修复 0」)
add002_review: approved(第 2 轮,2026-09-25,0 critical / 1 major / 2 minor,三项当场修复)
add003_review: approved(第 2 轮,2026-09-25,0 critical / 0 major / 0 minor)
add004_review: approved(第 2 轮,2026-10-05,0 critical / 0 major / 0 minor)
audit19_review_round3: changes-requested(第 3 轮,2026-10-25,0 critical / 3 major / 8 minor,3 个 major 当场修复)
audit19_review_round4: changes-requested(第 4 轮,2026-10-25,0 critical / 1 major / 3 minor,1 个 major + 3 个 minor 当场修复)
audit19_review_round5: approved(第 5 轮终审,2026-10-25,0 critical / 0 major / 7 minor,M1 当场修复 + 6 条登记遗留)
---

# 独立评审报告(第 1 轮)

## verdict: approved

0 critical / 4 non-critical。契约 envelope 对齐目标达成,宪法 MUST 全部满足,AI 代码套路清单 8 条中 7 条未命中、1 条轻命中(列为 non-critical)。

---

## 结论一:契约合规(实现 ↔ 契约)—— 通过(附 4 条 non-critical)

**抽样与核对方式**:36 端点逐一对照 openapi.yaml;验证摘要关键声明用廉价命令复核(未重跑重型 PASS 项)。

已核实(证据为亲测输出或文件:行号 @ ba8a897):

| 契约项 | 证据 |
|--------|------|
| 27 个 VSCode 命令注册 | 亲测 `grep -c "track('vscodeUEHelper"` = 27;注册层 `src/commands/index.ts` track→registerCommand 直接透传 handler 返回值(`src/core/command-registry.ts` 无包装丢失) |
| 24 个命令文件 envelope 出口 | 亲测 `grep -rl "okEnvelope\|errEnvelope" src/commands/` = 24 / 24(排除 index/_resolve 后恰为全部命令文件) |
| BuildDone 语义(exitCode≠0 仍 ok:true,成败以 data.exitCode 判定) | `src/commands/build.ts` L327、L333 `okEnvelope({mode, exitCode, durationMs})`;测试 `test/unit/commands/build.test.ts`「UBT 退出码非 0 仍返回 ok:true」钉住;data 形状 = 契约 BuildResult{mode, exitCode, durationMs?} |
| 错误码映射(构建域) | 无项目→PROJECT_NOT_DETECTED(L117)、无引擎→UBT_NOT_FOUND、并发守卫→OPERATION_CANCELLED(L83)、spawn 失败→BUILD_FAILED、取消→OPERATION_CANCELLED;liveCoding 409 语义→LIVE_CODING_UNAVAILABLE;launchEditor 404 语义→PROJECT_NOT_DETECTED |
| 9 个 MCP 工具 | 亲测 `grep -c "case 'ue_" src/mcp/tools.ts` = 9;MCPDispatch {ok, dispatched, mode?, note} 与实现逐字段一致;错误出口 `src/mcp/tools.ts` L145-152(context 未初始化→MCP_CONTEXT_NOT_INITIALIZED)、L238-240(未知工具→UNKNOWN_TOOL),由 tools.test.ts + tools.envelope.test.ts 双重钉住 |
| ue_get_build_errors 顶层 errorCount/warningCount(契约 BuildSummary) | `src/mcp/tools.ts` L214-215 从 `summary.totals` 薄适配,lastBuild totals 形状 {errors, warnings, notes}(`src/build/lastBuild.ts` L62)核对一致;测试断言 `errorCount===1` |
| C3/D4 fire-and-forget 保持 | `callTool` 同步签名不变,`dispatch` 形参放宽为 Promise<unknown>(L160-166);tools.envelope.test.ts 含「永不 resolve 的 promise 下 callTool 仍同步返回 string」强证明用例 |
| event-flow 边缘场景 | 非法 mode 回落 build(tools.ts L172-175 + [D6 现状保留] 测试)、无构建快照 {ok:true, hasResult:false, note} + 测试、MCP 未初始化契约错误 + 测试——三条全部落地 |

non-critical 缺口(详见处置账本 N1-N3):openWorkspaceFile 契约 requestBody.uri 未被实现消费;"无配对/无工作区"类失败复用 PROJECT_NOT_DETECTED(语义最接近但误导);envelope summary 硬编码文案未本地化。三者均已在 fill-report/verification 登记或属契约自身滞后(D6 spec-as-is 下应修契约),不阻断。

## 结论二:正确性(实现本身)—— 未发现 critical

**DoneClaim 三键探测**(对 verification.md / fill-report.md 声明):

- stale_state:verified_at_commit == HEAD,无过期结论。未重跑任何 PASS 命令。
- dirty_worktree:`git status` 仅 .planning/STATE.md 修改 + .planning/build/ 未跟踪(规划工件,非代码魔法补丁)。
- misleading_success_output:抽查 6 个测试文件(build/createProject/switchHeaderSource/setSystemIncludes/envelope/tools.envelope),断言均为行为级(envelope 形状、UI 消息、编排顺序、"runBuild 未被调用"),非 0 测试空转;「as unknown as 桥接删除」声明核实——src 现存 2 处 cast 与 base 逐行相同(editorDetect.ts L70 / noLint.ts L114),setSystemIncludes 中确已无桥接。

**S1-S8 套路清单扫描结果**(THOROUGH 全量,每条附核查方式):

| # | 结果 | 证据 |
|---|------|------|
| S1 mock 冒充实现 | 未命中 | envelope data 全部来自真实执行路径:build←runBuild 结果、showProjectInfo←detection.ready、uninstall←fs.rm 实删清单;diff 无硬编码假数据充当返回值 |
| S2 路由未接线 | 未命中 | 27 track + 9 case 亲测;抽查 handler 主体均含真实编排(无空对象/固定值/501) |
| S3 吞错误 | 未命中 | diff 范围 catch 块逐个核对:要么返回 errEnvelope、要么 log+envelope、要么 rethrow(build.ts 内层 L356-368 记快照后 rethrow,外层 L93-96 包装 INTERNAL_ERROR);无新增空 catch;openProjectExplorerFile 打开失败仅 logger 为既有行为原样保留(契约该端点仅定义 200) |
| S4 全 200 综合征 | 未命中 | 每域至少一条 err 路径有对应测试断言 code(build/copyBuild/createProject/clangd 系/config 系/noLint/uninstall/switchHeaderSource) |
| S5 契约字段未消费 | 轻命中 1 处 | openWorkspaceFile requestBody.uri 被注册层丢弃(index.ts L89 handler 无参)→ N1;其余契约字段(summary/error.details/BuildSummary.errorCount)均已产生并测试 |
| S6 测试只测 mock | 未命中 | 抽查断言对象为返回 envelope 与 UI 副作用,mock 调用仅作编排顺序辅助断言;tools.envelope 的 C3 钉子(never-resolve promise)为强行为断言 |
| S7 占位残留 | 未命中 | 亲测 diff 新增行 grep TODO/FIXME/placeholder/lorem/XXX/占位/临时方案 = 0 命中 |
| S8 校验只在文档里 | 未命中(范围内) | 契约 requestBody 仅 2 处:ue_build.mode 有回落逻辑+测试;openWorkspaceFile.uri 即 N1;ue_get_build_errors required [ok,hasResult] 满足 |

**其它正确性核查**:取消路径经 `result.cancelled`(build.ts L281-290 AbortSignal 桥接为既有逻辑)正确映射 OPERATION_CANCELLED,无误标 BUILD_FAILED 风险;复制粘贴漂移未发现实质漂移(selectConfig/selectTarget 为既有成对结构的镜像扩展);无幻影依赖(diff 无新增外部 import,package.json 不在 diff,C5 达标);无新增边界静默截断(slice(-5)/slice(-20) 为既有日志行为);errEnvelope details 仅含 file/mode/cwd/计数等业务值,无敏感值泄漏(C4 亲测密钥正则零命中)。

## 结论三:代码库一致性 —— 一致(2 条偏差已列 non-critical)

- envelope 基础设施收敛单一模块 `src/core/envelope.ts`(契约 9 码逐字常量 + Envelope/ContractError 类型 + ok/err 工厂),24 命令统一按「函数出口 catch + errEnvelope 映射 + 缺口登记注释」模式接入,注释均标注契约/决策出处——风格高度一致。
- 既有惯例未破坏:用户可见弹窗仍走 t()、目标解析仍收敛 `_resolve` SSoT、子进程仍经 subprocessRegistry(C1 亲测 `grep spawn` 于 src/commands、src/mcp = 0 命中)、C2 亲测 command-registry 之外无 vscode.commands.registerCommand。
- 偏差:N3(envelope 文案硬编码、中英混排,未走 t());N4(setSystemIncludes UI 提示与 envelope 信号不一致,系有意保留的既有控制流)。

---

## 处置账本

| ID | 严重度 | 处置意向 | evidence | decided_by | round |
|----|--------|----------|----------|------------|-------|
| R1-N1 | non-critical | 契约修订:改述 openWorkspaceFile 为现状行为(自动查找并打开 .code-workspace,无 uri 入参/无交互选择)或在契约登记 known gap;不改实现(D6 spec-as-is) | openapi.yaml L162-177 定义 requestBody.uri「缺省时交互选择」;实现 `src/commands/index.ts` L89 handler 丢弃入参、`src/commands/openWorkspaceFile.ts` L13 签名无 uri(行为为基线既有,非本次引入)@ba8a897 | reviewer-round1 | 1 |
| R1-N2 | non-critical | 契约修订:扩充错误码枚举(FILE_NOT_FOUND / EDITOR_NOT_AVAILABLE 类,verification.md §六已登记);当前「最接近码」满足 C8(SHOULD)字面要求,不阻断 | `src/commands/switchHeaderSource.ts` L306-312 无头/源配对→PROJECT_NOT_DETECTED;`src/commands/openWorkspaceFile.ts` L20-21、L45-46;`src/commands/uninstall.ts` L89 @ba8a897;该码枚举注释语义为「工作区无 .uproject」(openapi.yaml L433),AI 消费方可能误读 | reviewer-round1 | 1 |
| R1-N3 | non-critical | 维持 fill-report 的 i18n DEFERRED 登记;UI 消费落地时统一接 t(),建议届时统一语言(当前中文/英文/双语混排) | 约 15 处 envelope summary/message 硬编码:`src/commands/generateCompileCommands.ts` L84、`src/commands/selectConfig.ts` L45-46(双语)、`src/commands/refreshProjectExplorer.ts` L11、`src/commands/noLint.ts` L131/L138/L144、`src/commands/installRules.ts` L59、`src/commands/openProjectExplorerFile.ts` L31、`src/commands/switchHeaderSource.ts` L284/L320 等 @ba8a897;契约 Envelope.summary 描述「已本地化」(openapi.yaml L421);当前无 UI 消费方,C6(SHOULD)豁免成立 | reviewer-round1 | 1 |
| R1-N4 | non-critical | 保持 spec-as-is 现状;后续阶段将 UI 提示与 envelope 信号对齐(失败时不再弹成功提示) | `src/commands/setSystemIncludes.ts` L247-252 applyAddFlags 失败仅暂存 failure envelope、L272 `failure ?? okEnvelope(...)`——UI 仍弹 "System includes set" 成功提示而返回 ok:false(注释明示有意保留)@ba8a897 | reviewer-round1 | 1 |

## 验证摘要抽查记录

- 亲测确认:track=27、case 'ue_'=9、envelope 出口 24/24、src `as unknown as`=2(均基线既有)、C1/C2/C4/S7 扫描零命中、HEAD==ba8a897 且工作区无代码改动。
- 未重跑(摘要 PASS 且 commit 未变、无后续代码变更):npm run typecheck / npm test / npm run build / npm run lint。
- 抽查可信度结论:验证摘要各项声明与磁盘事实一致,无夸大。

## 复审输入提示(若有下一轮)

- 本轮 0 critical,无需修复回路。
- R1-N1/R1-N2 若走契约修订,属 /ql-design 契约变更而非代码修复;R1-N3 待 UI 消费落地时随迁。

---

# 独立评审报告(第 2 轮:add-002 增量,2026-09-25)

## verdict: approved

评审对象:7acb84c 之上 add-002 全部未提交变更(5 src + 5 test + 契约工件,+402/-21)。
评审者:ql-reviewer(全新上下文);验证基线:typecheck 0 错、改动文件 eslint 0 问题、vitest 全绿
(评审者亲自复跑 typecheck + 5 个改动测试文件 68 用例)。

### 结论一:契约合规 —— approved

openapi.yaml 0.2.0 五处变更(module/warning/BuildResult.module/BuildSummary.module/version)
逐项与实现核对 pass;.planning/add/002-module-build.md 验收清单 6 条全部 pass 且有测试证据。

### 结论二:正确性 —— approved(附 1 major,已当场修复)

贯穿链(UBTArgs → buildUBTCommand → executeBuild → 快照 → summarize → ue_get_build_errors)
逐环节核实;"不带 module 与现状逐字节一致"有 toStrictEqual 级断言钉死;S1-S8 套路清单 0 命中。

| 级别 | 发现 | 处置 |
|------|------|------|
| major | module 值未白名单,经 cmd.exe verbatim 拼接(agent 可控字符串首次进入该链路)存在命令注入面 | **当场修复**:MCP 入口白名单 `/^[\w.+-]+$/u`(src/mcp/tools.ts),注入样本 `x" & calc & "` 测试钉死;修复后全量 1330/1330 复测 |
| minor | executeBuild 函数层对 rebuild/clean+module 无防线 | **当场修复**:`effectiveModule = mode === 'build' ? module : undefined` + 测试 |
| minor | 异常路径快照 module 缺断言 | **当场修复**:withProgress reject 用例补齐(catch 路径快照带 module) |

### 结论三:代码库一致性 —— approved

[add-002] 标签体系、测试结构、可选字段"缺省不出现键"惯例均与周边一致;越界检查:domain 层零改动、
UI 命令面零改动、契约改动仅限记录声明范围,无夹带。

### NOT_RUN 声明

UBT `-Module=` 真实引擎行为(只编译不链接、obj 复用、Live Coding 拒绝)未在评审环境复现,
采信 add 记录的 UE 5.8 源码实证(TargetDescriptor.cs:58 / BuildMode.cs GatherOutputItems /
UEBuildTarget.cs:1900)与本机对照实验(过滤后 1 vs 21 待执行动作);单元测试只断言 args 形态与贯穿逻辑。

---

# 独立评审报告(第 3 轮:全仓库审计 19 条缺陷修复,2026-10-25)

## verdict: changes-requested

**0 critical / 3 major / 8 minor**

评审对象:`ddccd64` 之上工作区未提交 diff(88 文件)。评审者:独立 verifier 子 agent(全新上下文,只读取证,不改代码)。
19 条缺陷判定:**已修复 14 / 部分修复 5 / 未修复 0**。

### 契约合规 —— 通过(1 条 minor)

契约修订与实现逐字段对齐:`MCPFailure`(`required:[ok,error,isError]`)、`MCPDispatch` 移除 `isError`、`responses.MCPDispatched` 改 `oneOf`、`ue_get_build_errors` 的 `buildId` / `reason`、`BuildSummary` 的 `buildId` / `startedAtIso`、`Error.details` 允许 additionalProperties —— 六项全部对上实现。
设置项三处齐备(26 项,`package.json` / `package.nls.json` / `package.nls.zh-cn.json` 键名一致),`decisions.md` D10 与实现一致。

> 唯一瑕疵:`reason` 在 schema 里只是 `type: string`,枚举值仅存在于 description → 记 minor(第 4 轮已修)。

### 三个 major(均可复现,非风格问题)

| 编号 | 问题 | 实证 |
|------|------|------|
| MAJOR-1 | **D9 的 TaskProvider 在含空格路径下必然失败** —— `ProcessExecution` 的 options 漏 `windowsVerbatimArguments`,与 `buildRunner` 的写法不一致 | 评审者在系统临时目录构造带空格的 `Build.bat` 实跑:A(TaskProvider 现状)→ exit 1 `The network path was not found.`;B(buildRunner 写法)→ exit 0 |
| MAJOR-2 | **D14 写盘目标与 clangd 读取路径分叉** —— `fs.symlink` 失败回退 `fs.copyFile`(**Windows 默认状态**)时,写的是项目根副本,clangd 读的是 helper 目录旧副本 → D1 的成果对 clangd 不可见,全程静默 | `symlink.ts:102-141` 的 `catch → copyFile` 退化分支 + `.clangd` 的 `CompilationDatabase: '.vscode/vscodeuehelper'` |
| MAJOR-3 | **D5 的 `fmsCompatibilityVersion` 写入源与代码注释直接矛盾** —— 注释说「重新读一次」,实际只有 `config.update` 用了重读值,`.clangd` 渲染仍用探测值 | `setSystemIncludes.ts` 内 `renderClangdFlags({ fmsCompatibilityVersion: params.fmsCompatibilityVersion })` vs 同函数下方注释 |

### 八个 minor

| 编号 | 内容 | 处置 |
|------|------|------|
| MINOR-1 | D15 残留:silent 模式仍弹非模态 warning(`_resolve.ts:65` / `:86` 不区分 silent) | 第 4 轮已修 |
| MINOR-2 | README 测试数字滞后(写 1407 tests / 116 files,实测 126 文件 / 1534 用例) | 第 4 轮已修 |
| MINOR-3 | e2e 断言未覆盖新增命令(硬编码 22 个,实际 28 个) | 第 4 轮已修 |
| MINOR-4 | 契约 `reason` 无 `enum` 约束 | 第 4 轮已修 |
| MINOR-5 | `CONFIG_VALUE_KINDS` 非封闭集合 —— 防御深度不足,当前**不可达**(所有调用点先经 `getConfigKey` 的 `hasOwnProperty` 过滤) | 登记遗留 |
| MINOR-6 | D9 `resolveTask` 丢失 detail/group —— rebuild / clean 任务被标成 "Compile UE project" | 第 4 轮已修 |
| MINOR-7 | D11 根因未解 —— 未知参数只进 warnings 被丢弃,不透传给真实 clangd | 登记遗留(计划明确只做忽略) |
| MINOR-8 | D16 / D8 未覆盖 TaskProvider 路径 —— Task 直接 spawn UBT 不经 `executeBuild`,不加锁、不写快照 | 登记遗留(架构级改动,超出本轮范围) |

### 值得肯定的实证(评审者独立验证)

- **D5 的统一入口是真统一**:三个写入方(`controlPanel.ts:589` / `setSystemIncludes.ts:304` / `completionMode.ts:94`)全部改走 `writeClangdAddFlags`,无残留 `resolveFlags` 直调。
- **D3 的注释保留是真的**:合并走逐层递归 `map.set`,非整体替换。
- **D8 早退收口完整**:并发守卫 / inner 早退 / 异常 / 转发 Live Coding 四条路径都写快照,且用 `snap.buildId !== buildId` 判重避免覆盖真实快照。
- **D10 修复比表面更深**:客户端→服务端的响应走 `processClientMessage` 兜底透传,不会误删客户端关联。
- **D12 恢复目标不再错位**:找不到同名备份时**不退化**为「取第一个」。
- **D13 去 shell 后无注入面**:`spawn(editorPath, args)` 不经 shell,调用方 try/catch 完整。

### S1-S8 套路扫描

S1 mock 冒充实现 / S2 路由未接线 / S3 吞错误 / S4 全 200 综合征 / S5 契约字段未消费 / S7 占位残留 / S8 校验只在文档里 —— **全部未命中**。
S6 测试只测 mock —— **D7 有效**(`logger.test.ts:105-106` 断言 `appendLine` 被调用而 `console.log` **未**被调用,钉住真实 stdout 洁净性)、**D19 有效**(数组/对象/标量三态分别断言)、**D10 有效**(`bridgeIdNamespace.test.ts:108-146` 真发帧验证关联不丢)。

### 文档一致性

两个「易错点」**均已正确表述**,未把计划当实现:
- `.clangd` 多文档旧行为写「旧实现用 `yaml.parse()`,遇到第二个文档直接抛 `Source contains multiple documents`」——与 `yaml.parse` 真实行为一致,**不是**「只保留第一个文档」;
- 设置项键名写 `clangd.msvcRoot` / `clangd.sdkRoot` / `clangd.fmsCompatibilityVersion` —— 与 `package.json` 实测键名一致。

不一致处:MINOR-2(README 数字)、MINOR-3(e2e 断言)、MAJOR-1(`src/build/AGENTS.md` 称 taskProvider 的 cmd 包装「与 `buildRunner.ts` 的处理保持一致」,实际漏了 `windowsVerbatimArguments`)。

### NOT_RUN 声明(评审者自述)

1. 真实 UE 引擎 / UBT 构建(本机无 UE 安装与 `Build.bat`);
2. 真实 clangd 语言服务器(本机无 clangd 二进制);
3. 真实 VS Code 实例 / 控制面板首屏渲染时序;
4. Cursor / Claude Code 宿主内的 MCP 端到端;
5. Windows 符号链接权限的**真实**退化场景(评审者账号具备创建 symlink 权限,MAJOR-2 属代码级判定);
6. `npm run test:e2e` 的 4 个用例(需真实 EDH + 已装 clangd 扩展);
7. 主会话报告的全量回归结论(typecheck / lint / vitest / build)—— 未重跑。

> 评审者在系统临时目录的夹具(`%TEMP%\vscodeuehelper_d9_731dac82`)因工作区外删除策略未能清除,**未污染仓库**。

---

# 第 3 轮 major 的当场修复(2026-10-25)

| 编号 | 修法 | 关键决策 |
|------|------|---------|
| MAJOR-1 | 整条 UBT 命令放进环境变量 `VSCODEUEHELPER_UBT_CMD`,命令行只留 `%VSCODEUEHELPER_UBT_CMD%` | 评审建议的「给 `ProcessExecution` 加 `windowsVerbatimArguments: true`」**不可行** —— `vscode.ProcessExecutionOptions` 在 `@types/vscode` 1.136.0 里只有 `cwd` / `env`,加了编译不过。六形态实测只有「环境变量」与「临时 .bat 包装」能跑通,取前者(无临时文件、无清理逻辑)。根因见 VS Code 官方源码 `terminalTaskSystem.ts`:ProcessExecution 走非 shell 分支,args 原样交给进程 |
| MAJOR-2 | 新增 `resolveCompileCommandsWriteTarget(linkPath)`,写入前解析出**真实目标** | 用 `readlink` 而非 `realpath` —— 后者在 Windows 返回 `\\?\` 前缀,会污染后续路径比较 |
| MAJOR-3 | `applySystemIncludes(params)` 删除 `fmsCompatibilityVersion` 参数,按选中的 msvcRoot 内部读一次 | 删参数是为了根除「两条路径各自传值」的可能性,而不只是让本次恰好相等 |

修复后全量回归暴露 4 个测试文件失败 —— **全部是测试自身适配问题,不是产品代码缺陷**:3 个因全局 vscode mock 缺 `TaskGroup`(模块级常量 `TASK_KINDS` 在加载期就读 `vscode.TaskGroup.Build`),1 个因旧断言与 MINOR-1 新行为冲突。处置见 `verification.md` §9.9.4。

修复后回归:typecheck 0 错 / lint 0 errors 61 warnings / **vitest 127 文件 1553 用例全绿** / build 成功。

---

# 独立评审报告(第 4 轮:第 3 轮 major 修复后的复审,2026-10-25)

## verdict: changes-requested

**0 critical / 1 major / 3 minor**

评审者:独立 verifier 子 agent(全新上下文,只读取证,不改代码)。**未采信第 3 轮的实施方结论**,全部用独立脚本在 `%TEMP%` 重跑实证(评审前后 `git status --short` 均为 119 行,未修改任何项目文件)。

### 三个 major 的逐条复核

| 编号 | 判定 | 评审者的独立实证 |
|------|------|------------------|
| MAJOR-1 | **已真正修复** | 用 Node `child_process.spawn` 复刻 VS Code `ProcessExecution` 的 libuv 非 shell 转义,实跑 5 种形态:新写法(env var + `/d /s /c %VAR%`)**PASS**;旧写法(含/不含 `/s`)**FAIL**(`'\"C:\...\"' is not recognized`);环境变量里路径不加引号 **FAIL** —— 证实引号是必需的。**并追加核实了实施方未论证的前提**:`ProcessExecutionOptions.env` 官方注释 *"merged with the parent process' environment"*,VS Code 源码 `shellLaunchConfig.env = { ...env, ...options.env }` + `useShellEnvironment = true` → env 是**合并**语义,`cmd.exe` 不会因丢 PATH 起不来 |
| MAJOR-2 | **部分修复** | `resolveCompileCommandsWriteTarget` 四种形态实测全对(含相对链接),但**第 3 条写盘路径漏改** → 见下方 MAJOR-2-残留 |
| MAJOR-3 | **已真正修复** | `applySystemIncludes` 签名里确无 `fmsCompatibilityVersion` 形参;追查唯一候选的第二条路径(config 变更触发的重写)后确认:`setSystemIncludes` 在写 `.clangd` **之前**已 `await config.update(...)`,两条路径取同一个值,无分叉。删形参确实根除了「两条路径各自传值」 |

### 问题清单

| 编号 | 严重级 | 位置 | 问题 | 处置 |
|------|--------|------|------|------|
| MAJOR-2-残留 | major | `src/clangd/completionFiles.ts:585` | **第三条写盘路径** `addCompletionHelperToCompileCommands` 未接入 `resolveCompileCommandsWriteTarget`;且 `createProject.ts:458` 传的是**项目本地副本**而非 helper 目录路径。评审者实测复现:copy 回退场景下 clangd 读到的 helper 路径条目数 1、项目本地 2 → helper 条目对 clangd **完全不可见**,静默失效、无报错 —— 与上一轮 MAJOR-2 症状同构 | **已修**(见下) |
| MINOR-1 | minor | `README.md:199` | 命令表仍写 `Windows spawn (cmd /c start)`,代码已直接 spawn `.exe` | **已修** |
| MINOR-2 | minor | `doc/02-modules.md:119` / `:172` | ①称 `launchEditor.ts`「按平台分支(cmd / open / exec)」,实际 Windows-only 直接 spawn、无平台分支;②称 `compileCommands.ts`「符号链接到工作区根」,实际 symlink 失败会回退为独立副本(Windows 默认状态) | **已修** |
| MINOR-3 | minor | `verification.md` §9.9.2 | 悬空符号链接的行为描述与实现不符(写的是「回落为链接路径本身」)。评审者实测:实际是**仍写它指向的路径**;且文档那种写法**反而更差** —— rename 会把符号链接换成普通文件,链接语义丢失。**代码是对的,文档写反了** | **已修**(文档改对,并补回归用例钉住真实行为) |

### 评审者额外发现(既有状态,非本轮引入)

- `package.json` 的 `contributes.problemMatchers` 条目只有 `owner` 没有 `name` —— problemMatchers 按 `name` 解析、`owner` 不参与查找,故 VS Code 侧该 matcher 可能不被加载。`git show HEAD:package.json` 证明是**既有状态**。不影响本轮 major 判定,建议单独排期核实。

### 19 条缺陷判定(第 4 轮)

**已修复 18 / 部分修复 1(D14,因 MAJOR-2-残留)/ 未修复 0。**

### 契约一致性 ✓

`openapi.yaml` 与实现逐项对得上:`reason` 的 `enum: ['no-build','build-in-progress']`、`MCPDispatch` 收敛为成功载荷、`MCPFailure` 新增、`responses.MCPDispatched` 改 `oneOf`、`server.ts` 成功时不出现 `isError` 键。`decisions.md` 含 D10,`active_count: 10` 正确。

### MINOR 遗留登记核实 ✓

MINOR-5 / MINOR-7 / MINOR-8 三项**均如实登记**,措辞准确,未发现「承诺了但代码没做」。

### 第 4 轮后的当场修复

| 编号 | 修法 |
|------|------|
| MAJOR-2-残留 | ①`completionFiles.addCompletionHelperToCompileCommands` 内部先 `resolveCompileCommandsWriteTarget` 解析真实目标,且**读的文件与写的文件是同一个**(读 A 写 B 同样会分叉);②`createProject` 把 `linkPath` 提升到函数作用域,step 4 改传 `linkPath`(helper 目录里 clangd 实际读的那个文件)而非 `jsonPath`。回归:`completionFiles.test.ts` 新增 4 例(copy 回退 / 符号链接 / DB 不存在 / 悬空链接)+ `createProject.test.ts` 2 处断言 + `compileCommandsDb.test.ts` 悬空链接 1 例 |
| MINOR-1 | `README.md:199` → `Windows spawn (direct .exe, no shell)` |
| MINOR-2 | `doc/02-modules.md:119` → Windows-only 直接 spawn;`:172` → 补注 symlink 失败回退为独立副本 |
| MINOR-3 | `verification.md` §9.9.2 悬空链接一行改为实际行为,并补回归用例 |

修复后回归:typecheck 0 错 / lint 0 errors 61 warnings / **vitest 127 文件 1553 用例全绿** / build 成功。

---

# 独立评审报告(第 5 轮:终审,2026-10-25)

## verdict: approved

**0 critical / 0 major / 7 minor**(另有 2 条观察项、2 条规划工件记账遗留,均不阻断)

**19 条缺陷判定:已修复 19 / 部分修复 0 / 未修复 0。**

评审者:独立 verifier 子 agent(全新上下文,只读取证,不改代码;评审前后 `git status --short` 均为 123 行、HEAD 仍为 `ddccd64`)。

### 对 MAJOR-2 残留修复的复核:**已真正修复**

评审者在 `%TEMP%` 建仓库副本,用 `vi.mock('node:fs/promises')` 把 `fs.symlink` 强制成 `EPERM`,逼**真实的** `linkToWorkspaceRoot` 走 copy 回退分支,再跑真实的 `fillMissingCompileCommands` + `addCompletionHelperToCompileCommands`:

```
[VERIFY]       helper DB entries = 3   ← clangd 实际读的那份
                Game.cpp + BrandNew.cpp(补齐) + completionHelper.cpp
[VERIFY]       project-local DB entries = 1  ← 仍是 UBT 原始产物
[VERIFY-OLD]   helper DB has helper entry?  false   ← 旧写法对照组
[VERIFY-OLD]   project-local has helper entry? true
```

旧写法对照组**把静默失效原样复现**了 —— 证明该用例确在覆盖原缺陷。

代码落点核对:`completionFiles.ts` 先 `resolveCompileCommandsWriteTarget(ccPath)`、再读 `writeTarget`、再写 `writeTarget` → **读与写是同一个文件**;`createProject.ts` 的 `linkPath` 提升到函数作用域、step 4 传 `linkPath` 而非 `jsonPath`。

### 新增测试的强度判定:**会真红,不是自证式断言**

评审者做了**回退实验**(在副本里把修复改回旧写法再跑):

| 回退 | 变红的用例 |
|------|-----------|
| A:`completionFiles.ts` 去掉 `resolveCompileCommandsWriteTarget` | `completionFiles.test.ts`「符号链接形态」红(`lstat().isSymbolicLink()` 变 false + 项目本地副本拿不到 helper 条目) |
| B:`createProject.ts` 改回传 `jsonPath` | `createProject.test.ts`「非 fallback 路径」红(实参断言) |
| A+B(还原第 4 轮原始缺陷) | 两条都红 |

### 写盘路径穷举

**DB 的内容写入点共 4 处**(另 3 处 `copyFile` 是「建立一份 DB」而非写内容)。前 3 处全部经 `resolveCompileCommandsWriteTarget`、读写同一目标;第 4 处(fallback stub DB)是唯一有意例外且有注释与语义依据。**不存在遗漏。**

### 7 条 minor 的处置

| 编号 | 内容 | 处置 |
|------|------|------|
| **M1** | `src/commands/uninstall.ts` 的清理清单仍写 D12 之前的旧备份路径 `.vscode/.code-workspace.backup` → **插件自己创建的 `.vscode/uehelper-backup/` 永远不会被清理**,与 README「Uninstall (Clean Generated Files)」不符 | **已修**(评审建议本轮修)—— 备份目录路径抽成单一真相源 `getWorkspaceBackupDir()`(从 `@clangd/workspaceBackup` 导出),uninstall 据此清理,并保留旧路径作为历史遗留一并清掉;补回归用例 |
| M2 | README 命令表只列 23 条(声称 28) | **已修** —— 补全缺的 5 条 |
| M3 | `doc/02-modules.md` §6 表只列 21 条(标题写 28) | **已修** —— 补「工具与辅助」分组 7 条 |
| M4 | `chapter-01` 的「27 命令 + 9 工具」与证据行号偏移 | 登记遗留(生成器未重跑,交付时 `/ql-doc` 处理) |
| M5 | `chapter-06` 的「9 个 MCP 工具」与证据行号偏移 | 同上 |
| M6 | README `out/extension.js (~826kb)` vs 实测 1599.9 KB | **已修** —— 改为 ~1.6mb |
| M7 | 「全部 DB 写入点只有 4 处」表述边界不严谨(另有 3 处 copyFile) | **已修** —— 改为「DB 的**内容**写入点共 4 处」并补注 3 处 copyFile 属「建立副本」 |
| M8 | `createProject` 链路仍是两次原子写,与 AGENTS.md「一次刷新只写一次」不一致 | 登记遗留 —— **语义不同**:那条铁律说的是 `executeGenerateCompileCommands` 的**刷新**链路;`createProject` 是 5-step 脚手架流水线,step2 补齐 / step4 注入 helper 本就是两个独立步骤,合并会改变步骤语义(属架构级改动) |

### 2 条观察项(不阻断,已登记)

- **O1**:`completionFiles.ts` 的 `ccJsonPath` 原本有默认分支(落到**项目本地副本**),与本轮新立的不变量相悖。当前唯一调用方总是传 `linkPath`,无实际影响;但将来漏传会静默写到 clangd 读不到的那份。**已修** —— 去掉默认分支,参数**必填**,漏传在编译期就红。
- **O2**:copy 回退形态下项目本地副本与 helper 副本永久分叉。只影响「是否判定需要重跑 UBT」,**不影响 clangd**。登记为遗留。

### 第 5 轮后的当场修复

| 项 | 修法 | 回归 |
|----|------|------|
| M1 | `workspaceBackup.ts` 导出 `getWorkspaceBackupDir(projectDir)`(单一真相源);`uninstall.ts` 改用它清理,并保留旧路径一并清 | `uninstall.test.ts` 新增 1 例(M1) |
| O1 | `addCompletionHelperToCompileCommands` 的 `ccJsonPath` 改**必填**,去掉默认分支 | TS 编译期保障 |
| M2 / M3 / M6 / M7 | 文档修正 | — |
| 回归网补强 | 评审指出「copy 回退场景没有从链路入口到真实文件的端到端用例」→ 新增 `test/unit/clangd/compileCommands/writeTargetE2e.test.ts`(2 例,真实文件系统 + 强制 symlink 失败,驱动真实的 `linkToWorkspaceRoot` → `addCompletionHelperToCompileCommands` 链路) | 2 例 |

第 5 轮修复后最终回归:typecheck 0 错 / lint **0 errors / 61 warnings**(与基线同)· vitest **127 文件 / 1553 用例全绿** · build 成功。
