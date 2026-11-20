---
bugfix: 005
slug: mcp-agent-cannot-start
status: fixed
fixed_at: 2026-11-12T23:50:00+08:00
severity: critical
review: approved
---

# bugfix-005:代理无法启动 MCP 服务器——definition 不自足 + bridge 泄漏

## 现象

- 用户报告:"代理无法启动,live coding 会重新呼出一个新的进程进行 live coding,而不是在现有的编辑器进程中进行"。
- 背景:工作区未提交的 MCP 架构重构(旧"宿主检测 + 扩展内 stdio"→ 新"VS Code `McpServerDefinitionProvider` + 命名管道 bridge 回连扩展宿主")落地后,代理(Copilot Chat 等 MCP client)无法启动本扩展的 MCP 服务器。

## 复现路径

- 排除性复现(证明技术链路本身通):
  - `test/unit/mcp/e2e-smoke.test.ts`(新增)——bridge + 真实 `out/mcpServer.js` 子进程,initialize → tools/call `ue_status` 经管道回连扩展宿主,251ms 返回 `ok:true`。**在 resolve 被调用的前提下整条链路正常**。
- 根因复现(回归测试,修复前失败 ✗ / 修复后通过 ✓):
  - `test/unit/mcp/provider.test.ts` → `publishes a self-sufficient definition — bridge env present without resolve (bugfix-005)`:仅调 `provideMcpServerDefinitions` 后断言 definition env 已含 `VSCODE_UE_HELPER_MCP_PIPE/TOKEN`。修复前 env 为 `undefined` → 失败(旧实现把 pipe/token 只放在 resolve 阶段注入)。
  - 同文件 → `reuses one bridge across provide/resolve calls instead of leaking one per resolve (bugfix-005)`:两次 provide + 一次 resolve 断言 pipe/token 一致(单例 bridge)。旧实现每次 resolve `new MCPBridgeServer` 且不清理 → 失败。

## 根因

`provideMcpServerDefinitions` 返回的 definition 在 provide 阶段不携带子进程启动的必要环境变量(`VSCODE_UE_HELPER_MCP_PIPE/TOKEN`),只靠 `resolveMcpServerDefinition` 注入;而 VS Code 的 MCP 基础设施存在**不调用 resolve 的启动路径**(后台转发到 Copilot 会话、definition 缓存重启——官方文档明确警示 "Don't rely on an interactive resolver running during background forwarding to Copilot"),这些路径 spawn 的 `out/mcpServer.js` 因缺 env 立即抛 `VS Code MCP bridge environment is missing` 退出(stdioServer.ts:40-42)→ 代理侧表现为"无法启动"。叠加缺陷:每次 resolve 都新建 bridge 且从不清理旧实例,定义变更/会话重启反复 resolve 时泄漏管道服务器,表现为"重新呼出新进程"。

- 引入点:本次 MCP provider 重构初版(工作区未提交,`src/mcp/provider.ts`);对照官方 sample(microsoft/vscode-extension-samples `mcp-extension-sample`),definition 在 provide 阶段即完整可启动,resolve 仅用于需要用户交互的补充。
- 类别:逻辑错误(初始化时序错位)+ 资源泄漏。

## 修复

| 文件 | 位置 | 变更 |
|------|------|------|
| src/mcp/provider.ts | UEHelperMCPProvider | 新增 `ensureBridge()` 单例(懒建 + 缓存 + 入 subscriptions);`provideMcpServerDefinitions` 改 async 并在 provide 阶段注入 `bridge.environment`(definition 自足);`resolveMcpServerDefinition` 复用单例只做幂等 env 补齐 |
| test/unit/mcp/provider.test.ts | 新增 2 例 | 回归锁定:provide 自足、bridge 复用(回退旧实现即变红) |
| test/unit/mcp/e2e-smoke.test.ts | 新增 | 端到端冒烟:真实子进程 + bridge 回连 + tools/call;产物缺失时 `describe.skipIf` 显式跳过(评审 minor-2) |

**提交:** 未提交(工作区含进行中的 MCP 重构,由用户决定提交时机;建议 `fix(bugfix-005): MCP definition provide 阶段自足 + bridge 单例化,修复代理无法启动`)。

## 回归验证(fresh evidence)

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run typecheck` | PASS | 0 错误 |
| `npm test` | PASS | 1538/1538(127 文件,含新增 3 例) |
| `npm run build` | PASS | out/mcpServer.js 正常产出 |
| `npx vitest run test/unit/mcp/e2e-smoke.test.ts` | PASS | 真实子进程回连,241ms |

## 同类检查

- [x] `grep` 扫描同模式代码
- 结论:**无同类**。`resolveMcpServerDefinition`/`ensureBridge` 模式全仓库仅 provider.ts 一处;其余模块无"延迟注入启动必要资源"的写法。

## 遗留与顺带发现

- **(评审 minor-1)** `ensureBridge` 无 promise 记忆化,并发 provide 理论上可创建两个 bridge(后果仅资源重复,dispose 全覆盖,不会引用已死管道)。
- **(评审 minor-3)** `start()` 失败时 `created` 实例未显式 dispose(listen 失败时 Node 自行关闭 handle,实际无泄漏,仅代码卫生)。
- **(评审 minor-4)** 切到 `useMCP: never` 后单例 bridge 保持监听至扩展停用(单实例、无增长,可接受;如需严谨可在 mode 变更为 never 时主动 dispose)。
- **auto 模式宿主门控为设计如此**:`provideMcpServerDefinitions` 在 `auto`(默认)下仅对 appName 含 "Visual Studio Code" 的宿主发布(AGENTS.md 明确目标为 VS Code MCP provider API 含 Copilot Chat;Cursor/Claude Code 需各自注册)。若用户在其它 VS Code fork(如 Cursor/ZCode)中期望 MCP 可用,属设计边界而非缺陷,需 `/ql-add` 重新规划(例如放宽门控或提供外部 stdio 注册说明)。
- **live coding 命令链路无回归**:bugfix-001 的 UBT `-LiveCoding` + `-Project` 修复仍在(src/build/ubt.ts:109-111);"新进程做 live coding"的观察与 MCP 服务器不可用(代理走了错误路径)及 bridge 泄漏现象一致,MCP 修复后 `ue_live_coding` 将经 bridge 在扩展宿主内执行并连接现有编辑器。

## 旅程日志(≤5 条)

- e2e 冒烟首跑失败,排查后发现是复现脚本自身漏发 MCP 协议的 `notifications/initialized` 通知(SDK 在握手完成前忽略 tools/call)——"复现不干净先修复现"再次应验。
- 测量 `MCP_TOOLS` env 大小时 tsx 直跑 TS 因 `import 'vscode'` 链路失败,改在 vitest 环境(mock vscode)中测量:2311 字符,远低于 Windows 32KB 单变量上限,排除该假设。
- 根因定位的关键转折:不再猜"进程为什么起不来",转而对照官方 sample 发现其 definition 在 provide 阶段即自足(甚至不实现 resolve),与本实现"resolve 才注入关键 env"形成直接反差,再由官方文档"后台转发不保证 resolve"的警示闭合证据链。
