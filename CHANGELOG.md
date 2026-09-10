# Changelog

All notable changes to VSCodeUEHelper are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **激活提示**: 补齐 `package.json#activationEvents` 的 18 个缺失 `onCommand` 事件,使全部 22 个命令 ID 在被点击时立即触发激活,不再显示 "Extension 'VSCodeUEHelper' is activating…"。仓库根 AGENTS.md 与 `src/commands/AGENTS.md` 同步把"在 `activationEvents` 加 `onCommand`"纳入新增命令铁律,避免回归。

## [0.7.0] — 2026-06-24

### Phase 7 — Release readiness

- Full integration test suite (`npm test`)
- Updated README with feature matrix and command reference
- Documentation reflects all 7 phases complete

## [0.6.0] — 2026-06-24

### Phase 6 — Tests & Docs

- Vitest unit tests for all parsers (MSVC, UBT, linker, uproject)
- Clangd YAML rendering tests
- Integration scenarios for MSVC + UBT interleaved output
- 18 tests passing across 4 files

## [0.5.0] — 2026-06-24

### Phase 5 — MCP Integration

- MCP server with `@modelcontextprotocol/sdk`
- 6 tools exposed: `ue_build`, `ue_launch_editor`, `ue_live_coding`,
  `ue_generate_compile_commands`, `ue_show_project_info`, `ue_toggle_completion_mode`
- Lifecycle detection: auto-starts in Cursor / Claude Code env, no-op elsewhere
- Cursor rules generator (`.cursor/rules/unreal-cpp.mdc`)
- GitHub Copilot instructions (`.github/copilot-instructions.md`)

## [0.4.0] — 2026-06-24

### Phase 4 — UI & Commands

- All 12 commands wired to real implementations:
  - `vscodeUEHelper.build` / `.rebuild` / `.clean`
  - `vscodeUEHelper.launchEditor`
  - `vscodeUEHelper.liveCoding` (Windows only)
  - `vscodeUEHelper.generateCompileCommands`
  - `vscodeUEHelper.createProject` (scaffolds `.clangd` + customization points)
  - `vscodeUEHelper.toggleCompletionMode` (status bar toggle)
  - `vscodeUEHelper.installRules` / `.uninstall`
  - `vscodeUEHelper.setSystemIncludes` (Phase 6 placeholder)
  - `vscodeUEHelper.showProjectInfo`
- Status bar widget shows project / engine / config / target
- QuickPick pickers for engine, project, configuration, target, platform
- Problems panel integration for MSVC diagnostics
- Output channel for build output
- Progress notifications

## [0.3.0] — 2026-06-24

### Phase 3 — Clangd IntelliSense

- `compile_commands.json` generation via UBT `-ProjectFiles` mode
- `.clangd` writer with MSVC warning suppression
- Preparse-includes for UE macros (fast/slow profiles)
- Workspace backup against UBT clobber (`.vscode/.code-workspace.backup`)
- Status-bar completion mode toggle (`UE⚡` / `UE⌚`)
- Bundled preparse lists: `ue5-fast.json` (18 headers), `ue5-slow.json` (49 headers)

## [0.2.0] — 2026-06-24

### Phase 2 — Build Layer

- UBT CLI construction (`buildUBTCommand`)
- Editor path resolution (`resolveEditorPath`, `resolveLiveCodingCmd`)
- Build runner with stdout/stderr streaming and abort signal
- MSVC parser (file(line,col): error/warning Cxxxx: message)
- UBT progress parser (`[N/M] description`)
- Linker parser (LNK2019, LNK1120)
- VS Code TaskProvider for `Ctrl+Shift+B`
- Cross-platform editor launch (cmd / open / direct exec)

## [0.1.0] — 2026-06-24

### Phase 1 — Detection

- `UprojectScanner` — scans workspace for `.uproject`, parses EngineAssociation
- `EngineDiscovery` — cross-platform:
  - Windows: `HKLM\SOFTWARE\EpicGames\Unreal Engine\<version>` registry
  - Mac: `~/Library/Application Support/Epic/UnrealEngine`, `/Users/Shared/Epic Games`
  - Linux: `~/UnrealEngine`, `/opt/UnrealEngine`, `/usr/local/UnrealEngine`
  - Env var `UE_ROOT` override
- `VsBuildTools` — Windows-only vswhere.exe detection + MSVC toolset path
- `WorkspaceContext` — Memento-persisted selection

## [0.0.0] — 2026-06-24

### Phase 0 — Foundation

- Project skeleton (TypeScript strict + esbuild + Vitest + ESLint + Prettier)
- 12 command palette entries registered
- 10 typed configuration options
- Core modules: `Logger`, `Config` (typed settings wrapper), `command-registry`
- Comprehensive plan saved to `.claude/plans/vscode-ue-helper-plan.md`
- `showProjectInfo` placeholder command
