# VSCodeUEHelper

> All-in-one VS Code plugin for Unreal Engine C++ development: UBT build, Live Coding hot-reload, clangd IntelliSense, and optional MCP AI agent integration.

## Status

✅ **All 7 phases complete.** Ready for development use. Phase 7 polish (marketplace icon, banner) still pending.

| Phase | Status | Feature |
|---|---|---|
| 0 | ✅ | Project skeleton, command palette, configuration schema |
| 1 | ✅ | `.uproject` scanning, cross-platform engine discovery (Win/Mac/Linux), VS Build Tools detection |
| 2 | ✅ | UBT Build/Rebuild/Clean, Live Coding, MSVC parsing, Problems panel, Task provider |
| 3 | ✅ | clangd IntelliSense, `compile_commands.json`, `.clangd` config, preparse includes (fast/slow), workspace backup |
| 4 | ✅ | Status bar, QuickPick pickers, all 12 commands |
| 5 | ✅ | MCP server (auto-enabled in Cursor / Claude Code), AI agent rules |
| 6 | ✅ | Unit tests, 18 passing across 4 files |
| 7 | ⏳ | Marketplace icon/banner pending; .vsce ready |

## Inspiration

This plugin integrates patterns from two excellent open-source projects (both at their v3 versions):

- **[rmoubayed/engine-link](https://github.com/rmoubayed/engine-link)** — Cursor IDE extension: UBT build pipeline, live coding, engine auto-detection, MCP AI integration
- **[boocs/unreal-clangd](https://github.com/boocs/unreal-clangd/tree/v3)** — VS Code extension: clangd IntelliSense, `compile_commands.json` maintenance, workspace backup against UBT refresh, preparse-includes macro completion

The code is written from scratch to avoid version-coupling, but the patterns are mirrored.

## Features

### Build Integration
- Build / Rebuild / Clean via UnrealBuildTool (`Ctrl+Shift+B` via TaskProvider)
- Live Coding hot-reload (Windows only — `Ctrl+Alt+F11`)
- MSVC error parsing → Problems panel with file:line:col click-through
- Build progress in status bar notification
- Cross-platform editor launch (Windows / Mac / Linux)

### Engine & Project Detection
- Automatic `.uproject` scan of workspace
- Cross-platform Unreal Engine discovery:
  - Windows: registry `HKLM\SOFTWARE\EpicGames\Unreal Engine\<version>`
  - Mac: `~/Library/Application Support/Epic/UnrealEngine`, `/Users/Shared/Epic Games`
  - Linux: `~/UnrealEngine`, `/opt/UnrealEngine`, `/usr/local/UnrealEngine`
  - Env var `UE_ROOT` override
- VS Build Tools detection via `vswhere.exe` (Windows)
- Persistent selection (Memento) — pick once, remembered next time

### Clangd IntelliSense
- Auto-generates `compile_commands.json` via UBT `-ProjectFiles` mode
- Writes `.clangd` to suppress MSVC false positives (`builtin-macro-redefinition`, `unknown-warning-option`, etc.)
- Preparse-includes for UE macros:
  - **Fast** mode (`UE⚡`): curated 18-header list — fast indexing
  - **Slow** mode (`UE⌚`): comprehensive 49-header list — complete coverage
- Workspace backup: `.code-workspace` survives UBT's `-ProjectFiles` refresh

### MCP AI Agent Integration
- Auto-starts in Cursor / Claude Code (detected via env vars)
- 6 tools exposed: `ue_build`, `ue_launch_editor`, `ue_live_coding`, `ue_generate_compile_commands`, `ue_show_project_info`, `ue_toggle_completion_mode`
- Stdio transport via `@modelcontextprotocol/sdk`
- AI agent rules generated to `.cursor/rules/unreal-cpp.mdc` and `.github/copilot-instructions.md`

### User Project Setup
- `Create Unreal Clangd Project` command scaffolds `.clangd` + `.vscode/unreal-clangd/addCompletions.h` + `addMacroCompletions.h`
- `Uninstall` command cleans all generated files
- `Install AI Agent Rules` for Cursor / Copilot

## Installation (development)

```bash
git clone <repo>
cd VSCodeUEHelper
npm install
npm run build
# Press F5 in VS Code to launch Extension Development Host
```

## Configuration

Settings live under the `vscodeUEHelper.*` namespace.

| Setting | Type | Default | Description |
|---|---|---|---|
| `engineRoot` | string | `""` | Path to UE root. Empty = auto-detect. |
| `ueVersion` | string | `""` | Preferred UE version (e.g., `5.4`). Empty = latest detected. |
| `configuration` | enum | `Development` | Debug / DebugGame / Development / Shipping / Test |
| `target` | enum | `Editor` | Editor / Game / Server / Client |
| `platform` | enum | `Win64` | Win64 / Mac / Linux |
| `clangdPath` | string | `""` | Path to clangd binary. Empty = auto-detect. |
| `completionMode` | enum | `fast` | Fast = curated 18-header list. Slow = comprehensive 49-header list. |
| `autoBackupWorkspace` | bool | `true` | Backup/restore `.code-workspace` against UBT refresh. |
| `useMCP` | enum | `auto` | `auto` = only in Cursor/Claude Code. `always` / `never`. |
| `lspLoggingLevel` | enum | `info` | error / warn / info / debug |

## Commands

| Command | Title | Notes |
|---|---|---|
| `vscodeUEHelper.build` | Build | UBT build of selected target/config |
| `vscodeUEHelper.rebuild` | Rebuild | Clean + Build |
| `vscodeUEHelper.clean` | Clean | Remove intermediates |
| `vscodeUEHelper.launchEditor` | Launch Unreal Editor | Cross-platform spawn |
| `vscodeUEHelper.liveCoding` | Live Coding (Hot Reload) | Windows only |
| `vscodeUEHelper.generateCompileCommands` | Generate compile_commands.json | For clangd |
| `vscodeUEHelper.createProject` | Create Unreal Clangd Project | Scaffold `.clangd` + customization |
| `vscodeUEHelper.toggleCompletionMode` | Toggle Clangd Completion Mode | Fast ⇄ Slow |
| `vscodeUEHelper.showProjectInfo` | Show Project Info | Detect results |
| `vscodeUEHelper.setSystemIncludes` | Set System Includes (Windows) | Phase 6 placeholder |
| `vscodeUEHelper.installRules` | Install AI Agent Rules | Cursor + Copilot |
| `vscodeUEHelper.uninstall` | Uninstall (Clean Generated Files) | Reverse of `createProject` |

## Development

```bash
npm run build              # esbuild → out/extension.js (57.8kb)
npm run typecheck          # tsc --noEmit
npm run lint               # ESLint
npm run format:check       # Prettier
npm run test:unit          # Vitest (18 tests)
npm run package            # vsce package → .vsix
```

## Requirements

- VS Code 1.85+
- Node.js 18+
- Unreal Engine 5.2+ (for runtime use)
- clangd extension (`llvm-vs-code-extensions.vscode-clangd`) — auto-installed as Extension Pack dependency

## Architecture

```
src/
├── extension.ts                 # Entry point — wires 5 modules
├── core/                        # Logger, Config, command-registry
├── detection/                   # uproject scan, engine discovery, vswhere
├── build/                       # UBT CLI, runner, live coding, launch editor
├── clangd/                      # compile_commands, .clangd, preparse, backup
├── parsers/                     # MSVC, UBT, linker, uproject JSON
├── ui/                          # Status bar, quickPicks, problems panel
├── commands/                    # 12 command handlers
├── mcp/                         # MCP server (auto-enabled in Cursor)
└── rules/                       # AI agent rule generators
```

## License

MIT