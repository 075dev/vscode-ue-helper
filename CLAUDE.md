# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm run build              # esbuild → out/extension.js + out/clangdProxy.js + launcher scripts
npm run watch              # esbuild watch mode
npm run typecheck          # tsc --noEmit (strict mode)
npm run typecheck:watch    # tsc --noEmit --watch
npm run lint               # ESLint src test --ext .ts
npm run lint:fix           # ESLint with --fix
npm run format:check       # Prettier check
npm run format             # Prettier write
npm run test:unit          # vitest run (unit tests)
npm run test:unit:watch    # vitest interactive
npm run test               # unit + integration
npm run package            # vsce package → .vsix
npm run perf:baseline      # capture clangd-proxy overhead baseline (writes scripts/perf-baseline.json)
npm run perf:after         # capture current overhead (for diff vs baseline)
npm run perf:diff          # print baseline vs after diff
```

Run a single test file: `npx vitest run --run test/unit/ui/controlPanel.test.ts`
Run a single test by name pattern: `npx vitest run --run -t "parseMsvc"`

## Project Architecture

VS Code extension for Unreal Engine C++ development. **Extension entry**: `src/extension.ts:20` — `activate()`.

### Activation Sequence (order matters!)

```
1. initI18n()              ← must be first (before Logger)
2. Logger + Config         ← infrastructure, all modules depend on these
3. activateDetection()     ← project/engine discovery, returns DetectionHandles with `ready: Promise`
4. WorkspaceState          ← single source of truth for project/engine/paths; subscribes to detection.ready
5. ClangdOps               ← unified .clangd read/mutate API (depends on WorkspaceState)
6. activateBuild()         ← UBT Task Provider
7. activateClangd()        ← clangd config, workspace backup, proxy manager
8. activateUI()            ← 8 status bar buttons + control panel, awaits detection.ready
9. activateCommands()      ← registers 20 contributed commands
10. ControlPanelProvider   ← webview control panel
```

### Module Map (src/)

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `core/` | Infrastructure | `logger.ts` (Logger), `config.ts` (Config wrapper), `command-registry.ts`, `workspace.ts` (Phase 8 WorkspaceState) |
| `detection/` | Project/engine discovery | `engineDiscovery.ts`, `engineLocator.ts`, `uprojectScanner.ts`, `vsBuildTools.ts`, `workspaceContext.ts`, `workspaceEngines.ts`, `workspaceFolders.ts`, `uprojectAssociation.ts` |
| `build/` | UBT build, Live Coding, Task Provider | `ubt.ts`, `buildRunner.ts`, `liveCoding.ts`, `taskProvider.ts`, `launchEditor.ts` |
| `clangd/` | clangd IntelliSense, compile_commands, proxy | `clangdConfig.ts`, `clangdOps.ts` (Phase 8 API), `compileCommands.ts`, `compileCommandsCache.ts`, `completionMode.ts`, `completionFiles.ts`, `preparseIncludes.ts`, `ueMacroCompletions.ts`, `workspaceBackup.ts`, `diagnoseProject.ts`, `proxyManager.ts`, `proxy/` (14-file standalone LSP proxy) |
| `commands/` | 20 VS Code command implementations | `index.ts` (registration hub), one file per command |
| `ui/` | Status bar, QuickPick, control panel | `statusBar.ts` (8 buttons), `controlPanel.ts` + `controlPanel.html.ts` + `controlPanelMessages.ts` (webview), `quickPicks.ts`, `notifications.ts`, `problemsPanel.ts`, `outputChannel.ts`, `perfStatusBar.ts` |
| `parsers/` | MSVC/UBT/linker/uproject error parsers | `msvcParser.ts`, `ubtParser.ts`, `linkerParser.ts`, `uprojectParser.ts` |
| `mcp/` | MCP server (auto-enabled in Cursor/Claude Code), 6 tools | `server.ts`, `tools.ts`, `lifecycle.ts` |
| `rules/` | AI agent rule generators | `cursorRules.ts` |
| `i18n/` | i18n (zh/en) | `index.ts`, `locales/zh.ts`, `locales/en.ts` |

Per-module `AGENTS.md` files exist at `src/{build,clangd,commands,detection,ui}/AGENTS.md` for deeper context on those subsystems.

### Key Patterns

- **Path aliases**: Use `@core/`, `@detection/`, `@clangd/`, `@build/`, `@commands/`, `@ui/`, `@i18n/`, `@parsers/`, `@mcp/`, `@rules/` — never relative imports
- **i18n first**: All user-visible strings go through `t('key')` translation
- **Promise-based activation**: `detection.ready` is a Promise; UI awaits it before rendering to avoid race conditions
- **Disposable pattern**: All VS Code resources pushed to `context.subscriptions` for auto-cleanup
- **Chinese comments**: All code comments in Chinese
- **Strict TypeScript**: `strict: true`, `noUncheckedIndexedAccess`, `noImplicitAny`
- **No floating promises**: Use `void` to explicitly mark intentionally-unawaited promises
- **No `any`**: Use proper types; annotate `// eslint-disable-line` with reason if unavoidable

### Phase 8 Architecture (current)

Two new types in `src/extension.ts` between detection and the rest of activation:

- **WorkspaceState** (`src/core/workspace.ts`) — single source of truth for project / engine / path info. Subscribes to `detection.ready` internally (set once via constructor) and exposes typed getters (`projectFolder`, `engineRoot`, `clangdConfigPath`, etc.). Hard rules: callers MUST NOT `path.join` these — go through the getters, which also de-duplicate missing-info warnings (shown once per session via `vscode.window.showWarningMessage`). The getter set is closed — no external "custom path" fields.
- **ClangdOps** (`src/clangd/clangdOps.ts`) — unified `.clangd` read/mutate API with exactly **4 methods**: `readConfig`, `exists`, `writeFull`, `mutate(ctx => …)`. All writes are atomic (temp + rename). Callers MUST NOT call `fs.writeFile` on `.clangd` directly. The surface is intentionally minimal — no `setAddFlag` / `removeAddFlag` / `replaceAddBlock` style setters; those are just `mutate` closures and would expand API without value.

Migration is in progress (see `src/extension.ts:6-8`): legacy modules still take `DetectionHandles`; new callers can accept `WorkspaceState` + `ClangdOps` directly.

### Build Pipeline (esbuild)

The build produces two independent artifacts via `esbuild.config.mjs`:
1. **`out/extension.js`** — Main VS Code extension bundle (vscode module externalized)
2. **`out/clangdProxy.js`** — Standalone clangd LSP proxy CLI (no vscode dependency, runs as child process)
3. **Launcher scripts** — `out/launcher/proxy-launcher.bat` (Windows) and `.sh` (Unix) for clangd extension integration

### Configuration

All settings under `vscodeUEHelper.*` namespace. Key settings:
- `configuration`: Debug/DebugGame/Development/Shipping/Test (default: Development)
- `target`: Editor/Game/Server/Client (default: Editor)
- `platform`: Win64/Mac/Linux (default: Win64)
- `completionMode`: fast/slow (default: fast)
- `useMCP`: auto/always/never (default: auto)
- `clangdProxy.*`: LSP proxy settings (keepalive, localization)

### Clangd Proxy Architecture

The LSP proxy (`src/clangd/proxy/`) is a separate Node.js process that wraps clangd's LSP protocol. 14 source files split by concern:

- `cli.ts` — entry; parses CLI args (proxy args, `--` separator, real clangd args) and validates `--real-clangd` is present
- `bridge.ts` + `processBridge.ts` — LSP framing; `bridge.ts` is `vscode`-free so the proxy can be unit-tested
- `keepalive.ts` — **didClose keepalive**: suppresses the close→reopen churn that forces clangd to re-index
- `localization.ts` + `settingsReader.ts` + `settingsManager.ts` — Chinese append/override for diagnostics, codeActions, hover
- `ueDocLookup.ts` — UE API doc strings used by hover
- `cliArgs.ts` + `cliRuntime.ts` + `genericTranslator.ts` + `messages.ts` + `framing.ts` + `status.ts` + `realClangdResolver.ts` — supporting plumbing

Configuration: `vscodeUEHelper.clangdProxy.*` (keepalive, localization). Built as standalone CLI at `out/clangdProxy.js` and launched via `out/launcher/proxy-launcher.{bat,sh}` on Windows/Unix respectively. Performance is tracked with `npm run perf:{baseline,after,diff}` (drives `scripts/measure-proxy-overhead.mjs`).

### Test Structure

Tests live in `test/unit/`, mirroring `src/` as `test/unit/{clangd,commands,core,detection,i18n,parsers,ui}/`. Uses Vitest with:
- Coverage thresholds (from `vitest.config.ts`): lines 80%, functions 80%, branches 75%, statements 80%
- Setup file: `test/unit/setup.ts`
- VS Code APIs mocked via the `vscode-mocks` pattern (see existing tests in those directories)
- There is **no** `test/integration/` directory; `npm run test` runs unit tests only
- Run a single test file: `npx vitest run --run test/unit/<dir>/<file>.test.ts`
- Run by test-name substring: `npx vitest run --run -t "<substring>"`

## Common Development Tasks

- **Add a new command**: Create `src/commands/xxx.ts` with an `executeXxx()` function, register in `src/commands/index.ts` (there are 20 contributed commands, one file each)
- **Add a status bar button**: Edit `src/ui/statusBar.ts` (all 8 buttons are created in the constructor at lines 78-111) — add a new `createStatusBarItem`, a field, and an `update()` branch
- **Add a Control Panel section**: HTML in `src/ui/controlPanel.html.ts`, host↔webview protocol in `src/ui/controlPanelMessages.ts`, provider logic in `src/ui/controlPanel.ts`
- **Change `.clangd` generation rules**: Use `ClangdOps.mutate(ctx => …)` in the caller; do NOT add new setters (see Phase 8 Architecture above)
- **Edit an MCP tool**: `src/mcp/tools.ts` (6 tools exposed: `ue_build`, `ue_launch_editor`, `ue_live_coding`, `ue_generate_compile_commands`, `ue_show_project_info`, `ue_toggle_completion_mode`)
- **Add a setting**: Add to `package.json` `contributes.configuration.properties`, then wrap in `src/core/config.ts`
- **Modify detection logic**: Edit files in `src/detection/` — `engineDiscovery.ts` / `engineLocator.ts` for engine paths, `uprojectScanner.ts` for project scanning, `workspaceFolders.ts` for `.code-workspace` folder role assignment
- **Debug**: Press F5 to launch Extension Development Host; Output panel → "VSCodeUEHelper" for logs; logs are structured as `[module] message`

## Dependencies

- Runtime: `@modelcontextprotocol/sdk`, `chokidar`, `execa`, `json5`, `neverthrow`, `xstate`, `yaml`
- Dev: `esbuild`, `vitest`, `typescript`, `eslint`, `prettier`, `vsce`, `@vscode/test-electron`
- Extension dependency: `llvm-vs-code-extensions.vscode-clangd`
