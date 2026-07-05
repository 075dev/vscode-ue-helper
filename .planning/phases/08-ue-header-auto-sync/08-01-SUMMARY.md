---
phase: 08-ue-header-auto-sync
plan: 01
subsystem: clangd/headerWatcher
tags: [phase-8, ue-reflection, auto-sync, debounce, vscode-watcher]
dependency_graph:
  requires:
    - src/clangd/compileCommands.ts (generateCompileCommands pipeline)
    - src/core/workspace.ts (WorkspaceState getters)
    - src/core/config.ts (Config class)
    - src/i18n/index.ts (t() function)
  provides:
    - src/clangd/headerWatcher.ts (startHeaderWatcher + cancelHeaderWatcherTrigger)
  affects:
    - src/commands/generateCompileCommands.ts (cancellation hook)
    - src/extension.ts (activation wiring)
tech_stack:
  added: []
  patterns:
    - onDidSaveTextDocument subscription (D-01)
    - 1500ms setTimeout/clearTimeout debounce (D-04)
    - module-level timer handle dual-write for cross-boundary cancellation (D-12/D-13)
    - vscode.window.setStatusBarMessage ephemeral feedback (D-08)
key_files:
  created:
    - src/clangd/headerWatcher.ts (267 LoC)
    - test/unit/clangd/headerWatcher.test.ts (341 LoC, 8 tests)
  modified:
    - package.json (1 new setting)
    - src/core/config.ts (1 new getter)
    - src/i18n/locales/en.json (3 new keys)
    - src/i18n/locales/zh.json (3 new keys)
    - src/commands/generateCompileCommands.ts (1 cancellation call)
    - src/extension.ts (1 activation call)
decisions:
  - D-01 onDidSaveTextDocument over FileSystemWatcher (per 08-CONTEXT.md)
  - D-02 strict filter: .h + UE_MACRO_RE + .generated.h re-entry guard
  - D-04 1500ms debounce coalescing
  - D-05/D-06 clangdHeaderWatcher.enabled setting (default true)
  - D-07 reuse generateCompileCommands pipeline (Phase 7 fingerprint cache)
  - D-08 setStatusBarMessage 3-phase feedback (4s/3s/5s)
  - D-09/D-10 silent failure → logger.warn (no popup)
  - D-11 no retry
  - D-12/D-13 cancelHeaderWatcherTrigger bare function + moduleTimerHandle dual-write
  - D-14 startHeaderWatcher between activateClangd and activateUI
  - D-15 detection.ready gate (projectDir null check)
metrics:
  duration: 45min
  completed: 2026-07-05
  tasks_completed: 4
  tasks_total: 4
  tests_added: 8
  tests_total: 596
status: complete
---

# Phase 8 Plan 01: UE Header Auto-Sync Summary

UE reflection header auto-sync watcher: subscribes to `onDidSaveTextDocument`, debounces 1500 ms, filters `.h` files containing UE reflection macros within `workspace.projectFolder`, and triggers the existing `generateCompileCommands` pipeline so UBT regenerates `.generated.h` files in step with the user's `.h` line layout. Adds `vscodeUEHelper.clangdHeaderWatcher.enabled` setting (default true), 3 status-bar i18n keys, and a cancellation hook invoked by the manual `vscodeUEHelper.generateCompileCommands` command.

## Commits

1. `25957e1` feat(8): T1 — add clangdHeaderWatcher.enabled setting, Config getter, 3 i18n keys (D-05/D-06/D-08)
2. `cb89c55` feat(8): T2 — add HeaderWatcher module (D-01..D-15)
3. `2334e54` feat(8): T3 — cancellation hook + activation wiring (D-12/D-13/D-14)
4. `c63c946` test(8): T4 — add HeaderWatcher unit tests (D-02/D-03/D-04/D-05/D-12/D-15)

## Verification Results

- `npm run typecheck`: 38 pre-existing errors (controlPanel.html.ts, controlPanel.ts, controlPanelMessages.ts, test files) — no NEW errors introduced
- `npm run lint`: 300 problems (baseline 304 pre-existing; new test file adds only 3 `no-explicit-any` warnings)
- `npm run test:unit`: **596/596 pass** (49 files) — 588 existing + 8 new
- Source assertions:
  - `grep "export function startHeaderWatcher" src/clangd/headerWatcher.ts` → hit
  - `grep "export function cancelHeaderWatcherTrigger" src/clangd/headerWatcher.ts` → hit
  - `grep "cancelHeaderWatcherTrigger()" src/commands/generateCompileCommands.ts` → hit (line 38)
  - `grep "startHeaderWatcher(context, config, logger, workspace)" src/extension.ts` → hit (line 50)
  - `grep "clangdHeaderWatcher.enabled" package.json` → hit (line 374)
  - `grep "headerWatcher.regenerating" src/i18n/locales/en.json src/i18n/locales/zh.json` → 2 hits

## Deviations from Plan

None — plan executed exactly as written. The only minor adjustment was in T4 test setup: the `vscode.window.setStatusBarMessage` mock was missing from `test/unit/setup.ts`, so the test file patches it per-test via `vi.mocked(...)` cast.

## Threat Model Mitigations Implemented

| Threat ID | Mitigation |
|-----------|------------|
| T-08-02 | `path.relative(projectDir, fsPath)` rejects `..`-prefixed and absolute paths |
| T-08-03 | `dispose()` clears `debounceTimer` and disposes all subscriptions; wrapping disposable in `startHeaderWatcher` ensures auto-cleanup |
| T-08-04 | `cancelHeaderWatcherTrigger` is the FIRST statement of `executeGenerateCompileCommands`, called BEFORE any await |
| T-08-06 | `if (fsPath.endsWith('.generated.h')) return;` before read |
