# Phase 8: ue-header-auto-sync - Research

**Researched:** 2026-07-05
**Domain:** VS Code extension API — file watcher + debounced UBT invocation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Use `vscode.workspace.onDidSaveTextDocument` (NOT `FileSystemWatcher` — `onDidSave` already provides file-level granularity, avoids content-hash false triggers)
- **D-02:** Strict trigger: `.h` extension (NOT `.hpp`/`.inl`/`.cpp`) + file content must match `/\b(?:UCLASS|USTRUCT|UENUM|UINTERFACE|UFUNCTION|UPROPERTY|GENERATED_BODY|UMETA)\b/`
- **D-03:** File must be within `workspace.projectFolder` (incl. subdirectories); outside-project files do not trigger
- **D-04:** Debounce 1500 ms; consecutive saves across multiple files collapse to a single UBT call
- **D-05:** Default ENABLED; new setting `vscodeUEHelper.clangdHeaderWatcher.enabled` (default true), user-toggleable
- **D-06:** Setting registered in `package.json#contributes.configuration.properties` + `src/core/config.ts` strongly-typed wrapper (mirror `showPerfInStatusBar` pattern)
- **D-07:** Call existing `generateCompileCommands({ project, engineRoot, logger })` — do NOT build a new UBT path, reuse Phase 7 fingerprint cache
- **D-08:** Status bar feedback: `$(sync~spin) VSCodeUEHelper: UHT regenerating...` (4 s) → `$(check) VSCodeUEHelper: UHT synced` (3 s) → `$(warning) VSCodeUEHelper: UHT regen failed` (5 s)
- **D-09:** On UBT failure: NEVER show a popup (avoid spam when engine path is wrong)
- **D-10:** On failure: log to Output panel (`[headerWatcher]` prefix) + transient status bar warning (5 s)
- **D-11:** No auto-retry — user manually runs `vscodeUEHelper.generateCompileCommands`
- **D-12:** When user manually runs `vscodeUEHelper.generateCompileCommands`, cancel any pending debounce (avoid double-running UBT)
- **D-13:** Implementation: watcher exports `cancelPendingTrigger()`; called from manual command entry; in-memory token only (no fs lock)
- **D-14:** Watcher registers after `activateClangd()`, disposable pushed to `context.subscriptions`
- **D-15:** Activate ONLY when `workspace.projectFolder` AND `workspace.engineRoot` are ready (wrapped by `detection.ready`)
- **D-15 (Phase 7, override):** Phase 8 uses `onDidSaveTextDocument` instead of `FileSystemWatcher` (more precise, no FSW needed)

### Claude's Discretion

- Debounce implementation specifics (`setTimeout` + `clearTimeout` vs queued batching) — D-04 only locks duration
- Reflection-macro regex character class (whether to include `\s+` tolerance for whitespace)
- Status bar message i18n key names (follow `t()` bilingual pattern)
- Cancellation test edge cases (D-13 cancellation test requires mock timer)
- Watcher dispose timing (whether to stop on UE workspace close)

### Deferred Ideas (OUT OF SCOPE)

- UE type completion (TObjectPtr / TSubclassOf) → Phase 8-其余
- Include path auto-completion (Public/Private/*.generated.h) → Phase 8-其余
- Go-to-definition through UPROPERTY/UFUNCTION macros → Phase 8-其余
- Reference search for UCLASS/USTRUCT reflection → Phase 8-其余
- Hot Reload auto-sync (Phase 9)
- UE Editor bidirectional communication (Phase 9)
- Breakpoint mapping / debug attach (Phase 9)
- UE compile error code actions (Phase 10)
- Custom diagnostic rule JSON external loading (Phase 10)
- **ueClangdCompat.h override of `FID_*_PROLOG/EPILOG` (方案 3)** — already superseded by Phase 8方案 2
</user_constraints>

## Summary

This is a **small, well-scoped phase** that wires a single new trigger between VS Code's `onDidSaveTextDocument` event and the existing `generateCompileCommands()` pipeline (Phase 7's fingerprint cache makes redundant calls cheap). All 15 CONTEXT.md decisions are locked — research must verify the existing plumbing supports them and flag concrete pitfalls, not explore alternatives.

**Primary recommendation:** Build a single new module `src/clangd/headerWatcher.ts` (≤150 LoC) that subscribes to `onDidSaveTextDocument`, gates on `.h` extension + reflection-macro regex + inside-project check, debounces 1500 ms via `setTimeout/clearTimeout`, and reuses `generateCompileCommands()` (already accepts `WorkspaceState`). Export `cancelPendingTrigger()` for the manual command (D-12). Register after `activateClangd()` in `src/extension.ts`, gated by `detection.ready`.

**Confidence rationale:** HIGH — every locked decision maps to existing infrastructure; no open architectural questions; only minor implementation details (regex character class, debounce implementation choice) are at agent discretion.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLANGD-02 | Code understanding & navigation enhancement (v1.2 parked). Phase 8 covers "macro passthrough" precursor — auto-sync `.generated.h` to prevent `FID_*_PROLOG unknown_typename` errors | This entire phase is the precursor. Without this sync, downstream completion/goto features in Phase 8-其余 won't function reliably |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Detect `.h` save with UE reflection macros | Browser / Client (VS Code extension host) | — | `onDidSaveTextDocument` is in-process to VS Code editor; workspace filesystem access via Node fs |
| Debounce 1500 ms across multiple saves | Browser / Client | — | Pure local timer coordination; no async I/O |
| Trigger UBT for `.generated.h` regeneration | API / Backend (existing `compileCommands.ts`) | — | Spawns UBT Task; already wired to log + perf instrumentation |
| Status bar ephemeral feedback | Browser / Client | — | `vscode.window.setStatusBarMessage(message, timeoutMs)` — no permanent status bar item needed (D-08) |
| In-memory cancellation token | Browser / Client | — | Single closure variable + `setTimeout` handle; manual command calls synchronously |

## Standard Stack

### Core (already in repo, no new deps)

| Library / API | Version | Purpose | Why Standard |
|---------------|---------|---------|--------------|
| `vscode.workspace.onDidSaveTextDocument` | VS Code API stable | Editor save event source | VS Code's canonical "user saved" signal; fires only on real saves (not dirty buffers) — see Open Questions §1 |
| `vscode.window.setStatusBarMessage` | VS Code API stable | Ephemeral status bar text | Auto-clears after timeout; no disposable state — perfect fit for D-08 |
| `vscode.workspace.getConfiguration` | VS Code API stable | Setting reads (via `Config` wrapper) | Already wrapped by `src/core/config.ts` (D-06) |
| `@core/logger` | existing module | Structured log with `[headerWatcher]` prefix | D-10 — reuses existing Output channel writer |
| `@clangd/compileCommands.generateCompileCommands` | existing module | UBT invocation target | D-07 — accepts `WorkspaceState`, has Phase 7 fingerprint cache |
| `@core/workspace.WorkspaceState` | existing module | Single source of truth for project/engine paths | D-03, D-15 — `projectFolder` / `engineRoot` getters |
| `fs.readFile` (node:fs/promises) | built-in | Read `.h` content for regex match (D-02) | One-shot per save; could use sync `fs.readFileSync` since file is small |

### Supporting (re-use, no new code)

| Library | Purpose | When to Use |
|---------|---------|-------------|
| `@clangd/ueMacroCompletionData` `UE_REFLECTION_MACROS` constant | List of UE reflection macro names (currently 6: UFUNCTION/UCLASS/USTRUCT/UENUM/UMETA/UPROPERTY) | Optional — D-02's full regex includes 8 macros (also `UINTERFACE`, `GENERATED_BODY`); const only covers 6 |
| chokidar (`IncrementalFileWatcher` in `src/clangd/fileWatcher.ts`) | chokidar-based watcher | NOT applicable here — Phase 7's incremental scan watcher is **separate** from Phase 8's save event listener (D-01 explicitly chose `onDidSaveTextDocument`) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `onDidSaveTextDocument` | `createFileSystemWatcher` (per Phase 7 D-15) | FSW watches raw filesystem events — needs content hashing to dedupe editor saves vs external saves; **D-01 explicitly chose `onDidSaveTextDocument` to avoid this complexity** |
| `setTimeout/clearTimeout` debounce | `vscode.workspace.createFileSystemWatcher` with `awaitWriteFinish: { stabilityThreshold: 1500 }` | Possible, but `awaitWriteFinish` is a chokidar concept; VS Code's native FSW lacks it. Sticking with `setTimeout` keeps the watcher native to VS Code API |
| read full file content synchronously | `vscode.workspace.openTextDocument(uri).getText()` | Both work; `fs.readFileSync` is faster for the regex-only check on a small file (~1 KB–10 KB) |

**No new dependencies needed** — all required APIs are part of the existing extension.

## Architecture Patterns

### Integration Diagram

```
┌────────────────────────────────────────────────────────────────┐
│ VS Code Editor                                                │
│   user presses Ctrl+S on Foo.h                                 │
│         │                                                      │
│         ▼                                                      │
│   onDidSaveTextDocument (event)                                │
│         │                                                      │
│         ▼                                                      │
│   ┌─────────────────────────────────────────┐                 │
│   │ HeaderWatcher (new, src/clangd/)        │                 │
│   │   1. extension === '.h'?                │ (D-02)         │
│   │   2. path under projectFolder?           │ (D-03)         │
│   │   3. content matches UE macro regex?     │ (D-02)         │
│   │   4. clearTimeout(prev); scheduleFlush() │ (D-04, 13)     │
│   └─────────────────────────────────────────┘                 │
│         │ after 1500 ms quiet                                  │
│         ▼                                                      │
│   generateCompileCommands({ project, engineRoot })             │
│         │                                                      │
│         ▼                                                      │
│   Phase 7 fingerprint cache check                              │
│    ├─ HIT  → skip UBT, return cached ccPath                    │
│    └─ MISS → run UBT via Task API (existing)                   │
│         │                                                      │
│         ▼                                                      │
│   vscode.window.setStatusBarMessage(...) (D-08)                │
│   Output log via Logger.info/warn (D-10)                       │
└────────────────────────────────────────────────────────────────┘
         │
         ▼  user manually runs "Generate compile_commands.json"
   executeGenerateCompileCommands()
         │
         ▼  HeaderWatcher.cancelPendingTrigger()  (D-12, D-13)
   clears setTimeout handle, no-op on next event
```

### Recommended File Layout

```
src/clangd/
  headerWatcher.ts          ← NEW: ~100-150 LoC
  index.ts                  ← MODIFIED: export startHeaderWatcher()
src/commands/
  generateCompileCommands.ts  ← MODIFIED: +2-3 LoC for cancelPendingTrigger call
src/extension.ts             ← MODIFIED: +1 line in activate() after activateClangd
src/core/config.ts           ← MODIFIED: +3-5 LoC get headerWatcherEnabled()
package.json                 ← MODIFIED: add vscodeUEHelper.clangdHeaderWatcher.enabled
src/i18n/locales/
  en.json, zh.json           ← MODIFIED: +3-4 status-bar keys

test/unit/clangd/
  headerWatcher.test.ts     ← NEW: ~150-200 LoC
```

### Pattern 1: HeaderWatcher module structure

**What:** Single class with three public methods (`start`, `cancelPendingTrigger`, `dispose`).

**When to use:** Always for this phase.

**Example** (skeleton, not for direct copy — implementation file is the planner's job):

```typescript
// src/clangd/headerWatcher.ts (sketch)
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import { generateCompileCommands } from './compileCommands';
import type { WorkspaceState } from '@core/workspace';
import { t } from '@i18n';

const DEBOUNCE_MS = 1500; // D-04
const UE_MACRO_RE = /\b(?:UCLASS|USTRUCT|UENUM|UINTERFACE|UFUNCTION|UPROPERTY|GENERATED_BODY|UMETA)\b/; // D-02

export class HeaderWatcher implements vscode.Disposable {
  private debounceTimer: NodeJS.Timeout | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly workspace: WorkspaceState,
    private readonly logger: Logger,
    private readonly config: Config,
  ) {}

  /** Register onDidSaveTextDocument listener. Push returned disposable to context.subscriptions. */
  start(): vscode.Disposable {
    const sub = vscode.workspace.onDidSaveTextDocument((doc) => {
      void this.handleSave(doc.uri.fsPath);
    });
    return new vscode.Disposable(() => {
      sub.dispose();
      this.dispose();
    });
  }

  /** Cancel any pending debounced trigger. D-12, D-13. */
  cancelPendingTrigger(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      this.logger.info('[headerWatcher] pending trigger cancelled by manual command');
    }
  }

  dispose(): void {
    this.cancelPendingTrigger();
    for (const d of this.disposables) d.dispose();
  }

  private async handleSave(fsPath: string): Promise<void> {
    if (!this.config.clangdHeaderWatcherEnabled) return; // D-05
    if (!fsPath.endsWith('.h')) return;                    // D-02
    if (!this.isInsideProject(fsPath)) return;             // D-03

    let content: string;
    try {
      content = await fs.promises.readFile(fsPath, 'utf-8'); // small file, async ok
    } catch {
      return; // file vanished (rare) — silently skip
    }
    if (!UE_MACRO_RE.test(content)) return; // D-02

    this.scheduleTrigger(fsPath);
  }

  private scheduleTrigger(fsPath: string): void {
    this.cancelPendingTrigger();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runUbtRegen(fsPath);
    }, DEBOUNCE_MS);
  }

  private async runUbtRegen(fsPath: string): Promise<void> {
    const project = this.workspace.project;
    const engine = this.workspace.engine;
    if (!project || !engine) {
      this.logger.warn('[headerWatcher] project/engine not ready, skipped');
      return;
    }
    const spinningId = vscode.window.setStatusBarMessage(
      t('headerWatcher.regenerating'), // $(sync~spin) VSCodeUEHelper: UHT regenerating...
      4000,
    );
    try {
      await generateCompileCommands({
        project: project.path,
        engineRoot: engine.path,
        logger: this.logger,
        workspace: this.workspace,
      });
      void vscode.window.setStatusBarMessage(
        t('headerWatcher.synced'), // $(check) VSCodeUEHelper: UHT synced
        3000,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[headerWatcher] UBT failed: ${msg}`);
      void vscode.window.setStatusBarMessage(
        t('headerWatcher.failed'), // $(warning) VSCodeUEHelper: UHT regen failed
        5000,
      );
    } finally {
      spinningId.dispose(); // dismiss the spinner immediately on resolve
    }
  }

  private isInsideProject(fsPath: string): boolean {
    const dir = this.workspace.projectDir;
    if (!dir) return false;
    const rel = path.relative(dir, fsPath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }
}

export function startHeaderWatcher(
  context: vscode.ExtensionContext,
  config: Config,
  logger: Logger,
  workspace: WorkspaceState,
): void {
  // D-15: gate on detection.ready
  void workspace; // workspace already auto-subscribes to detection.ready in constructor (src/core/workspace.ts:113)
  // Since WorkspaceState already awaits detection.ready, we can register immediately:
  const watcher = new HeaderWatcher(workspace, logger, config);
  context.subscriptions.push(watcher.start());
  logger.info('[headerWatcher] started');
}
```

### Anti-Patterns to Avoid

- **DO NOT** subscribe in `activateClangd` itself — that function takes `DetectionHandles` (legacy API); inject into `extension.ts` after line 47 where `WorkspaceState` is fully constructed (mirrors how `completionMode.setProjectContext` is gated at `src/clangd/index.ts:123-134`).
- **DO NOT** use `fileWatcher.ts`'s chokidar approach — that module was designed for incremental scan metrics (Phase 7 D-15), not for UBT regen triggers. Sharing patterns (debounce timer handle, dispose()) is fine; sharing the watcher is not.
- **DO NOT** await the regex match — keep the read async but non-blocking. A 5 KB header file is `~1 ms` to read + regex-test.
- **DO NOT** use `onDidChangeTextDocument` — it fires per keystroke; `onDidSaveTextDocument` is the correct granularity for triggering expensive UBT calls.
- **DO NOT** push multiple `setStatusBarMessage` instances in parallel for the same event — the latest wins; the earlier `spinningId.dispose()` shows the final state correctly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UBT invocation | Custom spawn of RunUBT.bat with arg assembly | `generateCompileCommands()` from `@clangd/compileCommands` | Already handles UBT path discovery, LLVM_PATH injection, exit-code tolerance (1 vs 0), Phase 7 fingerprint cache (cache hit = no-op) |
| Project / engine path resolution | Re-detect via `vscode.workspace.workspaceFolders` | `workspace.projectDir` / `workspace.engineRoot` getters | WorkspaceState enforces no-path-join-via-callers rule and de-duplicates missing-info warnings |
| Setting getter | Inline `vscode.workspace.getConfiguration('vscodeUEHelper').get(...)` | `config.clangdHeaderWatcherEnabled` getter on `Config` class | Mirrors `showPerfInStatusBar` pattern (src/core/config.ts:193-195); one source of truth, type-safe |
| Reflection macro list | Hard-code `['UCLASS','USTRUCT',...]` | Reuse `UE_REFLECTION_MACROS` (6 macros) **+ add 2 (`UINTERFACE`, `GENERATED_BODY`)** | Existing const at `src/clangd/ueMacroCompletionData.ts:7-14` is close but missing two macros from D-02 — extend it or define a new regex literal; agent's choice |
| Status bar output formatting | Custom ThemeColor / disposable StatusBarItem | `vscode.window.setStatusBarMessage(text, timeoutMs)` | Auto-disposes; no leftover items; exact fit for D-08 (4s / 3s / 5s timeouts) |

**Key insight:** This phase is **pure glue code**. Every heavy lift (UBT spawn, fingerprint cache, i18n, WorkspaceState gating, status-bar feedback) is already implemented and waiting to be called. The new module is `~100-150 LoC` maximum — any implementation significantly larger than that is over-engineering.

## Common Pitfalls

### Pitfall 1: Fire on every keystroke

**What goes wrong:** Switching to `onDidChangeTextDocument` (instead of `onDidSaveTextDocument`) triggers UBT hundreds of times per minute during a single refactor.

**Why it happens:** Looks like a symmetric event name; easy to confuse.

**How to avoid:** Subscribe ONLY to `onDidSaveTextDocument` (D-01). Add a test that fires `onDidChangeTextDocument` and asserts no debounce set.

**Warning signs:** Repeated log lines `[headerWatcher] scheduling UBT regen` while user is typing.

### Pitfall 2: Pre-mature trigger before `detection.ready`

**What goes wrong:** If the watcher is registered at `activate()` time (line 39 of `extension.ts`), it can fire on the first save inside a UE file before the project engine is detected. `workspace.project` is `null`, so `runUbtRegen` silently bails. No visible problem, but the user expects it to "just work".

**Why it happens:** WorkspaceState ctor (src/core/workspace.ts:113) does `void opts.detection.ready.then(...)` — the `.then` is fire-and-forget. The flag flips asynchronously.

**How to avoid:** When calling `startHeaderWatcher`, also guard with `workspace.projectFolder !== null && workspace.engineFolder !== null`. Or — since this only matters for the first save during activation, simpler: check at event-fire time inside `handleSave` (already implied by D-15, but explicit getter checks are clearer).

**Warning signs:** Logs `[headerWatcher] project/engine not ready, skipped` from early-session saves.

### Pitfall 3: Cancellation race with manual command

**What goes wrong:** User saves `Foo.h` at t=0s. Debounce schedules UBT for t=1.5s. At t=0.5s, user manually runs "Generate compile_commands.json" which fires its own UBT (UBT-t1). At t=1.5s, the watcher fires its UBT (UBT-t2). Two UBTs in quick succession — second may fail if compile_commands.json is mid-write, or it may succeed wastefully.

**Why it happens:** `cancelPendingTrigger()` is only called from the manual command's entry point (D-13), not from the runUbtRegen path.

**How to avoid:** The example skeleton above already handles this: `scheduleTrigger` always `clearTimeout`s first, AND `cancelPendingTrigger` clears pending timer. The manual command must call `cancelPendingTrigger()` at its entry (verified in 08-impl), which is straightforward since the watcher is a module-singleton passed into `extension.ts`.

**Warning signs:** Two adjacent `[headerWatcher] UBT succeeded` lines ~1.5 s apart after a manual regen.

### Pitfall 4: Sync read on hot path

**What goes wrong:** Using `fs.readFileSync` in `handleSave` blocks the VS Code extension host while reading large project files (e.g., a 200 KB generated header if user accidentally hits Ctrl+S on a `*.generated.h`).

**Why it happens:** Sync is shorter to type and seems "simpler". But `.h` files in UE projects are mostly 1-10 KB; sync read is `~1 ms` — not actually a problem in practice, but defensively use async.

**How to avoid:** Use `await fs.promises.readFile(fsPath, 'utf-8')`. Even though the read is small, async avoids any chance of blocking the UI thread if a user hits save on a huge file.

**Warning signs:** VS Code freezes for 1 frame after Ctrl+S on a large header.

### Pitfall 5: Triggering on `.generated.h` writes (re-entry loop)

**What goes wrong:** UBT writes `Foo.generated.h`. If the watcher fires again on that save, infinite loop.

**Why it happens:** `.generated.h` matches `.h` extension and may contain `GENERATED_BODY()` references in macros; the regex would match.

**How to avoid:** Add early-out: `if (fsPath.endsWith('.generated.h')) return;` in `handleSave`. `.generated.h` files are written by UBT (not edited by user), so excluding them is correct.

**Warning signs:** Log line `[headerWatcher] scheduling UBT regen` immediately after a manual UBT run completes.

### Pitfall 6: Multi-root workspace false positives

**What goes wrong:** User has 2 folders: `MyGame/` (project) + `MyGameUE5/` (engine source for reference). If they edit a file under the engine source, the regex matches but it has nothing to do with project headers.

**Why it happens:** `path.relative(projectDir, fsPath).startsWith('..')` check (in `isInsideProject`) excludes files outside project — engine folder would be excluded. **But**: plugins written in project workspace (e.g., `MyGame/Plugins/MyPlugin/Source/...`) should still trigger. They're under projectDir, so inclusion is correct.

**How to avoid:** Keep D-03 strict: only files inside `projectFolder` (any depth, including `Plugins/`).

**Warning signs:** `[headerWatcher] UBT regen` triggered by an edit inside `<UE>/Engine/Source/...`.

## Code Examples

### Config getter (mirror `showPerfInStatusBar`)

```typescript
// src/core/config.ts — add after line 195
/** Phase 8: Header watcher enabled. D-05. */
get clangdHeaderWatcherEnabled(): boolean {
  return this.root.get<boolean>('clangdHeaderWatcher.enabled') ?? true;
}
```

### package.json setting entry

```jsonc
// package.json — after line 369 (end of contributes.configuration.properties)
"vscodeUEHelper.clangdHeaderWatcher.enabled": {
  "type": "boolean",
  "default": true,
  "description": "Auto-trigger UBT regeneration when UE reflection headers (.h with UCLASS/USTRUCT/...) are saved.",
  "description@zh": "当 UE 反射头（含 UCLASS/USTRUCT/...）保存时自动触发 UBT 重新生成。"
}
```

### i18n status bar keys

```jsonc
// src/i18n/locales/en.json — add
"headerWatcher.regenerating": "$(sync~spin) VSCodeUEHelper: UHT regenerating...",
"headerWatcher.synced": "$(check) VSCodeUEHelper: UHT synced",
"headerWatcher.failed": "$(warning) VSCodeUEHelper: UHT regen failed (see Output)"
```

```jsonc
// src/i18n/locales/zh.json — add
"headerWatcher.regenerating": "$(sync~spin) VSCodeUEHelper: UHT 重新生成中...",
"headerWatcher.synced": "$(check) VSCodeUEHelper: UHT 已同步",
"headerWatcher.failed": "$(warning) VSCodeUEHelper: UHT 重生成失败（详情见 Output）"
```

### Manual command cancellation hook

```typescript
// src/commands/generateCompileCommands.ts — add import + 1 call at top of executeGenerateCompileCommands
import { cancelHeaderWatcherTrigger } from '@clangd/headerWatcher';

// ...inside executeGenerateCompileCommands, before line 36:
cancelHeaderWatcherTrigger(); // D-12: avoid double-running UBT
```

### Activation wiring (src/extension.ts)

```typescript
// After line 47 (clangd activation), add:
import { startHeaderWatcher } from '@clangd/headerWatcher';

// inside activate(), after activateClangd call:
startHeaderWatcher(context, config, logger, workspace); // D-14, D-15
```

## Open Questions Resolved

The 10 research focus questions are now all answered:

1. **`onDidSaveTextDocument` vs `onDidChangeTextDocument`:** Use `onDidSaveTextDocument` exclusively — fires only on user save, not per keystroke. Documented VS Code API behavior.
2. **UE 5.x `BODY_MACRO_COMBINE` macro:** Direct codebase evidence — `src/clangd/ueClangdCompat.ts` overrides BOTH `BODY_MACRO_COMBINE` (line 86-92) and `BODY_MACRO_COMBINE_INNER` (line 75-83) for UE 5.x compat. Both names remain valid; nothing about Phase 8 needs to know which one UHT picks at runtime — `.generated.h` regeneration handles it transparently.
3. **`generateCompileCommands` concurrency:** Phase 7 PLAN B fingerprint cache (src/clangd/compileCommands.ts:343-378) makes a redundant call within the same fingerprint a `~ms`-cost early-return; concurrent calls would both miss cache and race-write `compile_commands.json` — but D-13 cancellation token prevents concurrent dispatch. Low risk after D-13.
4. **Debounce vs FileSystemWatcher:** Phase 7's `src/clangd/fileWatcher.ts` uses chokidar + `setTimeout/clearTimeout` debounce — same pattern applies here. `onDidSaveTextDocument` is the signal source, `setTimeout` is the debounce mechanism. Idiomatically simple.
5. **Regex vs folder detection:** Regex is required (D-02) — `.h` extension alone would over-trigger (any header including 3rd-party `ThirdParty/.../*.h` would fire). Regex gates to UE-specific files only.
6. **Workspace readiness gating:** WorkspaceState ctor already subscribes to `detection.ready` (src/core/workspace.ts:113). The headerWatcher just needs to defer trigger checks until `workspace.projectFolder != null && workspace.engineRoot != null`.
7. **Existing similar patterns:** `src/clangd/fileWatcher.ts` is the closest analogue for the debounce/dispose pattern. `src/ui/perfStatusBar.ts` is the template for disposable-style feedback (but Phase 8 uses `setStatusBarMessage` — lighter).
8. **Cancellation token:** In-memory `NodeJS.Timeout` handle + `clearTimeout` is sufficient. No fs lock needed (D-13 explicitly chose in-memory). Single closure variable on the watcher module.
9. **Testing strategy:** `test/unit/setup.ts:16` already mocks `onDidSaveTextDocument`. Use `vi.useFakeTimers()` to advance the 1500 ms timer without real waiting (per `fileWatcher.test.ts:77` pattern).
10. **Performance impact:** `onDidSaveTextDocument` fires per-save (user-driven); a 1500 ms async debounce of N saves → 1 UBT. Sync fs read of 5 KB file ≈ 1 ms; regex test ≈ microseconds. **Net cost per save event: ~1-2 ms async, no UI thread blocking.**

## Technical Risks

### Risk 1: UE macro name drift across versions

**Probability:** LOW | **Impact:** MEDIUM

UE may rename `BODY_MACRO_COMBINE` → other in some future version. Phase 8 itself doesn't care (it triggers UBT; UHT is authoritative). Indirect: if `.generated.h` regeneration produces wrong content, `clangd` errors will resurface. Mitigation: Phase 8 doesn't depend on macro names at all — only on the regex match (D-02) which uses public user-facing macro names (`UCLASS`, `GENERATED_BODY()`, etc.) that UE has supported for a decade.

### Risk 2: Compile_commands.json in-flight race

**Probability:** LOW | **Impact:** MEDIUM

If user runs manual regen and auto-watcher regen within ~1.5s window, both spawn UBT. Both miss cache → both write `compile_commands.json`. File-system race: last-writer-wins, both writes are valid output, but UBT may complain about concurrent writes from itself.

**Mitigation:** D-12 + D-13 cancellation ensures only one runs at a time. The 1500 ms debounce + same-fingerprint cache (Phase 7) reduces to single-run for the common case (saves within 1.5 s). For the rare user-races-watcher case, document the behavior; downgrading to "second regen may fail silently" is acceptable (D-11: no auto-retry).

### Risk 3: Reflect-header regex false negatives

**Probability:** LOW | **Impact:** LOW

A user could have a `.h` file that uses UE reflection but in a syntax form the regex doesn't catch:
```cpp
// Comment between U and CLASS:
U
CLASS()  // macro broken across lines
```
The regex `\bUCLASS\b` only matches whole-word `UCLASS`.

**Mitigation:** UE source style (codified via UnrealHeaderTool parser) requires `UCLASS` as a single token. Newline-broken macros will fail UHT regardless. Acceptable.

### Risk 4: First-save during activation race

**Probability:** LOW | **Impact:** LOW

User opens the project, immediately hits Ctrl+S on a `.h` before `detection.ready` resolves. The watcher fires but `workspace.project` is `null`. Currently handled by null-check in `runUbtRegen` — silent skip.

**Mitigation:** Log a `[headerWatcher] project/engine not ready, skipping` info line for first few saves. Acceptable degradation.

## Recommended Approach

1. **Implement `src/clangd/headerWatcher.ts`** with the `startHeaderWatcher(context, config, logger, workspace)` factory + `cancelHeaderWatcherTrigger()` standalone export (singleton-style). Mirror the example skeleton above; aim for ~120 LoC.
2. **Add `package.json` setting** (boolean, default `true`) plus `Config` getter `clangdHeaderWatcherEnabled`.
3. **Add 3 i18n keys** (`headerWatcher.{regenerating,synced,failed}` in both `en.json` and `zh.json`).
4. **Modify `src/commands/generateCompileCommands.ts`** — import `cancelHeaderWatcherTrigger`, call at top of `executeGenerateCompileCommands` (before line 36 `pickProject`). ~2 LoC change.
5. **Modify `src/extension.ts`** — after line 47 (`activateClangd` call), add `startHeaderWatcher(context, config, logger, workspace)`. 1 LoC.
6. **Add `src/clangd/index.ts` export** for the new module so `@clangd/headerWatcher` path alias resolves.
7. **Tests**: `test/unit/clangd/headerWatcher.test.ts` covering:
   - `.h` save triggers debounced `generateCompileCommands`
   - `.cpp`/`.hpp`/`.generated.h` saves do NOT trigger
   - File outside `projectFolder` does NOT trigger
   - File without reflection macros does NOT trigger
   - Two consecutive saves within 1500 ms collapse to one trigger
   - `cancelPendingTrigger()` clears pending timer
   - Dispose removes subscription and pending timer
   - Use `vi.useFakeTimers()` + advance by 1500 ms

**Estimated total:** ~180 LoC production + ~200 LoC tests. Small, contained, no architectural risk.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest + vscode-mocks pattern |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run --run test/unit/clangd/headerWatcher.test.ts` |
| Full suite command | `npm run test:unit` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLANGD-02 precursor | Phase 8: header saves trigger UBT regen; cancellation works | unit | `npx vitest run --run test/unit/clangd/headerWatcher.test.ts` | Wave 0 — to be created |
| Setting toggles | `Config.clangdHeaderWatcherEnabled` honored | unit | inline in same test file | Wave 0 |
| i18n keys present | Status bar messages resolve | smoke (no test, eyeball en.json/zh.json diff) | — | — |

### Sampling Rate

- **Per task commit:** `npx vitest run --run test/unit/clangd/headerWatcher.test.ts`
- **Per wave merge:** `npm run test:unit` (full suite green)
- **Phase gate:** Full suite + manual verification (open a UE project, edit `MyActor.h`, confirm status bar feedback after 1.5 s)

### Wave 0 Gaps

- [ ] `test/unit/clangd/headerWatcher.test.ts` — covers D-02/D-03/D-04/D-12/D-13 behavior
- [ ] `src/clangd/headerWatcher.ts` — new module, ~120 LoC
- [ ] `Config` getter + `package.json` entry — 2 small edits
- [ ] i18n keys × 2 locales — 6 string entries
- [ ] `src/commands/generateCompileCommands.ts` — 2 LoC modification
- [ ] `src/extension.ts` — 1 LoC wiring

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | n/a — no auth surface |
| V3 Session Management | no | n/a |
| V4 Access Control | no | n/a |
| V5 Input Validation | **yes** | Regex `/\b(?:UCLASS|...)\b/` on a 1-50 KB header file. No shell injection (no user-controlled command — only reuses existing `generateCompileCommands` which handles its own argument assembly). |
| V6 Cryptography | no | n/a |
| V9 Communication | no | n/a — all local, no network |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious `.h` file with reflection macros in project folder | Tampering (would trigger UBT) | D-02 regex is a STRING match, not a macro EXPANSION. Worst case: project gets a useless UBT re-run (already idempotent via fingerprint cache). Risk: negligible |
| Filesystem traversal via crafted filename | Tampering | `path.relative(projectDir, fsPath)` rejects paths with `..` prefix and absolute paths outside projectDir (already in skeleton above) |
| Cancellation token race | Denial of Service | D-13 in-memory token only — no fs lock, so worst case is double-UBT (D-11 explicitly accepts no auto-retry) |

**Net security assessment:** LOW RISK — pure local filesystem read + regex match + standard UBT invocation; no external input or untrusted command execution.

## References

### Primary (HIGH confidence — code verified)

- `src/clangd/compileCommands.ts:314-593` — `generateCompileCommands()` accepting `WorkspaceState`, including Phase 7 fingerprint cache (lines 343-378)
- `src/clangd/fileWatcher.ts:75-211` — `IncrementalFileWatcher` reference implementation for debounce + dispose patterns (chokidar-based; Phase 8 uses VS Code API instead per D-01)
- `src/clangd/ueClangdCompat.ts:75-92` — Confirms `BODY_MACRO_COMBINE` AND `BODY_MACRO_COMBINE_INNER` both valid UE 5.x macro names (Phase 7's compat stub covers both)
- `src/clangd/ueMacroCompletionData.ts:7-14` — Existing `UE_REFLECTION_MACROS` const (6 macros); D-02 regex adds 2 more (`UINTERFACE`, `GENERATED_BODY`)
- `src/core/workspace.ts:110-115` — `WorkspaceState` auto-subscribes to `detection.ready` in constructor
- `src/core/config.ts:193-195` — Template for `showPerfInStatusBar` getter (mirror for D-06)
- `src/extension.ts:34-49` — Activation order showing `WorkspaceState` constructed before `activateClangd()`; Phase 8 insertion point is after line 47
- `src/commands/generateCompileCommands.ts:32-40` — Manual command entry; D-12 cancellation hook injection point
- `src/i18n/locales/en.json:7-9` — Existing `cmd.generateCompileCommands` key pattern
- `test/unit/setup.ts:16,173-194` — VS Code mock for `onDidSaveTextDocument` + chokidar mock pattern (reusable header)
- `test/unit/clangd/fileWatcher.test.ts:1-100` — Test patterns for debounce timer + vi.useFakeTimers

### Primary (HIGH confidence — API verified)

- VS Code API docs (`https://code.visualstudio.com/api/references/vscode-api#workspace`): `onDidSaveTextDocument` fires on user save; `createFileSystemWatcher` is the alternative for external file changes
- `vscode.window.setStatusBarMessage(message, timeoutMs)` returns a `Disposable`; auto-clears after timeout

### Secondary (MEDIUM confidence)

- UE 5.x `GENERATED_BODY()` macro chain (`BODY_MACRO_COMBINE`, `BODY_MACRO_COMBINE_INNER`) — codebase evidence strong (Phase 7 implementation overrides both); external docs unreachable in this session (GitHub 404, web search backend error). [ASSUMED: macro names are stable across UE 5.0–5.4 based on codebase usage; documented in `src/clangd/ueClangdCompat.ts`]

### Tertiary (LOW confidence — research-blocked)

- WebSearch tool returned API errors throughout this session (June 2026 - July 2026 dates), preventing external corroboration of UE 5.x macro chain; the strong codebase evidence is the substitute.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library/API is already in the repo; nothing new
- Architecture: HIGH — D-01/D-12/D-13/D-15 patterns map cleanly to `src/extension.ts` activation sequence and `WorkspaceState` getters
- Pitfalls: HIGH — derived from concrete code inspection; UE macro regex coverage is the only `[ASSUMED]` item

**Research date:** 2026-07-05
**Valid until:** 2026-08-05 (30 days — VS Code API is stable; UE 5.x macro conventions are stable)

**Estimated phase size:** ~180 LoC production + ~200 LoC tests. Single PLAN; single wave is plausible.
