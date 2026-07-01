---
phase: 06-ui-update-e2e-verification
plan: 02
subsystem: localization
tags:
  - test
  - localization
  - bridge
  - behavioral
  - e2e
  - regression
requires:
  - LOC-04-01
  - LOC-04-02
  - LOC-04-03
  - LOC-04-04
provides:
  - Explicit behavioral tests for each localization mode output format
affects:
  - test/unit/clangd/proxy/bridgeLocalization.test.ts
tech-stack:
  added: []
  patterns: []
key-files:
  created: []
  modified:
    - test/unit/clangd/proxy/bridgeLocalization.test.ts
decisions: []
metrics:
  duration: 2m
  completed: "2026-07-01"
status: complete
---

# Phase 6 Plan 2: Add behavioral tests for zh-only/append modes and verify full suite

## Summary

Added three explicit behavioral tests to bridgeLocalization.test.ts that verify the localization pipeline output format for each mode (disabled, append, zh-only). Ran the full 496-test suite with zero failures and verified the TypeScript build produces zero errors. All four requirements (LOC-04-01 through LOC-04-04) are satisfied.

### Task Results

| Task | Name | Status | Commit |
|------|------|--------|--------|
| 1 | Add behavioral tests for append/zh-only/disabled modes | Complete | 4545e98 |
| 2 | Full suite regression check (LOC-04-04) | Complete | (same commit) |

### Test Details

- **LOC-04-01** (`localization 禁用时消息透传，字节等效不修改`): Constructs a `LspBridge` without any localization options, feeds a `publishDiagnostics` notification with a matchable message, and asserts the output is byte-exact with zero CJK characters.
- **LOC-04-02** (`append 模式输出包含原文和 [翻译] 两部分`): Constructs a localized bridge in `append` mode, feeds the same notification, and asserts the output contains both the original English text AND bracketed Chinese characters.
- **LOC-04-03** (`zh-only 模式输出仅为翻译文本，不含英文原文`): Constructs a localized bridge in `zh-only` mode, feeds the same notification, and asserts the output is ONLY the bracketed Chinese translation with no original English text present.

### Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run test/unit/clangd/proxy/bridgeLocalization.test.ts` | 23 passed (20 existing + 3 new) |
| `npx vitest run` (full suite) | 35 files, 496 passed, 0 failed |
| `npm run build` | Zero errors |

### Test Count Verification

- Before: 493 tests across 35 files (per Phase 05 SUMMARY)
- After: 496 tests across 35 files (+3)
- Delta: +3 behavioral tests, zero regressions

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all three tests verify against the real localization pipeline with concrete assertions (no mock data, no placeholder assertions).

## Threat Flags

None — no new production code introduced; test-only changes.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| File exists: `test/unit/clangd/proxy/bridgeLocalization.test.ts` | FOUND |
| Commit exists: `4545e98` | FOUND |
| Final metadata commit: `c41a16d` | FOUND |
