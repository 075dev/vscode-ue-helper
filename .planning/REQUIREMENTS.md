# Requirements: VSCode UE Helper — 控制面板

**Defined:** 2026-06-30
**Core Value:** UE 开发者可以在 VS Code 中完成所有日常开发操作，无需切换到 Rider 或 Visual Studio。

## v1 Requirements (Milestone: 控制面板)

Requirements for milestone v1.0. Each maps to a roadmap phase.

### Phase 1: 面板框架 + 操作按钮

- [ ] **CTRL-01**: 用户通过命令 `UE Helper: Show Control Panel` 打开 WebView 面板
- [ ] **CTRL-02**: 面板使用 VS Code WebView API，单例模式（同时只能打开一个）
- [ ] **CTRL-03**: 面板标题栏显示当前项目名称和引擎版本
- [ ] **CTRL-04**: 面板包含 Build / Rebuild / Clean 构建按钮，点击执行对应命令
- [ ] **CTRL-05**: 面板包含 Launch Editor / Live Coding 启动按钮
- [ ] **CTRL-06**: 面板包含 Create Project / Generate compile_commands 项目管理按钮
- [ ] **CTRL-07**: 面板包含 Diagnose Project / Toggle Completion Mode / Set System Includes 诊断工具按钮
- [ ] **CTRL-08**: 面板包含 Enable Proxy / Disable Proxy / Show Proxy Status 代理控制按钮
- [ ] **CTRL-09**: 面板包含 Show Project Info / Regenerate Workspace / Open Workspace File / Install Rules / Uninstall 其他工具按钮
- [ ] **CTRL-10**: 面板按钮操作结果通过通知或面板内消息反馈给用户

### Phase 2: 配置编辑区 + Proxy 设置

- [ ] **CTRL-11**: 面板提供 Build Configuration 下拉选择器（Debug/DebugGame/Development/Shipping/Test）
- [ ] **CTRL-12**: 面板提供 Build Target 下拉选择器（Editor/Game/Server/Client）
- [ ] **CTRL-13**: 面板提供 Platform 下拉选择器（Win64/Mac/Linux）
- [ ] **CTRL-14**: 面板提供 Completion Mode 切换开关（Fast/Slow）
- [ ] **CTRL-15**: 面板提供 MCP Mode 选择器（Auto/Always/Never）
- [ ] **CTRL-16**: 面板提供 Auto-backup Workspace 开关
- [ ] **CTRL-17**: 面板提供 Logging Level 选择器
- [ ] **CTRL-18**: 面板提供 Proxy Enable/Disable 开关
- [ ] **CTRL-19**: 面板提供 Localization Enable 开关、Mode 选择器、Targets 勾选框
- [ ] **CTRL-20**: 面板提供 Keepalive Max / TTL 输入框
- [ ] **CTRL-21**: 面板提供 Real Clangd Path / Log Path 输入框

### Phase 3: 状态展示 + 细节打磨

- [ ] **CTRL-22**: 面板 Status Tab 展示当前项目名称和路径
- [ ] **CTRL-23**: 面板展示当前引擎版本和路径
- [ ] **CTRL-24**: 面板展示 Proxy 状态摘要（启用/激活/本地化状态）
- [ ] **CTRL-25**: 面板展示 Workspace 文件路径
- [ ] **CTRL-26**: 面板打开时自动获取最新状态（detection.ready）
- [ ] **CTRL-27**: 面板支持中英文界面切换（跟随 VS Code 语言）
- [ ] **CTRL-28**: 面板卸载时自动清理资源

## Future Requirements

### Phase 4+: 增强功能

- **CTRL-F1**: 面板支持快捷键绑定
- **CTRL-F2**: 面板支持自定义按钮排序
- **CTRL-F3**: 面板支持构建历史查看

## Out of Scope

| Feature | Reason |
|---------|--------|
| 替换现有状态栏 | 状态栏和控制面板互补，用户可同时使用 |
| 实时构建日志输出到面板 | 构建日志在 Output 通道更合适 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CTRL-01 ~ CTRL-10 | Phase 1 | Pending |
| CTRL-11 ~ CTRL-21 | Phase 2 | Pending |
| CTRL-22 ~ CTRL-28 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-30*
*Last updated: 2026-06-30 after initial definition*
