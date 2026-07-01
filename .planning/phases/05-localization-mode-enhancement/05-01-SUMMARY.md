---
phase: 05-localization-mode-enhancement
plan: 01
subsystem: clangd-proxy
tags:
  - localization
  - type-rename
  - backward-compat
  - zh-only
requires:
  - 04-01 (CLI fix rule expansion)
provides:
  - ClangdProxyLocalizationMode type with zh-only
  - Config backward compat for old override values
affects:
  - src/clangd/proxy/cliArgs.ts
  - src/clangd/proxy/bridge.ts
  - src/core/config.ts
  - package.json
  - test/unit/clangd/proxy/cli.test.ts
  - test/unit/clangd/proxy/bridgeLocalization.test.ts
  - test/unit/clangd/proxy/e2eHarness.test.ts
  - test/unit/clangd/proxy/status.test.ts
tech-stack:
  added: []
  patterns:
    - "Backward-compat mapping for renamed enum values in config getter"
key-files:
  created: []
  modified:
    - src/clangd/proxy/cliArgs.ts
    - src/clangd/proxy/bridge.ts
    - src/core/config.ts
    - package.json
    - test/unit/clangd/proxy/cli.test.ts
    - test/unit/clangd/proxy/bridgeLocalization.test.ts
    - test/unit/clangd/proxy/e2eHarness.test.ts
    - test/unit/clangd/proxy/status.test.ts
decisions:
  - D-01: Rename 'override' mode to 'zh-only' in all user-visible type unions
  - D-02: Config getter backward-compat maps old 'override' to 'zh-only'
  - D-03: No UI/control-panel files modified (scope boundary)
metrics:
  duration: "390s"
  completed: "2026-07-01"
  tasks_completed: 3
  files_modified: 8
status: complete
---

# Phase 05 Plan 01: Replace `override` with `zh-only` in Source Types

Renamed the localization mode value from `'override'` to `'zh-only'` across all source type definitions, CLI argument parsing, bridge mode mapping, config types, and package.json configuration enums. Added backward compatibility in the Config getter so old `"override"` config values continue to work transparently.

## Completed Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Update cliArgs.ts | `5397432` | src/clangd/proxy/cliArgs.ts |
| 2 | Update bridge.ts | `bc0ca99` | src/clangd/proxy/bridge.ts |
| 3 | Update config.ts + package.json | `09c022e` | src/core/config.ts, package.json |
| - | Fix test files (Rule 3) | `da83502` | 4 test files |

## Deviations from Plan

### Auto-fixed Issues (Rule 3 - Blocking)

**1. Test file type errors from type rename**
- **Found during:** Verification after Task 3
- **Issue:** Four test files (`cli.test.ts`, `bridgeLocalization.test.ts`, `e2eHarness.test.ts`, `status.test.ts`) used the `'override'` literal in type annotations and function calls that became incompatible with the new `'append' | 'zh-only'` union type. These were blocking — TypeScript compilation would not pass without fixing them.
- **Fix:** Changed all test usages of `'override'` mode value to `'zh-only'`. Updated test descriptions from "override" to "zh-only" for accuracy.
- **Files modified:** test/unit/clangd/proxy/cli.test.ts, test/unit/clangd/proxy/bridgeLocalization.test.ts, test/unit/clangd/proxy/e2eHarness.test.ts, test/unit/clangd/proxy/status.test.ts
- **Commit:** `da83502`

### Out-of-Scope Pre-existing Issues (not fixed)

The following TypeScript errors are pre-existing in unrelated files and were not addressed:
- `src/ui/controlPanel.html.ts` (multiple `string` type assignability issues) — per D-03, UI files are out of scope
- `src/ui/controlPanel.ts` (unused variable, missing property, readonly assignment) — UI files out of scope
- `src/ui/controlPanelMessages.ts` (missing `label` property in SelectOption) — UI files out of scope
- `test/unit/ui/controlPanel.test.ts` (mock property errors) — UI test files out of scope

## Verification Results

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | Passes (only pre-existing UI errors remain, unrelated to this plan) |
| `grep -n "'override'" src/clangd/proxy/cliArgs.ts` | No occurrences (outside comments) |
| `grep -n "'override'" src/clangd/proxy/bridge.ts` | No occurrences (outside comments) |
| `grep -n '"zh-only"' src/core/config.ts` | Found on lines 60 (type) and 183 (backward compat) |
| `grep -n '"zh-only"' package.json` | Found on line 358 (enum value) |
| Backward compat: old `"override"` maps to `"zh-only"` | Implemented in clangdProxyLocalizationMode getter |

## Threat Surface Scan

No new threat surface introduced. The plan modified string literal types and config enums only. No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Key Decisions

- **D-01 (zh-only replaces override):** All user-visible type unions now use `'zh-only'` instead of `'override'`. The CLI only accepts `--localization-mode=zh-only`; old `--localization-mode=override` is rejected.
- **D-02 (Config backward compat):** The `Config.clangdProxyLocalizationMode` getter reads the raw VS Code config value and maps `"override"` to `"zh-only"`, ensuring users with existing settings don't lose functionality.
- **D-03 (No UI changes):** Control panel files (`src/ui/controlPanel.html.ts`, `src/ui/controlPanelMessages.ts`) still reference `'override'` mode strings in their template rendering. These are out of scope per the plan boundary — a separate plan (future work) will update the control panel to reflect the zh-only naming.

## Self-Check: PASSED

All verification checks confirmed:
- Source type changes applied correctly in all 4 target files
- Test files updated to match new type union
- Compilation passes with zero plan-related errors
- All 4 commits exist in git log
