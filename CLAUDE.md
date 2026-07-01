# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm run build              # esbuild → out/extension.js + out/clangdProxy.js + launcher scripts
npm run watch              # esbuild watch mode
npm run typecheck          # tsc --noEmit (strict mode)
npm run lint               # ESLint src test --ext .ts
npm run lint:fix           # ESLint with --fix
npm run format:check       # Prettier check
npm run format             # Prettier write
npm run test:unit          # vitest run (unit tests)
npm run test:unit:watch    # vitest interactive
npm run test:integration   # node test/integration/runTests.js
npm run test               # unit + integration
npm run package            # vsce package → .vsix
```

Run a single test file: `npx vitest run --run test/unit/ui/controlPanel.test.ts`

## Project Architecture

VS Code extension for Unreal Engine C++ development. **Extension entry**: `src/extension.ts:20` — `activate()`.

### Activation Sequence (order matters!)

```
1. initI18n()              ← must be first (before Logger)
2. Logger + Config         ← infrastructure, all modules depend on these
3. activateDetection()     ← project/engine discovery, returns DetectionHandles with `ready: Promise`
4. activateBuild()         ← UBT Task Provider
5. activateClangd()        ← clangd config, workspace backup
6. activateUI()            ← 11 status bar buttons, awaits detection.ready
7. activateCommands()      ← registers all commands
8. ControlPanelProvider    ← webview control panel
```

### Module Map (src/)

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `core/` | Infrastructure | `config.ts` (Config wrapper), `logger.ts` (Logger), `command-registry.ts` |
| `detection/` | Project/engine discovery | `engineDiscovery.ts`, `uprojectScanner.ts`, `vsBuildTools.ts`, `workspaceContext.ts` |
| `build/` | UBT build, Live Coding, Task Provider | (via codegraph) |
| `clangd/` | clangd IntelliSense, compile_commands, proxy | `clangdConfig.ts`, `compileCommands.ts`, `completionMode.ts`, `proxyManager.ts`, `ueMacroCompletions.ts` |
| `commands/` | 19 VS Code command implementations | `index.ts` (registration hub), one file per command |
| `ui/` | Status bar, QuickPick, control panel | `statusBar.ts`, `controlPanel.ts`, `controlPanel.html.ts`, `quickPicks.ts` |
| `parsers/` | MSVC/UBT/linker error parsers | `msvcParser.ts`, `ubtParser.ts`, `linkerParser.ts` |
| `mcp/` | MCP server (auto-enabled in Cursor/Claude Code) | `server.ts`, `tools.ts`, `lifecycle.ts` |
| `rules/` | AI agent rule generators | `cursorRules.ts` |
| `i18n/` | i18n (zh/en) | `index.ts` |

### Key Patterns

- **Path aliases**: Use `@core/`, `@detection/`, `@clangd/`, `@build/`, `@commands/`, `@ui/`, `@i18n/`, `@parsers/`, `@mcp/`, `@rules/` — never relative imports
- **i18n first**: All user-visible strings go through `t('key')` translation
- **Promise-based activation**: `detection.ready` is a Promise; UI awaits it before rendering to avoid race conditions
- **Disposable pattern**: All VS Code resources pushed to `context.subscriptions` for auto-cleanup
- **Chinese comments**: All code comments in Chinese
- **Strict TypeScript**: `strict: true`, `noUncheckedIndexedAccess`, `noImplicitAny`
- **No floating promises**: Use `void` to explicitly mark intentionally-unawaited promises
- **No `any`**: Use proper types; annotate `// eslint-disable-line` with reason if unavoidable

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

The LSP proxy (`src/clangd/proxy/`) is a separate Node.js process that wraps clangd's LSP protocol to add:
- **didClose keepalive** — prevents clangd from re-indexing when files are closed/opened
- **Localization** — Chinese append/override for diagnostics, codeActions, hover
- Configured via `vscodeUEHelper.clangdProxy.*` settings
- Built as a standalone CLI at `out/clangdProxy.js`

### Test Structure

Tests live in `test/unit/`, mirroring `src/` structure. Uses Vitest with:
- Coverage thresholds: lines 80%, functions 80%, branches 75%, statements 80%
- Setup file: `test/unit/setup.ts`
- VS Code APIs mocked via `vscode-mocks` pattern (see existing tests)

## Common Development Tasks

- **Add a new command**: Create `src/commands/xxx.ts` with `executeXxx()` function, register in `src/commands/index.ts`
- **Add a setting**: Add to `package.json` `contributes.configuration.properties`, then wrap in `src/core/config.ts`
- **Modify detection logic**: Edit files in `src/detection/` — `engineDiscovery.ts` for engine paths, `uprojectScanner.ts` for project scanning
- **Debug**: Press F5 to launch Extension Development Host, Output panel → "VSCodeUEHelper" for logs

## Dependencies

- Runtime: `@modelcontextprotocol/sdk`, `chokidar`, `execa`, `json5`, `neverthrow`, `xstate`, `yaml`
- Dev: `esbuild`, `vitest`, `typescript`, `eslint`, `prettier`, `vsce`, `@vscode/test-electron`
- Extension dependency: `llvm-vs-code-extensions.vscode-clangd`
