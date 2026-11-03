---
fill: add-004
slug: auto-refresh-compile-commands
status: done
built_at: 2026-10-05
mode: inline(主会话亲自实现)
commit: 96efbbe
---

# 构建报告 add-004:新增源文件自动重建 compile_commands(配置开关)

## 模式偏离说明

沿用 add-003 先例:协调器上下文无 worker 派发通道(宿主环境结构性限制,见
fill-report-add003.md 模式偏离记录),且本任务为单域小范围改造(一个配置项 +
quiet 形态 + hint 双模式),直接主会话内联实现,验收逐条亲测留痕。

## 变更清单(commit 96efbbe,11 文件 +361/-47)

| 文件 | 变更 |
|------|------|
| `package.json` | 新增 `vscodeUEHelper.compileCommandsAutoRefresh`(boolean,默认 true) |
| `package.nls.json` / `package.nls.zh-cn.json` | 配置描述中英双语 |
| `src/core/config.ts` | `compileCommandsAutoRefresh` getter(默认 true) |
| `src/commands/generateCompileCommands.ts` | 末位可选参 `opts?: { quiet?: boolean }`:quiet 隐含 silent(无 picker),无成功弹窗、无"重启 clangd?"询问、失败不弹窗;envelope 语义不变 |
| `src/commands/index.ts` | 注册 handler 接收并透传 `{ quiet: true }` 附加参数(executeCommand args) |
| `src/clangd/compileCommandsHint.ts` | 双模式重构:`mode` getter 每拍现读(开关即时生效);auto 节流 `DEFAULT_AUTO_INTERVAL_MS=2min`;inFlight 防重入;executeImpl 签名 `(mode)`(auto 附加 `{quiet:true}`);既有 notify 语义逐项保留 |
| `src/clangd/index.ts` | 装配注入 `mode: () => config.compileCommandsAutoRefresh ? 'auto' : 'notify'` |
| `test/unit/clangd/compileCommandsHint.test.ts` | +6 用例(auto 常量/命中静默/2min 节流/inFlight 防重入/模式即时切换/异常吞+复位);既有 8 用例零改动全绿 |
| `test/unit/commands/generateCompileCommands.test.ts` | +3 用例(quiet 无弹窗+ok/quiet 失败无弹窗+BUILD_FAILED/quiet 无项目+PROJECT_NOT_DETECTED) |
| `test/unit/scripts/nlsPlaceholders.test.ts` | 守护测试计数 22 → 23(新设置项) |

## 验收清单逐条自测(fresh evidence,主会话亲测)

| # | 验收项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | typecheck + 全量测试 | **PASS** | `npm run typecheck` 0 错误;`npx vitest run` 112 文件/1358 用例全绿(基线 1349 + hint 6 + quiet 3,对账吻合) |
| 2 | auto 模式命中即静默重建 | **PASS** | hint 测试:auto 模式命中 → notify 零调用、execute 收到 `'auto'`(生产默认实现附加 `{quiet:true}` 执行命令) |
| 3 | quiet 全程无弹窗、envelope 不变 | **PASS** | quiet 3 用例:成功路径 showInformation/Warning/Error 全零调用 + `ok:true+linkPath`;失败路径无错误弹窗 + BUILD_FAILED;无项目无警告 + PROJECT_NOT_DETECTED;picker 零调用(隐含 silent) |
| 4 | auto 节流 2 分钟 + inFlight | **PASS** | hint 测试:窗外(130s)第二批次 skip;inFlight 期间批次 skip、完成复位后窗外重试成功 |
| 5 | false 回到提示模式 | **PASS** | 既有 8 个 notify 用例零改动全绿(默认 mode='notify' 即现状行为) |
| 6 | 开关即时生效 | **PASS** | hint 测试:同一实例 mode getter 从 auto 切 notify,行为即时切换(无 reload) |
| 7 | MCP silent 行为不变 | **PASS** | 既有 generateCompileCommands 用例(silent 成功/失败弹窗断言)零改动全绿;quiet 与 silent 独立参数,`ue_generate_compile_commands` 不传 quiet |

## 行为变化登记(相对改造前)

1. **默认行为变化**:`compileCommandsAutoRefresh` 默认 true——升级后新增 C++ 文件
   不再弹提示,而是后台静默重建(2 分钟节流 + inFlight 护栏)。想回到旧行为关掉开关。
2. quiet 形态跳过"重启 clangd?"询问:依赖 clangd 12+ 对 compile_commands.json 的
   热重载;旧版 clangd 用户可手动 restart(配置描述已说明)。
3. 命令注册 handler 新增可选附加参数(无参调用行为不变)。

## 评审修复(commit 见 git log,复审后补登)

- F-1(major):quiet 管线失败原只返 envelope 不落日志,且 hint 打虚假成功日志——已修:
  catch 分支 quiet 时 logger.error;runAutoRefresh 检查 envelope.ok,失败打 warn、
  成功日志仅 ok 时输出;+1 用例(envelope ok:false → warn 且无成功日志)+ 既有 quiet
  失败用例补 logger.error 断言
- F-2(minor):runAutoRefresh 注释纠正(catch 兜底实际在 onBatch 外层)

## 遗留

- 批量加文件(如切分支)时自动重建按节流窗排队执行,不做显式合批/去重(节流 + inFlight 已覆盖主场景)
- auto 模式下进度仅状态栏小转圈(受既有 progressLocation 配置控制),无完成通知(设计如此,静默)
