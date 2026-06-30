# VSCode UE Helper

## What This Is

VS Code 插件，为 Unreal Engine C++ 开发提供一站式支持：UBT 构建、Live Coding 热重载、clangd IntelliSense 集成、以及可选的 MCP AI 代理集成。当前已有完整的命令系统（20+ 命令）、状态栏 UI、clangd LSP Proxy 和 22 条诊断中文本地化规则。

## Core Value

UE 开发者可以在 VS Code 中完成所有日常开发操作，无需切换到 Rider 或 Visual Studio。

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] **CTRL-01**: 用户可以通过 WebView 面板点击按钮执行所有插件操作，无需记忆命令
- [ ] **CTRL-02**: 面板包含 Build / Rebuild / Clean / Launch Editor / Live Coding 等构建操作按钮
- [ ] **CTRL-03**: 面板包含 Create Project / Generate compile_commands / Diagnose 等项目管理按钮
- [ ] **CTRL-04**: 面板包含 Enable/Disable Proxy 及 Show Proxy Status 等代理控制按钮
- [ ] **CTRL-05**: 面板包含 Toggle Completion Mode / Set System Includes 等 clangd 工具按钮
- [ ] **CTRL-06**: 面板提供可视化的配置选择器（Configuration / Target / Platform 等）
- [ ] **CTRL-07**: 面板提供 Proxy 高级设置编辑（Keepalive / Localization 等）
- [ ] **CTRL-08**: 面板展示当前项目、引擎、Proxy 状态的实时信息
- [ ] **CTRL-09**: 面板支持中英文界面（i18n）
- [ ] **CTRL-10**: 面板打开时自动获取最新配置和状态

### Out of Scope

- 替换现有的状态栏 UI — 状态栏和控制面板共存互补

## Context

- 插件已有完整命令体系（20 个命令注册在 `src/commands/index.ts`）
- 已有状态栏 11 个按钮（`src/ui/statusBar.ts`）
- 已有 Config 强类型配置封装（`src/core/config.ts`）
- 所有配置项已在 `package.json` 的 `contributes.configuration` 中定义
- 已有 i18n 系统（`src/i18n/index.ts`，中英双语）
- 代码库映射已完成（`.planning/codebase/` 含 7 个文档）

## Constraints

- **Tech Stack**: 纯 VS Code WebView API（HTML/CSS/JS），不引入前端框架
- **Pattern**: 消息协议双向通信（postMessage / onDidReceiveMessage）
- **i18n**: 所有用户可见文本必须通过 t() 函数

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| WebView 面板 | 已有完整命令体系，WebView 提供可视化交互 | — Pending |
| 分 3 个阶段交付 | Phase 1 按钮（最高价值），Phase 2 配置，Phase 3 状态 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-30 after initial definition*
