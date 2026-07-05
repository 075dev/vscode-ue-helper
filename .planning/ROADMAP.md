# Roadmap: VSCode UE Helper

## Active Milestone

## v1.3 — 插件工程化与打包规范化 (active, started 2026-07-05)

2 个阶段 (Phase 11-12)：打包元数据 + 清单修复 → 根目录清理 + 端到端验证。

> **📌 启动原因：** 用户痛点——`npm run package` 报 3 个 WARNING，且 `out/` 有旧构建残留导致 vsix 体积膨胀 (7.67MB)。
> 同时根目录有 3 个临时/空文件需要清理，`.vscodeignore` 含未经调查的工具目录规则。

> **⚠ v1.2 状态：** Phase 7 已完成 context 收集，Phase 8-10 挂起等 v1.3 ship 后继续。
> 原 v1.2 主题变更史保留：2026-07-04 从"汉化规则覆盖完善"调整为"clangd 完善"，
> 原汉化规则扩展已并入 v1.1 phase 5/6 交付。

## Milestones

- ✅ **v1.0 控制面板** — Phases 1-3 (shipped 2026-07-01)
- ✅ **v1.1 Proxy 本地化增强** — Phases 4-6 (shipped 2026-07-01)
- 🔄 **v1.3 插件工程化与打包规范化** — Phases 11-12 (active 2026-07-05)
- ⏸️ **v1.2 clangd 智能提示与集成完善** — Phases 7-10 (parked, await v1.3)
- ~~❌ **v1.2 汉化规则覆盖完善**~~ — *abandoned 2026-07-04，主题变更*

## Phases

<details>
<summary>✅ v1.0 控制面板 (Phases 1-3) — SHIPPED 2026-07-01</summary>

- [x] Phase 1: 面板框架 + 操作按钮 — completed 2026-07-01
- [x] Phase 2: 配置编辑区 + Proxy 设置 — completed 2026-07-01
- [x] Phase 3: 状态展示 + 细节打磨 — completed 2026-07-01

</details>

<details>
<summary>✅ v1.1 Proxy 本地化增强 (Phases 4-6) — SHIPPED 2026-07-01</summary>

- [x] **Phase 4: CLI Fix + Rule Expansion** - Fix CLI-to-bridge localization wiring, expand rule table to 30+ rules (completed 2026-06-30)
- [x] **Phase 5: Localization Mode Enhancement** - Add zh-only mode, support append/zh-only switching (completed 2026-07-01)
- [x] **Phase 6: UI Update + E2E Verification** - Update control panel labels, add restart prompt, integration tests (completed 2026-07-01)

</details>

<details>
<summary>⏸️ v1.2 clangd 智能提示与集成完善 (Phases 7-10) — PARKED 2026-07-05</summary>

- [x] **Phase 7: clangd 性能优化** - compile_commands.json 生成加速、preparse-includes 缓存、增量扫描 (completed 2026-07-04)
- [ ] **Phase 8: 代码理解增强** - UE 类型系统补全、include 自动补全、跳转定义增强、引用搜索
- [ ] **Phase 9: 工具链集成** - UE 编辑器双向通信、Source 浏览器集成、Hot Reload 联动、调试适配
- [ ] **Phase 10: 诊断增强** - 自定义诊断规则、UE 特定错误诊断补全、修复建议、快速修复

</details>

<details open>
<summary>🔄 v1.3 插件工程化与打包规范化 (Phases 11-12) — ACTIVE 2026-07-05</summary>

- [ ] **Phase 11: 打包与清单修复** - LICENSE 文件 + repository 字段 + 构建 clean 步骤 + 排除 *.map
- [ ] **Phase 12: 根目录清理与端到端验证** - 删除临时文件 + .vscodeignore 调查 + 完整验证

</details>

## Phase Details

### Phase 4: CLI Fix + Rule Expansion

**Goal**: Localization configuration flows correctly from CLI to LspBridge, and diagnostic rule coverage meets requirements
**Depends on**: Phase 3 (v1.0 control panel foundation)
**Requirements**: LOC-01-01, LOC-01-02, LOC-01-03, LOC-01-04, LOC-03-01, LOC-03-02, LOC-03-03
**Success Criteria** (what must be TRUE):

  1. User can start proxy with `--localization-enabled` and see Chinese translations in diagnostics output
  2. Starting proxy without `--localization-enabled` produces no Chinese translations (backward compatible)
  3. Proxy diagnostics show translations for 30+ UE-specific patterns (up from 22)
  4. All new translation rules have corresponding unit tests passing

**Plans**: 2/2 plans complete

Plans:

- [x] 04-01-PLAN.md — Wire localization options from parseArgs into LspBridge constructor (CLI fix)
- [x] 04-02-PLAN.md — Expand rule table from 22 to 30 rules with UE-specific C++ diagnostic patterns

### Phase 5: Localization Mode Enhancement

**Goal**: Users can choose between bilingual (append) and Chinese-only (zh-only) diagnostic modes
**Depends on**: Phase 4
**Requirements**: LOC-02-01, LOC-02-02, LOC-02-03, LOC-02-04, LOC-02-05
**Success Criteria** (what must be TRUE):

  1. User can pass `--localization-mode=zh-only` and see only Chinese translations (no English original)
  2. User can pass `--localization-mode=append` and see bilingual diagnostics (original + [Chinese translation])
  3. Config type `ClangdProxyLocalizationMode` accepts `zh-only` as a valid value
  4. `bridge.ts` correctly maps zh-only mode to the rule-layer replace mode

**Plans**: 1/2 plans executed

Plans:

- [x] 05-01-PLAN.md — Replace override with zh-only in cliArgs, bridge, config types and package.json enums (source type + logic changes)
- [x] 05-02-PLAN.md — Update tests for zh-only mode, add config backward compat test, full suite verification

### Phase 6: UI Update + E2E Verification

**Goal**: Control panel reflects localization mode changes, and the full pipeline is verified end-to-end
**Depends on**: Phase 5
**Requirements**: LOC-02-06, LOC-02-07, LOC-04-01, LOC-04-02, LOC-04-03, LOC-04-04
**Success Criteria** (what must be TRUE):

  1. Control panel Proxy Tab mode selector shows "中英双语 / Bilingual" and "仅中文 / Chinese Only" labels
  2. User sees a restart notification when switching localization mode in the control panel
  3. Integration test confirms CLI args flow correctly to LspBridge with LocalizationOptions
  4. Integration test confirms append mode produces "original + [translation]" output
  5. Integration test confirms zh-only mode produces only translated output
  6. All 498 existing tests pass with zero regressions

**Plans**: 2/2 plans complete

Plans:

- [x] 06-01-PLAN.md — Update control panel labels and add restart notice bar (LOC-02-06, LOC-02-07)
- [x] 06-02-PLAN.md — Add behavioral tests and verify full suite zero regressions (LOC-04-01 ~ LOC-04-04)

**UI hint**: yes

### Phase 7: clangd 性能优化

**Goal**: 提升 clangd 启动速度、增量响应速度和大规模工程的扫描效率
**Depends on**: Phase 6 (v1.1 completed)
**Requirements**: TBD (clangd-01-*)
**Success Criteria** (what must be TRUE):

  1. compile_commands.json 生成时间在大型项目（>5000 文件）中 < 5s
  2. preparse-includes 缓存命中率 > 80%（二次构建）
  3. 文件变更后增量扫描延迟 < 200ms
  4. vscode-clangd 与自研 proxy 协同不引入额外开销

**Plans**: TBD

### Phase 8: 代码理解增强

**Goal**: 强化 clangd 对 UE C++ 代码的理解与导航能力
**Depends on**: Phase 7
**Requirements**: TBD (clangd-02-*)
**Success Criteria** (what must be TRUE):

  1. UE 类型（TObjectPtr、TSubclassOf、FGameMode 等）补全正常
  2. include 路径自动补全（支持 `Public/`、`Private/`、`*.generated.h` 模式）
  3. 跳转定义穿透 UPROPERTY/UFUNCTION 宏到真实声明
  4. 引用搜索识别 UCLASS/USTRUCT 反射注册

**Plans**: TBD

### Phase 9: 工具链集成

**Goal**: 与 Unreal Editor / UBT / Live Coding 协同联动
**Depends on**: Phase 8
**Requirements**: TBD (clangd-03-*)
**Success Criteria** (what must be TRUE):

  1. 编辑器内点击源码文件 → VS Code 跳转对应行（编辑器通信）
  2. Hot Reload 后无需手动 reload Window，clangd 自动同步
  3. VS Code 内右键 UE 类型符号可一键在编辑器内定位
  4. 调试配置支持 attach 到 UE 进程（含断点映射）

**Plans**: TBD

### Phase 10: 诊断增强

**Goal**: 自定义 clangd 诊断规则与 UE 特定错误的快速修复
**Depends on**: Phase 9
**Requirements**: TBD (clangd-04-*)
**Success Criteria** (what must be TRUE):

  1. UE 编译错误（链接失败、模块缺失等）显示明确诊断 + 修复建议
  2. `UPROPERTY()` 宏缺失/类型错误提供 code action
  3. Module 依赖错误（缺 `PublicDependencyModuleNames`）自动建议
  4. 用户可自定义本地规则表（外部 JSON 文件）

**Plans**: TBD

### ~~Phase 7 (废弃): 汉化规则扩展~~

> **⚠ ABANDONED 2026-07-04** — v1.2 主题调整为 clangd 完善。汉化规则表扩展（58→150+）已并入 v1.1 Phase 4/5。残留 07-CONTEXT.md 已删除，磁盘已清理。新主题见 Phase 7: clangd 性能优化。

### Phase 11: 打包与清单修复

**Goal**: 修复 `npm run package` 的 3 个 WARNING（missing repository / missing LICENSE / bundling），让打包输出干净；新增构建前的 `out/` 清理步骤。

**Depends on**: 无

**Requirements**: PKG-01, PKG-02, PKG-03, PKG-04, STR-02

**Success Criteria** (what must be TRUE):

  1. `npm run package` 输出包含 0 个 WARNING（特别是 `repository field is missing`、`LICENSE not found`、bundling 警告）
  2. 生成的 `.vsix` 不包含 `*.map` 文件
  3. `npm run package` 前会自动清理 `out/src/` 和 `out/test/` 目录（即每次重打包都从干净 `out/` 开始）
  4. `.vscodeignore` 中已移除项目未使用的工具目录规则（STR-02）

**Plans**: TBD

### Phase 12: 根目录清理与端到端验证

**Goal**: 清理根目录临时/空文件残留；执行完整的端到端验证（typecheck + lint + test + package）确保 v1.3 改动无回归。

**Depends on**: Phase 11

**Requirements**: STR-01, VAL-01, VAL-02, VAL-03, VAL-04

**Success Criteria** (what must be TRUE):

  1. 仓库根目录不再存在 `temp_writer.js`、`temp_writer.mjs`、`ANALYSIS_detection_build.md`
  2. `npm run typecheck` 通过
  3. `npm run lint` 通过
  4. `npm run test:unit` 通过（无新增失败）
  5. `.vsix` 文件大小 < 2MB
  6. `.vsix` 在 VS Code Extension Development Host 安装并激活成功（状态栏出现）

**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|---------------|--------|-----------|
| 1. 面板框架 + 操作按钮 | v1.0 | 1/1 | Complete | 2026-07-01 |
| 2. 配置编辑区 + Proxy 设置 | v1.0 | 1/1 | Complete | 2026-07-01 |
| 3. 状态展示 + 细节打磨 | v1.0 | 1/1 | Complete | 2026-07-01 |
| 4. CLI Fix + Rule Expansion | v1.1 | 2/2 | Complete    | 2026-06-30 |
| 5. Localization Mode Enhancement | v1.1 | 2/2 | Complete    | 2026-07-01 |
| 6. UI Update + E2E Verification | v1.1 | 2/2 | Complete    | 2026-07-01 |
| 7. clangd 性能优化 | v1.2 | 2/2 | Complete    | 2026-07-04 |
| 8. 代码理解增强 | v1.2 | 0/0 | Re-scoped | - |
| 9. 工具链集成 | v1.2 | 0/0 | Re-scoped | - |
| 10. 诊断增强 | v1.2 | 0/0 | Re-scoped | - |
| 11. 打包与清单修复 | v1.3 | 0/0 | Planning | - |
| 12. 根目录清理与端到端验证 | v1.3 | 0/0 | Planning | - |
