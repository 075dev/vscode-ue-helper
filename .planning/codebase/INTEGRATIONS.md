# External Integrations

**Analysis Date:** 2026-07-23

> **Scope:** This codebase is a Windows-only VS Code extension. It shells out to several heavyweight external systems (Unreal Build Tool, clangd, MSVC tooling, Unreal Editor) and exposes a Model Context Protocol (MCP) surface to AI editors. There are **no remote HTTP APIs, no databases, no auth/secret stores, and no webhook endpoints** — the entire "integration" surface is local child-process spawning plus one stdio MCP server.
>
> **Companion docs:** `STACK.md` (versions, build tooling), `AGENTS.md` at repo root (architecture, pitfalls), per-module `src/<module>/AGENTS.md` for deep dives.

## External Systems Inventory (at a glance)

| System | Direction | Mechanism | Triggered by |
|---|---|---|---|
| Unreal Build Tool (UBT) | outbound child process | `node:child_process.spawn` / `execFile` on `<Engine>/Engine/Build/BatchFiles/Build.bat` | `vscodeUEHelper.build / rebuild / clean` commands, `ue_build` MCP tool, `generateCompileCommands` |
| Unreal Editor | outbound child process | spawn `UnrealEditor.exe` or `UnrealEditor-Cmd.exe` | `vscodeUEHelper.launchEditor`, `ue_launch_editor` MCP tool |
| UE Live Coding | outbound child process | `UnrealEditor-Cmd.exe -ExecCmds="LiveCoding.Compile"` | `vscodeUEHelper.liveCoding`, `ue_live_coding` MCP tool |
| Microsoft VS Build Tools (`vswhere.exe`) | outbound child process | `execFile` of hardcoded `vswhere.exe` paths | `VsBuildTools.findAll()` (Windows only) |
| MSVC / Windows SDK headers | local file reads (no IPC) | `node:fs/promises` to enumerate `Microsoft Visual Studio/.../VC/Tools/MSVC/<v>/include` + `Windows Kits/10/Include/<v>/{um,ucrt,shared}` | `src/clangd/windowsSdk.ts`, `Set System Includes` command |
| clangd (via `llvm-vs-code-extensions.vscode-clangd`) | LSP over stdio, intercepted by local proxy | independent Node child process `out/clangdProxy.js` with `Content-Length` LSP framing | all C++ file edits (the user-installed clangd extension spawns our launcher) |
| MCP-compatible host (Cursor / Claude Code) | stdio MCP server | `@modelcontextprotocol/sdk` `StdioServerTransport` | host spawns the extension, environment vars `CURSOR_*` / `CLAUDE_CODE_*` |
| AI agent rule files (Cursor / Copilot) | local file writes | `node:fs/promises` writes `.cursor/rules/*.mdc` and `.github/copilot-instructions.md` | `vscodeUEHelper.installRules` command |
| VS Code API surface | inbound from VS Code | `vscode` module (provided at runtime) | activation events, commands, status bar, problems panel, output channel, webview |

## APIs & External Services

There are no remote HTTP / REST / GraphQL APIs. The only "API" surface is the **local LSP proxy** (cloned clangd protocol) and the **MCP server** (6 tools, JSON-RPC over stdio).

### 1. Unreal Build Tool (UBT) Integration

**Files:** `src/build/ubt.ts`, `src/build/buildRunner.ts`, `src/build/taskProvider.ts`, `src/build/liveCoding.ts`, `src/clangd/compileCommands.ts`, `src/clangd/compileCommandsFallback.ts`

- **What it does:** Spawns the UBT `.bat` to (a) build the C++ project, (b) clean intermediates, (c) regenerate `compile_commands.json` for clangd.
- **Integration method:** `node:child_process.spawn` (and `execFile` in some paths). Output streamed line-by-line through `MsvcParser` (`src/parsers/msvcParser.ts`) which uses the regex `^(.*?)\((\d+)(?:,(\d+))?\)\s*:\s*(error|warning|note|fatal error)\s+([A-Z]+\d+)\s*:\s*(.*)$` — **identical to the pattern declared in `package.json#contributes.problemMatchers[0]`**, so terminal UBT errors and VS Code problem-matcher both parse the same shape (Pitfall #7).
- **Command shape** (`src/build/ubt.ts:48-61`): `[ubtPath, <TargetName>, <Platform>, <Configuration>, -Project=<file>.uproject, -waitmutex]`. Target name is computed by `resolveUBTTarget(uprojectPath, type)`: `Editor` → `<ProjectName>Editor`, `Game` → `<ProjectName>`, `Server` → `<ProjectName>Server`, `Client` → `<ProjectName>Client`.
- **Path resolution:** `resolveUBTPath` walks `<Engine>/Engine/Build/BatchFiles/{Build.bat, RunUBT.sh}` (the `.sh` is dead on Windows-only builds; `.bat` is the only path actually used).
- **Stream consumption:** Build output is split by `\r?\n`; the trailing partial line is held in a buffer until the next chunk or `flush()` (see `MsvcParser.parse` and `MsvcParser.flush` in `src/parsers/msvcParser.ts:33-58`). Line offsets must be **MSVC 1-based → VS Code 0-based**: `problemsPanel.pushDiagnostics` does `Math.max(0, d.line - 1)` and `Math.max(0, (d.column ?? 1) - 1)`.
- **Compile-commands generation:** `src/clangd/compileCommands.ts` runs UBT with `-ProjectFiles`, then `linkToWorkspaceRoot()` creates a symlink at the workspace root pointing into the engine's `Intermediate/Build/.../compile_commands.json`. On failure, `compileCommandsFallback.ts` provides a curated fallback DB.
- **Workspace backup / restore** (`src/clangd/workspaceBackup.ts`): UBT's `-ProjectFiles` invocation **overwrites `.code-workspace`**, losing the user's `folders[]` entries. The backup module snapshots before, restores after, and is gated by `vscodeUEHelper.autoBackupWorkspace` (default `true`).
- **Auth:** None. UBT is invoked as the current Windows user; no tokens, no signing.
- **No rate limits / no remote service:** purely local subprocess.
- **Failure isolation:** Detached `setTimeout(300)` after `spawn()` in `liveCoding.ts:21-30` — Live Coding has no completion event, so we don't await it. UBT build errors are reported via `vscode.window.showErrorMessage` and the Problems panel; they do not throw.

### 2. Unreal Editor Launch + Live Coding (Windows-only)

**Files:** `src/build/launchEditor.ts`, `src/build/liveCoding.ts`

- **What it does:** Spawns `UnrealEditor.exe` (interactive) or `UnrealEditor-Cmd.exe` (headless) to launch the editor or trigger Live Coding hot-reload.
- **Integration method:** `node:child_process.spawn` with `detached: true, stdio: 'ignore', windowsHide: true`, then `child.unref()` so the editor survives our process exit.
- **Editor command shape:** `UnrealEditor.exe <uprojectPath> [-log] [-stdout] [other UE args]`.
- **Live Coding command shape** (`src/build/liveCoding.ts:21`): `UnrealEditor-Cmd.exe -ExecCmds="LiveCoding.Compile"`. Editor must already be running; this is IPC, not a fresh build.
- **Cross-platform support:** `src/build/launchEditor.ts` documents Mac (`UnrealEditor.app/Contents/MacOS/UnrealEditor`) and Linux (`UnrealEditor-Linux-DebugGame`) variants, but the extension's `package.json#platforms: ["win32"]` blocks actual execution outside Windows.
- **Auth:** None.
- **Failure mode:** If Editor is not running, Live Coding silently no-ops (no completion event we can await).
- **Visibility gating:** Command palette entries for `vscodeUEHelper.liveCoding` and `vscodeUEHelper.setSystemIncludes` have `when: "isWindows"` (lines 238-244 of `package.json`).

### 3. Microsoft Visual Studio Build Tools / MSVC

**Files:** `src/detection/vsBuildTools.ts`, `src/clangd/windowsSdk.ts`, `src/parsers/msvcParser.ts`

- **What it does:** Discovers installed MSVC + Windows SDK so clangd can resolve `#include <windows.h>`, `<atlbase.h>`, etc. Parses MSVC build output into VS Code Diagnostics.
- **Integration method:**
  - **Discovery** — `node:child_process.execFile` of `vswhere.exe` with `windowsHide: true, timeout: 30000` (defaults defined in `src/detection/vsBuildTools.ts:40-56` as a hand-rolled `runExeca` shim; see `execa` note in `STACK.md`).
  - **Filesystem enumeration** — `node:fs/promises` to enumerate `Microsoft Visual Studio/<version>/BuildTools/VC/Tools/MSVC/<toolchain-version>/include` and `Program Files (x86)/Windows Kits/10/Include/<sdk-version>/{um, ucrt, shared}`.
- **vswhere.exe lookup paths** (`src/detection/vsBuildTools.ts:58-61`):
  - `C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe`
  - `C:\Program Files\Microsoft Visual Studio\Installer\vswhere.exe`
  - Override via constructor arg (`vswherePathOverride`) — test seam only.
- **vswhere query (implicit):** `-products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` (per `src/detection/AGENTS.md` line 110-115).
- **Output consumption:** `VsBuildTools.findAll()` parses the JSON-ish stdout into `VSInstallation[]` (per the `interface VsWhereOutput` in `src/detection/vsBuildTools.ts:63-67`).
- **Wiring into clangd:** the discovered `-imsvc` paths are written to the `.clangd` file via `ClangdOps` (the `system-include-windows` flag id, managed by the `Set System Includes` command / `ue_set_system_includes` MCP tool).
- **Auth:** None (vswhere is a local executable).
- **Failure isolation:** vswhere not on disk → returns `[]` silently; other platforms (non-Windows) also return `[]` without throwing.
- **MSVC parser** (`src/parsers/msvcParser.ts`): a stateful streaming parser; two regexes — `MSVC_RE` for `file(line,col): severity Code: message` and `LINKER_RE` for `: error LNK####: ...`. Maintains `currentFile` context across lines so that linker errors can attach the offending file from the preceding line.

### 4. clangd LSP Integration (via independent proxy)

**Files:** `src/clangd/proxy/*.ts` (17 files), `src/clangd/proxyManager.ts`, `src/clangd/proxyLogChannel.ts`, `out/clangdProxy.js` (esbuild bundle 2), `out/launcher/proxy-launcher.bat` (auto-generated).

> **Architecture note (Phase 8 / 9):** The "extension → clangd" path is **not** a direct call to `vscode.commands.executeCommand('clangd.*')`. Instead the user-installed `llvm-vs-code-extensions.vscode-clangd` extension is configured (via `clangd.path`) to point at our generated `out/launcher/proxy-launcher.bat`, which spawns `out/clangdProxy.js`, which in turn spawns the real clangd. This gives us a place to inject UE-specific behavior.

- **What it does:** Transparent LSP proxy that:
  1. Forwards LSP JSON-RPC between the clangd extension and the real `clangd` binary.
  2. Implements **didClose keepalive** (`src/clangd/proxy/keepalive.ts`) — when a file is closed, the proxy holds a "fake open" with the document in memory so hover/completion still work (off-doc deadlock workaround).
  3. **Localizes** clangd's English diagnostics/hover/completion to Chinese via `src/clangd/proxy/localization.ts` + `src/clangd/proxy/genericTranslator.ts` + `src/clangd/proxy/ueDocLookup.ts` (mode controlled by `vscodeUEHelper.clangdProxy.localization.{enabled, mode}`).
  4. **Watches generated headers** (`src/clangd/proxy/generatedHeaderWatcher.ts`) — `.generated.h` changes trigger a re-parse notification to clangd.
  5. **Watches UE diagnostics** (`src/clangd/proxy/ueDiagnosticWatcher.ts`) — Phase 8 replacement for the old `headerWatcher`. Intercepts clangd's `publishDiagnostics`, recognizes UE-macro errors (e.g. `unknown type name 'FID_...'`, `use of undeclared identifier 'UCLASS'`, etc., matched by `UE_MACRO_ERROR_PATTERNS` in `ueDiagnosticWatcher.ts:45-51+`), and reactively invokes UBT to regenerate `.generated.h`. **This is the only place where header regeneration is triggered** (Pitfall #8).
- **Integration method:** LSP over stdio with `Content-Length` framing (`src/clangd/proxy/framing.ts`). The proxy reads LSP frames from the upstream client, parses them with `LspFramingParser`, and writes serialized frames to the downstream server (`ProcessBridge.send`). The reverse path (server → client) is default pass-through.
- **LSP message types handled** (`src/clangd/proxy/messages.ts`): request vs notification classification, id/method extraction, request correlation. The bridge keeps per-request state for response correlation (`RequestCorrelation`).
- **Real clangd resolution** (`src/clangd/proxy/realClangdResolver.ts`): priority-ordered candidate list (in order):
  1. `vscodeUEHelper.clangdProxy.realClangdPath` (`proxyOverride`)
  2. `vscodeUEHelper.clangdPath` (`configuredClangdPath`)
  3. Current `clangd.path` from the third-party clangd extension (`currentClangdPath`)
  4. settingsManager backup of the previous `clangd.path` (`backupClangdPath`)
  5. `PATH` lookup (`pathEnv`, joined with the platform path delimiter)
  6. Default LLVM install roots (`defaultLlvmPath`)
  Each candidate is **explicitly rejected** if it equals `input.launcherPath` (no recursion into ourselves) — see `proxyLauncher` rejection reason. The resolver is a pure function: all I/O (`fileExists`, `envPath`, `defaultSearchRoots`) is injected.
- **Wiring the proxy into clangd extension** (`src/clangd/proxy/settingsManager.ts` + `settingsReader.ts`):
  1. Reads current `.vscode/settings.json`.
  2. Backs up the user's existing `clangd.path` to `vscodeUEHelper.clangdProxy.backupClangdPath` workspace state.
  3. Writes `clangd.path` → our launcher + `clangd.useScriptAsExecutable: true`.
  4. On disable / uninstall: restores the backup and removes the proxy.
- **Bundle output:** `out/clangdProxy.js` is a **second esbuild bundle** with `external: []` (zero `vscode` dependency — see `esbuild.config.mjs:57-66`). It is spawned as a standalone Node child process.
- **Launcher generation:** `out/launcher/proxy-launcher.bat` is auto-emitted by esbuild on every build (`esbuild.config.mjs:95-105`). The `.sh` Unix launcher is no longer emitted (N2 dead-code cleanup; Windows-only).
- **Configuration surface** (`package.json#contributes.configuration`, lines 356-407):
  - `vscodeUEHelper.clangdProxy.enabled` (bool, default `false`)
  - `vscodeUEHelper.clangdProxy.keepaliveMax` (number, default `20`; invalid values clamp to 20)
  - `vscodeUEHelper.clangdProxy.keepaliveTtlSec` (number, default `900`; invalid values clamp to 900)
  - `vscodeUEHelper.clangdProxy.realClangdPath` (string, default `""`)
  - `vscodeUEHelper.clangdProxy.logPath` (string, default `""`; empty = stderr only)
  - `vscodeUEHelper.clangdProxy.localization.enabled` (bool, default `false`)
  - `vscodeUEHelper.clangdProxy.localization.mode` (enum `append | zh-only`, default `append`)
  - `vscodeUEHelper.clangdProxy.dictionaryPath` (string, default `""`; UE docs dictionary for hover localization)
- **Perf overhead measurement:** `src/clangd/proxy/perfProxy.ts` + `scripts/measure-proxy-overhead.mjs` — P50/P95/P99 latency + RSS sampling. Driven by `npm run perf:{baseline, after, diff}` (target: < 1% drift).
- **Auth:** None. All local stdio.
- **Known zombies:** 6 "TODO 后续实现" comments at `src/clangd/proxy/localization.ts:79/91/103` and `src/clangd/proxy/bridge.ts:676/685/694` — not yet implemented; not on any roadmap (Pitfall #13).

### 5. Unreal Engine Source Tree (filesystem-level)

**Files:** `src/detection/engineDiscovery.ts`, `src/detection/workspaceFolders.ts`, `src/clangd/preparseIncludes.ts`, `resources/preparse-includes/ue5-slow.json`, `src/clangd/ueClangdCompat.ts`, `src/clangd/ueMacroCompletionProvider.ts`, `src/clangd/ueReflectionLinter.ts`.

- **What it does:** Reads the engine install to learn version, modules, and shared-PCH headers. Generates UE-specific clangd scaffolding (compat header, macro completion files, preparse list).
- **Integration method:** Pure filesystem reads. No IPC.
- **Engine version probe:** `<Engine>/Engine/Build/Build.version` (JSON) → `version` (e.g. `5.3.2`), `isLauncherInstall` (boolean — distinguishes Epic Launcher install from source build).
- **Workspace folder model** (`src/detection/workspaceFolders.ts`): **fully trusts** the `.code-workspace` `folders[]` array — no recursive filesystem scan.
  - `path === '.'` → project root (look for `<name>.uproject`).
  - `name === 'UE5'` → engine root (read `Build.version`).
  - Otherwise → role `unknown`.
  - If user opens a single folder (no workspace file), `detection` returns empty results and the UI shows a warning.
- **preparse-includes list:** `resources/preparse-includes/ue5-slow.json` ships with 5 SharedPCH headers (`CoreSharedPCH.h`, `CoreUObjectSharedPCH.h`, `EngineSharedPCH.h`, `SlateSharedPCH.h`, `UnrealEdSharedPCH.h`) — read at runtime by `src/clangd/preparseIncludes.ts:33-41`. The old `ue5-fast.json` was deleted (H4-B); only `slow` remains.
- **UE Clangd compat header:** `src/clangd/ueClangdCompat.ts` rewrites `BODY_MACRO_COMBINE` so `UCLASS()` / `GENERATED_BODY()` expand to legal C++ even when `.generated.h` is stale. Written to `.vscode/vscodeuehelper/ueClangdCompat.h` and force-included via `/FI` in `.clangd`.
- **UE reflection linter:** `src/clangd/ueReflectionLinter.ts` validates `UCLASS`/`USTRUCT`/`UENUM`/`UINTERFACE`/`UFUNCTION`/`UPROPERTY`/`GENERATED_BODY`/`UMETA` declarations locally (no compile).
- **Auth:** None.
- **Failure mode:** If `Build.version` cannot be read, `engines` array is empty and the error is logged but does not abort the extension.

### 6. Model Context Protocol (MCP) Server

**Files:** `src/mcp/index.ts`, `src/mcp/server.ts`, `src/mcp/tools.ts`, `src/mcp/lifecycle.ts`, `src/core/runtime-detect.ts`

- **What it does:** Exposes 6 tools to AI agents (Cursor / Claude Code) so they can drive UBT builds, launch the editor, trigger Live Coding, regenerate compile commands, and inspect the detected project — without the user invoking VS Code commands manually.
- **Integration method:** `@modelcontextprotocol/sdk` `^1.0.0` (declared in `package.json#dependencies` as a **production** dep). Transport: `StdioServerTransport` — the host process spawns the extension; the SDK handles JSON-RPC framing.
- **Host detection** (`src/core/runtime-detect.ts:58-66`): pure function. Looks for environment variables in this order:
  1. `CURSOR_TRACE_ID` or `CURSOR_USER_DATA_DIR` → `'cursor'`
  2. `CLAUDE_CODE_ENTRYPOINT` or `CLAUDE_CODE_SSE_PORT` → `'claude-code'`
  3. otherwise → `null` (regular VS Code; MCP is no-op)
  Detection logic was extracted from `src/mcp/lifecycle.ts` to `@core/runtime-detect` (T4.3 refactor) so non-MCP code (e.g. `showProjectInfo` command) can read it without depending on `@mcp`.
- **MCP mode** (`vscodeUEHelper.useMCP`, enum `auto | always | never`, default `auto`):
  - `auto` (default) — only start when `detectHost() !== null`.
  - `always` — always start (experimental, will fail in normal VS Code).
  - `never` — never start, even in Cursor/Claude Code.
- **6 exposed tools** (`src/mcp/tools.ts:49-89`):

  | MCP tool name | Dispatches to | Notes |
  |---|---|---|
  | `ue_build` | `executeBuild(mode, ..., silent=true)` | `mode: 'build' \| 'rebuild' \| 'clean'`, default `build`. |
  | `ue_launch_editor` | `executeLaunchEditor(..., silent=true)` | — |
  | `ue_live_coding` | `executeLiveCoding(..., silent=true)` | Windows only. |
  | `ue_generate_compile_commands` | `executeGenerateCompileCommands(..., silent=true)` | Runs UBT `-ProjectFiles`. |
  | `ue_show_project_info` | `showProjectInfo(..., silent=true)` | Surfaces detection result. |
  | `ue_set_system_includes` | `executeSetSystemIncludes(..., silent=true)` | Writes `-imsvc` paths into `.clangd`. |

  **Removed:** `ue_toggle_completion_mode` (deleted — fast/slow merged into slow per H4-B / Pitfall #11).
- **Fire-and-forget dispatch** (`src/mcp/tools.ts:124-175`): `callTool(name, args)` returns synchronously with `{ok: true, dispatched: name, note: 'fire-and-forget; see logger'}` after dispatching the real async `executeXxx` via `void` and a `.catch()` for error logging. The AI agent does not block waiting for completion; progress flows back through `OutputChannel` + `Problems` panel.
- **Runtime context injection** (`src/mcp/tools.ts:104-113`): `setMCPContext({config, logger, detection, workspace?, clangdOps?})` is called from `activateMCP` before the server starts. If `callTool` is invoked before the context is injected, it returns `{ok: false, error: 'MCP context not initialized — extension is not running in Cursor / Claude Code host'}`.
- **Lifecycle** (`src/mcp/lifecycle.ts`): `shouldStartMCP(mode)` returns true only when mode is `always`, or mode is `auto` and a known host is detected. `detectHost` is re-exported from `@core/runtime-detect` for backward compatibility.
- **Entry-point contract** (`src/mcp/index.ts:38-75`): `activateMCP(context, config, logger, detection, workspace?, clangdOps?)` — returns `MCPHandles = { server: MCPServer | undefined, host: RuntimeHost }`. The function **clears any stale MCPContext** when starting is skipped. **Note:** `src/extension.ts` does **not** currently call `activateMCP` (dead-code; see `src/mcp/AGENTS.md` line 11-15 and Plan 12 in `REMEDIATION-PLAN`). Wiring is on the roadmap.
- **Auth:** None. MCP inherits the host's permissions — no separate auth flow.
- **No secrets / no rate limits** — the host's invocation rate is bounded by the AI agent.

### 7. AI Agent Rule File Generator

**Files:** `src/rules/cursorRules.ts`, `src/commands/installRules.ts`

- **What it does:** Writes project-local rules so Cursor / GitHub Copilot know to use UBT, respect Live Coding, and follow UE C++ conventions.
- **Integration method:** Direct `node:fs` writes.
  - `.cursor/rules/unreal-cpp.mdc` (Markdown Components with frontmatter `description` + `globs: ["**/*.cpp", "**/*.h", "**/*.cs"]`).
  - `.github/copilot-instructions.md` (plain Markdown derived from the same source).
- **Content source:** two exported constants — `UE_HELPER_RULES_MDC` and `UE_HELPER_COPILOT_INSTRUCTIONS` in `src/rules/cursorRules.ts`.
- **Auth:** None.
- **Triggered by:** `vscodeUEHelper.installRules` command only. No automatic write — must be explicitly invoked.

### 8. VS Code API Surface (inbound)

**Files:** `src/extension.ts` (sole entry), `src/ui/*.ts` (UI layer), `src/ui/outputChannel.ts`, `src/ui/problemsPanel.ts`, `src/ui/statusBar.ts`, `src/ui/controlPanel.ts`, `src/ui/controlPanel.html.ts`, `src/ui/projectExplorer*.ts`, `src/ui/quickPicks.ts`, `src/ui/notifications.ts`, `src/ui/perfStatusBar.ts`.

This is the **inbound** half of the integration — VS Code calls into us, not the other way around. Key surfaces consumed:

- **Activation** — `vscode.ExtensionContext` passed to `activate(context)`. Activation events listed in `package.json#activationEvents` (5 events: workspace uproject + 4 explicit commands).
- **OutputChannel** — `src/ui/outputChannel.ts` wraps `vscode.window.createOutputChannel` (via `getLoggerOutputChannel` in `@core/logger`). All plugin logs share the single `VSCodeUEHelper` channel.
- **ProblemsPanel** — `src/ui/problemsPanel.ts` wraps `vscode.languages.createDiagnosticCollection('UE Helper')`. Click-through navigation from the Problems panel back to source uses the `vscode.Range(line, col, line, col)` shape (zero-based; MSVC output is 1-based, so `pushDiagnostics` does the `−1`).
- **StatusBar** — `src/ui/statusBar.ts` creates 11 `vscode.window.createStatusBarItem` buttons (per root `AGENTS.md` line 14), gated by `when` clauses for context-aware visibility.
- **TreeView / Webview** — `src/ui/projectExplorer.ts` (TreeView, `view/item/context` for `vscodeUEHelper.build` and `launchEditor`); `src/ui/controlPanel.ts` (Webview, `id: vscodeUEHelper.controlPanel`); `src/ui/controlPanel.html.ts` is the Webview HTML payload.
- **Tasks** — `src/build/taskProvider.ts` implements `vscode.TaskProvider` (registered for `Ctrl+Shift+B`).
- **Configuration** — `vscode.workspace.getConfiguration('vscodeUEHelper')` (wrapped by `Config` in `src/core/config.ts`); `onDidChangeConfiguration` for change events.
- **Workspace state** — `context.workspaceState` (used by `WorkspaceContext` and `WorkspaceState` for selected project/engine); `context.globalState` (used for `vscodeUEHelper.welcomed`).
- **Workspace folders** — `vscode.workspace.workspaceFile` / `vscode.workspace.workspaceFolders` / `vscode.workspace.getWorkspaceFolder()` are **banned by ESLint** outside `src/detection/index.ts` and `src/core/workspace.ts` — must go through `WorkspaceState` from `@core/workspace` (Phase 9 SSoT lock-in; see `no-restricted-syntax` rules in `.eslintrc.json`).
- **Commands** — `vscode.commands.registerCommand` wrapped by `registerCommand` in `src/core/command-registry.ts` (auto-pushes disposable to `context.subscriptions`).
- **Auth:** None at the VS Code API layer.

## Authentication & Identity

**There is no authentication layer in this codebase.** No tokens, no OAuth, no API keys, no user accounts, no secret store. The extension runs as the current Windows user; all spawned child processes (UBT, clangd, UnrealEditor, vswhere, UnrealEditor-Cmd) inherit that user identity.

The only **identity-like** signal is **MCP host detection** in `src/core/runtime-detect.ts` (see §6), which is purely a runtime environment-variable sniff — no auth.

## Data Storage

**There are no databases.** All state is local and ephemeral:

- **`context.workspaceState`** — per-workspace, persisted in VS Code's storage:
  - User-selected project / engine (`WorkspaceContext.setProject / setEngine`; the only allowed write paths are `WorkspaceState.setSelectedProject / setSelectedEngine`).
  - Backup of original `clangd.path` (managed by `SettingsManager` when the proxy is enabled).
- **`context.globalState`** — global across workspaces:
  - `vscodeUEHelper.welcomed` (boolean) — guards one-time welcome message.
- **Performance cache** (file-on-disk, not a DB): `.vscode/clangd-perf-cache/{proxy-baseline,proxy-after}.json` — produced by `npm run perf:baseline / perf:after` via `scripts/measure-proxy-overhead.mjs`. Used by `npm run perf:diff`.
- **Generated working files** (on-disk in user's project):
  - `compile_commands.json` — written to `<Project>/compile_commands.json` by UBT (via symlink from `Intermediate/Build/...`).
  - `.clangd` — written by `ClangdOps` to `<Project>/.clangd`.
  - `.vscode/vscodeuehelper/*.h` — UE compat header + macro completion files (`ueClangdCompat.h`, `addCompletions.h`, `addMacroCompletions.h`).
  - `.cursor/rules/unreal-cpp.mdc` + `.github/copilot-instructions.md` — written by `installRules` command.

No connection strings. No credentials. No file-storage service (S3 / Azure Blob / etc.). No caching service (Redis / Memcached).

## CI/CD & Deployment

**No CI / CD pipeline.** Confirmed by `AGENTS.md` line 131: "无 CI / pre-commit / Husky 配置（`.github/`、`hooks/` 都不存在）。所有门禁靠开发者本地命令."

- **Hosting:** None. Distributed as a `.vsix` file. The extension is published to the VS Code Marketplace via `vsce publish` (`npm run publish`); current `package.json#repository.url` is still the placeholder `https://github.com/YOUR_USERNAME/vscode-ue-helper.git` and must be changed before publishing (root `AGENTS.md` line 128).
- **Version:** `package.json#version: 0.1.0` (initial release). MCP server reports `name: 'vscode-ue-helper', version: '0.1.0'` to its host (`src/mcp/server.ts:23-25`).
- **Build pipeline:** Manual. The only artifact-producing flow is:
  ```bash
  npm ci               # install
  npm run typecheck    # tsc --noEmit
  npm run lint         # eslint
  npm run format:check # prettier
  npm run test:unit    # vitest
  npm run package      # vsce package → .vsix
  ```
  The `prepackage` npm hook auto-runs `npm run build` before `vsce package`.
- **No secrets management:** There are no secrets to manage. The .vsix ships in the marketplace; users install it into their own VS Code instance and point it at their own UE/MSVC/clangd installs.
- **No staging environment:** A single artifact chain. Integration tests are broken (Pitfall #1) so there is no automated e2e gate.

## Webhooks & Callbacks

**None.** This codebase has no inbound webhook endpoints (it is not a server) and no outbound webhook calls. The closest analog is:
- **MCP `CallToolRequestSchema`** in `src/mcp/server.ts:42-49` — an inbound request over stdio from a Cursor / Claude Code host. Handled synchronously; result returned in the same stdio round-trip.
- **`UbtDiagnosticWatcher` → UBT re-spawn** — when the proxy detects a stale-`.generated.h` diagnostic, it fires a local child process (UBT) and then sends a `workspace/didChangeWatchedFiles` notification back to clangd. This is local IPC, not a webhook.

## Environment Configuration

There are **no environment variables** that the extension reads at runtime (other than the MCP host-detect env vars above). All configuration is via `package.json#contributes.configuration` + the `Config` accessor in `src/core/config.ts`.

**Environment variables the extension depends on (implicit, not configured):**
- `CURSOR_TRACE_ID` / `CURSOR_USER_DATA_DIR` — for MCP host detection (read-only).
- `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_SSE_PORT` — for MCP host detection (read-only).
- `PATH` — used by `RealClangdResolver` to look up `clangd.exe`.
- `TMP` / `TEMP` — used by Node's child_process internally for temp file handling.

**No `.env` files** exist; nothing is gitignored for secrets. The extension is fully self-contained: no API keys, no database URLs, no auth tokens.

**Development vs. Production differences:** None. The same artifact runs in development (`F5` Extension Development Host via `.vscode/launch.json`) and in production (installed from marketplace). The only meaningful difference is which `clangd.path` setting is used and which `SettingsManager` backup state is in workspace state.

## Per-Integration Summary Table

| Integration | File(s) | Direction | Auth | Failure Isolation |
|---|---|---|---|---|
| UBT | `src/build/{ubt,buildRunner,taskProvider}.ts` | outbound child proc | none | errors → Problems panel + status bar |
| Unreal Editor | `src/build/launchEditor.ts` | outbound child proc | none | `detached: true, unref()` |
| Live Coding | `src/build/liveCoding.ts` | outbound child proc | none | silent no-op if Editor not running |
| MSVC / Windows SDK | `src/detection/vsBuildTools.ts`, `src/clangd/windowsSdk.ts` | local fs + `vswhere.exe` | none | missing → empty array, logged |
| clangd (via proxy) | `src/clangd/proxy/*.ts` | stdio LSP | none | proxy returns clangd errors to client; UE diagnostic recovery |
| UE engine source | `src/detection/engineDiscovery.ts`, `src/clangd/preparseIncludes.ts`, `resources/preparse-includes/ue5-slow.json` | local fs | none | missing → empty array, logged |
| MCP host | `src/mcp/{index,server,tools,lifecycle}.ts`, `src/core/runtime-detect.ts` | stdio JSON-RPC | inherits host perms | skipped when no host detected |
| AI agent rules | `src/rules/cursorRules.ts` | local fs write | none | manual command only |
| VS Code API | `src/extension.ts`, `src/ui/*.ts` | inbound | VS Code auth | standard VS Code error surfaces |

---

*Integration audit: 2026-07-23*
*Update when adding/removing external services or changing MCP tool surface.*
