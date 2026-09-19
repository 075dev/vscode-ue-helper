---
review_round: 1
reviewed_at: 2026-09-20
base: 263848e
head: ba8a897
range_commits: 20
diff_scope: 51 文件(+2857/-491);src 侧仅 src/commands/*(24 文件)+ src/core/envelope.ts(新增)+ src/mcp/tools.ts,逻辑层(src/build、src/core 其余、src/clangd、src/detection)diff 零改动
strictness: THOROUGH(>20 文件;宪法 C1-C8 全量对照 + S1-S8 全量扫描)
verification_trust: verification.md verified_at_commit(ba8a897)== 当前 HEAD,工作区除 .planning/ 工件外干净 → 无 stale_state / dirty_worktree;PASS 命令未重跑
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
