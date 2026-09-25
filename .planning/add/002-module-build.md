---
add: 002
slug: module-build
status: reviewed
created_at: 2026-09-25T11:55:00+08:00
at: chapter-01
placement: auto(唯一重合)
review: approved(第 1 轮,0 critical;1 major 命令注入白名单 + 2 minor 已当场修复,1330/1330 复测全绿)
---

# add-002:ue_build 支持单模块编译(UBT -Module=)

## 需求

> AI agent 改完单个模块的代码后,能只编译该模块快速验证(秒级抓编译错误),而不是全 target 构建。
> 底层 = UBT 原生 `-Module=<名>` 参数(UE 5.8 源码 `TargetDescriptor.cs:58` 实证,本机已对照实验验证:
> 过滤后待执行动作 1 个 vs 全量 21 个)。

## 勘察与定位(add 步骤 0-2)

**UBT 语义边界(源码级实证,决定契约描述):**

- `-Module=` 是 target 构建链的**动作过滤参数**,不是新操作:`BuildMode.cs` `GatherOutputItems`
  把待执行动作过滤为指定模块的输出项(`UEBuildBinary.cs:789` 注册的是模块贡献给链接的输入文件集)。
- **只编译不链接**:不产出/更新模块 DLL,`bDeployAfterCompile` 在有 -Module 时被强制关闭
  (`UEBuildTarget.cs:1900`)。定位是"快速编译验证",编辑器用新代码仍需全量 build / Live Coding。
- 编出的 obj 被后续全量构建增量复用,不浪费。
- 模块名不预校验(合法集 = 项目 + 全部插件 + 引擎模块,插件侧不可枚举);UBT 找不到时报
  `Unable to find output items for module 'X'`,以普通构建失败进快照。
- 编辑器 Live Coding 激活时 UBT 拒绝普通构建(`Unable to build while Live Coding is active`),
  与现有编辑器感知构建(bugfix 链路)同场景,MCP silent 模式行为不变。

**落点判定:** 并入 **chapter-01**——自动判断(唯一重合):新功能是构建域(`/mcp/tools/ue_build`、
`BuildSummary`、`executeBuild` 链路)的参数化扩展,构建域全部位于 chapter-01。不新建章节。

**范围裁剪(本记录即边界):**

- ✅ MCP 面:`ue_build` 加可选 `module` 参数(fire-and-forget 语义不变,结果仍经 `ue_get_build_errors` 回读)
- ✅ 执行层参数贯穿:`UBTArgs` → `buildUBTCommand` → `executeBuild` → `LastBuildSnapshot` → `BuildErrorsSummary`
- ❌ 不做 VS Code UI 命令面(命令面板不暴露模块选择;UI 需要模块发现器,超出本批)
- ❌ 不动 `src/build/domain/`(UbtTask 实体为悬空骨架,src 主链路零消费,不在本次范围)
- ❌ 不做模块名校验/发现(理由见上;UBT 报错如实透传进快照)

## 契约面(openapi.yaml 0.1.0 → 0.2.0,minor:仅新增可选字段,向后兼容)

| 位置 | 变更 |
|------|------|
| `/mcp/tools/ue_build` requestBody | 新增可选 `module: string`(UBT -Module=;仅 mode=build 生效) |
| `MCPDispatch` | 新增可选 `warning: string`(mode=rebuild/clean 携带 module 被忽略时返回) |
| `BuildResult` | 新增可选 `module: string`(本次构建的模块过滤,未指定时缺省) |
| `BuildSummary` | 新增可选 `module: string`(快照对应的模块过滤,供 AI 识别快照范围) |
| `info.version` | 0.1.0 → 0.2.0 |

配套:`event-flow.md` 场景 2 payload 与边缘场景表更新;`decisions.md` 追加 D7(取舍:可选参数 vs
独立 ue_compile_module 工具)。

## 验收清单(构建 + 评审逐条断言)

1. `npm run typecheck` 通过;`npm test` 全绿(存量不回归)。
2. `buildUBTCommand({module})` 产出 args 含 `-Module="<name>"`;不带 module 时与现状逐字节一致。
3. `callTool('ue_build', {module:'Foo'})` 正常 dispatch 且 module 传抵执行层;`ue_build` 的
   inputSchema 描述含 module。
4. `callTool('ue_build', {mode:'rebuild', module})` 忽略 module,dispatch 响应含 warning 字段;
   clean 同理。
5. `executeBuild('build', …, module)` 成功路径:envelope data 带 module;快照 `LastBuildSnapshot.module`
   记录;`summarizeBuildErrorsForAgent` 透出 module;失败/异常路径快照同样带 module。
6. 不带 module 的调用全链路与现状行为一致(快照无 module 字段,envelope 无 data.module)。
