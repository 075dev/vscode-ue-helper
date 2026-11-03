# 骨架阶段报告(Walking Skeleton)—— vscode-ue-helper 阶段 1

- 工作分支:ql/phase-1-panorama(base 263848e0 → 现 5790c72)
- 整体状态:**partial** —— Wave 1(基础设施)完成并验证;Wave 2(四命令域 + MCP 面)因外部 API 配额耗尽未执行
- 日期:2026-09-20

## 1. 覆盖矩阵(契约 36 端点 ↔ 任务 ID,零遗漏)

| 域 | 任务 ID | 端点(operationId / 命令 ID) | 数量 | 存量实现 | envelope 对齐 |
|----|---------|-------------------------------|------|----------|----------------|
| 基础设施 | TASK_INFRA_ENVELOPE | —(支撑任务,对应契约 components.schemas.Envelope/Error) | - | - | **PASS**(已合并) |
| 构建域 | TASK_CMD_BUILD | build, rebuild, clean, copyBuildCommand, liveCoding, generateCompileCommands, launchEditor | 7 | 已有 | NOT_RUN |
| 项目域 | TASK_CMD_PROJECT | showProjectInfo, diagnoseProject, createProject, refreshProjectExplorer, openProjectExplorerFile, openWorkspaceFile, openTerminalInNewWindow, switchHeaderSource | 8 | 已有 | NOT_RUN |
| clangd 域 | TASK_CMD_CLANGD | enableClangdProxy, disableClangdProxy, showClangdProxyStatus, setSystemIncludes, installRules, noLintCurrentLine, noLintNextLine | 7 | 已有 | NOT_RUN |
| 配置域 | TASK_CMD_CONFIG | selectConfig, selectTarget, showControlPanel, retryFirstTimeInit, uninstall | 5 | 已有 | NOT_RUN |
| MCP 面 | TASK_MCP | ue_build, ue_rebuild, ue_clean, ue_get_build_errors, ue_launch_editor, ue_live_coding, ue_generate_compile_commands, ue_show_project_info, ue_set_system_includes | 9 | 已有 | NOT_RUN |

- 27 命令 + 9 MCP 工具 = 36/36 契约端点全部有任务覆盖,零遗漏、零孤儿任务。
- 事件覆盖:event-flow.md 登记的 4 条消息(VSCode EventEmitter ×2、MCP JSON-RPC 请求/响应)均为既有机制,契约无领域事件端点 → 无事件任务需派发(合规,非缺口)。
- 派发方式偏离说明:工作流默认的 ql-builder-worker 子代理在本环境不可用(无 Agent 工具/相关 CLI),改用等价的全新上下文进程派发:hermes -z + copilot/gpt-4.1(--yolo,任务卡落盘后按绝对路径读取,git 分支提交为硬验证)。Wave 1 用该机制成功交付,机制本身有效。

## 2. 波次统计

| 波次 | 任务数 | 并行度 | 结果 |
|------|--------|--------|------|
| Wave 1 | 1(TASK_INFRA_ENVELOPE) | 1 | PASS,已合并 |
| Wave 2 | 5(TASK_CMD_BUILD / PROJECT / CLANGD / CONFIG / MCP) | 计划 5 → 实际两轮分别 5、2 | 两轮全部失败(外部限流),未合并 |

依赖依据:四命令域 + MCP 面全部消费 src/core/envelope.ts(锁定导出接口),故 infra 必须先行;五域之间 Files 边界互不相交(注册层 src/commands/index.ts 经勘察确认无需改动,已从各任务边界中剔除,消除共享文件冲突)。

## 3. 验证命令结果

| 阶段 | 命令 | 结果 |
|------|------|------|
| Wave 1 合并前(worktree 内实测) | npx vitest run test/unit/core/envelope.test.ts | 14 passed |
| Wave 1 合并前(worktree 内实测) | npx tsc --noEmit | 0 错误 |
| Wave 1 合并后(工作分支全量) | npm run typecheck | 0 错误 |
| Wave 1 合并后(工作分支全量) | npm test(vitest run) | **101 文件 / 1249 测试全部通过** |
| Wave 2 | (未达验证阶段——两轮派发均死于 API 429,零提交) | - |

## 4. 提交清单(ql/phase-1-panorama)

| hash | 说明 |
|------|------|
| 69bd2f6 | feat(core): 添加契约 envelope 类型及工具函数,并配套测试(Wave 1,TASK_INFRA_ENVELOPE) |
| 5790c72 | merge: wave-1 TASK_INFRA_ENVELOPE(契约 envelope 基础设施) |

## 5. 工作区清理确认

- git worktree list:仅主工作区(6 个临时 worktree 已全部 remove)
- 临时分支:ql/wave-1/infra-envelope、ql/wave-2/* 已全部删除
- 全部 worktree 已 reset 清净后删除(第 1/2 轮失败残留的半成品改动已丢弃,未混入任何分支)
- 保留:.tmp/task-cards/(6 份任务卡,含 Wave 2 五份可直接复用)、.tmp/worker-logs/(派发日志)

## 6. 失败记录与根因(重要)

- Wave 2 第 1 轮(5 并行):全员 HTTP 429 —— "exceeded your rate limit for utility models"(Copilot 对 gpt-4.1 的 utility 限额),约 20 分钟重试后死亡,零提交。
- Wave 2 第 2 轮(降 2 并发 + 错峰 120s + 小步提交):同样 429 死亡,配额在 ~40 分钟内未恢复。
- 冷却 25 分钟后探针:copilot/gpt-4.1 挂起无输出(长退避);对照组 minimax 快速返回 429(hermes 本体正常)。claude 系模型全部 400 not supported;gpt-4o 挂起;gpt-4o-mini 被 hermes 64k 上下文下限拦截;minimax 为月度配额耗尽。
- 结论:非任务卡/机制缺陷,是单一可用 provider 的配额长窗口耗尽。按"连续 2 轮失败即停"纪律停止重试,上报 partial。

## 7. 恢复指引(断点续跑)

1. 台账:.planning/build/progress.md —— 从第一条非 PASS(TaskCmdBuild)继续;只信台账与 git log。
2. 任务卡现成:.tmp/task-cards/wave-2-*.md(5 份,自包含,含上一波次备注与 Files 边界)。
3. 步骤:确认 provider 配额恢复(1 次轻量探针)→ 为每任务重建 worktree(`git worktree add -b ql/wave-2/<task> .tmp/wt-<task> ql/phase-1-panorama` + node_modules junction)→ **串行或 ≤2 并发**派发 → 每任务按任务卡验收标准 git 实测后 --no-ff 合并 → 全量 npm run typecheck + npm test → 补全本报告与台账。
4. 环境注意:hermes 工具 shell 固定从 HOME 启动,任务卡首指令强制 cd worktree(已内建);provider 备选需先 `hermes auth` 配置凭据。

---

## Wave 2 补跑结果(2026-09-20,主会话 Agent 通道接管)

首轮外部 CLI 派发因配额耗尽失败;主会话以会话内 Agent 工具(ql-builder-worker × 5 并行)补跑,全部 PASS。

- 波次:Wave 2 × 5 任务(构建/项目/clangd/配置/MCP),worktree 隔离,合并零冲突
- 提交:11 个 worker 提交 + 1 个合并消解(91af273,dispatch 形参放宽为 Promise<unknown>,多 worker 共识项)
- 验证:全仓 typecheck 0 错误;npm test 109 文件 / 1312 测试全绿(基线 101/1249,净增 8 文件/63 用例)
- 逻辑层确认:src/build|core|clangd|detection 与 mcp server/lifecycle 的 diff 零改动——骨架严格限于命令层返回值 + MCP 错误出口 + 测试
- 清理:5 个 worktree 与 ql/wave-2/* 分支已删除,git worktree list 仅剩主工作区
- 遗留登记(填充阶段输入):Promise<any> 收紧、setSystemIncludes 桥接清理、BuildSummary errorCount/warningCount 顶层适配、i18n 中文字面量接线、错误码枚举缺口(FILE_NOT_FOUND/EDITOR_NOT_AVAILABLE 类)→ 建议契约修订
