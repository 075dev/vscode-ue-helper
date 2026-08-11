<!-- Parent: ../AGENTS.md -->
# commands 模块知识库

> 治理参考：`.specify/memory/constitution.md`。Command 层是宪法 §II 的“编排面”：**只做参数收集 → 调用下层 → 结果展示**；业务逻辑一律交给 `@build` / `@clangd` / `@detection` / `@core/workspace`，禁止命令层重新实现或重复派生路径。Command handler 同时是 VS Code 的 `commands.*` 注册入口与 MCP `callTool` 的 dispatch 目标（宪法 §IV：单一真相源）。

## 模块概述

**21 个 VS Code 命令处理器**（`package.json#contributes.commands` 中实际暴露的命令数；`src/commands/index.ts` 的 `track` 计数器以单点数字报告），用户交互的主入口点。所有命令绑定到 `vscodeUEHelper.*` 命名空间。

## 命令列表

| 命令 ID                   | 实现文件                     | 功能                                                 |
| ------------------------- | ---------------------------- | ---------------------------------------------------- |
| `showProjectInfo`         | `showProjectInfo.ts`         | 显示项目 / 引擎检测结果                              |
| `build`                   | `build.ts`                   | UBT 构建（`executeBuild('build', ...)`）             |
| `rebuild`                 | `build.ts`                   | 清理 + 构建（`executeBuild('rebuild', ...)`）        |
| `clean`                   | `build.ts`                   | 清理构建产物（`executeBuild('clean', ...)`）         |
| `launchEditor`            | `launchEditor.ts`            | 启动 Unreal Editor（Windows only）                   |
| `liveCoding`              | `liveCoding.ts`              | Live Coding 热重载（Windows only）                   |
| `generateCompileCommands` | `generateCompileCommands.ts` | 生成 `compile_commands.json`                         |
| `createProject`           | `createProject.ts`           | 创建 UE Clangd 项目脚手架                            |
| `diagnoseProject`         | `diagnoseProject.ts`         | 诊断 Clangd 项目（输出报告）                         |
| `installRules`            | `installRules.ts`            | 安装 AI Agent 规则                                   |
| `uninstall`               | `uninstall.ts`               | 清理所有生成文件                                     |
| `setSystemIncludes`       | `setSystemIncludes.ts`       | 设置 MSVC + Windows SDK 系统包含路径（Windows only） |
| `openWorkspaceFile`       | `openWorkspaceFile.ts`       | 打开 `.code-workspace`                               |
| `selectConfig`            | `selectConfig.ts`            | 选择构建配置                                         |
| `selectTarget`            | `selectTarget.ts`            | 选择构建目标                                         |
| `enableClangdProxy`       | `enableClangdProxy.ts`       | 启用 Clangd LSP 代理                                 |
| `disableClangdProxy`      | `disableClangdProxy.ts`      | 禁用 Clangd LSP 代理                                 |
| `showClangdProxyStatus`   | `showClangdProxyStatus.ts`   | 显示 Clangd 代理状态                                 |
| `showControlPanel`        | `showControlPanel.ts`        | 打开控制面板 webview                                 |
| `refreshProjectExplorer`  | `refreshProjectExplorer.ts`  | 手动刷新项目目录树                                   |
| `openProjectExplorerFile` | `openProjectExplorerFile.ts` | 项目目录树触发的文件打开                             |

> **`toggleCompletionMode` 已删除**（Phase 9 / H4-B / Plan B 收束）：fast/slow 已统一为 slow，`src/commands/index.ts` 中不注册此命令，`package.json#contributes.commands` 也不再有此定义。补全重写改为 `CompletionModeController.rewriteClangd()` 单入口，详见 `src/clangd/AGENTS.md`。

## 支持文件（非命令）

| 文件              | 职责                                                                                                                                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_resolve.ts`     | 命令链选择项目 / 引擎的公共 helper（Phase 11 包 1 引入） —— 收敛 `resolveProjectOrPick` / `resolveEngineOrPick` / `persistSelection`，消除原本散落在 6 个命令文件里的"读 selection → auto-pick → picker fallback → showWarning"重复模式。`silent` 参数专为 MCP `callTool` 路径设计，命令面板默认 `false` |
| `firstRunInit.ts` | 首次打开插件的一次性初始化编排（`.code-workspace#settings.vscodeUEHelper.initialized` 标记）                                                                                                                                                                                                             |

## 实现模式

### 标准命令函数签名

```typescript
export async function executeXxx(
  config: Config, // 全局配置
  logger: Logger, // 日志器（命令层也用 [commands] 前缀区分）
  detection: DetectionHandles, // 检测层句柄（兼容老调用点）
  workspace?: WorkspaceState, // [Phase 8 + Plan Add 收束] 主要路径必须传
  clangdOps?: ClangdOps, // [Phase 8] 需要写 .clangd 的命令必须传
  silent?: boolean, // [Phase 11] MCP 路径用，跳过 UI 交互
): Promise<void>;
```

### 注册模式（`src/commands/index.ts`）

```typescript
let commandCount = 0;
const track = (label: string, fn: (...args: unknown[]) => unknown): void => {
  commandCount += 1;
  registerCommand(context, label, fn);
};
track('vscodeUEHelper.build', () => executeBuild('build', config, logger, detection, workspace));
// ... 21 处 track(...) 调用
logger.info(`[commands] registered ${commandCount} commands`);
```

`track` 同时承担：① `vscode.commands.registerCommand`；② 推入 `context.subscriptions`；③ 日志打印实际注册数；满足宪法 §III 的 lifecycle ownership 与 observable logs。

## 关键约定

### 错误处理

```typescript
try {
  // 业务逻辑
} catch (err) {
  logger.error('[commands] operation failed:', err);
  vscode.window.showErrorMessage(t('key.error'));
}
```

日志必须带 `[commands]` 前缀；用户可见字符串一律 i18n 双语（宪法 §III）。

### 用户交互

- **成功**：`showInformationMessage` + 日志
- **警告**：`showWarningMessage` + 日志
- **错误**：`showErrorMessage` + 日志
- **选择**：`showQuickPick` 返回 `T | undefined`

### 依赖管理

- 每个命令只依赖它真正需要的模块。
- **禁止在命令层做复杂业务逻辑** —— 委托给对应模块（`@build` / `@clangd` / `@detection`）。
- 命令层只负责：参数收集 → 调用下层 → 结果展示。

### SSoT 规则

- 项目 / 引擎路径派生一律走 `workspace.selectedProject` / `workspace.selectedEngine`。
- `.clangd` 写入一律走 `clangdOps.writeFull` / `mutate`，不在命令层拼路径写文件。
- 命令 handler 与 MCP `callTool` 共用同一份 `executeXxx`（命令 handler 不再做自动选择快捷路径，唯一例外是 `silent` 参数短路 auto-pick / picker）。

## 新增命令步骤（5 步）

1. **`package.json#contributes.commands`**：添加命令定义（含 `title` / `title@zh` / `category`）。
2. **实现文件**：`src/commands/newCommand.ts` 写 `executeNewCommand(...，silent?: boolean)`。
3. **注册**：`src/commands/index.ts` 用 `track('vscodeUEHelper.newCommand', ...)`。
4. **国际化**：`src/i18n/locales/{en,zh}.json` 加用户可见字符串（**en 与 zh 同步**）。
5. **MCP 暴露（如需）**：`src/mcp/tools.ts` 在 `MCP_TOOLS` 增加 `{ name, description, inputSchema }` 并在 `callTool` 增加 dispatch（silent = true）。

第 5 步可选，但**新增命令默认应同时考虑 MCP 可达性**（宪法 §V：避免维护两套并行路径）。

## 资源清理与生命周期

- 命令注册统一用 `registerCommand`（`@core/command-registry`），自动 push 到 `context.subscriptions`；命令 handler **不要**自己持 long-lived 资源。
- 任何 watcher / StatusBarItem / `vscode.Progress` 资源必须由命令层创建并 push 订阅，或交给 `@ui` 持 lifecycle。
- windowsHide / detached / stdio 子进程由被调用模块负责，命令层 **不**直接 `spawn`（避免双重释放）。

## Windows-only 命令约束

`launchEditor` / `liveCoding` / `setSystemIncludes` 在非 Windows 上必须快速退出，输出双语提示，不抛未受控异常。详见 `src/build/AGENTS.md` 与 `src/clangd/AGENTS.md`。
