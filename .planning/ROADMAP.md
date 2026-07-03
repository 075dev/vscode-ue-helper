# Roadmap: VSCode UE Helper

## Active Milestone

## v1.2 — 汉化规则覆盖完善 (in progress)

3 个阶段 (Phase 7-9)：Diagnostics 规则系统性扩展 (50→158)、Hover 内容汉化、规则表维护与测试。

## Milestones

- ✅ **v1.0 控制面板** — Phases 1-3 (shipped 2026-07-01)
- ✅ **v1.1 Proxy 本地化增强** — completed 2026-07-01
- 🔄 **v1.2 汉化规则覆盖完善** — Phases 7-9 (in progress)

## Phases

<details>
<summary>✅ v1.0 控制面板 (Phases 1-3) — SHIPPED 2026-07-01</summary>

- [x] Phase 1: 面板框架 + 操作按钮 — completed 2026-07-01
- [x] Phase 2: 配置编辑区 + Proxy 设置 — completed 2026-07-01
- [x] Phase 3: 状态展示 + 细节打磨 — completed 2026-07-01

</details>

<details open>
<summary>🔄 v1.1 Proxy 本地化增强 (Phases 4-6) — SHIPPED 2026-07-01</summary>

- [x] **Phase 4: CLI Fix + Rule Expansion** - Fix CLI-to-bridge localization wiring, expand rule table to 30+ rules (completed 2026-06-30)
- [x] **Phase 5: Localization Mode Enhancement** - Add zh-only mode, support append/zh-only switching (completed 2026-07-01)
- [x] **Phase 6: UI Update + E2E Verification** - Update control panel labels, add restart prompt, integration tests (completed 2026-07-01)

</details>

<details open>
<summary>🔄 v1.2 汉化规则覆盖完善 (Phases 7-9) — IN PROGRESS</summary>

- [ ] **Phase 7: Diagnostics 规则系统性扩展** - 从 58 条扩展到 150+ 条，覆盖 clangd/clang-cl 常见诊断
- [ ] **Phase 8: Hover 内容汉化** - 添加 hover 专用规则，覆盖 C++ 关键字、UE 类型、函数签名等
- [ ] **Phase 9: 规则表维护 + 测试完善** - 规则分类优化、边界测试、性能验证

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

### Phase 7: Diagnostics 规则系统性扩展

**Goal**: 将诊断消息规则表从 58 条扩展到 150+ 条，系统性覆盖 clangd/clang-cl 常见诊断消息
**Depends on**: Phase 6 (v1.1 proxy localization pipeline)
**Requirements**: LOC-05-01, LOC-05-02, LOC-05-03
**Success Criteria** (what must be TRUE):
  1. `createDefaultLocalizationTable()` 返回 150+ 条规则
  2. 覆盖 clangd 全部常见诊断类别（类型错误、语法错误、模板错误等）
  3. 覆盖 clang-cl/MSVC 特有诊断（编译器选项、pragma 等）
  4. 每条新规则有对应的单元测试
  5. 现有 492 个测试全部通过
**Plans**: TBD

### Phase 8: Hover 内容汉化

**Goal**: 添加 hover 专用规则，覆盖 C++ 关键字、UE 类型名、函数签名关键词等
**Depends on**: Phase 7
**Requirements**: LOC-06-01, LOC-06-02, LOC-06-03
**Success Criteria** (what must be TRUE):
  1. hover 内容中的 C++ 关键字（public/private/static/virtual/const/override 等）被翻译
  2. hover 内容中的常见 UE 类型前缀（TSoftClassPtr、FName、TArray 等）不被误翻译
  3. 代码块和内联代码保护机制正常工作
  4. hover 规则不影响 diagnostics 输出
  5. 所有测试通过
**Plans**: TBD

### Phase 9: 规则表维护 + 测试完善

**Goal**: 规则分类优化、边界测试、性能验证，确保规则表可维护
**Depends on**: Phase 8
**Requirements**: LOC-07-01, LOC-07-02, LOC-07-03
**Success Criteria** (what must be TRUE):
  1. 规则按类别分组（类型错误/语法错误/模板/MSVC/其他）
  2. 每条规则有类别标签
  3. 边界测试覆盖空输入、特殊字符、混合语言
  4. 规则表加载性能 < 5ms
  5. 所有测试通过
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
| 7. Diagnostics 规则系统性扩展 | v1.2 | 0/0 | Not started | - |
| 8. Hover 内容汉化 | v1.2 | 0/0 | Not started | - |
| 9. 规则表维护 + 测试完善 | v1.2 | 0/0 | Not started | - |
