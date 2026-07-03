# Phase 1 Plan: 面板框架 + 操作按钮

**Goal:** 创建 WebView 控制面板框架，集成所有现有命令的一键操作按钮。

**Requirements:** CTRL-01 ~ CTRL-10

---

## Overview

Phase 1 为整个控制面板打下基础。核心思路是「命令触发层」：面板本身只是一个 WebView 界面，点击按钮时通过 `vscode.postMessage` 向扩展进程发送消息，扩展进程收到消息后调用已有的命令实现（`commands/index.ts` 中的 `execute*` 函数）。

**关键设计决策:**
- WebView 使用 **panel** 类型（非 preview），保持独立标签页
- 单例模式：通过 `vscode.WebviewPanel.onDidDispose` 清理引用，通过 `panel.reveal()` 复用
- 消息协议：使用 `neverthrow` 的 `Result` 类型统一错误处理（与现有代码一致）
- 按钮分组：按功能划分 Tab（构建、代理、工具），Phase 1 只实现操作按钮

---

## Files to Create / Modify

### 1. `src/ui/controlPanelMessages.ts` — 消息协议 (CREATE)

定义 WebView ↔ Extension 之间的消息类型。

```typescript
// 扩展 → WebView 消息
export type PanelMessage =
  | { type: 'commandResult'; command: string; success: boolean; message?: string }
  | { type: 'showError'; message: string };

// WebView → 扩展消息
export type WebViewMessage =
  | { type: 'executeCommand'; command: string }
  | { type: 'panelReady' };

// 面板状态
export interface PanelState {
  projectName: string;
  engineVersion: string;
}
```

### 2. `src/ui/controlPanel.html.ts` — HTML 模板 (CREATE)

生成 WebView 的 HTML/CSS/JS 内容。

- 使用 VS Code WebView 的 `cspSource` 设置 Content-Security-Policy
- 适配 VS Code 深色/浅色主题（通过 `body.vscode-dark` / `body.vscode-light` class）
- 按钮按功能分组：
  - **Build** 组：Build / Rebuild / Clean
  - **Launch** 组：Launch Editor / Live Coding
  - **Project** 组：Create Project / Generate compile_commands
  - **Diagnostics** 组：Diagnose Project / Toggle Completion Mode / Set System Includes
  - **Proxy** 组：Enable Proxy / Disable Proxy / Show Proxy Status
  - **Tools** 组：Show Project Info / Regenerate Workspace / Open Workspace File / Install Rules / Uninstall
- 每个按钮调用 `vscode.postMessage({ type: 'executeCommand', command: '...' })`
- 显示执行结果反馈（通过接收 `commandResult` 消息更新内联状态文本）
- 点击后按钮短暂禁用防重复点击

### 3. `src/ui/controlPanel.ts` — ControlPanel 类 (CREATE)

单例管理 WebView 面板。

```typescript
export class ControlPanel {
  private static instance: ControlPanel | null = null;
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(context: vscode.ExtensionContext, ...deps): ControlPanel;
  static dispose(): void;
  
  private constructor(context, ...deps);
  private getHtmlContent(): string;
  private handleMessage(message: WebViewMessage): Promise<void>;
  private showResult(command: string, success: boolean, message?: string): void;
  public dispose(): void;
}
```

**消息路由：** 收到 `executeCommand` 消息后，通过 `vscode.commands.executeCommand` 调用已有命令。部分命令需要特殊处理（如 `showProjectInfo` 在面板模式下可以改为内联展示）。

**依赖注入：** 接收 `Config`, `Logger`, `DetectionHandles`, `ClangdHandles`（与 `activateCommands` 签名一致）。

### 4. `src/commands/showControlPanel.ts` — 打开面板命令 (CREATE)

```typescript
export function executeShowControlPanel(
  context: vscode.ExtensionContext,
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  clangd: ClangdHandles,
): void {
  ControlPanel.createOrShow(context, config, logger, detection, clangd);
}
```

### 5. `src/commands/index.ts` — 注册新命令 (MODIFY)

```typescript
import { executeShowControlPanel } from './showControlPanel';

// 在 activateCommands 中注册:
registerCommand(context, 'vscodeUEHelper.showControlPanel', () =>
  executeShowControlPanel(context, config, logger, detection, clangd),
);
// logger.info 更新为 21 个命令
```

### 6. `package.json` — 命令 manifest (MODIFY)

```json
{
  "command": "vscodeUEHelper.showControlPanel",
  "title": "Show Control Panel",
  "title@zh": "显示控制面板",
  "category": "UE Helper",
  "icon": "$(dashboard)"
}
```

同时在 `activationEvents` 中添加 `onCommand:vscodeUEHelper.showControlPanel`。

### 7. `src/i18n/locales/en.json` / `zh.json` — 面板文本 (MODIFY)

添加 Phase 1 需要的 i18n key：
- `panel.title` — 面板标题
- `panel.tab.actions` — 操作按钮 Tab 名
- `panel.group.build` — 构建组标题
- `panel.group.launch` — 启动组标题
- `panel.group.project` — 项目组标题
- `panel.group.diagnostics` — 诊断组标题
- `panel.group.proxy` — 代理组标题
- `panel.group.tools` — 工具组标题
- `panel.executing` — 执行中提示
- `panel.result.success` / `panel.result.failure` — 结果反馈

### 8. `test/unit/ui/controlPanel.test.ts` — 单元测试 (CREATE)

测试覆盖：
- `ControlPanel.createOrShow()` 创建新面板
- `ControlPanel.createOrShow()` 复用已有面板（单例行为）
- `ControlPanel.dispose()` 释放资源
- `handleMessage('executeCommand')` 分发到 `vscode.commands.executeCommand`
- `getHtmlContent()` 返回有效的 HTML 结构
- `panel.onDidDispose` 清理 instance 引用

---

## Tab Structure (Phase 1)

Phase 1 只实现「操作按钮」一个 Tab，但为后续 Phase 2/3 预留 Tab 切换结构：

| Tab | Phase | Status |
|-----|-------|--------|
| Actions (操作按钮) | Phase 1 | ✅ 实现 |
| Config (配置编辑) | Phase 2 | ⏳ 预留占位 |
| Proxy Settings | Phase 2 | ⏳ 预留占位 |
| Status (状态展示) | Phase 3 | ⏳ 预留占位 |

HTML 中为所有 Tab 写好切换逻辑 JS，但非 Phase 1 的 Tab 内容显示「Coming soon」占位文本。

---

## Implementation Order

1. **消息协议** — `controlPanelMessages.ts`
2. **HTML 模板** — `controlPanel.html.ts`
3. **ControlPanel 类** — `controlPanel.ts`
4. **打开面板命令** — `showControlPanel.ts`
5. **注册命令** — `commands/index.ts`
6. **命令 manifest** — `package.json`
7. **i18n 文本** — `en.json` / `zh.json`
8. **单元测试** — `controlPanel.test.ts`
9. **构建验证** — `npm run build`

---

## Dependencies & Risk

- **无外部依赖**：WebView 是 VS Code 内置 API
- **风险**：`vscode.commands.executeCommand` 在 WebView 中异步调用，需处理好 Loading 状态
- **风险**：部分命令（如 `enableClangdProxy`）可能弹对话框，在面板模式下需调整为静默模式或通过面板内消息通知
- **缓解**：`executeCommand` 消息处理使用 `try/catch`，失败时通过 `panel.webview.postMessage` 反馈

---

## Verification

1. `npm run build` 编译通过
2. `npm test` 单元测试通过
3. `npm run lint` 无错误
4. F5 启动后 `UE Helper: Show Control Panel` 打开面板
5. 点击每个按钮执行对应命令
6. 再次执行命令聚焦已有面板（不创建新面板）
7. 关闭面板后资源释放
