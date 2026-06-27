# ui 模块文档

## 基本信息
- **路径**: `src/ui/`
- **文件数**: 6
- **语言**: TypeScript
- **职责**: 状态栏(11 按钮)、QuickPick 选择器、Output 通道、Problems 面板——用户界面层。

## 符号表

### 导出类/函数

| 符号名 | 文件:行号 | 类型 | 说明 |
|--------|----------|------|------|
| activateUI | `src/ui/index.ts` | function | 创建状态栏管理器，`await detection.ready` 后渲染 |
| StatusBarManager | `src/ui/statusBar.ts` | class | 核心—管理 11 个状态栏按钮 |
| Notifications | `src/ui/notifications.ts` | | 通知管理 |
| OutputChannel | `src/ui/outputChannel.ts` | | Output 面板管理 |
| ProblemsPanel | `src/ui/problemsPanel.ts` | | Problems 面板（MSVC 错误映射） |
| QuickPicks | `src/ui/quickPicks.ts` | | QuickPick 选择器 |

### StatusBarManager 核心方法

| 方法 | 说明 |
|------|------|
| `update(ctx, settings)` | 核心渲染方法—根据 project/engine 状态显示/隐藏按钮 |
| `dispose()` | 清理所有状态栏按钮 |

## 11 个状态栏按钮

| 序号 | 图标 | 文本 | 条件 | 点击命令 |
|------|------|------|------|----------|
| 1 | `$(play)` | Build | 始终 | `vscodeUEHelper.build` |
| 2 | `$(refresh)` | Rebuild | 始终 | `vscodeUEHelper.rebuild` |
| 3 | `$(trash)` | Clean | 始终 | `vscodeUEHelper.clean` |
| 4 | `$(gear)` | {config} | 始终 | `vscodeUEHelper.selectConfig` |
| 5 | `$(symbol-class)` | {target} | 始终 | `vscodeUEHelper.selectTarget` |
| 6 | `$(device-desktop)` | {platform} | 始终 | —（只读） |
| 7 | `$(library)` | MSVC/SDK | Windows | `vscodeUEHelper.setSystemIncludes` |
| 8 | `$(file-code)` / `$(warning)` | {project} / No Project | 始终 | `vscodeUEHelper.showProjectInfo` |
| 9 | `$(package)` / `$(warning)` | UE {ver} / No Engine | 始终 | —（只读） |
| 10 | `$(zap)` | Live Coding | Windows | `vscodeUEHelper.liveCoding` |
| 11 | `$(rocket)` | Launch | 始终 | `vscodeUEHelper.launchEditor` |

> 没有项目时：构建系列 + Engine 按钮隐藏；其余按钮仍显示但可能灰色/警告状态。

## 关键设计

- **await detection.ready** — 状态栏不先渲染，等检测完。避免竞态。
- **降级显示** — 检测失败 → `$(warning) No Project` / `$(warning) No Engine`
- **Windows 限定** — Live Coding 和 MSVC/SDK 按钮仅在 Windows 显示

## 对外依赖

| 依赖模块 | 用途 |
|----------|------|
| @detection | `await detection.ready` 获取项目/引擎信息 |
| @core/logger | 日志 |
| @core/config | 读取配置 |
| vscode | StatusBarItem, QuickPick, OutputChannel |

## 被依赖情况

- `extension.ts` — 第四个激活（`src/extension.ts:84`）
- `commands/` — 部分命令调用 QuickPick/Output 通道
