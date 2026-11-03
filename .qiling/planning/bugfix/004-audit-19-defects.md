---
bugfix: 004
slug: audit-19-defects
status: fixed
fixed_at: '2026-10-25T23:58:00+08:00'
severity: major
review: approved(第 5 轮终审,2026-10-25,0 critical / 0 major / 7 minor;19 条缺陷「已修复 19 / 部分修复 0 / 未修复 0」)
base_commit: ddccd64
defect_count: 19
contract_changes: 'D8 构建快照 / D17 MCP 响应'
---

# bugfix-004:全仓库只读审计的 19 条缺陷修复

> **编号说明**：本文件里的 `D1`–`D19` 是 **2026-10-25 审计缺陷编号**，与
> `.qiling/planning/context/decisions.md` 里的**决策编号**（D1–D10）是两套独立编号 ——
> 决策账本记录「为什么这么定」，本文件记录「哪个缺陷、改在哪、怎么验的」。
> 代码与测试里的 `[Dxx]` 标记（如 `test/unit/clangd/clangdRewriteTrigger.test.ts`、
> `src/clangd/AGENTS.md`）一律指**本文件的缺陷编号**。

## 背景

一次全仓库只读审计（4 个并行审计 agent + 主会话交叉核实）产出 20 条编号缺陷与约 28 条较小发现。
**所有「零引用 / 死代码」类结论都用 node 递归脚本与原生 `rg` 交叉验证过** —— 本工作区的
grep 工具会静默跳过名为 `build` 的目录（`src/build/**` 约 1900 行），只信 grep 会误判。

本轮只修这 19 条编号缺陷；**精简类改动（死代码清理等）按用户拍板另排期**；
第 20 条（代理性能）同样另排期。

## 缺陷清单与落点

| 编号 | 缺陷 | 主要落点 | 回归测试 |
|------|------|---------|---------|
| D1 | 补齐的 compile_commands 条目命令行仍指向旧源文件 | `src/clangd/compileCommands/fillMissing.ts` | `compileCommandsDb.test.ts` |
| D2 | 指纹不含源文件 → 快路径命中 → UBT 根本不启动 | `src/clangd/compileCommands.ts`（`probeMissingSourceEntries`） | `compileCommandsDb.test.ts` |
| D3 | `.clangd` 多文档 YAML 解析抛异常 → 读不了也改不了 | 新增 `src/clangd/clangdYaml.ts` + `clangdOps.ts` | `clangdMultiDoc.test.ts` |
| D4 | 编译数据库候选顺序偏向引擎根 | `src/clangd/compileCommands.ts` | `compileCommandsDb.test.ts` |
| D5 | `.clangd` 的 `CompileFlags.Add` 有 3 条独立写入路径 → 谁最后写谁赢 | 新增 `src/clangd/clangdFlagRenderer.ts` 等 | `clangdFlagRenderer.test.ts` 等 5 个 |
| D6 | 控制面板首屏 HTML 在 projectName 为空时就赋值 | `src/ui/controlPanel.ts` | `controlPanel.test.ts` |
| D7 | MCP 的 stdout 协议帧流被 `logger.info` 污染 | `src/core/logger.ts` + `src/mcp/index.ts` | `logger.test.ts`、`mcp/index.test.ts` |
| D8 | 构建早退路径不写快照 → `ue_get_build_errors` 返回旧结果 | `src/build/lastBuild.ts` + `commands/build.ts` + `mcp/tools.ts` | 4 个测试文件 |
| D9 | TaskProvider 返回空壳任务 | `src/build/taskProvider.ts` 等 | `taskProvider.test.ts` |
| D10 | 代理请求关联 id 无命名空间 → 同 id 串扰 | `src/clangd/proxy/messages.ts` + `bridge.ts` | `bridgeIdNamespace.test.ts` |
| D11 | 代理遇到未知 CLI 参数直接整进程退出 | `src/clangd/proxy/cliArgs.ts` + `cli.ts` | `proxy/cli.test.ts` |
| D12 | 备份与恢复各自独立找「第一个 .code-workspace」；`launch.json` 从未备份 | `src/clangd/workspaceBackup.ts` | `workspaceBackup.test.ts` |
| D13 | 启动编辑器走 `cmd /c start` → 路径含空格/`&` 时起不来 | `src/build/launchEditor.ts` | `launchEditor.test.ts` |
| D14 | compile_commands 两处整体覆盖写、无原子性、一次刷新写两遍 | 新增 `src/clangd/compileCommands/dbFile.ts` 等 | `compileCommandsDb.test.ts` 等 |
| D15 | silent 模式仍弹 QuickPick 与模态错误框 | `src/commands/setSystemIncludes.ts` | `setSystemIncludes.test.ts` |
| D16 | 构建与 Live Coding 可同时跑 | 新增 `src/build/lock.ts` | `liveCoding.test.ts` |
| D17 | MCP 失败响应不带 `isError` → AI 代理错误分支永不触发 | `src/mcp/tools.ts` + `server.ts` | `server.test.ts`、`tools.envelope.test.ts` |
| D18 | webview 消息与配置值只做存在性检查 | `src/ui/controlPanelMessages.ts` + `controlPanel.ts` | `controlPanel.test.ts` |
| D19 | `Config.update` 写盘校验比较序列化字符串 | `src/core/config.ts` | `configValueCompare.test.ts` |

## 契约改动（D8 / D17 —— 先改契约、再改实现）

按仓库铁律「契约不可直接改，改行为先改契约」，本轮先修订
`.qiling/planning/context/openapi.yaml`，再改实现：

- **D8**：`ue_get_build_errors` 响应增补可选 `buildId` 与 `reason`
  （`no-build` / `build-in-progress`）；`BuildSummary` 增补可选 `buildId` / `startedAtIso`。
- **D17**：`MCPDispatch` 明确为「成功载荷」并移除其 `isError`；
  新增 `components.schemas.MCPFailure`（`required:[ok,error,isError]`，`ok` const false，
  `isError` const true）；`responses.MCPDispatched` 改 `oneOf: [MCPDispatch, MCPFailure]`。

决策依据见 `decisions.md` 的 **D10**（构建快照早退收口）。

## 验收

- 19 条全部有**行为级**回归用例（用 `[Dxx]` 标记钉在测试文件里）。
- 全量回归：`typecheck` 0 错误 · `lint` 0 errors / 61 warnings · `vitest` 127 文件 / 1553 用例全绿 · `build` 成功。
- `npm run format:check` 失败 266 文件 —— **仓库基线即失败**，非本轮引入。
- 6 项需真实 UE / clangd / VS Code 的手工验收项**未在本机完成**，已在
  `.qiling/planning/build/verification.md` §9.7 登记。
- 独立评审结论见 `.qiling/planning/build/review.md`（第 3 轮 changes-requested；3 个 major
  当场修复后见第 4 轮）。

## 用户拍板的三项决策

1. **MCP 只做进程内修复 + 文档如实标注** —— 不做独立进程化（前置条件是解耦
   `detection` / `commands` 层的 vscode 运行时依赖）。
2. **本轮只修 19 条缺陷** —— 精简类改动另排期。
3. **TaskProvider 接线真实 UBT 命令** —— 不删 provider。
