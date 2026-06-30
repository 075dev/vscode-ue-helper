# Roadmap: VSCode UE Helper

## Milestones

- ✅ **v1.0 控制面板** — Phases 1-3 (shipped 2026-07-01)
- 🔄 **v1.1 Proxy 本地化增强** — Phases 4-6 (in progress)

## Phases

<details>
<summary>✅ v1.0 控制面板 (Phases 1-3) — SHIPPED 2026-07-01</summary>

- [x] Phase 1: 面板框架 + 操作按钮 — completed 2026-07-01
- [x] Phase 2: 配置编辑区 + Proxy 设置 — completed 2026-07-01
- [x] Phase 3: 状态展示 + 细节打磨 — completed 2026-07-01

</details>

<details open>
<summary>🔄 v1.1 Proxy 本地化增强 (Phases 4-6) — IN PROGRESS</summary>

- [ ] **Phase 4: CLI Fix + Rule Expansion** - Fix CLI-to-bridge localization wiring, expand rule table to 30+ rules
- [ ] **Phase 5: Localization Mode Enhancement** - Add zh-only mode, support append/zh-only switching
- [ ] **Phase 6: UI Update + E2E Verification** - Update control panel labels, add restart prompt, integration tests

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
**Plans**: 2 plans

Plans:
- [ ] 04-01-PLAN.md — Wire localization options from parseArgs into LspBridge constructor (CLI fix)
- [ ] 04-02-PLAN.md — Expand rule table from 22 to 30 rules with UE-specific C++ diagnostic patterns

### Phase 5: Localization Mode Enhancement
**Goal**: Users can choose between bilingual (append) and Chinese-only (zh-only) diagnostic modes
**Depends on**: Phase 4
**Requirements**: LOC-02-01, LOC-02-02, LOC-02-03, LOC-02-04, LOC-02-05
**Success Criteria** (what must be TRUE):
  1. User can pass `--localization-mode=zh-only` and see only Chinese translations (no English original)
  2. User can pass `--localization-mode=append` and see bilingual diagnostics (original + [Chinese translation])
  3. Config type `ClangdProxyLocalizationMode` accepts `zh-only` as a valid value
  4. `bridge.ts` correctly maps zh-only mode to the rule-layer replace mode
**Plans**: TBD

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
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|---------------|--------|-----------|
| 1. 面板框架 + 操作按钮 | v1.0 | 1/1 | Complete | 2026-07-01 |
| 2. 配置编辑区 + Proxy 设置 | v1.0 | 1/1 | Complete | 2026-07-01 |
| 3. 状态展示 + 细节打磨 | v1.0 | 1/1 | Complete | 2026-07-01 |
| 4. CLI Fix + Rule Expansion | v1.1 | 0/2 | Planned | - |
| 5. Localization Mode Enhancement | v1.1 | 0/0 | Not started | - |
| 6. UI Update + E2E Verification | v1.1 | 0/0 | Not started | - |
