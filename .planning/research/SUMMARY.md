# Project Research Summary

**Project:** VSCodeUEHelper - clangd Proxy Localization Enhancement
**Domain:** VS Code extension / clangd LSP proxy with diagnostic localization for Chinese UE developers
**Researched:** 2026-07-01
**Confidence:** HIGH

## Executive Summary

VSCodeUEHelper v1.1 enables Chinese localization for clangd diagnostics through the existing LSP proxy. The core problem: CLI layer (cli.ts) parses --localization-* flags but never passes them to LspBridge, silently disabling the feature. Fix: ~10-line change + 8+ translation rules, no new dependencies.

The recommended approach: fix CLI-to-bridge wiring (LOC-01), expand rule table (LOC-03), verify bilingual and Chinese-only modes (LOC-02), add E2E integration test (LOC-04), improve control panel UI with Chinese labels and restart notifications. All localization logic exists and is correct -- it simply lacks the input connection.

**Key risk:** Feature silently disabled with zero feedback. Mitigation: single-file ~10-line change with TypeScript type enforcement.

## Key Findings

### Recommended Stack

No new technologies. Pure TypeScript regex-based pattern matching. Avoids i18next/ICU MessageFormat because clangd has no stable message IDs.

**Core technologies:**
- TypeScript: all proxy code, no runtime deps
- Vitest/Jest: tests with injectable spawnFn/io params
- Source files: cli.ts, bridge.ts, cliArgs.ts, localization.ts

### Expected Features

**Must have (v1.1):**
- LOC-01: CLI passes localization config to LspBridge (P0 bugfix)
- LOC-02: Both modes (bilingual + Chinese-only) produce correct output
- LOC-03: Rule coverage expansion from 22 to 30+ rules
- LOC-04: E2E integration test
- UI: Chinese labels for mode select
- UI: Proxy restart notification

**Should have (v1.2):**
- Auto-enable for zh locale, per-rule mode override, restart prompt

**Defer (v2+):**
- Custom rule table, rule priority UI, rule testing tool

### Architecture Approach

Three-layer pipeline: cliArgs.ts (parse) to cli.ts (construct LspBridge) to bridge.ts (intercept LSP, apply localization). Root bug: layer 2 never passes data to layer 3. Mode mapping (append|override to append|replace) is correct in getAdaptedTable().

**Components:** 1. cli.ts (FIX) 2. bridge.ts (UNCHANGED) 3. localization.ts (MODIFIED) 4. cliArgs.ts (UNCHANGED)

### Critical Pitfalls

1. CLI never passes localization config to LspBridge -- root bug
2. No createDefaultLocalizationTable() call in CLI flow
3. Mode naming seam: override vs replace across layers
4. Missing integration test for CLI-to-bridge flow
5. Mode change requires proxy restart with no UI feedback

## Implications for Roadmap

### Single Milestone: v1.1

Order: LOC-01, LOC-03, LOC-04, LOC-02, UI

1. **LOC-01** (P0) -- Blocks everything. Fix CLI wiring.
2. **LOC-03** (P1) -- Add 8+ rules. Parallel with LOC-01.
3. **LOC-04** (P1) -- Integration test. Needs LOC-01+03.
4. **LOC-02** (P1) -- Verify both modes. Needs LOC-01.
5. **UI** (P1) -- Chinese labels + restart toast. Independent.

### Research Flags

**Needs research:** None. All existing code, well-understood fix.
**Standard patterns:** All items. Bugfix + enhancement, no new deps.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Pure TS, no new deps, 6 files analyzed |
| Features | HIGH | All 4 source + 4 test + config + UI analyzed |
| Architecture | HIGH | Layer diagrams, data flow, exact line numbers |
| Pitfalls | HIGH | 10 pitfalls with reproduction and prevention |

**Overall: HIGH**

### Gaps

- LOC-03 rules need validation against real UE5 clangd output
- Pitfall 10 regression test (regex false matches) needs writing

## Sources

- src/clangd/proxy/cli.ts (lines 137-149)
- src/clangd/proxy/bridge.ts (lines 57-66, 326-355)
- src/clangd/proxy/cliArgs.ts (lines 13-30, 111-130)
- src/clangd/proxy/localization.ts (lines 75-259)
- src/clangd/proxy/__tests__/*.ts
- src/core/config.ts
- src/ui/controlPanelMessages.ts
- .planning/PROJECT.md

---
*Research completed: 2026-07-01*
*Ready for roadmap: yes*

