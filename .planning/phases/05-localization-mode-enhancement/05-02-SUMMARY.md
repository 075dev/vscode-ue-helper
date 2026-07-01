---
phase: 05-localization-mode-enhancement
plan: 02
subsystem: clangd-proxy-config
tags:
  - test
  - backward-compat
  - localization
requires:
  - 05-01 (override -> zh-only source rename)
provides:
  - Passing zh-only test suite with backward compat coverage
  - Config backward compatibility verified (override -> zh-only mapping)
affects:
  - test/unit/core/clangdProxyConfig.test.ts
  - src/core/config.ts
tech-stack:
  added: []
  patterns:
    - "Backward compat test pattern: mock VS Code config with legacy value, assert mapped output"
key-files:
  created: []
  modified:
    - test/unit/core/clangdProxyConfig.test.ts (21 insertions, 3 deletions)
    - src/core/config.ts (1 line: curly brace fix for lint)
decisions:
  - "Plan referenced config.test.ts but Config class tests live in clangdProxyConfig.test.ts; added backward compat tests there instead"
metrics:
  duration: ~5m
  completed_date: "2026-07-01"
status: complete
requirements_verified:
  - LOC-02-01 (backward compat: override -> zh-only)
  - LOC-02-02 (append mode unchanged)
  - LOC-02-05 (all tests pass with zero regressions)
---

# Phase 05 Plan 02: Update tests and verify full suite for zh-only mode

Update all test files to use 'zh-only' instead of 'override' for localization mode values, add backward compatibility tests for Config class mapping old 'override' config values to 'zh-only', and verify the full test suite passes with zero regressions.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update cli.test.ts | d9d7bc0 | test/unit/clangd/proxy/cli.test.ts |
| 2 | Update bridgeLocalization.test.ts | d9d7bc0 | test/unit/clangd/proxy/bridgeLocalization.test.ts |
| 3 | Add config backward compat test + full suite verification | d9d7bc0 | test/unit/core/clangdProxyConfig.test.ts, src/core/config.ts |

### Task 1: Update cli.test.ts (auto-fixed by 05-01)

The cli.test.ts file was already updated in plan 05-01 -- no 'override' references remain. Verified by grep: zero matches.

### Task 2: Update bridgeLocalization.test.ts (auto-fixed by 05-01)

The bridgeLocalization.test.ts file was already updated in plan 05-01 -- no 'override' references remain. Verified by grep: zero matches.

### Task 3: Add config backward compat test + fix failing test

The plan referenced `config.test.ts` but the actual Config class tests live in `clangdProxyConfig.test.ts`. The existing test at line 113-117 expected `config.clangdProxyLocalizationMode` to be `'override'` (which now maps to `'zh-only'`), causing it to fail.

**Fix applied:**
1. Updated the failing assertion from `toBe('override')` to `toBe('zh-only')`
2. Renamed the test description to "向后兼容：override 被映射为 zh-only"
3. Added three new backward compatibility tests:
   - `override -> zh-only` (backward compat)
   - `zh-only -> zh-only` (direct pass-through)
   - `append -> append` (unchanged)
   - `undefined -> append` (default value)

A lint error was also discovered and fixed in `src/core/config.ts` line 183: the `if` body lacked curly braces, which the `curly` ESLint rule requires.

## Verification Results

| Check | Result |
|-------|--------|
| `npm run build` | Pass - zero errors |
| `cli.test.ts` (15 tests) | 15/15 passed |
| `bridgeLocalization.test.ts` (20 tests) | 20/20 passed |
| `clangdProxyConfig.test.ts` (30 tests) | 30/30 passed (was 26, +4 new) |
| Full suite (35 files) | 493/493 passed (was 490, +3 new) |
| Lint - new errors in plan files | None (pre-existing errors unchanged) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] clangdProxyConfig.test.ts had failing assertion for override -> zh-only mapping**
- **Found during:** Task 3
- **Issue:** `clangdProxyConfig.test.ts` line 113-117 asserted `config.clangdProxyLocalizationMode` equals `'override'`, but the Config getter now maps `'override'` to `'zh-only'` (backward compat per D-02). The test file was missed by plan 05-01's rename.
- **Fix:** Changed assertion to `toBe('zh-only')` and renamed test description to reflect backward compat purpose. Added 3 additional tests for full backward compat coverage.
- **Files modified:** `test/unit/core/clangdProxyConfig.test.ts`
- **Commit:** d9d7bc0

**2. [Rule 1 - Bug] Lint error in config.ts: missing curly braces around if body**
- **Found during:** Task 3 lint verification
- **Issue:** `src/core/config.ts` line 183 had `if (raw === "override") return "zh-only";` which violates the `curly` ESLint rule.
- **Fix:** Added curly braces: `if (raw === "override") { return "zh-only"; }`
- **Files modified:** `src/core/config.ts`
- **Commit:** d9d7bc0

### Plan-Reference Deviation

The plan specified adding backward compat tests to `test/unit/core/config.test.ts`. However, the Config class tests actually reside in `test/unit/core/clangdProxyConfig.test.ts`. Tests were added to the correct file instead.

## Self-Check: PASSED

- [x] `npm run build` -- zero errors
- [x] `npx vitest run test/unit/clangd/proxy/cli.test.ts` -- 15/15 passed
- [x] `npx vitest run test/unit/clangd/proxy/bridgeLocalization.test.ts` -- 20/20 passed
- [x] `npx vitest run test/unit/core/clangdProxyConfig.test.ts` -- 30/30 passed
- [x] `npx vitest run` -- 35 files, 493/493 passed
- [x] Lint -- no new errors in plan's scope files
- [x] Commit d9d7bc0 exists
