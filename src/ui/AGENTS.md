<!-- Parent: ../AGENTS.md -->

# ui 模块知识库

> 治理参考：`.specify/memory/constitution.md`。UI 层负责把宪法 §III（Localized, Observable, Resource-Safe UX）的可观察性与资源安全落到用户可视交互上 —— bilingual UX、前缀日志、`context.subscriptions` 拥有的生命周期、原子写。同时遵守宪法 §II：UI **只读** `WorkspaceState` / `ClangdOps`，不允许拼路径写 `.clangd`，不允许按 `config.completionMode` 切分支（`completionMode` 已合并为统一 slow —— 详见 `src/clangd/AGENTS.md`）。

## 模块概述

**用户界面层**，负责所有与用户的可视化交互：

- 底部状态栏按钮集合（`StatusBarManager`）
- QuickPick 选择器（引擎、配置、目标）
- 信息 / 警告 / 错误通知弹窗
- Problems 面板集成（错误解析）
- Output Channel 日志输出
- ControlPanel Webview + Project Explorer TreeDataProvider

> `src/ui/statusBar.ts` 当前实现为 **8 个状态栏按钮**（项目信息 / Config / Target / Build / Rebuild / Clean / Live Coding / Launch）；不再有 `clangd` 补全模式切换按钮（统一 slow 后删除）。

## 核心文件

| 文件                      | 职责                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `statusBar.ts`            | `StatusBarManager`：底部 Rider 风格工具栏；`settingsFromConfig` 从 `Config` 提取 `StatusBarSettings` |
| `quickPicks.ts`           | QuickPick 选择器（引擎 / 配置 / 目标 / 平台）                                                        |
| `notifications.ts`        | 通知弹窗封装（`notifyInfo` / `notifyWarn` / `notifyError`）                                          |
| `problemsPanel.ts`        | Problems 面板诊断管理（DiagnosticManager）                                                           |
| `outputChannel.ts`        | Output Channel 日志输出封装                                                                          |
| `controlPanel.ts`         | `ControlPanelProvider` —— Webview 控制面板（侧边栏）。首屏先 `await` 标题信息再赋 HTML；`panelReady` 重推全部状态；`postMessage` 投递失败记 warn |
| `controlPanel.html.ts`    | 控制面板 HTML 模板（从 `controlPanel.ts` 拆出便于热更新）                                            |
| `controlPanelMessages.ts` | 控制面板 host ↔ webview 双向消息协议。命令白名单用 null 原型对象；`validateConfigValue` 校验配置值类型 |
| `perfStatusBar.ts`        | perf 埋点状态栏                                                                                      |
| `projectExplorer.ts`      | 项目目录树 TreeDataProvider                                                                          |
| `projectExplorerFs.ts`    | 项目目录树 fs 扫描（与 provider 解耦）                                                               |
| `projectExplorerModel.ts` | 项目目录树 model（数据层）                                                                           |
| `index.ts`                | UI 激活入口                                                                                          |

## 状态栏设计

### 按钮布局（从左到右，8 个）

```
[$(file-code) 项目名 | $(package) 引擎版本 | $(device-desktop) 平台]   ← 合并 3 项信息
[$(gear) Config] [$(symbol-class) Target]
[$(play) Build] [$(refresh) Rebuild] [$(trash) Clean]
[$(zap) Live Coding] [$(rocket) Launch]
```

### 每个按钮的职责

| 按钮                  | 点击行为                              | 显示内容                                                                                          |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 项目信息              | 调用 `vscodeUEHelper.showProjectInfo` | `$(file-code) <项目名> \| $(package) <UE 版本> \| $(device-desktop) Win64`，缺失项用 warning 背景 |
| 配置                  | 调用 `vscodeUEHelper.selectConfig`    | `Development` / `DebugGame` 等                                                                    |
| 目标                  | 调用 `vscodeUEHelper.selectTarget`    | `Editor` / `Game` / `Server` / `Client`                                                           |
| 构建                  | 调用 `vscodeUEHelper.build`           | `$(play) Build`（prominent，build 中显示 spinner）                                                |
| Rebuild               | 调用 `vscodeUEHelper.rebuild`         | `$(refresh) Rebuild`                                                                              |
| Clean                 | 调用 `vscodeUEHelper.clean`           | `$(trash) Clean`                                                                                  |
| 热重载（Live Coding） | 调用 `vscodeUEHelper.liveCoding`      | `$(zap) Live Coding`（prominent，Windows only）                                                   |
| 启动                  | 调用 `vscodeUEHelper.launchEditor`    | `$(rocket) Launch`（prominent）                                                                   |

> 已删除：原 `clangd` 补全模式切换按钮。fast/slow 已被合并为单一 slow rewrite（见 `src/clangd/AGENTS.md`），UI 不再展示 toggle 状态。

### 状态栏代码模式

```typescript
// 1. 静态按钮 - 点击触发命令
vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

// 2. 动态按钮 - 状态变化时更新文本
item.text = `$(rocket)  Launch`;
item.text = `$(sync~spin)  Building...`;
item.text = `$(check)  Build OK`; // 成功 5 秒
item.text = `$(error)  N errors`; // 失败 5 秒

// 3. 条件显示
if (process.platform === 'win32') {
  liveCodingItem.show();
}
```

### 配置变更同步路径（重要）

`StatusBarManager` 暴露两条重绘路径，按依赖关系拆分：

- **`update(ctx, settings)`** —— **异步**完整重绘。依赖 `detection.ready` 解析后的 ctx（含项目 / 引擎 + 用户选择），用于初始激活、detection 结果变化、项目切换等场景。`activateUI` 内对应 `renderFull`。
- **`updateConfig(settings)`** —— **同步**仅重绘 config 相关按钮（`configBtn` / `targetBtn` / `projectInfoBtn` 的 platform 段）。**不**依赖 ctx，**不**走 `await detection.ready`，同一 tick 内更新。用于 `config.onDidChange` listener —— 修复"点击 Config 按钮改配置后状态栏按钮更新滞后"的 bug。

**为什么需要拆？** 旧实现把 `config.onDidChange` 接进 `void renderFull()`，async 函数首个 `await detection.ready` 会让出当前 tick，把 `statusBar.update` 推到 microtask queue。用户视角下"点完按钮通知已弹，但状态栏按钮更新滞后到下一 microtask"，看起来像"没反应"。**修复后 listener 同步调 `updateConfig`，不再走 async 链路**。

**守护**：

- `_isBuilding === true` 时 `updateConfig` 直接 return —— build spinner / 错误结果状态不被配置变化打断，build 结束由 `showBuildResult` → `update()` 走完整路径一并刷新。
- `_cachedCtx === null`（首次 `update` 还未跑过）时 `updateConfig` 只更新 `configBtn` / `targetBtn`，`projectInfoBtn` 不动 —— 避免在没有 detection 结果时显示「No Project | No Engine」。

回归测试：`test/unit/ui/statusBarConfigSync.test.ts`（9 个 case 覆盖 configuration / target / platform 同步更新 + `_isBuilding` 守护 + 完整 renderFull）。

## QuickPicks 选择器

### 设计模式

每个选择器遵循同一模式：

```typescript
export async function pickXxx(items: T[], activeItem?: T, labelFn: (item: T) => string): Promise<T | undefined> {
  // 1. 构造 QuickPickItem 数组
  // 2. activeItem 前面加 ✅ 标记
  // 3. showQuickPick
  // 4. 用户取消 → return undefined
}
```

### 选择器列表

| 选择器           | 选项来源                                                          | 持久化                          |
| ---------------- | ----------------------------------------------------------------- | ------------------------------- |
| `pickEngine()`   | `detection.engines`                                               | `WorkspaceState.selectedEngine` |
| `pickConfig()`   | 固定枚举（Debug / DebugGame / Dev / Shipping / Test）             | VS Code 配置                    |
| `pickTarget()`   | 固定枚举（Editor / Game / Server / Client）                       | VS Code 配置                    |
| `pickPlatform()` | **Windows only**：`Win64` 单选（宪法 §I：Mac/Linux 不在产品范围） | VS Code 配置                    |

`Commands` 层（`pickPlatform` 之外的 selection 路径）通过 `@commands/_resolve` 拿 `WorkspaceState` —— 选择需 `persistSelection` 才能落到 memento，未持久化前不写入。

## Notifications 封装

统一的通知 API，避免重复代码：

```typescript
export function notifyInfo(logger: Logger, key: string, ...args: any[]): void {
  const msg = t(key, ...args);
  logger.info(msg);
  vscode.window.showInformationMessage(msg);
}

export function notifyWarn(logger: Logger, key: string, ...args: any[]): void {
  const msg = t(key, ...args);
  logger.warn(msg);
  vscode.window.showWarningMessage(msg);
}

export function notifyError(logger: Logger, key: string, ...args: any[]): void {
  const msg = t(key, ...args);
  logger.error(msg);
  vscode.window.showErrorMessage(msg);
}
```

**关键**：所有用户可见字符串走 i18n 的 `t()` 函数，logger + notification 双通道输出。en 与 zh 双语同步（宪法 §III）。

## Problems 面板集成

```typescript
class DiagnosticManager {
  private diagnostics: Map<string, vscode.Diagnostic[]>;
  private collection: vscode.DiagnosticCollection;

  add(file: string, diagnostic: vscode.Diagnostic): void;
  clearFile(file: string): void;
  clearAll(): void;
  apply(): void; // 实际写入 VS Code
}
```

### 诊断级别映射

| `ParsedDiagnostic.severity` | `vscode.DiagnosticSeverity` |
| --------------------------- | --------------------------- |
| `error`                     | `Error`（红色下划线）       |
| `warning`                   | `Warning`（黄色下划线）     |
| `note`                      | `Information`（蓝色）       |

### 注意事项

- **诊断必须有绝对路径**：相对路径 VS Code 不识别。
- **行列从 0 开始**：MSVC 输出是 1-based，要减 1（`src/parsers/msvcParser.ts` 已统一处理）。
- **构建前清空前一次的诊断**：不要累积旧错误。

## ControlPanel Webview

### 首屏与消息握手时序

```
resolveWebviewView()  →  async，返回 Promise<void>
  ├── 注册 onDidReceiveMessage / onDidChangeVisibility 监听   ← 必须先注册
  └── await initWebview()
         ├── await refreshTitleInfo()   → projectName / engineVersion
         └── webview.html = getHtmlContent(webview)
```

- **先注册监听，再 `await`**：`resolveWebviewView` 改成 `async` 后，await 期间到达的 `panelReady` 消息会丢 —— 监听晚注册就没有补救时机。
- **先拿标题信息，再赋 HTML**：旧实现同步赋 HTML，此刻 `projectName` 还是空串 → HTML 渲染 `body.no-project`，整个界面被 CSS 藏掉，只剩空状态遮罩。拿不到标题也要把 HTML 渲染出来（空状态遮罩），不能让面板永远空白。
- **`panelReady` 是 webview 就绪的权威信号**：收到后重推 title / panelState / proxyConfig / status 四类状态。首屏之前的推送可能早于 iframe 就绪，`postMessage` resolve 为 false 时消息直接丢失。
- **`postMessage` 失败要留痕**：`void postMessage(msg).then(...)` —— 投递为 false（webview 未就绪 / 已销毁）或 promise reject 时记 `logger.warn`，不再静默丢消息。

### 消息校验

webview 消息**可以被伪造**，扩展侧必须自校验：

- **命令白名单用 null 原型对象**（`Object.create(null)`）—— 对象字面量继承 `Object.prototype`，`COMMAND_MAP['constructor']` 会返回继承来的函数（truthy）→ 绕过「未知命令」分支。
- **配置值逐项校验类型**（`validateConfigValue`）—— `CONFIG_VALUE_KINDS` 显式列出每个字段的类型（boolean / number / select / string），`select` 还校验取值在白名单内。不匹配即拒绝并回推错误。
- **命令消息的载荷也要校验** —— `saveAddFlags` 的 `selectedIds` 只接受字符串数组。

### 保存 Add flags

`saveAddFlags` 走 `@clangd` 的**统一写入入口** `clangdFlagRenderer.writeClangdAddFlags`：

- ctx 五项由 `collectClangdFlagContext` 统一采集 —— 旧实现传的是**完全为空**的 ctx，依赖动态路径的词条（compat header / preparse headers / UHT include dirs）渲染出 0 个 flag，用户勾选**静默失效**（面板报「保存成功」，`.clangd` 里啥也没有）。
- 保存的是**并集**：保留用户已选的 `system-include-windows`（它在 glossary 里没有对应 checkbox，webview 不会回传）—— 否则保存一次就把 Windows SDK / MSVC 的 `/imsvc` 全部丢掉。

## Output Channel 与日志

统一的日志输出通道，所有模块共享：

```typescript
const channel = vscode.window.createOutputChannel('VSCodeUEHelper');

channel.info('[ui] ...');
channel.warn('[ui] ...');
channel.error('[ui] ...');
```

**约定**：每个日志行开头加模块前缀，方便过滤：

```
[detection] workspaceFile = C:/path/to/project.code-workspace
[build] running UBT...
[clangd] wrote .clangd config
[ui] statusBar updated
[commands] registered 28 commands
```

UI 模块日志前缀：`[ui]`。子区域细分可加 `[ui/statusBar]` / `[ui/controlPanel]` 等。日志要携带上下文（诊断 / 命令 / 资源名），满足宪法 §III 的 observable 原则。

## UI 激活流程

```typescript
// activateUI() 内部流程
1. 创建所有 StatusBarItem（但暂不 show）
2. await detection.ready         // 等待检测完成
3. 用检测结果更新状态栏文本
4. 注册配置变化监听器 → 变化时刷新 UI
5. 所有 button.show()
```

**关键点**：先创建按钮但不显示，等检测结果后才 `show()`，避免闪烁。

## 图标约定

使用 VS Code 内置图标（Octicons）：

| 用途        | 图标代码                |
| ----------- | ----------------------- |
| 构建        | `$(tools)` / `$(play)`  |
| 启动        | `$(rocket)`             |
| 热重载      | `$(zap)`                |
| Rebuild     | `$(refresh)`            |
| Clean       | `$(trash)`              |
| 成功        | `$(check)`              |
| 警告 / 失败 | `$(alert)` / `$(error)` |
| 日志        | `$(output)`             |
| 配置        | `$(gear)`               |
| 类 / 目标   | `$(symbol-class)`       |
| 信息        | `$(info)`               |

## 资源清理与生命周期

- 全部 `StatusBarItem`、watcher、`DiagnosticCollection`、Webview 必须 push 到 `context.subscriptions`（宪法 §III）。
- `StatusBarManager.dispose()` 释放所有按钮；插件卸载时由 `extension.ts` 释放 UI 子模块 subscriptions。
- Webview / Project Explorer 等长寿命对象在 `index.ts` 创建并跟随 `context.subscriptions`；不要在命令层单独持 references。

## 禁用状态处理

当检测失败（无 `.uproject` 或引擎）时：

- 状态栏按钮变灰（`statusBarItem.warningBackground`）
- tooltip 提示原因
- 点击时显示错误通知而不是执行命令
- Build / Rebuild / Clean / LiveCoding / Launch 按钮在无项目时直接 `hide()`（已经实现，见 `statusBar.ts#update`）
- 不崩溃，只是功能降级

## 跨模块约束（宪法 §II）

- **不要**在 UI 层调用 `vscode.workspace.workspaceFile` / `getWorkspaceFolder` 直读 —— 一律读 `WorkspaceState` 提供的 getter。
- **不要**读 `config.completionMode` 决策 UI 行为 —— fast/slow 已统一 slow，UI 不再展示模式状态。
- **不要**直接写 `.clangd` / `compile_commands.json` —— `.clangd` 的 `CompileFlags.Add` 只经 `@clangd` 的统一入口 `clangdFlagRenderer.writeClangdAddFlags` 写；`compile_commands.json` 由 `@clangd` / `@build` 负责。UI 仅触发命令或回调。
