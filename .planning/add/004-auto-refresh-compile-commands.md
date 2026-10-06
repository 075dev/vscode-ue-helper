---
add: 004
slug: auto-refresh-compile-commands
status: building
created_at: 2026-10-05T12:00:00+08:00
at: chapter-01
placement: auto(唯一重合)
review: pending
---

# add-004:新增源文件自动重建 compile_commands(配置开关)

## 需求

> 用户新增 C++ 文件时,插件目前弹提示(10 分钟节流)让用户手动点"更新"。
> 期望:自动后台重建;保留开关可回到提示模式(决策 D9)。

## 勘察与定位(add 步骤 0-2)

**现状链路:**

- `IncrementalFileWatcher`(chokidar,`ignoreInitial: true` → 启动不误报新增)
  → `CompileCommandsRefreshHint.onBatch`(add 事件过滤 → 10 分钟节流 →
  `showInformationMessage` 提示)→ 用户点击 → `executeCommand('vscodeUEHelper.generateCompileCommands')`
- `executeGenerateCompileCommands`:picker(silent 可跳)→ 完整管线(UBT
  GenerateProjectFiles 分钟级 → symlink → fillMissing → 补全文件 → rsp 后台)→
  **成功弹窗 + "重启 clangd?"询问 + 失败弹窗**——直接复用会比提示模式更打扰
- 无重入保护:自动触发与手动/MCP 并发会并行跑两个 UBT 生成,写坏输出

**落点判定:** 并入 **chapter-01**——自动判断(唯一重合):compile_commands 域
(generateCompileCommands 端点)全部位于 chapter-01。不新建章节。

**契约面:空。** 不新增/修改端点(命令已有,`quiet` 为内部行为形态);配置项
`vscodeUEHelper.compileCommandsAutoRefresh` 属 package.json 设置面,不进 OpenAPI。
`decisions.md` 登记决策 D9。

**范围边界(本记录即边界):**

- ✅ 新配置 `vscodeUEHelper.compileCommandsAutoRefresh`(boolean,默认 true,
  package.json + nls 中英 + Config getter 三处)
- ✅ `executeGenerateCompileCommands` 增加末位可选参 `opts?: { quiet?: boolean }`:
  quiet = 跳过 picker(silent 同路径)+ 无成功弹窗 + 无重启询问 + 失败不弹窗;
  envelope 返回语义不变
- ✅ commands/index.ts 注册 handler 透传 opts(executeCommand 附加参数)
- ✅ `CompileCommandsRefreshHint` 支持自动模式(模式经 getter 注入,配置变更即时生效,
  不挂监听):节流 `DEFAULT_AUTO_INTERVAL_MS = 2 分钟`、inFlight 防重入、
  executeImpl 直接触发 quiet 管线、失败仅 log
- ✅ clangd/index.ts 装配:按 `config.compileCommandsAutoRefresh` 注入模式 getter
- ❌ 不做排队合批/智能 debounce(节流 + inFlight 已覆盖;UBT 期间新增文件延后到下个窗)
- ❌ 不动 MCP 面(ue_generate_compile_commands 的 silent 语义不变,不传 quiet)
- ❌ 不加进度 UI 新形态(quiet 仍走 withProgress,受既有 progressLocation 配置控制,
  默认状态栏小转圈不打扰)

## 验收清单(构建 + 评审逐条断言)

1. `npm run typecheck` 通过;`npm test` 全绿(存量不回归)。
2. `compileCommandsAutoRefresh=true`(默认)时:onBatch 命中新增 C++ 文件 →
   不弹提示,直接触发 `executeCommand('vscodeUEHelper.generateCompileCommands', {quiet: true})`。
3. quiet=true 时:无 picker、无成功信息弹窗、无"重启 clangd?"询问、失败无错误弹窗
   (envelope 照返);非 quiet 行为与现状逐项一致(既有测试不回归)。
4. 自动模式节流:2 分钟窗口内重复 onBatch 只触发一次重建;inFlight(执行中)忽略新批次。
5. `compileCommandsAutoRefresh=false` 时:行为与现状一致(10 分钟节流提示 + 点击执行)。
6. 配置开关变更即时生效(getter 每拍现读,无需 reload)。
7. MCP `ue_generate_compile_commands`(silent=true,不传 quiet)行为不变:
   保留成功提示与重启询问(既有测试钉住)。
