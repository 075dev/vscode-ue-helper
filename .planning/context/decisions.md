---
decisions_version: '1.0'
updated: 2026-09-25
active_count: 7
superseded_count: 0
---

# 决策轨迹(Decision Trace)

> 设计决策的留痕账本:**选了什么、为什么、否掉了什么、代价是什么**。
> 消费方:/ql-build 的协调器与 worker、/ql-fix 的根因判定、独立评审。

## 决策记录(append-only)

| # | 决策(decision) | 理由(reason) | 否掉的备选(alternatives) | 代价(tradeoff) | 状态 | 日期 |
|---|----------------|---------------|--------------------------|-----------------|------|------|
| D1 | 阶段 1 契约化范围取**插件能力全景**(27 命令 + 9 MCP 工具一次性全覆盖) | 项目已成熟(src 148 个 TS 文件、能力面稳定),全景契约一次性建立验证基线,后续阶段增量追加即可;聚焦单批变更会把全景规格化无限期后推 | 聚焦当前未提交变更(switchHeaderSource + liveCoding/UBT 增强)——闭环更快但覆盖面窄,存量 30+ 能力仍无契约可依 | 讨论与构建验收面宽,单阶段工作量大;部分交互式命令(createProject 向导)契约只能定义到入口语义 | active | 2026-09-19 |
| D2 | 27 个命令建模为 **RPC 式显式端点**(每命令一个路径 `/commands/{短名}`,短名=命令 ID 去前缀) | 与 src/commands/index.ts 的 registerCommand 注册表一一对应,验证器可逐条机械断言,worker 任务卡可直接按路径切分;资源式分域需要额外维护"路径↔命令"映射表 | 资源式分域路径(/build、/clangd-proxy 等按域聚合)——更 REST 化但与注册结构错位 | 36 个端点样板量大;弱 REST 语义(全是 POST),对 HTTP 工具链不友好——本项目非 HTTP 服务,代价可承受 | active | 2026-09-19 |
| D3 | 构建类长任务(UBT 可达分钟级)在契约中**如实描述为同步执行**(响应含 exitCode/耗时,注明分钟级特征) | 现有 executeBuild 链路就是同步等待 + 进度流式反馈,契约描述现实可让构建阶段做"对齐验证"而非"重构";异步任务模型超出"契约化存量"的阶段定位 | 异步任务模型(返回任务句柄 + 状态轮询端点)——更优雅但需重构构建链路与全部调用方 | 契约响应无法表达"进行中"中间态,消费方只能等最终响应;若未来要并行多构建需修订本契约 | active | 2026-09-19 |
| D4 | MCP dispatch 类工具**契约如实描述 fire-and-forget 语义**(响应只确认 dispatch,结果经 ue_get_build_errors 回读);ue_get_build_errors 建模为同步快照查询 | src/mcp/tools.ts 的 callTool 是同步签名 + dispatch 不等待,这是既成架构且注释明确("不阻塞 AI agent");契约发明等待完成语义会与实现系统性冲突 | 契约定义"等待完成"语义并要求 MCP 层改为可等待 —— 语义更完整但推翻既有设计,且 9 个工具全部受影响 | AI 消费方需要两次调用(build + get_build_errors)才能拿到结果,单工具不自足;该模式已在工具 description 中显式告知 | active | 2026-09-19 |
| D5 | 统一响应 envelope `{ok, summary?, data?, error?}` + 全局错误码枚举(9 项),不按域拆分错误模型 | MCP 面已有 `{ok, error}` 事实标准(callTool 全部返回此形状),命令面向其对齐使两侧错误处理一致;全局 9 项错误码足够当前错误场景映射 | 各域自定义错误结构 —— 表达力更强但破坏 envelope 一致性,验证器无法统一断言;直接复用 VSCode showMessage 字符串 —— 无结构可断言 | 纯 UI 命令(showControlPanel 等)现状返回 void,对齐 envelope 是目标口径,构建阶段需补齐返回值;9 项枚举未来可能不够用,扩充走契约修订 | active | 2026-09-19 |
| D6 | 契约定位 **spec-as-is**(存量能力规格化 + 目标口径标注),不借契约引入新架构 | 阶段 1 价值在"建立验证基线"而非"重新设计";把现实如实入约,验证器才能判定"实现符合契约";新架构诉求留给后续阶段显式讨论 | spec-as-piration(契约定义理想架构,构建阶段重写实现对齐)—— 会导致大规模重写存量稳定代码 | 契约中保留了现状的粗糙处(ue_build 非法 mode 静默回落、命令重入未拦截),它们以"待确认差距"形式登记在 event-flow.md 边缘场景而非契约强约束 | active | 2026-09-19 |
| D7 | 单模块编译以 `ue_build` **可选 `module` 参数**承载(仅 mode=build 生效,其余模式忽略 + 响应 warning),不建独立 `ue_compile_module` 工具 | UBT `-Module=` 是 target 构建链的**动作过滤参数**而非新操作语义(UE 5.8 源码 TargetDescriptor.cs:58 + GatherOutputItems 过滤),executeBuild → buildUBTCommand → lastBuild 快照 → ue_get_build_errors 全链路复用;独立工具名会复制同一 UBT 调用的第二条入口,并发守卫/快照/错误映射全要双份 | 独立 `ue_compile_module` 工具名(意图命名命中更高,参照 ue_rebuild 先例)——被否:ue_rebuild 有 `-Rebuild` 这个**不同 UBT 语义**撑腰,而模块编译与 build 的差异只是**参数过滤**,撑不起工具级分叉 | ue_build 参数组合空间变大(mode×module),需要"module 仅 build 生效"的忽略规则并在 MCPDispatch 加可选 warning 字段;契约 version minor +1 | active | 2026-09-25 |

## 质量标准(三条硬标准,不达标不算决策轨迹)

1. **reason 绑定具体细节** —— 必须引用本次讨论/本项目的事实,不写"更优雅"这类万金油
2. **alternatives 是真选项** —— 必须是讨论中真实考虑过的命名方案,不是稻草人
3. **tradeoff 是真代价** —— 写清这个选择"更差在哪",不写审美托词

## 追加纪律

- 编号单调递增,不复用、不重排
- 推翻旧决策:旧行 status 改 `superseded(取代者:D-N)`,新行首列写 `取代 D-M`
- /ql-add 的每条新决策与本账本既有条目冲突时,必须走"取代"流程,不允许静默另起炉灶
