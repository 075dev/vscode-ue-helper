---
phase: 04-cli-fix-rule-expansion
plan: 02
subsystem: clangd-proxy-localization
tags:
  - localization
  - rule-expansion
  - UE-specific
  - C++ diagnostics
dependency_graph:
  requires:
    - LOC-03-01 (rule table framework)
  provides:
    - LOC-03-02 (30-rule localization table)
    - LOC-03-03 (test coverage for all 30 rules)
  affects:
    - src/clangd/proxy/localization.ts
    - test/unit/clangd/proxy/localization.test.ts
tech-stack:
  added:
    - 8 new LocalizationRule entries in createDefaultLocalizationTable()
  patterns:
    - All new rules use mode: 'append' with target: ['diagnostics', 'codeActions', 'hover']
key-files:
  created: []
  modified:
    - src/clangd/proxy/localization.ts
    - test/unit/clangd/proxy/localization.test.ts
decisions:
  - Rule 30 (private constructor) added as the 8th new rule to reach 30 total, per LOC-03-02
  - New rules placed after rule #22 with section comment to preserve existing rule order
  - Test file updated inline (not separate file) per D-05
metrics:
  duration: ~5 minutes
  completed_date: 2026-07-01
status: complete
---

# Phase 4 Plan 2: Expand Localization Rule Table from 22 to 30 Rules

Expanded the `createDefaultLocalizationTable()` function from 22 rules to 30 rules by appending 8 new UE-specific C++ diagnostic patterns, with corresponding unit tests. All new rules use `mode: 'append'` and target `['diagnostics', 'codeActions', 'hover']`.

## Deviations from Plan

None - plan executed exactly as written.

## Tasks Executed

### Task 1: Add 8 new rules to localization.ts

- Updated JSDoc: "22 种" -> "30 种", "7 类" -> "8 类", added Phase 4 listing
- Added section comment `// ===== 新增 UE 特定规则（Phase 4 扩展） =====`
- Appended 8 new rules after rule #22:
  - Rule 23: override specifier
  - Rule 24: cast precision loss
  - Rule 25: protected constructor
  - Rule 26: return type mismatch
  - Rule 27: template instantiation mismatch
  - Rule 28: temporary address
  - Rule 29: deprecated API
  - Rule 30: private constructor
- Commit: `15f1ea0`

### Task 2: Update test file

- Updated rule count assertion: `toHaveLength(22)` -> `toHaveLength(30)`, renamed test to '应包含 30 条默认规则'
- Renamed comprehensive test: '应处理所有 22 种 clangd 消息' -> '应处理所有 30 种 clangd 消息'
- Added 8 new test cases with UE-specific inputs (BeginPlay, AActor, FMyTemplate, UProperty, FScopedEvent, etc.)
- Commit: `fbd549f`

### Task 3: Full suite verification

- `npm run build`: Clean compile (0 errors)
- `npm run test:unit`: 490 tests passed across 35 test files (0 failures)
- `npm run lint`: No new warnings/errors in modified files (all existing warnings/errors are pre-existing in unrelated files)

## Verification Results

| Check | Status |
|-------|--------|
| npm run build | PASSED |
| npm run test:unit | PASSED (490/490) |
| npm run lint (modified files) | PASSED (no new issues) |
| 30 rules in createDefaultLocalizationTable() | PASSED |
| 8 new test cases match 8 new rules | PASSED |
| All 22 existing rules unchanged | PASSED |

## Key Files Modified

- `src/clangd/proxy/localization.ts` -- 78 insertions, 1 deletion (JSDoc + 8 rules)
- `test/unit/clangd/proxy/localization.test.ts` -- 36 insertions, 3 deletions (count/test name + 8 test cases)

## Self-Check: PASSED

- Source file exists and compiles: PASSED
- Test file exists and all tests pass: PASSED
- Commit hashes verified: `15f1ea0`, `fbd549f`
