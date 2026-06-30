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

## Next Milestone Goals

- Phase 4+ 增强功能（快捷键绑定、自定义按钮排序、构建历史查看）
- 用户反馈驱动的迭代优化
- 潜在的性能优化和体验打磨

## Requirements

### Validated

- ✓ **CTRL-01 ~ CTRL-10**: 面板框架 + 操作按钮 — v1.0
- ✓ **CTRL-11 ~ CTRL-21**: 配置编辑 + Proxy 设置 — v1.0
- ✓ **CTRL-22 ~ CTRL-28**: 状态展示 + 细节打磨 — v1.0

### Active

(None — next milestone to define fresh requirements)

### Out of Scope

- 替换现有的状态栏 UI — 状态栏和控制面板共存互补
- 实时构建日志输出到面板 — 构建日志在 Output 通道更合适

## Context

- 插件已有完整命令体系（20 个命令注册在 `src/commands/index.ts`）
- 已有状态栏 11 个按钮（`src/ui/statusBar.ts`）
- 已有 Config 强类型配置封装（`src/core/config.ts`）
- 所有配置项已在 `package.json` 的 `contributes.configuration` 中定义
- 已有 i18n 系统（`src/i18n/index.ts`，中英双语）
- **v1.0 新增**: WebView 控制面板（4 Tab，16 按钮，15 配置字段）
- 代码库映射已完成（`.planning/codebase/` 含 7 个文档）

## Constraints

- **Tech Stack**: 纯 VS Code WebView API（HTML/CSS/JS），不引入前端框架
- **Pattern**: 消息协议双向通信（postMessage / onDidReceiveMessage）
- **i18n**: 所有用户可见文本必须通过 t() 函数

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
*Last updated: 2026-07-01 after v1.0 milestone*
