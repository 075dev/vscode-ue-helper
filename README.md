# VSCodeUEHelper

> All-in-one VS Code plugin for Unreal Engine C++ development: UBT build, Live Coding hot-reload, clangd IntelliSense, optional MCP AI agent integration, and an embedded clangd LSP proxy with localization support.

## Governance

This project is **Windows-only** (see `package.json#platforms`). Unreal Engine 5.2+, the
MSVC toolchain, and the Windows SDK are hard requirements. All code comments are written
in Chinese by convention.

## Status

✅ **All 8 phases complete.** Ready for development use.

| Phase | Status | Feature                                                                                                   |
| ----- | ------ | --------------------------------------------------------------------------------------------------------- |
| 0     | ✅     | Project skeleton, command palette, configuration schema                                                   |
| 1     | ✅     | `.uproject` scanning, engine discovery (Windows-only), VS Build Tools detection                           |
| 2     | ✅     | UBT Build/Rebuild/Clean, Live Coding, MSVC parsing, Problems panel, Task provider                         |
| 3     | ✅     | clangd IntelliSense, `compile_commands.json`, `.clangd` config, preparse includes, workspace backup       |
| 4     | ✅     | Status bar, QuickPick pickers, **25 commands**                                                            |
| 5     | ✅     | MCP server (auto-enabled in Cursor / Claude Code), AI agent rules                                         |
| 6     | ✅     | Unit tests (Vitest, 870+ tests), CI-ready scripts                                                         |
| 7     | ✅     | clangd LSP proxy + control panel webview + preparse cache, perf instrumentation                           |
| 8     | ✅     | `WorkspaceState`（36 callers）+ `ClangdOps`（22 callers）统一架构、Phase 7/8/9 SSoT 收束                  |
| 9     | ✅     | 2026-09 生态调研吸收：编辑器感知构建、新增文件提示、MCP 9 工具、NOLINT、format/tidy 脚手架、复制 UBT 命令 |

## Inspiration

This plugin integrates patterns from two excellent open-source projects (both at their v3 versions):

- **[rmoubayed/engine-link](https://github.com/rmoubayed/engine-link)** — Cursor IDE extension: UBT build pipeline, live coding, engine auto-detection, MCP AI integration
- **[boocs/unreal-clangd](https://github.com/boocs/unreal-clangd/tree/v3)** — VS Code extension: clangd IntelliSense, `compile_commands.json` maintenance, workspace backup against UBT refresh, preparse-includes macro completion

Additional patterns are adopted from a 2026-09 ecosystem survey of similar projects:

- **[mainframeindustries/vscode-boreal](https://github.com/mainframeindustries/vscode-boreal)** — "Copy UBT Build Command" clipboard helper
- **[Alingkumo/unreal-engine-link (UE Build Bridge)](https://marketplace.visualstudio.com/items?itemName=Alingkumo.unreal-engine-link)** — editor-aware build suggestion, `get_build_errors` MCP tool
- **[microsoft/vc-ue-extensions](https://github.com/microsoft/vc-ue-extensions)** — reference for UE test/discovery integration direction

The code is written from scratch to avoid version-coupling, but the patterns are mirrored.

## Features

### Build Integration

- Build / Rebuild / Clean via UnrealBuildTool (`Ctrl+Shift+B` via TaskProvider)
- **Editor-aware build**: detects a running Unreal Editor before `build` and suggests Live Coding instead (avoids DLL lock errors); disable via `editorAwareBuild`
- **Copy UBT Build Command**: puts the exact UBT command line (incl. `-Rebuild`/`-Clean`) on the clipboard for terminal reproduction
- Live Coding hot-reload (`Ctrl+Alt+F11`)
- MSVC error parsing → Problems panel with file:line:col click-through
- Build progress in status bar notification
- Editor launch via `cmd /c start` (Windows-only spawn path)

### Engine & Project Detection

检测层**完全信任 `.code-workspace` 的 `folders[]`**，不做文件系统递归扫描（UE 项目体量大，扫描会卡顿）。`folders[]` 的 role 分配规则是硬编码的：

| `folders[]` 字段 | 角色      | 动作                                                       |
| ---------------- | --------- | ---------------------------------------------------------- |
| `path === '.'`   | `project` | 读取 `<name>.uproject`（JSON5 解析，支持 trailing commas） |
| `name === 'UE5'` | `engine`  | 读取 `Engine/Build/Build.version` 拿 `Major.Minor.Patch`   |
| 其他             | `unknown` | 忽略                                                       |

如果 `.code-workspace` 没打开，detection 直接返回空结果，UI 显示警告。

- **`.uproject` 解析**：`UprojectScanner` 用 `json5` 库解析（Epic 在 `.uproject` 里用了 trailing commas，标准 JSON 不支持）。
- **引擎版本读取**：`EngineDiscovery` 验证候选路径下存在 `Engine/Build/Build.version`，按版本号倒序去重。
- **系统包含路径发现**（仅 Windows）：`discoverSystemIncludes`（`src/clangd/windowsSdk.ts`）通过 clang/clangd 探测 MSVC 与 Windows SDK 的 include 路径，供 `.clangd` 的 `system-include-windows` flag 使用。
- **持久化用户选择**：`WorkspaceContext` 把"用户选定的项目路径 / 引擎路径"存到 `context.workspaceState`（VS Code Memento API），跨会话保留；下次打开同一工作区直接恢复。
- **`WorkspaceState` 统一读取入口**（Phase 8）：`src/core/workspace.ts` 把 detection 结果封装成 lazy 派生字段（`projectFolder` / `engineFolder` / `projectDir` / `engineDir` 等），所有消费模块统一从这里读，不再直接读 detection 句柄。

### Clangd IntelliSense

- Auto-generates `compile_commands.json` via UBT `-ProjectFiles` mode（含 fallback DB）
- Writes `.clangd` to suppress MSVC false positives + 注入 Intermediate/UHT 头目录
- Preparse-includes for UE macros（**slow 模式统一** — fast/slow 已合并为单一 slow,49 头文件列表）
- UE macro parameter completion (`UCLASS` / `UPROPERTY` / `UFUNCTION` / `USTRUCT` / `UENUM`) via managed `addMacroCompletions.h` — user code is preserved across refreshes
- **New-file compile_commands hint**: incremental watcher 区分 add/change/unlink，新增 .h/.cpp 时节流提示一键刷新编译数据库（借鉴 boocs/unreal-clangd）
- **clang-tidy NOLINT commands**: `noLintCurrentLine`（行尾 `// NOLINT`）/ `noLintNextLine`（上方 `// NOLINTNEXTLINE`），幂等 + 多光标 + 编辑器右键菜单
- **Optional `.clang-format` / `.clang-tidy` scaffold** in `Create Unreal Clangd Project`（已存在不覆盖；模板默认禁用 Lyra 崩溃检查 `readability-static-accessed-through-instance`）
- Workspace backup: `.code-workspace` survives UBT's `-ProjectFiles` refresh
- **`ClangdOps` 统一 .clangd 操作 API**：[Phase 8] 22 callers 用 `mutate / applyAddFlags / readConfig / exists / writeFull`；`setAddFlag / replaceAddBlock / setIndexBackground / updateSystemIncludes` 等细粒度 setter **不提供**——它们只是 mutate 闭包的固化。
- `Diagnose Clangd Project` command: scans `.clangd` / `compile_commands.json` / preparse / clangd binary / addCompletions + addMacroCompletions, 输出结构化 pass/warn/fail 报告
- **clangd LSP 代理**（独立进程,stdin/stdout JSON-RPC）：didClose keepalive、汉化（hover 词典）,`proxy-launcher.bat/sh` 自动生成

### MCP AI Agent Integration

- Auto-starts in Cursor / Claude Code (detected via env vars)
- 9 tools exposed: `ue_build`, `ue_rebuild`, `ue_clean`, `ue_get_build_errors`, `ue_launch_editor`, `ue_live_coding`, `ue_generate_compile_commands`, `ue_show_project_info`, `ue_set_system_includes`
- `ue_get_build_errors` returns the last build's structured diagnostics (severity totals, files-with-errors dedup, truncated details) so agents can close the "build → read errors → fix" loop
- Stdio transport via `@modelcontextprotocol/sdk`
- AI agent rules generated to `.cursor/rules/unreal-cpp.mdc` and `.github/copilot-instructions.md`

### Control Panel

- Webview 面板（`vscodeUEHelper.showControlPanel`）：Build/CompileCommands/Proxy 等快捷按钮
- 左下角状态栏：项目信息（仅项目名，悬停看引擎/平台）、UHT 状态（保存 .h 自动生成反射代码）、8 个操作按钮；可选性能三段指标（`showPerfInStatusBar`）。未检测到 `.uproject` 时以上状态项全部自动隐藏。
- `Set System Includes` (Windows) 自动设置 MSVC / Windows SDK include 路径

### User Project Setup

- `Create Unreal Clangd Project` command scaffolds `.clangd` + `.vscode/unreal-clangd/addCompletions.h` + `addMacroCompletions.h`
- `Uninstall` command cleans all generated files
- `Install AI Agent Rules` for Cursor / Copilot

## Installation (development)

```bash
git clone https://github.com/<your-org>/vscode-ue-helper.git
cd vscode-ue-helper
npm install
npm run build
# Press F5 in VS Code to launch Extension Development Host
```

## Configuration

Settings live under the `vscodeUEHelper.*` namespace.

| Setting                            | Type   | Default       | Description                                                                                                       |
| ---------------------------------- | ------ | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ueVersion`                        | string | `""`          | Preferred UE version (e.g., `5.4`). Empty = latest detected.                                                      |
| `configuration`                    | enum   | `Development` | Debug / DebugGame / Development / Shipping / Test                                                                 |
| `target`                           | enum   | `Editor`      | Editor / Game / Server / Client                                                                                   |
| `platform`                         | enum   | `Win64`       | Win64 / Mac / Linux                                                                                               |
| `clangdPath`                       | string | `""`          | Path to clangd binary. Empty = auto-detect.                                                                       |
| `autoBackupWorkspace`              | bool   | `true`        | Backup/restore `.code-workspace` against UBT refresh.                                                             |
| `editorAwareBuild`                 | bool   | `true`        | Detect a running Unreal Editor before build and suggest Live Coding instead.                                      |
| `progressLocation`                 | enum   | `window`      | Task progress UI: `window` = status bar spinner (auto-hides, no popup) / `notification` = bottom-right popup.     |
| `scaffold.clangFormat`             | bool   | `true`        | Create Project: scaffold base `.clang-format` (never overwrites).                                                 |
| `scaffold.clangTidy`               | bool   | `false`       | Create Project: scaffold base `.clang-tidy` (never overwrites).                                                   |
| `useMCP`                           | enum   | `auto`        | `auto` = only in Cursor/Claude Code. `always` / `never`.                                                          |
| `lspLoggingLevel`                  | enum   | `info`        | error / warn / info / debug                                                                                       |
| `clangdProxy.enabled`              | bool   | `false`       | Enable clangd LSP proxy (didClose keepalive + localization).                                                      |
| `clangdProxy.keepaliveMax`         | number | `20`          | Max keepalive documents.                                                                                          |
| `clangdProxy.keepaliveTtlSec`      | number | `900`         | Keepalive TTL (seconds).                                                                                          |
| `clangdProxy.realClangdPath`       | string | `""`          | Path to real clangd binary. Empty = auto-detect.                                                                  |
| `clangdProxy.localization.enabled` | bool   | `false`       | Enable hover localization (UE docs dict).                                                                         |
| `clangdProxy.localization.mode`    | enum   | `append`      | append = 中文追加 / zh-only = 仅中文                                                                              |
| `clangd.userAddFlags`              | array  | `[]`          | Custom flags injected into `.clangd` `CompileFlags.Add`.                                                          |
| `showPerfInStatusBar`              | bool   | `false`       | Show performance metrics (compile_commands gen time, preparse cache hit, incremental scan latency) in status bar. |

> **`completionMode` 设置已删除（H4-B 决策）**：fast/slow 模式已合并为统一 slow，无需切换。

## Commands

25 commands total. All bound to `vscodeUEHelper.*` namespace.

| Command                                  | Title                              | Notes                                      |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------ |
| `vscodeUEHelper.build`                   | Build                              | UBT build of selected target/config        |
| `vscodeUEHelper.rebuild`                 | Rebuild                            | Clean + Build                              |
| `vscodeUEHelper.clean`                   | Clean                              | Remove intermediates                       |
| `vscodeUEHelper.launchEditor`            | Launch Unreal Editor               | Windows spawn (`cmd /c start`)             |
| `vscodeUEHelper.liveCoding`              | Live Coding (Hot Reload)           | Triggers UE Live Coding                    |
| `vscodeUEHelper.generateCompileCommands` | Generate compile_commands.json     | For clangd                                 |
| `vscodeUEHelper.diagnoseProject`         | Diagnose Clangd Project            | First stop when clangd indexing is broken  |
| `vscodeUEHelper.createProject`           | Create Unreal Clangd Project       | Scaffold `.clangd` + customization         |
| `vscodeUEHelper.showProjectInfo`         | Show Project Info                  | Detection results                          |
| `vscodeUEHelper.setSystemIncludes`       | Set System Includes (Windows)      | Auto-discover MSVC + Win SDK paths         |
| `vscodeUEHelper.installRules`            | Install AI Agent Rules             | Cursor + Copilot                           |
| `vscodeUEHelper.uninstall`               | Uninstall (Clean Generated Files)  | Reverse of `createProject`                 |
| `vscodeUEHelper.openWorkspaceFile`       | Open `.code-workspace`             | Quick action                               |
| `vscodeUEHelper.selectConfig`            | Select Build Configuration         | QuickPick                                  |
| `vscodeUEHelper.selectTarget`            | Select Build Target                | QuickPick                                  |
| `vscodeUEHelper.enableClangdProxy`       | Enable Clangd LSP Proxy            | Toggle proxy on                            |
| `vscodeUEHelper.disableClangdProxy`      | Disable Clangd LSP Proxy           | Toggle proxy off                           |
| `vscodeUEHelper.showClangdProxyStatus`   | Show Clangd Proxy Status           | Diagnostics                                |
| `vscodeUEHelper.showControlPanel`        | Show Control Panel                 | Open webview                               |
| `vscodeUEHelper.copyBuildCommand`        | Copy UBT Build Command             | Clipboard helper for terminal reproduction |
| `vscodeUEHelper.noLintCurrentLine`       | Suppress clang-tidy (Current Line) | Appends `// NOLINT` (editor context menu)  |
| `vscodeUEHelper.noLintNextLine`          | Suppress clang-tidy (Next Line)    | Inserts `// NOLINTNEXTLINE` above          |

## Development

```bash
npm run build              # esbuild → out/extension.js (~826kb) + out/clangdProxy.js (~254kb) + launcher scripts
npm run typecheck          # tsc --noEmit
npm run lint               # ESLint src test
npm run format:check       # Prettier
npm run test:unit          # Vitest (1170 tests / 96 files, coverage ≥ 80/80/75/80)
npm run package            # vsce package → .vsix
npm run perf:baseline      # LSP proxy overhead sample → .vscode/clangd-perf-cache/proxy-baseline.json
npm run perf:after         # Same as above → proxy-after.json
npm run perf:diff          # Compare two JSON files (< 1% deviation = pass)
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
├── core/                        # Logger, Config, command-registry, WorkspaceState
├── detection/                   # uproject scan, engine discovery, workspace context
├── build/                       # UBT CLI, runner, live coding, launch editor
├── clangd/                      # compile_commands, .clangd, ClangdOps, preparse, proxy/
│   └── proxy/                   # Standalone LSP proxy CLI
├── parsers/                     # MSVC, UBT, linker, uproject JSON
├── ui/                          # Status bar, QuickPick, control panel webview
├── commands/                    # 21 command handlers
├── mcp/                         # MCP server (auto-enabled in Cursor)
├── rules/                       # AI agent rule generators
└── i18n/                        # en.json + zh.json
```

## License

MIT
