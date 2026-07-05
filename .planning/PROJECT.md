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

## Current Milestone: v1.3 插件工程化与打包规范化

> **📌 2026-07-05 新里程碑**：解决用户打包痛点并规范化目录结构。
> v1.2 暂时挂起（Phase 7 完成 context 收集，Phase 8-10 待办），等 v1.3 ship 后继续。

**Goal:** 让 `npm run package` 无 WARNING 通过、VSIX 体积合理、目录结构符合 VS Code 扩展最佳实践。

**Target features (2 类别):**

**A. 打包元数据修复**
- A1: 加 LICENSE 文件（MIT 全文）
- A2: 加 `repository` 字段到 package.json（占位 URL）
- A3: 构建脚本加 clean 步骤，清理 `out/src/`、`out/test/` 残留
- A4: `.vscodeignore` 加 `*.map`，排除 source map

**B. 目录结构规范化**
- B1: 删除根目录临时文件 `temp_writer.js`、`temp_writer.mjs`、`ANALYSIS_detection_build.md`
- B2: 调查 `.omo/.codewiki/.hermes` 目录；不存在则从 `.vscodeignore` 移除

**显式不做：** 合 doc/docs、改版本号、加 release 脚本/pre-commit、继续 v1.2 的 clangd 主题。

## Previous Milestones

### v1.2 clangd 智能提示与集成完善（挂起）

**State:** Phase 7 context 已收集（CONTEXT.md），Phase 8-10 待办。
**原因:** 用户优先解决打包规范化痛点，v1.2 工作挂起等 v1.3 ship。

**Goal:** 强化 clangd 在 UE C++ 工程中的智能提示与导航能力，让 VS Code + clangd + UBT 协同工作流达到 Rider 等价体验。

**Phase 计划 (4 阶段):**
1. **Phase 7 — clangd 性能优化**：compile_commands.json 生成加速、preparse-includes 缓存、增量扫描
2. **Phase 8 — 代码理解增强**：UE 类型补全、include 路径补全、跳转定义穿透 UPROPERTY/UFUNCTION、引用搜索识别反射
3. **Phase 9 — 工具链集成**：UE 编辑器双向通信、Hot Reload 自动同步、调试 attach、断点映射
4. **Phase 10 — 诊断增强**：UE 编译错误智能诊断、UPROPERTY 错误 code action、Module 依赖建议、自定义规则表

> v1.2 主题变更史：2026-07-04 从"汉化规则覆盖完善"调整为"clangd 完善"。
> 原 v1.2 内容（Diagnostics 规则 58→150+、Hover 汉化、规则表维护）已废弃，汉化能力持续由 v1.1 维持。

### v1.1 Proxy 本地化增强 ✅ Shipped 2026-06-24

### v1.0 控制面板 ✅ Shipped 2026-07-01

## Requirements

### Validated

- ✓ **CTRL-01 ~ CTRL-10**: 面板框架 + 操作按钮 — v1.0
- ✓ **CTRL-11 ~ CTRL-21**: 配置编辑 + Proxy 设置 — v1.0
- ✓ **CTRL-22 ~ CTRL-28**: 状态展示 + 细节打磨 — v1.0
- ✓ **LOC-01 ~ LOC-04 (18 sub-items)**: CLI 传递 + 汉化模式 + 规则扩展 + E2E — v1.1

### Active (v1.3 — 打包规范化)

- [ ] **PKG-01**: LICENSE 文件存在且为 MIT 全文（见 Phase 11）
- [ ] **PKG-02**: package.json 包含 `repository` 字段（占位 URL）（见 Phase 11）
- [ ] **PKG-03**: `npm run package` 自动清理 `out/src/`、`out/test/` 残留（见 Phase 11）
- [ ] **PKG-04**: `.vsix` 不包含 `*.map` 文件（见 Phase 11）
- [ ] **STR-01**: 根目录无 `temp_writer.*` 和 `ANALYSIS_detection_build.md`（见 Phase 12）
- [ ] **STR-02**: `.vscodeignore` 中只保留项目实际使用的工具目录（见 Phase 12）

### Parked (v1.2 — clangd 完善，v1.3 完成后继续)

- [ ] **CLANGD-01**: clangd 性能优化（见 Phase 7-v1.2）
- [ ] **CLANGD-02**: 代码理解与导航增强（见 Phase 8-v1.2）
- [ ] **CLANGD-03**: 与 UE 编辑器/UBT 工具链集成（见 Phase 9-v1.2）
- [ ] **CLANGD-04**: 自定义诊断与快速修复（见 Phase 10-v1.2）

### Out of Scope

- 替换现有的状态栏 UI — 状态栏和控制面板共存互补
- 实时构建日志输出到面板 — 构建日志在 Output 通道更合适
- Phase 4+ 面板增强功能（快捷键、排序、构建历史）— 推迟到 v2
- **v1.2 已废弃**: Diagnostics 规则表 58→150+、Hover 内容汉化、规则分类优化 — 回归 v1.1 已覆盖范围
- **v1.3 显式不做**: 合并 `doc/` 和 `docs/`、改 package.json 版本号、加 release 脚本或 pre-commit 钩子

## Context

- 插件已有完整命令体系（20 个命令注册在 `src/commands/index.ts`）
- 已有状态栏 11 个按钮（`src/ui/statusBar.ts`）
- 已有 Config 强类型配置封装（`src/core/config.ts`）
- 所有配置项已在 `package.json` 的 `contributes.configuration` 中定义
- 已有 i18n 系统（`src/i18n/index.ts`，中英双语）
- **v1.0 新增**: WebView 控制面板（4 Tab，16 按钮，15 配置字段）
- **v1.1 新增**: 汉化 Proxy（22→30+ 规则、zh-only/append 双模式、控制面板模式选择器）
- **v1.2 待办**: clangd 配置文件生成器、clangd 触发指令、UE 类型系统适配层、Hot Reload 钩子

## Constraints

- **Tech Stack**: 纯 VS Code WebView API（HTML/CSS/JS），不引入前端框架
- **Pattern**: 消息协议双向通信（postMessage / onDidReceiveMessage）
- **i18n**: 所有用户可见文本必须通过 t() 函数
- **Proxy 协议**: 代理 CLI 必须通过 --localization-* 参数传递本地化配置
- **clangd 协议**: 遵循 LSP 3.17 规范，不修改 upstream clangd，通过配置与客户端指令增强

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| WebView 面板 | 已有完整命令体系，WebView 提供可视化交互 | ✓ Good |
| 分 3 个阶段交付 | Phase 1 按钮（最高价值），Phase 2 配置，Phase 3 状态 | ✓ Good |
| 纯 VS Code WebView API | 不引入前端框架 | ✓ Good — 无额外依赖 |
| 4 Tab 分区（Actions/Config/Proxy/Status） | 功能正交，用户快速定位 | ✓ Good |
| Unicode 图标而非图标库 | 避免前端依赖 | ✓ Good |
| 配置批量保存 + 回执机制 | 确保配置写入成功 | ✓ Good |
| **v1.2 主题变更 2026-07-04** | 汉化规则扩展边际收益递减，回归 clangd 核心价值 | ✓ Pending feedback |

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
*Last updated: 2026-07-05 — v1.3 started (packaging normalization); v1.2 parked*
