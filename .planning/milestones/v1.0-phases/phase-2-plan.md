# Phase 2: Clangd Proxy 控制面板 — 实施计划

## 目标

构建 Clangd Proxy 控制面板，提供 WebView 界面来监控和管理 clangd proxy 实例。

## 当前状态分析

### 已有代码（已完成的部分）

| 文件 | 状态 | 说明 |
|---|---|---|
| `src/ui/controlPanel.ts` | ✅ 骨架 | `ClangdProxyControlPanel` 类，实现 `vscode.WebviewViewProvider` |
| `src/ui/controlPanel.html.ts` | ✅ 骨架 | 生成 HTML 模板，含基础结构和样式 |
| `src/ui/controlPanelMessages.ts` | ✅ 完成 | WebView ↔ 扩展消息类型定义 |
| `src/commands/showControlPanel.ts` | ✅ 完成 | 注册 `ueHelper.showControlPanel` 命令 |
| `src/commands/showClangdProxyStatus.ts` | ✅ 完成 | 显示当前代理状态信息 |
| `src/commands/index.ts` | ✅ 已注册 | 命令注册入口 |
| `src/extension.ts` | ✅ 已注册 | 扩展激活入口 |
| `test/unit/ui/controlPanel.test.ts` | ✅ 骨架 | 基础测试结构 |
| `test/unit/setup.ts` | ✅ 完成 | VS Code API mock |

### 差距分析

1. **controlPanel.ts** — `resolveWebviewView()` 中的 HTML 未注入实际数据；`_panel` 未正确初始化；缺少完整消息处理
2. **controlPanel.html.ts** — 模板缺少 **JavaScript 交互逻辑**（当前只有 CSS）；消息面板没有实际数据
3. **controlPanelMessages.ts** — ✅ 定义完整，无需修改
4. **与 Clangd Proxy 的集成** — 控制面板未获取代理实际状态（端口、运行状态、请求数等）
5. **i18n 文本** — 缺少控制面板相关的中英文文本
6. **状态栏交互** — `showClangdProxyStatus` 命令已存在但需要与状态栏自动集成
7. **配置管理** — 未实现通过 WebView 修改代理配置（端口、编译数据库路径等）
8. **日志查看** — 未实现实时日志显示

## 实施任务

### 任务 1: 完成 controlPanel.ts — WebView Provider

**文件**: `src/ui/controlPanel.ts`

- [ ] 添加 `_disposables` 数组管理订阅
- [ ] 在构造函数中接收 `ClangdProxy` 实例（或通过 DI 获取）
- [ ] 实现 `resolveWebviewView()` — 注入实际数据到 HTML
- [ ] 实现 `_handleMessage()` — 处理 WebView 发来的所有消息类型
- [ ] 实现代理状态变更事件监听 → 推送更新到 WebView
- [ ] 实现 `dispose()` 清理

### 任务 2: 完善 controlPanel.html.ts — HTML 模板

**文件**: `src/ui/controlPanel.html.ts`

- [ ] 添加 JavaScript 交互逻辑（监听消息、发送命令、更新 UI）
- [ ] **仪表盘视图**: 状态指示器、运行时间、端口信息
- [ ] **统计视图**: 请求总数、活跃请求数、错误数
- [ ] **日志视图**: 实时日志列表（可滚动、自动滚动到底部）
- [ ] **配置视图**: 端口号、编译数据库路径、额外参数
- [ ] **操作按钮**: 启动/停止/重启代理
- [ ] **通知**: 操作结果反馈（成功/错误提示）
- [ ] **暗色/亮色主题适配**（使用 VS Code CSS 变量）

### 任务 3: 集成 Clangd Proxy 状态

**文件**: `src/ui/controlPanel.ts` + `src/clangd/proxy/index.ts`

- [ ] 在 `ClangdProxy` 或 `ClangdProxyManager` 中暴露状态接口
- [ ] 定义 `ProxyState` 类型:
  ```ts
  interface ProxyState {
    status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
    port: number;
    pid?: number;
    uptime: number;        // 秒
    requestCount: number;
    activeRequests: number;
    errorCount: number;
    logLines: string[];
    compileCommandsPath?: string;
  }
  ```
- [ ] 控制面板定期轮询或监听事件更新状态
- [ ] 启动/停止/重启操作调用 Proxy 实例方法

### 任务 4: 配置管理

**文件**: `src/ui/controlPanel.ts` + 新文件 `src/ui/controlPanelConfig.ts`

- [ ] 定义可配置项类型
- [ ] 从 VS Code 配置读取/保存（`vscode.workspace.getConfiguration`）
- [ ] WebView 发送配置变更 → 扩展保存并应用

### 任务 5: i18n 文本补充

**文件**: `src/i18n/locales/zh.json` + `src/i18n/locales/en.json`

添加控制面板所需的文本:
- 面板标题、状态标签、按钮文字
- 统计信息标签、日志标签
- 配置项标签、错误提示
- 状态栏文字

### 任务 6: 状态栏自动集成

**文件**: `src/commands/showClangdProxyStatus.ts`

- [ ] 创建状态栏项（`vscode.window.createStatusBarItem`）
- [ ] 显示代理状态（运行中/已停止）+ 端口号
- [ ] 点击打开控制面板
- [ ] 监听代理状态变更自动更新

### 任务 7: 单元测试补充

**文件**: `test/unit/ui/controlPanel.test.ts` + 新测试文件

- [ ] controlPanel.test.ts — 测试完整消息处理循环
- [ ] controlPanel.html.test.ts — 测试 HTML 模板生成（如适用）
- [ ] showControlPanel.test.ts — 测试命令注册和调用

### 任务 8: 边界情况与健壮性

- [ ] 代理未安装/未找到时的优雅提示
- [ ] WebView 关闭后清理事件监听
- [ ] 配置变更后的实时刷新
- [ ] 错误恢复（代理崩溃后状态同步）

## 实施顺序

```
任务 3（状态接口）→ 任务 1（Provider）→ 任务 2（HTML 模板 + JS）
→ 任务 4（配置）→ 任务 5（i18n）→ 任务 6（状态栏）→ 任务 7（测试）
```

## 不在此阶段的范围

- 高级日志过滤/搜索
- 代理性能图表（CPU/内存）
- 多代理实例管理
- 代理配置的导入/导出

## 验收标准

1. 控制面板 WebView 显示代理实时状态
2. 启动/停止/重启代理操作正常
3. 日志视图实时显示代理日志
4. 配置可读可写
5. 状态栏显示代理状态，点击打开控制面板
6. 所有 i18n 文本中英文完整
7. 单元测试覆盖核心交互逻辑
