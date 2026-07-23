# ui 模块知识库

## 模块概述

**用户界面层**，负责所有与用户的可视化交互：
- 11 个状态栏按钮
- QuickPick 选择器（引擎、配置、目标）
- 信息/警告/错误 通知弹窗
- Problems 面板集成（错误解析）
- Output Channel 日志输出

## 核心文件

| 文件 | 职责 |
|---|---|
| `statusBar.ts` | 所有状态栏按钮的创建与更新 |
| `quickPicks.ts` | QuickPick 选择器（引擎、配置、目标） |
| `notifications.ts` | 通知弹窗封装 |
| `problemsPanel.ts` | Problems 面板诊断管理 |
| `outputChannel.ts` | Output Channel 日志输出封装 |
| `controlPanel.ts` | ControlPanelProvider —— Webview 控制面板（侧边栏） |
| `index.ts` | UI 激活入口 |

## 状态栏设计

### 按钮布局（从左到右）

```
[配置] [目标] [平台] [构建] [启动] [热重载] [clangd] [项目] [引擎] [检测] [日志]
```

### 每个按钮的职责

| 按钮 | 点击行为 | 显示内容 |
|---|---|---|
| 配置 | 选择构建配置 | `Development` / `DebugGame` 等 |
| 目标 | 选择构建目标 | `Editor` / `Game` / `Server` / `Client` |
| 平台 | 显示目标平台 | `Win64` / `Mac` / `Linux` |
| 构建 | 立即构建 | `$(tools)` 图标 + 点击 |
| 启动 | 启动 Editor | `$(play)` 图标 + 点击 |
| 热重载 | Live Coding | `$(zap)` 图标 + 点击 |
| clangd | 切换补全模式 | `UE⚡` fast / `UE⌚` slow |
| 项目 | 显示当前项目 | 项目名 |
| 引擎 | 显示当前引擎 | 引擎版本 |
| 检测 | 显示检测状态 | `$(check)` 成功 / `$(alert)` 失败 |
| 日志 | 打开 Output | `$(output)` 图标 |

### 状态栏模式

```typescript
// 1. 静态按钮 - 点击触发命令
vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

// 2. 动态按钮 - 状态变化时更新文本
item.text = `UE⚡`;  // fast 模式
item.text = `UE⌚`;  // slow 模式

// 3. 条件显示 - 只在 Windows 显示 Live Coding
if (process.platform === 'win32') {
  liveCodingItem.show();
}
```

## QuickPicks 选择器

### 设计模式

每个选择器遵循相同模式：

```typescript
export async function pickXxx(
  items: T[],
  activeItem?: T,
  labelFn: (item: T) => string,
): Promise<T | undefined> {
  // 1. 构造 QuickPickItem 数组
  // 2. activeItem 前面加 ✅ 标记
  // 3. showQuickPick
  // 4. 用户取消 → return undefined
}
```

### 选择器列表

| 选择器 | 选项来源 | 持久化 |
|---|---|---|
| `pickEngine()` | detection.engines | workspaceState |
| `pickConfig()` | 固定枚举 (Debug/DebugGame/Dev/Shipping/Test) | vscode 配置 |
| `pickTarget()` | 固定枚举 (Editor/Game/Server/Client) | vscode 配置 |
| `pickPlatform()` | 固定枚举（Windows-only：本插件仅服务 Win64） | vscode 配置 |

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

**关键**：所有用户可见字符串走 i18n 的 `t()` 函数，logger 和 notification 同时输出。

## Problems 面板集成

```typescript
class DiagnosticManager {
  // 每个源文件一个诊断集合
  private diagnostics: Map<string, vscode.Diagnostic[]>;
  private collection: vscode.DiagnosticCollection;

  add(file: string, diagnostic: vscode.Diagnostic): void;
  clearFile(file: string): void;
  clearAll(): void;
  apply(): void;  // 实际写入 VS Code
}
```

### 诊断级别映射

| ParsedDiagnostic.severity | vscode.DiagnosticSeverity |
|---|---|
| `error` | `Error` (红色下划线) |
| `warning` | `Warning` (黄色下划线) |
| `note` | `Information` (蓝色) |

### 注意事项

- **诊断必须有绝对路径**：相对路径 VS Code 不识别
- **行列从 0 开始**：MSVC 输出是 1-based，要减 1
- **构建前清空前一次的诊断**：不要累积旧错误

## Output Channel

统一的日志输出通道，所有模块共享：

```typescript
// Logger 类内部使用
const channel = vscode.window.createOutputChannel('VSCodeUEHelper');

// 支持的级别
channel.info('[module] message');
channel.warn('[module] warning');
channel.error('[module] error');
```

**约定**：每个日志行开头加模块前缀，方便过滤：
```
[detection] workspaceFile = C:/path/to/project.code-workspace
[build] running UBT...
[clangd] wrote .clangd config
```

## UI 激活流程

```typescript
// activateUI() 内部流程
1. 创建所有 StatusBarItem
2. await detection.ready  // 等待检测完成
3. 用检测结果更新状态栏文本
4. 注册配置变化监听器 → 变化时刷新 UI
5. 所有 button.show()
```

**关键点**：先创建按钮但不显示，等检测结果后才 show()，避免闪烁。

## 图标约定

使用 VS Code 内置图标 (Octicons)：

| 用途 | 图标代码 |
|---|---|
| 构建 | `$(tools)` |
| 启动 | `$(play)` |
| 热重载 | `$(zap)` |
| 成功 | `$(check)` |
| 警告/失败 | `$(alert)` |
| 日志 | `$(output)` |
| 配置 | `$(gear)` |
| 类/目标 | `$(symbol-class)` |
| 信息 | `$(info)` |

## 禁用状态处理

当检测失败（无 .uproject 或引擎）时：
- 状态栏按钮变灰（轻量颜色）
-  tooltip 提示原因
- 点击时显示错误通知而不是执行命令
- 不崩溃，只是功能降级
