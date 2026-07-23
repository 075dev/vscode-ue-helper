# Technology Stack

**Analysis Date:** 2026-07-23

> **Project:** VSCodeUEHelper — Windows-only VS Code extension for Unreal Engine 5.2+ C++ development (UBT build, Live Coding hot-reload, clangd IntelliSense, optional MCP AI agent integration).
> **Root:** `D:/AIWorkSpace/VScodePlugin/VSCodeUEHelper`
> **Repo knowledge base:** `AGENTS.md` (project root) + per-module `src/<module>/AGENTS.md` (8 modules).

## Languages

**Primary:**
- TypeScript 5.3.3 (`^5.3.3`, exact in `package.json#devDependencies.typescript`) — all application code under `src/**/*.ts` and tests under `test/unit/**/*.test.ts`.

**Secondary:**
- JavaScript (ES2022) — esbuild build scripts (`esbuild.config.mjs`), clean/measure scripts under `scripts/*.mjs`, generated `out/extension.js` + `out/clangdProxy.js` bundles.
- JSON / JSON5 — `.uproject` (Epic uses JSON5 with trailing commas → parsed via `json5` npm package), `Build.version`, locale files `src/i18n/locales/{en,zh}.json`, configuration schema in `package.json#contributes.configuration`.
- YAML — `.clangd` (the file the extension writes), `compile_commands.json`.
- Markdown — repo knowledge base (`AGENTS.md`, per-module docs).
- Batch (Windows) — generated launcher `out/launcher/proxy-launcher.bat` (auto-emitted by esbuild).
- PowerShell — `scripts/gen-icon.ps1` (icon regeneration helper).

## Runtime

**Environment:**
- Node.js `>=18.0.0` (`engines.node` in `package.json`).
- esbuild `target: 'node18'` (`esbuild.config.mjs:23`) — emitted JavaScript targets Node 18.
- VS Code Engine API `^1.85.0` (`engines.vscode` in `package.json`).
- No browser/Electron runtime — runs inside VS Code Extension Host (Node.js process) only.
- `module: "Node16"`, `moduleResolution: "Node16"`, `lib: ["ES2022"]` (`tsconfig.json:4-6`).

**Package Manager:**
- npm (lockfile: `package-lock.json` present at repo root).
- Workspace has no `yarn.lock` / `pnpm-lock.yaml`.

## Frameworks

**Core:**
- VS Code Extension Host — extension activation model (`src/extension.ts` is the sole entry; `main: "out/extension.js"` in `package.json`).
- `@modelcontextprotocol/sdk` `^1.0.0` (production `dependencies`) — MCP server for Cursor/Claude Code AI agents (`src/mcp/server.ts`, `src/mcp/tools.ts`).

**Testing:**
- Vitest `^1.3.0` + `@vitest/coverage-v8` `^1.6.1` — unit tests under `test/unit/**/*.test.ts`; v8 coverage provider with thresholds `lines:80, functions:80, branches:75, statements:80` (`vitest.config.ts:18-23`).
- `chokidar` `^3.6.0` is **mocked** in `test/unit/setup.ts` (Pitfall #6 in root `AGENTS.md`) — required, otherwise `fileWatcher` tests spawn real fs watchers and hang.
- `npm run test:integration` is currently **broken** (script points at `test/integration/runTests.js` which does not exist; only `npm run test:unit` works).

**Build/Dev:**
- TypeScript 5.3.3 compiler — `tsc --noEmit` for typecheck (`npm run typecheck`).
- esbuild `^0.20.0` — **dual bundle** output (`esbuild.config.mjs`):
  - `out/extension.js` — main extension entry (`src/extension.ts`), `vscode` and `@vscode/*` marked `external` (provided by VS Code runtime at load time).
  - `out/clangdProxy.js` — independent clangd LSP proxy CLI (`src/clangd/proxy/cli.ts`), zero `vscode` dependency, runs as a standalone Node child process.
  - Auto-emits `out/launcher/proxy-launcher.bat` (Windows-only launcher; Unix `.sh` removed in N2 dead-code cleanup).
- `@vscode/test-electron` `^2.3.8` — declared in `devDependencies` for future integration/E2E test runs.
- `vsce` `^2.15.0` — official VS Code Extension Manager, used by `npm run package` to emit `.vsix`.

## Key Dependencies

**Production (`dependencies` in `package.json:493-498`):**
- `@modelcontextprotocol/sdk` `^1.0.0` — MCP server SDK (Cursor / Claude Code stdio transport).
- `chokidar` `^3.6.0` — incremental file watcher (`src/clangd/fileWatcher.ts`, `src/clangd/proxy/ueDiagnosticWatcher.ts`, `src/clangd/proxy/generatedHeaderWatcher.ts`).
- `json5` `^2.2.3` — UE `.uproject` parser (Epic uses trailing commas; standard JSON would fail).
- `yaml` `^2.9.0` — `.clangd` read/write (`src/clangd/clangdConfig.ts`).

> Note: no runtime HTTP / database / auth clients. The only outbound integrations are child-process spawns to UBT, clangd, vswhere, UnrealEditor, and the stdio MCP transport. Listed in `INTEGRATIONS.md`.

**Dev (`devDependencies` in `package.json:479-492`):**
- `@types/node` `^20.11.0` + `@types/vscode` `^1.85.0` — type defs.
- `esbuild` `^0.20.0` — bundler.
- `typescript` `^5.3.3` — compiler.
- `vitest` `^1.3.0` + `@vitest/coverage-v8` `^1.6.1` — test runner + coverage.
- `eslint` `^8.57.0` + `@typescript-eslint/eslint-plugin` `^7.0.0` + `@typescript-eslint/parser` `^7.0.0` — linter.
- `prettier` `^3.2.5` — formatter.
- `@vscode/test-electron` `^2.3.8` — integration test runner (currently unused; integration suite is broken — see Pitfalls).
- `vsce` `^2.15.0` — package/publish.

**No `execa` / no `node-fetch` / no auth libs:** the codebase uses Node built-ins (`node:child_process.spawn` / `execFile`, `node:fs/promises`, `node:path`, `node:url`) instead. `src/detection/vsBuildTools.ts:25-56` ships an internal `runExeca` shim explicitly because `execa` is ESM-only and the project emits CJS from esbuild.

## Configuration

**Build / TypeScript:**
- `tsconfig.json` — `target: ES2022`, `module/moduleResolution: Node16`, `strict: true` with `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitAny`, `strictNullChecks`, `useDefineForClassFields`, `isolatedModules`, `declaration: true`, `sourceMap: true`, `resolveJsonModule: true`, `forceConsistentCasingInFileNames: true`. Emits to `./out`.
- `vitest.config.ts` — `test/unit/**/*.test.ts` includes, `test/integration/**` excluded, `environment: 'node'`, v8 coverage with thresholds, setup file `test/unit/setup.ts`, mirrors path aliases from `tsconfig.json`.
- `esbuild.config.mjs` — dual bundle config; CJS output, platform `node`, target `node18`, sourcemap on for dev, minify+treeShake on for prod, NODE_ENV define injection.

**Extension Configuration (declarative in `package.json#contributes.configuration`):**
Namespace `vscodeUEHelper.*`, schema contributions on lines 259-437 of `package.json`:
- `vscodeUEHelper.ueVersion` (string) — preferred UE version (e.g. `5.4`); empty = auto.
- `vscodeUEHelper.configuration` (enum) — UE build config: `Debug | DebugGame | Development | Shipping | Test` (default `Development`).
- `vscodeUEHelper.target` (enum) — `Editor | Game | Server | Client` (default `Editor`).
- `vscodeUEHelper.platform` (enum) — `Win64 | Mac | Linux` (default `Win64`; Mac/Linux are unreachable in practice — see `package.json#platforms: ["win32"]`).
- `vscodeUEHelper.clangdPath` (string) — clangd binary path override.
- `vscodeUEHelper.autoBackupWorkspace` (bool, default `true`) — backup/restore `.code-workspace` against UBT refresh.
- `vscodeUEHelper.useMCP` (enum: `auto | always | never`, default `auto`) — MCP server mode (see INTEGRATIONS.md).
- `vscodeUEHelper.lspLoggingLevel` (enum: `error | warn | info | debug`, default `info`).
- `vscodeUEHelper.clangdProxy.*` — group of 7 settings (enabled, keepaliveMax=20, keepaliveTtlSec=900, realClangdPath, logPath, localization.enabled, localization.mode `append | zh-only`, dictionaryPath).
- `vscodeUEHelper.showPerfInStatusBar` (bool, default `false`).
- `vscodeUEHelper.clangdHeaderWatcher.enabled` (bool, default `true`) — actually **no-op** (Pitfall #8 in root `AGENTS.md`; the watcher is now passive, in proxy-side `UeDiagnosticWatcher`).
- `vscodeUEHelper.clangd.userAddFlags` (string array of flag ids) — `compat-header`, `macro-helper`, `std-cxx20`, `preparse-headers`, `uht-include-dirs`, `system-include-windows`.
- **Removed settings** (kept only as `deprecationMessage` per Pitfall #11): `vscodeUEHelper.completionMode` — fast/slow merged into slow (`H4-B`); getter always returns `'slow'`.

**Strong-typed accessor:** `src/core/config.ts` — `Config` class wraps `vscode.workspace.getConfiguration('vscodeUEHelper')` with one typed getter per setting, `update(key, value)` for writes (auto-refreshes `this.root`; see Pitfall #10), and `onDidChange(listener) → Disposable`. `Config.update` mutates in place — it does **not** return a new instance.

**Path aliases (HARD constraint — see root `AGENTS.md` §"路径别名" and Pitfall section):**
Declared in three places that must stay in sync: `tsconfig.json#compilerOptions.paths` (lines 33-52), `esbuild.config.mjs#alias` (lines 28-39), `vitest.config.ts#resolve.alias` (lines 28-39). Required aliases:

| Alias | Resolves to |
|---|---|
| `@/*` | `src/*` |
| `@core` / `@core/*` | `src/core/index` / `src/core/*` |
| `@detection` / `@detection/*` | `src/detection/index` / `src/detection/*` |
| `@build` / `@build/*` | `src/build/index` / `src/build/*` |
| `@clangd` / `@clangd/*` | `src/clangd/index` / `src/clangd/*` |
| `@commands` / `@commands/*` | `src/commands/index` / `src/commands/*` |
| `@ui` / `@ui/*` | `src/ui/index` / `src/ui/*` |
| `@i18n` / `@i18n/*` | `src/i18n/index` / `src/i18n/*` |
| `@parsers/*` | `src/parsers/*` |
| `@mcp` / `@mcp/*` | `src/mcp/index` / `src/mcp/*` |
| `@platform` (declared in `tsconfig.json` but **dead**) | `src/platform/*` — directory does not exist (historical residue; do not use). |
| `@rules` (used in `tsconfig.json` root `AGENTS.md` mention) | `src/rules/*` — declared in `tsconfig.json` alias list of root `AGENTS.md` but **absent** from the `tsconfig.json` itself; actual rule files live in `src/rules/`. |

**Relative imports forbidden:** `import { Logger } from '../../core/logger'` is rejected by repo convention. Always use `import { Logger } from '@core/logger'`. ESLint `no-restricted-syntax` also blocks `new Logger(...)` outside `src/extension.ts` and test files — must use `sharedLogger` (`@core/logger`).

**Linting / Formatting:**
- `.eslintrc.json` — `@typescript-eslint/no-floating-promises: error`, `no-misused-promises: error`, `await-thenable: error`, `eqeqeq: [error, always]`, `curly: [error, all]`, `prefer-const: error`. Phase 9 SSoT lock-in rules:
  - `no-restricted-syntax` blocks direct `vscode.workspace.workspaceFile` / `vscode.workspace.workspaceFolders` / `vscode.workspace.getWorkspaceFolder(...)` reads (must go through `WorkspaceState` from `@core/workspace`).
  - `no-restricted-syntax` blocks `new Logger(...)` outside the entry & test seams.
  - `no-restricted-imports` blocks imports of `@clangd/clangdConfig` (deleted in Phase 9; `.clangd` writes go through `ClangdOps` only).
- `.prettierrc` — `singleQuote: true`, `trailingComma: "all"`, `printWidth: 100`, `tabWidth: 2`, `arrowParens: "always"`, `endOfLine: "lf"`. Markdown overridden to `printWidth: 120, proseWrap: "preserve"`.
- `tsconfig.json` `noUnusedLocals` + `noUnusedParameters` enforce zero dead code; unused args prefix with `_` to bypass.

**i18n:**
- `src/i18n/index.ts` — `t(key, params?)` runtime helper. Locale auto-detected from `vscode.env.language` (starts with `zh` → `'zh'`, else `'en'`); fallback to English if a key is missing in the active locale. Supports `{name}` placeholders (string or number).
- `initI18n()` **must be called before any `Logger`** (`src/extension.ts:29`) — logger output may use translated strings.
- Locale files: `src/i18n/locales/en.json` (252 lines) + `src/i18n/locales/zh.json` (252 lines) — symmetric key set; both must be kept in sync.

## npm Scripts (`package.json#scripts:458-478`)

| Script | Command | Purpose |
|---|---|---|
| `build` | `npm run clean && node esbuild.config.mjs` | Full clean + dual bundle. |
| `clean` | `node scripts/clean-out.mjs` | Wipes `out/src/` and `out/test/` (prevents stale `.vsix` content; deliberately leaves `out/extension.js` alone). |
| `watch` | `node esbuild.config.mjs --watch` | esbuild watch mode for both bundles. |
| `typecheck` | `tsc --noEmit` | Must pass with zero errors. |
| `typecheck:watch` | `tsc --noEmit --watch` | Watch-mode typecheck. |
| `lint` | `eslint src test --ext .ts` | Lint TypeScript. |
| `lint:fix` | `eslint src test --ext .ts --fix` | Lint with autofix. |
| `format` | `prettier --write "src/**/*.ts" "test/**/*.ts" "*.{json,md,mjs}"` | Write-formatted. |
| `format:check` | `prettier --check ...` | CI-style format check. |
| `test:unit` | `vitest run` | Run unit tests. |
| `test:unit:watch` | `vitest` | Watch-mode unit tests. |
| `test` | `npm run test:unit` | Currently only unit (integration step is broken — Pitfall #1). |
| `test:coverage` | `vitest run --coverage` | Coverage report. |
| `prepackage` | `npm run build` | Auto-runs before `package`. |
| `package` | `vsce package` | Build `.vsix`. |
| `publish` | `vsce publish` | Publish to marketplace. |
| `perf:baseline` | `node scripts/measure-proxy-overhead.mjs --baseline` | Sample LSP proxy overhead → `.vscode/clangd-perf-cache/proxy-baseline.json`. |
| `perf:after` | `node scripts/measure-proxy-overhead.mjs --after` | Same → `proxy-after.json`. |
| `perf:diff` | `node scripts/measure-proxy-overhead.mjs --diff` | Compare two JSON files; < 1% drift passes. |

## Platform Requirements

**Development:**
- **Windows 10/11 x64 only.** `package.json#platforms: ["win32"]` is a hard constraint — Mac/Linux are out of scope (root `AGENTS.md` header).
- Node.js `>= 18`, npm, Git for Windows (provides `git-bash` shell used in Hermes dev).
- VS Code `>= 1.85.0` (the engine version pinned in `package.json#engines.vscode`).
- Extension dependency: `llvm-vs-code-extensions.vscode-clangd` (declared in `extensionDependencies`) — required for IntelliSense; the proxy bundles route through it.
- Recommended companion extensions (`.vscode/extensions.json`): Prettier, ESLint, clangd, TypeScript Next.
- **External host tools the extension shells out to (not bundled, must be installed by user):**
  - Unreal Engine 5.2+ source tree (with `Engine/Build/BatchFiles/Build.bat`).
  - Microsoft Visual Studio Build Tools (with `vswhere.exe` for detection).
  - Windows SDK (for `windows.h` and friends — paths fed into clangd `-imsvc`).
  - LLVM clangd (when not using the bundled `llvm-vs-code-extensions.vscode-clangd`).
  - For AI-agent integrations: Cursor IDE or Claude Code CLI.

**Production (deployment):**
- Distributed as a single `.vsix` file built by `vsce package` (preceded by `npm run build`).
- `.vsix` content per `.vscodeignore`: only `out/extension.js`, `out/clangdProxy.js`, `out/launcher/*`, `resources/icon.png`, `package.json` ship in the bundle. Excluded: `src/`, `test/`, `tsconfig.json`, `*.mjs`, `AGENTS.md`, `CLAUDE.md`, `.planning/`, `.codegraph/`, `scripts/`, `*.log`, `*.map`, `doc/`, `docs/`.
- Installed into VS Code's `extensions/` directory and run inside Extension Host (Node.js process spawned by VS Code).
- No CI / pre-commit / Husky configuration present (`.github/`, `hooks/` directories do not exist); all gates (typecheck/lint/test/format) are developer-local.

**Activation triggers** (`package.json#activationEvents:37-43`):
- `workspaceContains:**/*.uproject` — auto-activate when a UE project file is in the workspace.
- `onCommand:vscodeUEHelper.{build,liveCoding,showProjectInfo,diagnoseProject}` — lazy activation when these commands are first invoked.

---

*Stack analysis: 2026-07-23*
*Update after major dependency changes, engine version bump, or new external integration.*
