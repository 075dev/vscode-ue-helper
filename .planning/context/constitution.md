---
constitution_version: 1.0.0
ratified: 2026-09-19
last_amended: 2026-09-19
---

# 项目宪法

> 跨阶段的持久约束层。构建波次划分、实现取舍、评审裁定都以此为准。
> 违反 MUST 原则 = CRITICAL;违反 SHOULD 原则 = 必须书面论证(见豁免表)。

## 核心原则

### C1 子进程统一收口(MUST)
所有外部进程调用(UBT、Live Coding 控制台、clangd、终端)必须经 `src/core/subprocessRegistry`
统一管理(spawn、输出流、退出回收);命令层与 MCP 工具层禁止直接 `child_process.spawn`。
(判定:grep 命令层/MCP 层源码无 spawn/exec 直接调用即通过)

### C2 命令注册统一入口(MUST)
所有 VSCode 命令必须经 `src/core/command-registry` 的 `registerCommand` 注册(统一 label、
错误兜底、日志埋点);禁止在 extension.ts 直接 `vscode.commands.registerCommand`。
(判定:commands/index.ts 之外无注册点即通过)

### C3 MCP 保持同步 dispatch 语义(MUST)
`callTool` 保持同步签名 `(name, args) => string`;dispatch 类工具 fire-and-forget,
不阻塞 MCP request handler;快照读取类(ue_get_build_errors)同步返回。
(判定:callTool 无 await executeXxx 即通过;依据决策 D4)

### C4 安全底线(MUST)
密钥/凭证/令牌不入库(源码、测试、文档一律);日志与文档不得包含用户敏感绝对路径之外的
机器特定信息。文档产出必须通过密钥扫描(docsmap 同款正则:sk-/ghp_/AKIA/私钥头等)。
(判定:扫描正则零命中即通过)

### C5 技术栈红线(MUST)
TypeScript + VSCode API `^1.85.0` + Node `>=18`;平台 win32。禁止引入新的运行时依赖
(dependencies),devDependencies 新增需在 PR 说明理由。
(判定:package.json dependencies 清单不增长即通过)

### C6 用户可见文案走 i18n(SHOULD)
新增用户可见文案(package.json 命令标题、Webview、消息)应经 `src/i18n/locales`(en/zh 双语),
禁止源码内散落未本地化的用户字符串。
(判定:新文案在 en.json/zh.json 均有条目即通过;例外:纯调试日志)

### C7 新能力配单测(SHOULD)
新命令/MCP 工具/域逻辑应有单元测试,目录镜像 src 结构(test/unit/**),mock vscode API,
不依赖真实 UE 工程。
(判定:`npm run test` 覆盖新能力即通过)

### C8 错误出口统一(SHOULD)
命令/MCP 工具的失败出口应返回契约 envelope(`{ok:false, error:{code,message,details}}`),
错误码取自契约全局枚举(openapi.yaml Error.code),不抛裸字符串。
(判定:新增失败路径的 code 在枚举内即通过;依据决策 D5,目标口径)

## 技术栈红线

- 语言/框架:TypeScript(strict)、VSCode Extension API ^1.85.0、Node >=18,锁定不漂移
- 禁止引入:任何新的运行时依赖;HTTP 服务框架(本插件无常驻服务端);领域事件总线库
  (消息面以 VSCode EventEmitter 与 MCP JSON-RPC 为准,见 event-flow.md)

## 豁免表(违规必须登记)

| # | 违反原则 | 为什么需要 | 更简单方案为何被否 | 批准人 |
|---|----------|-----------|-------------------|--------|
| (暂无) | | | | |

## 修订记录

| 版本 | 日期 | 变更 | 理由 |
|------|------|------|------|
| 1.0.0 | 2026-09-19 | 初版(从阶段 1 讨论与仓库勘察提炼) | - |
