---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: 插件工程化与打包规范化
status: planning
last_updated: "2026-07-05T11:11:33.054Z"
last_activity: 2026-07-05
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-01)

**Core value:** UE 开发者可以在 VS Code 中完成所有日常开发操作，无需切换到 Rider 或 Visual Studio。
**Current focus:** Planning v1.1 roadmap

## Milestone Summary

**v1.0 — 控制面板** ✅ Archived 2026-07-01

All 3 phases implemented, 28 requirements covered, 498 tests passing across 35 test files.

**v1.1 — Proxy 本地化增强** 🔄 Planning

3 phases (Phase 4-6), 18 requirement sub-items across 4 categories (LOC-01 ~ LOC-04). Core fix is ~10 lines in cli.ts to pass localization options to LspBridge.

## Key Files Created (v1.0)

| File | Purpose |
|------|---------|
| src/ui/controlPanelMessages.ts | 消息协议 + 类型定义 + 按钮/字段配置 |
| src/ui/controlPanel.html.ts | HTML/CSS/JS 模板生成器 |
| src/ui/controlPanel.ts | WebviewViewProvider 实现 |
| src/commands/showControlPanel.ts | 打开面板命令 |
| test/unit/ui/controlPanel.test.ts | 33 个单元测试 |

## Key Files Modified (v1.0)

| File | Change |
|------|--------|
| src/commands/index.ts | 注册 showControlPanel 命令 |
| src/extension.ts | 注册 ControlPanelProvider |
| package.json | 命令 manifest + viewsContainers/views |
| src/i18n/locales/en.json | 面板文本 |
| src/i18n/locales/zh.json | 面板文本 |
| test/unit/setup.ts | VS Code mock 补充 |

## Test Results

- 35 test files, 498 tests — **all passing**
- Build: `npm run build` — clean
- Test: `npm run test:unit` — 35/35 files, 498/498 tests

## Decisions Summary

| Decision | Outcome |
|----------|---------|
| 纯 VS Code WebView API | ✓ Good |
| 4 Tab 分区 | ✓ Good |
| Unicode 图标 | ✓ Good |
| 分 3 阶段交付 | ✓ Good |

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-07-05 — Milestone v1.3 started

## Phase Dependencies

- **Phase 7 (clangd 性能优化)** — 当前阶段，启动 v1.2 入口
- **Phase 8 (代码理解增强)** — Depends on Phase 7
- **Phase 9 (工具链集成)** — Depends on Phase 8
- **Phase 10 (诊断增强)** — Depends on Phase 9

## Known Context

- v1.2 主题变更：放弃汉化规则扩展（v1.1 已覆盖 30+ 规则），回归 clangd 核心
- 新阶段按价值/优先级顺序：性能优化 → 代码理解 → 工具链集成 → 诊断增强
- 现有基础设施（v1.0 控制面板 + v1.1 Proxy 本地化）保持不变
- Phase 7 需要先识别 clangd 现有的性能瓶颈点（compile_commands 生成、preparse-includes、增量扫描）
- clangd 完善不需要修改代理层逻辑，集中在 clangd 配置、客户端指令、面板触发逻辑

## Blockers

None.

## Session

**Last session:** 2026-07-04T01:15:00.000Z
**Stopped at:** Phase 07 context gathered — ready for planning
**Resume file:** .planning/phases/07-clangd-performance-optimization/07-CONTEXT.md

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 04-cli-fix-rule-expansion P01 | 5m | 2 tasks | 2 files |
| Phase 05-localization-mode-enhancement P01 | 390s | 3 tasks | 8 files |
| Phase 06-ui-update-e2e-verification P02 | 2m | 2 tasks | 1 files |
| Phase 06-ui-update-e2e-verification P01 | 8m | 2 tasks | 5 files |

## Decisions

- [Phase 04-cli-fix-rule-expansion]: localization field placed between keepaliveTtlSec and hooks in LspBridge options for related-field grouping — Keeps related fields grouped together in the constructor options object
- [Phase 04-cli-fix-rule-expansion]: When localization is disabled, undefined is passed (backward compatible per LOC-01-04) — Spreading undefined into object literal is safe and keeps the bridge default behavior unchanged
- [Phase 04-cli-fix-rule-expansion]: createDefaultLocalizationTable called eagerly at construction time — Function is synchronous and infallible, so eager construction is safe
- [Phase ?]: Replaced 'override' with 'zh-only' across all type unions in cliArgs.ts, bridge.ts, config.ts, and package.json
- [Phase ?]: Config.clangdProxyLocalizationMode getter maps 'override' to 'zh-only' for backward compatibility
- [Phase ?]: Control panel files out of scope for this rename; will be updated in a separate plan
- [Phase 06-01]: Used bilingual labels (Chinese/English) for dropdown options per D-01 to serve both Chinese and international users
- [Phase 06-01]: Used amber/warning color scheme for the restart notice bar, consistent with VS Code warning conventions
- [Phase 06-01]: Added localizationModeChanged as optional field on SaveResult rather than creating a new message type
- [v1.2 re-scope 2026-07-04]: 放弃汉化规则扩展（v1.1 已覆盖足够），回归 clangd 核心功能建设
- [v1.2 re-scope 2026-07-04]: 阶段按价值/优先级排序：性能优化 → 代码理解 → 工具链 → 诊断增强
- [v1.2 re-scope 2026-07-04]: 原 Phase 7-9 主题（汉化）整组废弃，新阶段 7-10 主题（clangd），磁盘 CONTEXT.md 清理完成
- [Phase 07]: 先插桩后 benchmark 双轨方案，D-01 — 实测优先，避免过度设计
- [Phase 07]: 性能可视化用状态栏三段 + 三色阈值，不新建 Performance Tab，D-04/D-05 — 保持面板简洁
- [Phase 07]: 模式自适应持久化，开发模式轮转压缩归档，生产模式仅内存，D-07 — 用户体验权衡
- [Phase 07]: compile_commands.json 拆 2 个 PLAN：PLAN A 指纹/缓存、PLAN B UBT 并发/协同，D-10 — 渐进交付
- [Phase 07]: 增量扫描具体路径由 agent 决定，用户表态「不太懂」，D-15 — 用户专业边界尊重
