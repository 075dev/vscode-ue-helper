# VSCode UE Helper

## What This Is

VS Code 插件，为 Unreal Engine C++ 开发提供一站式支持：UBT 构建、Live Coding 热重载、clangd IntelliSense 集成、以及可选的 MCP AI 代理集成。当前已有完整的命令系统（20+ 命令）、WebView 控制面板、状态栏 UI、clangd LSP Proxy 和 22 条诊断中文本地化规则。

## Core Value

UE 开发者可以在 VS Code 中完成所有日常开发操作，无需切换到 Rider 或 Visual Studio。

## Current State

**v1.0 控制面板** ✅ Shipped 2026-07-01

- 3 phases, 28 requirements, 498 tests passing
- 46 files changed, +3,303 / -140 lines of code
- Complete WebView control panel with 4 Tabs (Actions / Config / Proxy / Status)
- 16 one-click action buttons, 7+8 config fields, 3 status cards
- Full i18n (Chinese/English) support
- Timeline: 2026-06-30 → 2026-07-01

## Current Milestone: v1.2 汉化规则覆盖完善

**Goal:** 系统性扩展汉化规则覆盖范围，从 58 条扩展到 200+ 条，覆盖 UE C++ 开发中的常见 clangd/clang-cl 诊断消息和 hover 内容。

**Target features:**
- 系统性收集并添加 clangd/clang-cl 常见诊断规则（目标 200+ 条）
- hover 内容结构化关键词汉化（C++ 关键字、UE 类型名等）
- 用户通过日志反馈持续迭代规则
- 所有规则有对应的单元测试

## Previous Milestone: v1.1 Proxy 本地化增强 ✅

## Requirements

### Validated

- ✓ **CTRL-01 ~ CTRL-10**: 面板框架 + 操作按钮 — v1.0
- ✓ **CTRL-11 ~ CTRL-21**: 配置编辑 + Proxy 设置 — v1.0
- ✓ **CTRL-22 ~ CTRL-28**: 状态展示 + 细节打磨 — v1.0

### Active

- [ ] **LOC-01**: CLI 层传递 localization 配置给 LspBridge
- [ ] **LOC-02**: 新增"仅中文"本地化模式（当前为 append 模式，需支持 replace 替换英文）
- [ ] **LOC-03**: 完善汉化规则覆盖范围
- [ ] **LOC-04**: 端到端验证本地化功能

### Out of Scope

- 替换现有的状态栏 UI — 状态栏和控制面板共存互补
- 实时构建日志输出到面板 — 构建日志在 Output 通道更合适
- Phase 4+ 面板增强功能（快捷键、排序、构建历史）— 推迟到 v1.2

## Context

- 插件已有完整命令体系（20 个命令注册在 `src/commands/index.ts`）
- 已有状态栏 11 个按钮（`src/ui/statusBar.ts`）
- 已有 Config 强类型配置封装（`src/core/config.ts`）
- 所有配置项已在 `package.json` 的 `contributes.configuration` 中定义
- 已有 i18n 系统（`src/i18n/index.ts`，中英双语）
- **v1.0 新增**: WebView 控制面板（4 Tab，16 按钮，15 配置字段）
- **已知问题**: clangd Proxy 本地化功能因 CLI 层未传递配置而静默失效

## Constraints

- **Tech Stack**: 纯 VS Code WebView API（HTML/CSS/JS），不引入前端框架
- **Pattern**: 消息协议双向通信（postMessage / onDidReceiveMessage）
- **i18n**: 所有用户可见文本必须通过 t() 函数
- **Proxy 协议**: 代理 CLI 必须通过 --localization-* 参数传递本地化配置

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| WebView 面板 | 已有完整命令体系，WebView 提供可视化交互 | ✓ Good |
| 分 3 个阶段交付 | Phase 1 按钮（最高价值），Phase 2 配置，Phase 3 状态 | ✓ Good |
| 纯 VS Code WebView API | 不引入前端框架 | ✓ Good — 无额外依赖 |
| 4 Tab 分区（Actions/Config/Proxy/Status） | 功能正交，用户快速定位 | ✓ Good |
| Unicode 图标而非图标库 | 避免前端依赖 | ✓ Good |
| 配置批量保存 + 回执机制 | 确保配置写入成功 | ✓ Good |

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
*Last updated: 2026-07-01 after v1.1 milestone start*
