---
bugfix: 002
slug: mcp-not-wired
status: fixed
created_at: 2026-09-25T16:10:00+08:00
review: approved(ql-reviewer,0 critical / 3 non-critical,#1 已修,#3 登记)
---

# bugfix-002:MCP 功能完全不可用(extension.ts 未接线 activateMCP)

## 现象

用户报告"现在 MCP 功能应该还不可用"。事实链:任何宿主下 MCP 服务器都不会启动,
AI agent 的 9 个 ue_* 工具全部拿不到(要么连接不上,要么 callTool 返回
`MCP_CONTEXT_NOT_INITIALIZED`);而 README Phase 表却声称 "MCP server ✅"。

## 复现(硬门控)

`test/unit/extension.test.ts`(新):mock 全部 activate 链路依赖,调 `activate(fakeContext())`,
断言 `activateMCP` 被调用。

**修复前跑红**(复现证据):`AssertionError: expected "spy" to be called 1 times, but got 0 times`。
独立评审者用 `git stash push -- src/extension.ts` 摘除修复复跑,同样红 → 回归测试真实锁定 bug;
恢复后 2/2 绿。

## 根因(一句话)

**`src/extension.ts` 激活流程从未调用 `activateMCP`**——Phase 11 改造 MCP 模块时留下的
dead code(src/mcp/index.ts 头注释自称"Plan 12 处理 dispatch 接入"),该接线计划此后从未落地;
detectHost 宿主门控 → setMCPContext 注入 → stdio server 启动整条链路永不执行。

交叉验证:决策轨迹 D1-D7 无"MCP 不接线"取舍;契约 openapi.yaml 有 9 个 `/mcp/tools/ue_*`
端点 → 实现落后于契约,是构建遗漏,不是设计如此。同类检查:grep "Plan 12|dead code" 全库
仅 MCP 一处(两处注释指向同一问题);build/clangd/ui/commands/detection 各 activate* 域均已接线。

## 修复(最小)

- `src/extension.ts`:激活流程(activateCommands 之后,依赖就绪处)fire-and-forget 接线
  `void activateMCP(context, config, logger, detection, workspace, clangdOps).catch(...)`,
  与同函数 firstRunInit 同构;宿主门控在 activateMCP 内部(Cursor/Claude Code 启动,
  普通 VS Code no-op),启动失败只记日志不阻塞激活。
- `src/mcp/index.ts` / `src/mcp/tools.ts`:同步两处与事实相反的过时注释(评审 non-critical #1;
  本次 bug 的成因之一正是"注释与现实脱节"误导后续维护)。

## 回归验证(fresh evidence)

| 命令 | 结果 |
|------|------|
| `npx vitest run test/unit/extension.test.ts`(修复前) | FAIL(复现:0 次调用) |
| `npx vitest run test/unit/extension.test.ts`(修复后) | PASS 2/2 |
| `npm run typecheck` | PASS(0 错) |
| `npm test` 全量 | PASS **111 文件 / 1332 用例全绿**(净增 1 文件 / 2 用例) |
| `npm run build` | PASS(esbuild 产物正常) |

## 评审(ql-reviewer,第 1 轮)

**approved**(0 critical / 3 non-critical):

1. 过时注释未同步(index.ts/tools.ts 两处)→ **已当场修复**(见上)
2. extension.test.ts 只锁调用次数与参数个数、不锁参数身份 → 记录不修:错序会被 tsc 拦截,
   注入生效由 test/unit/mcp/index.test.ts 的 setMCPContext 断言兜底
3. pre-existing 竞态:activateMCP 内 dispose 订阅在 `await server.start()` 成功后才 push,
   start 挂起期间 deactivate 则 server.stop 不执行 → Phase 11 既有代码,不在本 diff,
   登记不修(窗口极小)

评审者实证:stash 摘除修复复跑回归测试(红→绿往返)、亲跑 typecheck 与单点测试。

## 遗留(非阻塞)

- non-critical #3 竞态(见上)——若未来要修,建议 activateMCP 先 push dispose 再 start,
  或用 try/finally;属独立小修,不宜搭车
- stdio 桥接在真实 Cursor / Claude Code 宿主中的端到端行为(宿主如何 spawn/连接扩展宿主进程)
  无法在单测内验证——接线后首次在真实宿主实测时若仍不可用,属下一层问题,另行开 bugfix
