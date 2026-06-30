---
phase: 04-cli-fix-rule-expansion
plan: 01
subsystem: clangd-proxy
tags:
  - cli
  - localization
  - lsp-bridge
  - wiring
requires:
  - 04-02
provides:
  - LOC-01-01
  - LOC-01-02
  - LOC-01-03
  - LOC-01-04
affects:
  - src/clangd/proxy/cli.ts
  - test/unit/clangd/proxy/cli.test.ts
tech-stack:
  added:
    - createDefaultLocalizationTable import in cli.ts
    - LocalizationOptions type import in cli.ts
  patterns:
    - LocalizationOptions | undefined constructed from parsed CLI args
    - Object spread of undefined is safe for optional constructor fields
key-files:
  created: []
  modified:
    - src/clangd/proxy/cli.ts
    - test/unit/clangd/proxy/cli.test.ts
decisions:
  - "localization field placed between keepaliveTtlSec and hooks in LspBridge options for related-field grouping"
  - "When localization is disabled, undefined is passed (backward compatible per LOC-01-04)"
  - "createDefaultLocalizationTable called eagerly at construction time (synchronous, infallible)"
metrics:
  duration: 5m
  completed_date: 2026-06-30
  tasks_completed: 2
  files_modified: 2
status: complete
---

# Phase 04 Plan 01: Wire --localization-* CLI args into LspBridge constructor

## Objective

Wire the already-parsed `--localization-*` CLI arguments from `parseArgs()` into the `LspBridge` constructor so the localization engine actually receives its configuration. The bridge and localization engine were fully implemented but lacked the input connection -- `cli.ts:runProxy()` parsed `localizationEnabled`/`mode`/`targets` via `parseArgs()` but never passed a `LocalizationOptions` object to `new LspBridge(...)`.

## Commits

| Task | Message | Hash | Files |
| ---- | ------- | ---- | ----- |
| 1 | feat(04-01): wire localization options into LspBridge constructor | `df1df8b` | src/clangd/proxy/cli.ts |
| 2 | test(04-01): add CLI tests for localization option parsing | `9202f4c` | test/unit/clangd/proxy/cli.test.ts |

## Verification

- `npm run build` -- passed (zero TypeScript errors)
- `npm test -- --filter=cli` -- passed (490 tests across 35 test files)
- `createDefaultLocalizationTable` import present in cli.ts (line 25)
- `LocalizationOptions` type imported from bridge (line 22)
- Localization construction block after `parseArgs(argv)` (lines 85-88)
- `localization` field passed to LspBridge options (line 148)
- bridge.ts, localization.ts, cliArgs.ts are unmodified

## Deviations from Plan

None -- plan executed exactly as written.

## Self-Check: PASSED

- [x] src/clangd/proxy/cli.ts exists and contains `createDefaultLocalizationTable` import
- [x] src/clangd/proxy/cli.ts exists and contains `localization:` field in LspBridge options
- [x] test/unit/clangd/proxy/cli.test.ts exists with 2 new localization tests
- [x] Commit df1df8b exists in git log
- [x] Commit 9202f4c exists in git log
