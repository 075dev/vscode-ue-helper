---
decisions_version: '1.0'
updated: 2026-10-25
active_count: 10
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
| D8 | clangd 路径解析统一为 **ClangdLocator 单服务**(懒探测 + 缓存 + 失效),对外暴露两个视图:`resolveRealClangd()`(排除本扩展 proxy launcher,供 clangd 代理链路)与 `locateClangDriver()`(clangd + 由 `clangd --version` 的 InstalledDir 推导 clang 驱动器,供 MSVC/SDK 探测链路);候选源(插件 `vscodeUEHelper.clangdPath`、第三方 `clangd.path` 当前值与备份值、`where clangd`、PATH 遍历、默认 LLVM 目录)收敛为一份,保留来源标签与检查记录 | 现状两条链路(realClangdResolver 6 级 / windowsSdk.findClangdExecutable 4 级)已实际漂移:默认 LLVM 目录列表在 proxyManager.ts 与 windowsSdk.ts 各硬编码一份,`where clangd` 仅 SDK 链路使用,后续追加搜索路径(如 UE 自带 LLVM)需改两处、漏一处即产生"proxy 能找到而 SDK 探测找不到"类缺陷;激活性能约束(`where` 5s 超时 + PATH 遍历 + `clangd --version` 子进程)决定不能在 activate 全量预取,懒探测 + 缓存是唯一兼顾启动速度与统一管理的形态 | ① activate 时全量预取一次——启动路径立即拿到结果但 `where` 最长 5s 会拖慢扩展激活,否;② 两链路保留仅共享目录常量——改动最小但解析行为继续漂移,重复的 PATH 遍历与存在性检查仍各一份,否 | 首次调用方承担探测延迟(`where` 最多 5s);缓存失效需监听 `vscodeUEHelper.clangdPath` 配置变更与 proxy enable/disable,漏挂监听会读到过期路径;realClangdResolver 现为同步纯函数(同步 fileExists 注入),统一后 resolveRealClangd 转异步,proxyManager 调用点需相应 await | active | 2026-10-03 |
| D9 | 新增源文件的 compile_commands 刷新改为**默认自动重建 + 配置开关**:`vscodeUEHelper.compileCommandsAutoRefresh`(默认 true)= 新增 C++ 文件时后台静默重建(复用 `executeGenerateCompileCommands` 管线,`quiet` 语义:无 picker、无成功弹窗、跳过"重启 clangd?"询问、失败不弹窗只落日志),自动模式节流 2 分钟(`DEFAULT_AUTO_INTERVAL_MS`,首拍即建)且 inFlight 防重入(UBT 分钟级,跑完前忽略新批次);关闭后回到现有 10 分钟节流提示模式 | 现状提示模式(compileCommandsHint,借鉴 boocs/unreal-clangd)要求用户手动点"更新"——用户反馈期望免干预;`ignoreInitial: true`(fileWatcher.ts:137)已保证启动初始扫描不触发 add 事件,自动模式不会开机误跑全量重建;clangd 12+ 对 compile_commands.json 有热重载,quiet 模式跳过"重启 clangd?"询问不损失功能(旧版 clangd 手动 restart 即可,日志留痕);沿用既有 vscode.commands.executeCommand 间接调用(avoid clangd → commands 循环依赖,compileCommandsHint.ts 头注释既有决策) | ① 完全自动且不加开关——最强一致但 UE 批量生成/切换分支场景会周期性触发分钟级 UBT,需给用户退路,否;② 仅缩短提示节流不改自动——未解决"要人工干预"的本源诉求,否;③ hint 直接 import commands 管线函数——违反 compileCommandsHint.ts 既有防循环依赖决策,否 | 自动模式下 IntelliSense 更新最多延迟一个节流窗(2 分钟,比提示模式"即时点击"慢);批量加文件时每 2 分钟一次分钟级 UBT 的 CPU/IO 负担(节流 + inFlight 护栏,`compileCommandsAutoRefresh=false` 可整体关闭);executeGenerateCompileCommands 形参再加一层 opts(quiet),注册层 handler 签名同步扩展 | active | 2026-10-05 |
| D10 | 构建快照(`ue_get_build_errors` 数据源)**新增 `buildId` + `startedAtIso`**,且构建命令的**每一个早退分支**(没选到项目/没选到引擎/并发守卫/用户取消/转发 Live Coding)都补写一条失败快照;MCP 空态响应新增 `reason`(`no-build` / `build-in-progress`);MCP dispatch 层对 **resolve 出来的错误信封**也记日志(不只 catch rejection) | 旧实现下 MCP 是 fire-and-forget(决策 D4),agent 触发 `ue_build` 后读到的快照可能属于**上一次**构建 —— 早退(比如没选到项目)时 MCP 完全静默,agent 会把上一次成功结果当成本次"编译通过"并据此做出错误的修复决策;构建进行中读快照同样会读到上一轮结果。`buildId` 让 agent 能判断结果属于哪一次尝试,`reason` 让 agent 知道该重试还是该先触发构建。dispatch 吞错是同一根因的另一半:命令层 resolve 出 `errEnvelope` 时旧代码只 catch rejection,失败在 MCP 侧零可见性 | ① 让 MCP 改为等待构建完成再返回 —— 推翻 D4 已确认的 fire-and-forget 架构,9 个工具全部受影响,否;② 只在 MCP 层加"构建中"锁,命令层不改 —— 命令层快照仍是旧结果,只解决一半;③ 把快照挪到磁盘持久化 —— 进程内共享已满足(MCP 与扩展宿主同进程),落盘引入陈旧文件与清理负担,否 | 快照结构新增两个字段,`rememberBuildSnapshot` 的调用方(命令层 3 处 + 测试 fixture)需同步补字段;`ue_get_build_errors` 空态响应多 `reason` 字段,依赖旧响应形状的 agent 需容忍新键;构建进行中时 `ue_get_build_errors` 不再返回上轮摘要,agent 必须实现"轮询直到 hasResult=true"的循环 —— 这是刻意的约束,避免误读旧结果 | active | 2026-10-25 |

## 质量标准(三条硬标准,不达标不算决策轨迹)

1. **reason 绑定具体细节** —— 必须引用本次讨论/本项目的事实,不写"更优雅"这类万金油
2. **alternatives 是真选项** —— 必须是讨论中真实考虑过的命名方案,不是稻草人
3. **tradeoff 是真代价** —— 写清这个选择"更差在哪",不写审美托词

## 追加纪律

- 编号单调递增,不复用、不重排
- 推翻旧决策:旧行 status 改 `superseded(取代者:D-N)`,新行首列写 `取代 D-M`
- /ql-add 的每条新决策与本账本既有条目冲突时,必须走"取代"流程,不允许静默另起炉灶
