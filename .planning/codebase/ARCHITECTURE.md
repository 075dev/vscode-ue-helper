# Architecture

**Analysis Date:** 2026-07-23

## Pattern Overview

**Overall:** VS Code Extension Host application with a **dual-process runtime** (main extension in the Extension Host + a standalone LSP-proxy Node CLI as a child process spawned by the user's separate `clangd` VS Code extension).

**Key Characteristics:**
- Windows-only — `package.json#platforms: ["win32"]` is a hard runtime constraint; UE 5.2+ / MSVC / Windows SDK are mandatory toolchains.
- Single Node 18 target bundled with esbuild (CJS, `target: 'node18'`, `platform: 'node'`).
- TypeScript strict-everywhere, all user-visible strings flow through i18n.
- Two esbuild bundles from one config: `out/extension.js` (main, with `vscode` external) and `out/clangdProxy.js` (no vscode dep, zero-deps Node CLI). The Windows launcher `out/launcher/proxy-launcher.bat` is auto-generated alongside.
- Phase 8 + 9 architecture: a **Single Source of Truth (SSoT)** pattern built around `WorkspaceState` (project / engine / path getters) and `ClangdOps` (unified `.clangd` read/write API) — every other module reads state through these.
- DDD-style `domain/` subfolder inside `src/build/` is a **reference-only skeleton**; the planned `application/` and `infrastructure/` shells were removed in H3 (REMEDIATION-PLAN §十二). The active `src/build/` is flat.

## Layers

**Extension Host entry layer:**
- Purpose: VS Code activation / deactivation lifecycle, dependency wiring, `i18n` + `Logger` bootstrap.
- Contains: `src/extension.ts` (sole entry, `activate()` / `deactivate()` exports), `src/i18n/index.ts`, `src/core/logger.ts`.
- Depends on: every other module's `activate*` function plus `WorkspaceState` and `ClangdOps` factories.
- Used by: VS Code Extension Host runtime.

**Core / cross-cutting infrastructure (`src/core/`):**
- Purpose: shared primitives all modules depend on.
- Contains: `logger.ts` (36 src imports — OutputChannel wrapper, `[moduleName]` prefix), `config.ts` (22 src imports — `vscodeUEHelper.*` settings proxy, `update(key, value)` mutator with auto-refresh), `workspace.ts` (`WorkspaceState` SSoT, 13 import / 31 src callers / 38 total project-wide), `command-registry.ts` (wraps `vscode.commands.registerCommand`, auto-pushes to `context.subscriptions`), `runtime-detect.ts`, `core/types/diagnostic.ts`.
- Depends on: `vscode` API only; no module dependencies on other layers.
- Used by: every other layer.
- Note: there is no `index.ts` here by design — imports use the `@core/<name>` path alias.

**Detection layer (`src/detection/`):**
- Purpose: trust-based workspace scanning — does **not** walk the filesystem; reads `.code-workspace` `folders[]` and assigns roles (`path === '.'` → project; `name === 'UE5'` → engine).
- Contains: `index.ts` (`activateDetection`), `uprojectScanner.ts` (JSON5 parsing of `.uproject`), `engineDiscovery.ts` (reads `Engine/Build/Build.version`), `vsBuildTools.ts` (Windows MSVC discovery via `vswhere.exe`), `workspaceContext.ts` (`context.workspaceState` persistence for `selectedProject` / `selectedEngine`), `workspaceFolders.ts` (role assignment), `types.ts` (`ProjectInfo` / `EngineInstall` / `WorkspaceFolderInfo` / `VSInstallation`).
- Returns: `DetectionHandles` synchronously, with a `ready: Promise<DetectionResult>` that resolves once all scan steps finish. UI must `await detection.ready` before rendering.
- Used by: extension entry (constructs `WorkspaceState` after `activateDetection`), all downstream modules.

**WorkspaceState SSoT (`src/core/workspace.ts`):**
- Purpose: Phase 8 + 9 single source of truth for project / engine / workspace paths and user selections.
- Constructs: subscribes to `detection.ready`, freezes state on resolution.
- Exposes: Level 0 (root) → Level 3 (completion-file path) getter hierarchy; `selectedProject` / `selectedEngine` (Phase 9, persisted via `WorkspaceContext.memento`); `setSelectedProject` / `setSelectedEngine` mutators.
- Invariants (enforced in code + ESLint): no `path.join(..., '.clangd')` outside this class; no direct `vscode.workspace.workspaceFile` reads; no `detection.workspaceContext.getSelected*` — everything funnels through `workspace.*` getters.
- Used by: every layer except `core/logger.ts` and `core/command-registry.ts`.

**ClangdOps SSoT (`src/clangd/clangdOps.ts`):**
- Purpose: Phase 8 unified API for all `.clangd` mutations — eliminates 29+ ad-hoc `writeClangdConfig` / `findClangdConfig` / direct `path.join` write sites.
- API surface (minimal): `readConfig`, `exists`, `writeFull`, `mutate(mutator)`, `applyAddFlags`. Implemented as `vscode.Disposable` and pushed to `context.subscriptions`.
- 9 src-callers (Phase 9, after SSoT collapse): `extension.ts`, `commands/{createProject,diagnoseProject,firstRunInit,index,setSystemIncludes}.ts`, `mcp/{index,tools}.ts`, `ui/controlPanel.ts`. (AGENTS.md reports "22 callers" — that figure counts the pre-collapse 22 import / use sites; the Phase 9 SSoT pass shrunk the call sites that import `@clangd/clangdOps` directly to 9.)
- Depends on: `WorkspaceState` (path getters) + `@clangd/clangdConfig` (default / render only — fs is owned by `ClangdOps._atomicWrite`).
- Used by: commands that mutate `.clangd`, MCP `ue_*` tools, ControlPanel Webview actions.

**Build layer (`src/build/`):**
- Purpose: UBT command construction, process execution, MSVC diagnostic parsing, Task Provider, Live Coding, Unreal Editor launch.
- Contains (flat, not DDD): `ubt.ts` (command builder), `buildRunner.ts` (execa-backed stream runner, MSVC line parser pipeline), `taskProvider.ts` (`Ctrl+Shift+B`), `liveCoding.ts` (Windows only), `launchEditor.ts` (per-platform Editor launch), `types.ts` (`UBTArgs` / `ParsedDiagnostic` / `BuildResult`).
- `domain/` subdirectory is **reference-only**: `entities/ubt-task.entity.ts` (full DDD entity with tests), `value-objects/{build-configuration,build-platform,build-target,ubt-task-id}.vo.ts`, `events/{ubt-task-created,ubt-task-completed}.event.ts`, `repositories/ubt-task.repository.ts`. Production code keeps importing from `@build` (the top-level barrel) — no `application/` or `infrastructure/` shells exist.
- Depends on: `core/logger`, `core/config`, `detection` (for paths), `parsers/msvcParser`, `parsers/ubtParser`.
- Used by: `commands/{build,launchEditor,liveCoding,selectConfig,selectTarget}.ts`, MCP tools.

**Clangd layer (`src/clangd/`):**
- Purpose: clangd integration — `compile_commands.json` generation, `.clangd` authoring (now exclusively via `ClangdOps`), preparse-includes UE macro completion files, workspace backup against UBT overwrite, system-include discovery.
- Contains: `clangdConfig.ts` (default + render only — no fs), `compileCommands.ts` + `compileCommandsCache.ts` + `compileCommandsFallback.ts` (UBT-driven + cache + fallback DB), `compileCommands/task.ts`, `completionMode.ts` (controller, but mode is locked to `'slow'` after fast/slow merge), `completionFiles.ts` (single writer of `addCompletions.h` etc.), `preparseIncludes.ts`, `workspaceBackup.ts`, `windowsSdk.ts`, `ueClangdCompat.ts` (rewrites `BODY_MACRO_COMBINE`), `ueMacroCompletion{Provider,Data}.ts`, `ueReflectionLinter.ts`, `proxyManager.ts`, `fileWatcher.ts` (chokidar IncrementalFileWatcher), `intermediateUhtCollector.ts`, `headerCache.ts`, `fingerprint.ts`, `flagGlossary.ts`, `perfLog.ts`, `perfProxy.ts`, `proxyLogChannel.ts`, `proxyLogTailer.ts`, `ueLinkManager.ts`, `uhtGeneration.ts`, `ueMacroCompletions.ts`, `createRspMatchers.ts`, `modifyRspFiles.ts`, `diagnoseProject.ts`, `compileCommandsFallback.ts`.
- Subdirectories: `diagnostics/` (4 files — internal checker for the `Diagnose Clangd Project` command, no `index.ts`, relative-imported from `diagnoseProject.ts`); `proxy/` (17 files — independent LSP proxy CLI, see separate entry point below).
- Depends on: `WorkspaceState`, `ClangdOps` (for `.clangd` mutations), `parsers/msvcParser`, `parsers/ubtParser`.
- Used by: `commands/{generateCompileCommands,createProject,setSystemIncludes,diagnoseProject,...}.ts`, `ui/controlPanel`, MCP tools.

**Commands layer (`src/commands/`):**
- Purpose: 19 (post-`toggleCompletionMode` deletion) `vscodeUEHelper.*` command handlers + barrel.
- Contains: 22 `.ts` files — 19 command impls + `index.ts` (barrel / `registerCommand` loop) + `_resolve.ts` (parameter resolver) + `firstRunInit.ts` (fire-and-forget first-launch orchestrator, not a command).
- Standard signature: `executeXxx(config, logger, detection, ...optional handles): Promise<void>`. New commands are pure glue: parameter collection → delegate to layer module → format output.
- Depends on: every other layer (it's the integration layer).
- Used by: VS Code command palette, status bar buttons, MCP `ue_*` tools, ControlPanel Webview.

**UI layer (`src/ui/`):**
- Purpose: user-facing surface.
- Contains: `statusBar.ts` (11 status-bar buttons in fixed left-to-right order: 配置/目标/平台/构建/启动/热重载/clangd/项目/引擎/检测/日志), `quickPicks.ts` (engine / config / target pickers, active item gets ✅), `notifications.ts` (i18n-aware `notifyInfo` / `notifyWarn` / `notifyError`), `problemsPanel.ts` (`DiagnosticManager` with `vscode.DiagnosticCollection`, 0-based row/col — MSVC output is 1-based so `-1` on parse), `outputChannel.ts`, `controlPanel.ts` (Webview-based side panel), `controlPanel.html.ts` (template), `controlPanelMessages.ts` (postMessage protocol), `projectExplorer.ts` + `projectExplorerFs.ts` + `projectExplorerModel.ts` (tree view), `perfStatusBar.ts`, `index.ts` (`activateUI`).
- Depends on: `core/`, `detection/`, `commands/` handles, `WorkspaceState`.
- Used by: extension entry, MCP, commands.

**Parsers layer (`src/parsers/`):**
- Purpose: pure-function output parsers.
- Contains: `msvcParser.ts` (matches `package.json#contributes.problemMatchers` regex — single source of truth), `ubtParser.ts` (build summary, `Total build time` lines), `linkerParser.ts`, `uprojectParser.ts` (thin wrapper around `json5`).
- Depends on: standard library only.
- Used by: `build/buildRunner`, `clangd/proxy/ueDiagnosticWatcher`.

**MCP layer (`src/mcp/`):**
- Purpose: Model Context Protocol server, only auto-enabled in Cursor / Claude Code environments.
- Environment detection: `process.env.CURSOR_TRACE_ID || CURSOR_USER_DATA_DIR || CLAUDE_CODE_ENTRYPOINT || CLAUDE_CODE_SSE_PORT` (plus user override `vscodeUEHelper.useMCP: 'auto' | 'always' | 'never'`).
- Contains: `index.ts` (env check + activateMcp), `server.ts` (`@modelcontextprotocol/sdk` stdio transport), `tools.ts` (6 tools), `lifecycle.ts`.
- 6 tools: `ue_build`, `ue_launch_editor`, `ue_live_coding`, `ue_generate_compile_commands`, `ue_show_project_info`, `ue_toggle_completion_mode` (last one is a zombie — `completionMode` is locked to `'slow'`, see Pitfall #11).
- Used by: external AI agents, never by VS Code itself.

**Rules layer (`src/rules/`):**
- Purpose: AI agent rule file generation.
- Contains: `cursorRules.ts` (exports `UE_HELPER_RULES_MDC` for `.cursor/rules/*.mdc` and `UE_HELPER_COPILOT_INSTRUCTIONS` for `.github/copilot-instructions.md`), `index.ts` (barrel).
- Currently imported only via relative path inside `src/rules/` — `@rules` alias is documented in `AGENTS.md` but **not registered** in `tsconfig.json` / `esbuild.config.mjs` / `vitest.config.ts`. Callers in `commands/installRules.ts` import through the `mcp` layer.
- Used by: `commands/installRules.ts` (via `mcp`).

**i18n layer (`src/i18n/`):**
- Purpose: bilingual UI strings (zh + en).
- Contains: `index.ts` (`initI18n()` + `t(key, params)`), `locales/en.json`, `locales/zh.json`.
- Constraint: `initI18n()` must be the very first call in `activate()` because `Logger` may invoke translations.

**Clangd proxy CLI (`src/clangd/proxy/`):**
- Purpose: standalone LSP proxy child process — sits between the user's separate `clangd.vscode` extension and the real `clangd` binary on `stdio`.
- Contains: `cli.ts` (entry, arg parser + `LspBridge` + `ProcessBridge` constructor), `cliArgs.ts` (parseArgs pure function), `cliRuntime.ts` (CliIo/CliStdio injection seams), `bridge.ts` (`LspBridge` — JSON-RPC forwarder, intercepts diagnostics/hover for UE-specific augmentation), `processBridge.ts` (`ServerTransport` — spawns real clangd), `framing.ts` (LSP `Content-Length` framing), `messages.ts` (JSON-RPC message classification), `keepalive.ts` (`didClose` state machine to avoid off-doc hover deadlocks), `localization.ts` (UE term zh dictionary — 3 of its TODOs are unimplemented), `genericTranslator.ts`, `ueDocLookup.ts` (UE doc-comment lookup, depends on `scripts/extract-ue-docs.ts` output), `ueDiagnosticWatcher.ts` (Phase 8 D-05/D-06 — intercepts diagnostics, passively triggers UBT regen), `generatedHeaderWatcher.ts` (notifies clangd of new `.generated.h`), `settingsReader.ts` / `settingsManager.ts` (back up/restore `clangd.path` so the proxy doesn't overwrite itself), `realClangdResolver.ts` (find real clangd binary, excluding our launcher), `status.ts` (state machine + `buildStatus()`).
- No `index.ts` by design. Must not import `vscode` (esbuild bundles with `external: []`). stdout is the LSP channel — no logging there.

## Data Flow

**Extension activation (synchronous wiring → async initialization):**

1. VS Code calls `activate(context)` in `src/extension.ts`.
2. `initI18n()` runs first (`src/i18n/index.ts`).
3. `sharedLogger` (from `@core/logger`) and `new Config()` (from `@core/config`) initialize.
4. `activateDetection(context, config, logger)` returns a `DetectionHandles` synchronously; `detection.ready` is a pending `Promise<DetectionResult>`.
5. `new WorkspaceState({ detection, logger, workspaceContext: detection.workspaceContext })` — subscribes to `detection.ready`, freezes state on resolve. Implements `vscode.Disposable`.
6. `new ClangdOps({ workspace, logger })` — exposes unified `.clangd` API. Implements `vscode.Disposable`.
7. `activateBuild(context, config, logger, detection)` and `activateClangd(context, config, logger, detection, workspace, clangdOps)` and `activateUI(context, config, logger, detection, workspace)` run in parallel-ish.
8. `activateCommands(context, config, logger, detection, clangd, workspace, clangdOps, ui.projectExplorer)` — registers 19 commands; must be the last `activate*` because it depends on all handles.
9. `ControlPanelProvider.register({...})` — registers the Webview side panel.
10. `void runFirstTimeInit({...}, context)` — fire-and-forget, awaits internally, errors logged to `[firstRunInit]`.
11. `context.subscriptions.push(workspace, clangdOps)` — wires disposal to extension deactivate.
12. Welcome notification on first run (`globalState.vscodeUEHelper.welcomed` gate).

The activation order is a hard invariant — reordering breaks `detection.ready` resolution timing and breaks UI render-before-detection races.

**Detection → WorkspaceState → downstream consumers (steady-state data flow):**

```
.code-workspace (folders[])
  → workspaceFolders.ts assigns role
  → uprojectScanner parses *.uproject
  → engineDiscovery reads Engine/Build/Build.version
  → detection.ready resolves with DetectionResult
       ↓
  WorkspaceState.setResult() freezes state
       ↓
  workspace.projectDir / engineRoot / clangdConfigPath / ...
       ↓
  ┌──────────────┬──────────────┬──────────────────┐
  ↓              ↓              ↓                  ↓
Commands       UI (statusBar  ClangdOps          MCP tools
(e.g. Build)   updates after  (mutate(.clangd))  (ue_* invocations)
                detection.ready)
       ↓
  ClangdOps.mutate()  →  atomic temp+rename write of .clangd
                    ↓
            VS Code picks up .clangd → clangd.vscode → out/launcher/proxy-launcher.bat
                                        → out/clangdProxy.js (our CLI)
                                            → real clangd binary
```

**clangd-proxy standalone flow (separate process):**

```
clangd.vscode (user-installed) spawns
  out/launcher/proxy-launcher.bat
    → out/clangdProxy.js (Node CLI)
      → ProcessBridge spawns real clangd binary
      → LspBridge forwards JSON-RPC on stdio (Content-Length framed)
        - Most messages pass through untouched
        - Diagnostics intercepted by UeDiagnosticWatcher → can passively trigger UBT regen
        - Hover / completion may go through localization (TODO, not live)
        - generatedHeaderWatcher notifies clangd of new .generated.h
```

**Command execution (e.g. `vscodeUEHelper.build`):**

1. User clicks status-bar or invokes from palette.
2. `commands/index.ts` registered handler calls `executeBuild(config, logger, detection, ...)`.
3. Handler awaits `detection.ready` if needed, reads derived paths from `workspace.*`.
4. Handler delegates to `@build` (e.g. `runBuild(args)`).
5. `BuildRunner` execa's UBT process, streams stdout through `msvcParser.parseLine`.
6. Diagnostics pushed to `vscode.DiagnosticCollection` via `ui/problemsPanel` (0-based col/row).
7. Status bar updates (`statusBar.ts`), completion notification, problems panel shows errors.

**State management:**
- All persistent state is in `WorkspaceState` (in-memory after activation) + `WorkspaceContext.memento` (cross-session: `selectedProject` / `selectedEngine`).
- VS Code settings (`vscodeUEHelper.*`) are mediated by `Config` — read through getters, write through `await config.update(key, value)` (auto-refreshes internal cache).
- No database, no on-disk JSON state outside `context.workspaceState` and `.vscode/vscodeuehelper/` helper dir.
- `out/launcher/.clangd-path-backup.json` (managed by `proxy/settingsManager`) is the only file-based state in the proxy layer.

## Key Abstractions

**`WorkspaceState` (Phase 8 + 9 SSoT):**
- Purpose: single source of truth for project / engine / paths / user selection.
- Pattern: Constructor subscribes to `detection.ready`; getter hierarchy is fixed (Level 0 roots → Level 3 completion file paths); mutator for user selection only.
- Examples: `workspace.projectDir`, `workspace.clangdConfigPath`, `workspace.selectedEngine`, `await workspace.setSelectedProject(p)`.
- Backed by: `core/workspace.ts` + tests in `test/unit/core/workspace.test.ts` (284 lines, 12 behavior tests) + `test/unit/core/ssot.test.ts` (142 lines, 13 regression guards).

**`ClangdOps` (Phase 8 SSoT):**
- Purpose: single API for all `.clangd` reads / writes.
- Pattern: `readConfig / exists / writeFull / mutate(mutator) / applyAddFlags`; mutator is a closure over `ClangdMutatorContext`; atomic temp+rename; auto-uses `WorkspaceState.clangdConfigPath` so callers never pass a path.
- Example callers: `commands/createProject.ts`, `commands/setSystemIncludes.ts`, `commands/firstRunInit.ts`, `ui/controlPanel.ts`, `mcp/{index,tools}.ts`.

**Detection result + handles:**
- Purpose: async, non-blocking scan that returns handles immediately.
- Pattern: factory returns `DetectionHandles` with a `ready` Promise — UI awaits before render, commands await before exec.
- Example: `src/detection/index.ts` → `activateDetection(...)`.

**Command function:**
- Purpose: glue between VS Code command palette / status bar / MCP / Webview and the actual feature module.
- Pattern: `export async function executeXxx(config, logger, detection, ...)`; `index.ts` registers via `@core/command-registry`'s `registerCommand(context, id, () => executeXxx(...))`.
- Examples: 19 of these, see `src/commands/AGENTS.md`.

**Logger + i18n:**
- Purpose: per-module tagged log output + bilingual user strings.
- Pattern: `new Logger('moduleName')` → OutputChannel title; per-call message starts with `[moduleName]`. All user-visible strings go through `t(key, params)` from `@i18n`.
- Examples: `logger.info('[detection] workspaceFile = ...')`, `t('build.success', { target })`.

**clangd-proxy ProcessBridge / LspBridge:**
- Purpose: two-layer LSP middleware.
- Pattern: `ProcessBridge` owns the spawn + framing; `LspBridge` is the message-level forwarder / interceptor; both expose `CliIo` for test injection.

## Entry Points

**Extension entry:**
- Location: `src/extension.ts`
- Triggers: VS Code activates the extension per `package.json#activationEvents` (workspace open containing `.code-workspace` / `.uproject`).
- Responsibilities: `activate(context)` wires modules in hard-coded order, then `deactivate()` disposes registered handles.

**clangd-proxy CLI entry:**
- Location: `src/clangd/proxy/cli.ts`
- Triggers: Spawned by the user's `clangd.vscode` extension via `out/launcher/proxy-launcher.bat` (with `clangd.useScriptAsExecutable=true`).
- Responsibilities: parse argv (proxy args + `--` + real clangd args), instantiate `ProcessBridge` (spawn real clangd) + `LspBridge` (forward / intercept LSP messages), run until stdin closes, emit `DoneClaim` JSON summary on stderr.

**First-run init (non-command orchestrator):**
- Location: `src/commands/firstRunInit.ts` — `runFirstTimeInit(handles, context)`.
- Triggers: `void runFirstTimeInit(...).catch(...)` at end of `activate()`.
- Responsibilities: detect, prompt user, initialize per-project scaffold (`.clangd`, `compile_commands.json`, completion files).

**Test entry:**
- Location: `test/unit/setup.ts` (Vitest setup — mocks `chokidar`); `test/unit/**/*.test.ts` (72 files, ~12k lines).
- Triggers: `npm run test:unit` (vitest).

## Error Handling

**Strategy:** Per-module try/catch with logging + i18n-keyed user notification. Activation-time errors are caught at the top of `activate()` and surfaced via `vscode.window.showErrorMessage` — the extension never crashes the host.

**Patterns:**
- `Logger.error('[module] operation failed:', err)` followed by `vscode.window.showErrorMessage(t('key.error'))`.
- `WorkspaceState` getter miss → `vscode.window.showWarningMessage` once per session per field (de-duplicated via `WorkspaceField` set).
- `Config.update` auto-refreshes the in-memory cache; callers can read the new value on the same instance immediately (Pitfall #10).
- `detection.ready` rejection → handled inside `WorkspaceState` (state stays partial; getters return undefined and show the missing-source warning).
- Diagnostic parsing is line-by-line and tolerant — non-matching lines pass through as raw text in the Output Channel.
- Proxy CLI errors → exit non-zero; `LspBridge` swallows JSON-RPC errors per-message and logs to stderr; the proxy never crashes the parent `clangd.vscode` extension.

## Cross-Cutting Concerns

**Logging:**
- `Logger` class (`src/core/logger.ts`) wraps `vscode.OutputChannel`.
- Default level `info`, settable via `vscodeUEHelper.lspLoggingLevel`.
- Module prefix `[moduleName]` is required; further sub-prefix `[subArea]` is conventional.
- Object args are `JSON.stringify`'d (circular refs possible — known caveat).
- One `sharedLogger` instance per extension lifetime; modules do not construct their own.

**Validation:**
- JSON5 parsing of `.uproject` (trailing commas allowed).
- MSVC error regex duplicated in `package.json#contributes.problemMatchers` and `src/parsers/msvcParser.ts` — keep in sync (Pitfall #7).
- `uprojectScanner.scan(folderPaths)` requires `folderPaths` argument — no implicit filesystem walk.
- `Config.update(key, value)` validates the new value through the typed Config schema.

**Authentication / authorization:**
- None — local extension, no network, no credentials.
- `vscode.workspace.workspaceFile` is the only "trust boundary": detection is gated on its presence.

**i18n:**
- All user-visible strings go through `t(key, params)`.
- Two locales: `en.json` and `zh.json` — must be kept in sync.
- `initI18n()` must run first in `activate()`.

**File / path operations:**
- Path derivation is exclusively `WorkspaceState`'s responsibility.
- `.clangd` writes go exclusively through `ClangdOps` (atomic temp+rename).
- All VS Code disposables (StatusBarItem, command, watcher) are pushed to `context.subscriptions` (or use `@core/command-registry` which does it automatically).

**Build / bundle:**
- esbuild produces two CJS bundles from one config.
- TypeScript strict-everywhere, ESLint enforces `no-floating-promises` / `no-misused-promises` / `await-thenable` — intentional fire-and-forget uses `void foo()`.

**Performance / observability:**
- `perfLog` singleton records events (e.g. `activation.elapsed`) and flushes to disk via `WorkspaceState` (single source of truth for paths).
- `perfProxy` measures LSP proxy P50/P95/P99 + RSS.
- `npm run perf:baseline|after|diff` runs `scripts/measure-proxy-overhead.mjs` with < 1% tolerance.

---

*Architecture analysis: 2026-07-23*
*Update when Phase X changes, or when a new SSoT-class is added.*
