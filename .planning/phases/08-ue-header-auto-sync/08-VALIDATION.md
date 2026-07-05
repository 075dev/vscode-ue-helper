---
phase: 8
slug: ue-header-auto-sync
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-05
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Documents HOW each `<verify>` block in `08-01-PLAN.md` will be validated at execution time.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (vscode-mocks pattern via `test/unit/setup.ts`) |
| **Config file** | `vitest.config.ts` (existing, coverage thresholds 80/80/75/80) |
| **Quick run command** | `npx vitest run --run test/unit/clangd/headerWatcher.test.ts` |
| **Full suite command** | `npm run test:unit` |
| **Estimated runtime** | ~10 seconds (single-file) / ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck` (Tasks 1-3) or `npx vitest run --run test/unit/clangd/headerWatcher.test.ts` (Task 4)
- **After every plan wave:** Run `npm run test:unit` (full suite green — single Wave 1 phase)
- **Before `/gsd-verify-work`:** Full suite + `npm run build` + `npm run lint` must all be green
- **Max feedback latency:** 15 seconds (typecheck ~5s, vitest single-file ~10s, full suite ~60s)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 8-01-01 | 01 | 1 | CLANGD-02 | — | Setting `vscodeUEHelper.clangdHeaderWatcher.enabled` defaults to true; Config getter returns boolean | inline (node script) | `npm run typecheck && node -e "<package.json schema assertion>"` | ⬜ pending | ⬜ pending |
| 8-01-02 | 01 | 1 | CLANGD-02 | T-08-02 / T-08-03 / T-08-06 | HeaderWatcher module compiles; exports `startHeaderWatcher` + `cancelHeaderWatcherTrigger` | typecheck | `npm run typecheck` | ⬜ pending | ⬜ pending |
| 8-01-03 | 01 | 1 | CLANGD-02 | T-08-04 | Cancellation hook wired into `executeGenerateCompileCommands`; activation wiring in `src/extension.ts` | typecheck + lint + source-assertion | `npm run typecheck && npm run lint && grep -nE "cancelHeaderWatcherTrigger\(\)\|startHeaderWatcher\(context" src/commands/generateCompileCommands.ts src/extension.ts` | ⬜ pending | ⬜ pending |
| 8-01-04 | 01 | 1 | CLANGD-02 | T-08-04 (via D-12 cancellation test) | All 8 behavioral contracts of HeaderWatcher exercised | unit (vitest) | `npx vitest run --run test/unit/clangd/headerWatcher.test.ts` | ⬜ pending | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Phase 8 has a single Wave 1 (no parallel waves). Wave 0 deliverables ARE the implementation deliverables — every production file and test file required by the plan is created by Tasks 1-4 in Wave 1. There is no separate "test scaffold" phase because the project's existing test infrastructure (`test/unit/setup.ts` vscode-mocks + `vitest.config.ts`) covers all needed stubs.

Wave 0 entries treated as in-Wave-1 deliverables:

- [ ] `src/clangd/headerWatcher.ts` — production module (~140 LoC, exports `startHeaderWatcher` + `cancelHeaderWatcherTrigger`)
- [ ] `src/commands/generateCompileCommands.ts` — modified (D-12/D-13 cancellation hook)
- [ ] `src/extension.ts` — modified (D-14 activation wiring, +1 line)
- [ ] `src/core/config.ts` — modified (D-06 getter)
- [ ] `package.json` — modified (D-05/D-06 setting entry)
- [ ] `src/i18n/locales/en.json` — modified (3 new status-bar keys)
- [ ] `src/i18n/locales/zh.json` — modified (3 new status-bar keys)
- [ ] `test/unit/clangd/headerWatcher.test.ts` — unit tests (~180-220 LoC, 8 test cases)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live UBT regen fires after .h save in real UE project | CLANGD-02 | Requires an actual UE project + working UBT; integration test outside unit-test scope | 1. Open a UE project with the extension. 2. Edit `MyActor.h` (add/remove a comment or blank line above `UCLASS()`). 3. Save (Ctrl+S). 4. Watch status bar — should show `$(sync~spin) VSCodeUEHelper: UHT regenerating...` (~4s) then `$(check) VSCodeUEHelper: UHT synced` (~3s). 5. Verify `.generated.h` was regenerated. |
| Cancellation race window (manual command during pending debounce) | CLANGD-02 / D-12 | Wall-clock dependent; manual regen must arrive within 1.5s of auto-trigger | 1. Edit `MyActor.h`, save. 2. Within ~1s, run command palette → "Generate compile_commands.json". 3. Watch Output channel — only ONE `[headerWatcher]` UBT run log line should appear (not two). |
| Re-entry loop guard on `.generated.h` writes | D-02 / RESEARCH Pitfall 5 | Requires UBT write event in real environment | After a successful UBT regen, observe that no `$(sync~spin)` status bar message fires for the `.generated.h` write itself. |

*Manual-only items supplement — NOT replace — the automated unit-test suite. The 8 unit tests in Task 4 cover all in-process behaviors; manual items verify end-to-end against a real UE project + real UBT binary.*

---

## Validation Sign-Off

- [ ] All four tasks have `<automated>` verify entries (Tasks 1-4)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (Tasks 1, 2, 3, 4 all have automated checks)
- [ ] Wave 0 is N/A (single Wave 1); all files are created within the plan
- [ ] No watch-mode flags used in verify commands (`--run` only)
- [ ] Feedback latency < 60s for any single verify command
- [ ] `nyquist_compliant: true` set in frontmatter (after all 4 tasks land and tests pass)

**Approval:** pending (filled in by `/gsd-verify-work` after execution)