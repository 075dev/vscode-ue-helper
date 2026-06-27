# Plan: VSCodeUEHelper —— 集成 engine-link + unreal-clangd 功能的 VS Code 插件

**Source**: User request — 学习 `https://github.com/rmoubayed/engine-link` 与 `https://github.com/boocs/unreal-clangd` 两个项目,创建一个整合两者功能的插件
**Selected Milestone**: Phase 0 (Foundation) → Phase 7 (Release)
**Complexity**: Medium-Large
**Status**: Confirmed by user (2026-06-24)

---

## Summary

构建一个 VS Code 原生 Unreal Engine C++ 开发插件,集成 UBT 构建/重建/清理、Live Coding 热重载、clangd 极速 IntelliSense、`.uproject` 与引擎自动发现、跨平台支持(Windows/Mac/Linux),以及可选的 MCP AI agent 集成(在 Cursor/Claude Code 中自动启用)。借鉴 engine-link 的构建管线与检测层设计,以及 unreal-clangd 的 clangd 集成经验,但代码完全自写以避免版本耦合。

---

## Source Project Analysis

### rmoubayed/engine-link
- **类型**: Cursor IDE 扩展(Windows-only)
- **核心功能**: UBT 构建、Live Coding、自动检测引擎/项目、Cursor MCP 集成、`.clangd` 管理、状态栏 + Problems 面板
- **技术栈**: TypeScript + esbuild + VS Code Extension API + MCP SDK + Vitest
- **目录**: `src/{build,commands,config,cursor,detection,mcp,parsers,platform,ui}/`
- **借鉴**: 检测层、构建层、MSVC 解析、MCP 集成、`.clangd` 配置策略

### boocs/unreal-clangd
- **类型**: VS Code 扩展(跨平台, v3.4.1)
- **核心功能**: clangd IntelliSense、`compile_commands.json` 维护、preparse-includes 宏补全(快/慢两档)、`.code-workspace` 备份/恢复(对抗 UBT 刷新覆盖)、状态栏切换、Windows SDK 设置
- **技术栈**: TypeScript + clangd + UBT + PowerShell 7 + XState + neverthrow
- **借鉴**: 宏补全头列表管理、工作区备份机制、状态栏模式切换、卸载清理

---

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Naming | engine-link `src/commands/build.ts` | 命令 ID `vscodeUEHelper.<verb>` (e.g., `vscodeUEHelper.build`) |
| Errors | unreal-clangd v4 | 使用 `neverthrow` `Result<T, E>` 而非 try/catch,集中错误类型在 `core/errors.ts` |
| Logging | engine-link `src/ui/outputChannel.ts` | 单一 `OutputChannel`,带分级 `[INFO]/[WARN]/[ERROR]` 前缀 |
| Detection | engine-link `src/detection/` | 检测 → 缓存到 `Memento` → 用户可通过 QuickPick 覆盖 |
| Tasks | engine-link `src/build/taskProvider.ts` | 实现 `vscode.TaskProvider` 让 `Ctrl+Shift+B` 原生集成 |
| Config | engine-link `src/config/` | TypedSettings 强类型包装 `vscode.workspace.getConfiguration` |
| Backup | unreal-clangd `src/workspaceBackup.ts` | UBT 修改前快照 → FileSystemWatcher 检测修改 → 自动恢复 |

---

## Technology Stack

| Dimension | Choice | Reason |
|---|---|---|
| Language | TypeScript 5.x (strict) | Source projects use TS, official VS Code language |
| Bundler | esbuild | Engine-link validated, fast startup |
| VS Code Engine | `^1.85.0` | Supports MCP, Language Model Tool API |
| Testing | Vitest + @vscode/test-electron | Engine-link uses Vitest |
| Async Errors | `neverthrow` `Result<T,E>` | Unreal-clangd v4 pattern |
| State Machine | XState (optional) | For detection / UI flows |
| MCP | `@modelcontextprotocol/sdk` | Engine-link uses |
| Process | `execa` | Cross-platform shell |
| File Watch | `vscode.workspace.createFileSystemWatcher` | Native API |

---

## Files to Create (across all phases)

### Phase 0: Foundation
- `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `vitest.config.ts`, `.eslintrc.json`, `.prettierrc`, `.gitignore`
- `src/extension.ts` (activation entry stub)

### Phase 1: Detection
- `src/detection/{uprojectScanner,engineDiscovery,vsBuildTools,workspaceContext}.ts`

### Phase 2: Build
- `src/build/{ubt,buildRunner,liveCoding,launchEditor,taskProvider}.ts`
- `src/parsers/{msvcParser,ubtParser,linkerParser,uprojectParser}.ts`

### Phase 3: Clangd
- `src/clangd/{compileCommands,clangdConfig,preparseIncludes,addCompletions,workspaceBackup,systemIncludes,completionMode}.ts`
- `resources/preparse-includes/ue5-{fast,slow}.json`

### Phase 4: UI/Commands
- `src/ui/{statusBar,quickPicks,problemsPanel,outputChannel,notifications}.ts`
- `src/commands/*.ts` (11 handlers)
- `src/core/{logger,config,errors,paths}.ts`

### Phase 5: MCP
- `src/mcp/{server,tools,lifecycle}.ts`
- `src/rules/{cursorRules,copilotRules}.ts`

### Phase 6: Tests + Docs
- `test/unit/**/*.test.ts`, `test/integration/**/*.test.ts`, `test/fixtures/**/*`
- `README.md`, `CHANGELOG.md`

### Phase 7: Release
- `resources/{icon,banner}.png`, `.vscodeignore`

---

## Tasks (Phased)

1. **Phase 0 — Foundation**: npm init, deps, configs, extension.ts stub
2. **Phase 1 — Detection**: uproject scan, engine discovery (Win/Mac/Linux), VS Build Tools
3. **Phase 2 — Build**: UBT CLI, buildRunner, Live Coding, launch, parsers, TaskProvider
4. **Phase 3 — Clangd**: compile_commands.json, .clangd, preparse includes, workspace backup
5. **Phase 4 — UI/Commands**: status bar, quickPicks, 11 commands, core utilities
6. **Phase 5 — MCP**: server, tools, lifecycle detection, rule generation
7. **Phase 6 — Tests & Docs**: unit + integration tests, fixtures, README, CHANGELOG
8. **Phase 7 — Release**: marketplace icon, banner, vsce packaging

---

## Validation

```bash
npm run build            # esbuild → out/extension.js
npm run typecheck        # tsc --noEmit
npm run test:unit        # Vitest
npm run test:integration # @vscode/test-electron
npm run lint             # ESLint
npm run package          # vsce package → .vsix
# Manual: F5 in VS Code → Extension Development Host
```

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| UE 5.8 dropped response files | High | Detect UBT output, `--no-rsp-files` flag |
| Windows registry permission | Medium | `vscodeUEHelper.engineRoot` manual override |
| clangd vs MSVC IntelliSense conflict | Medium | README: disable cpptools IntelliSense, keep debug |
| Live Coding unstable on Mac/Linux | High | `when: isWindows`; docs note Windows-only |
| Multi-version engine conflicts | Medium | QuickPick force selection; workspaceState cache |
| MCP SDK cross-version breaks | Low | Lock major; CI tests Cursor + Claude Code |
| Engine-link config namespace clash | Low | Use `vscodeUEHelper.*` namespace |
| Process spawn hanging on Windows | Medium | `execa` with timeout + cleanup on deactivate |

---

## Acceptance

- [ ] All 8 phase tasks complete
- [ ] `npm run build` no errors
- [ ] `npm test` passes, coverage ≥ 80%
- [ ] Extension activates in VS Code 1.85+
- [ ] On sample .uproject: auto-detect engine, build via `Ctrl+Shift+B`, errors in Problems panel, clangd indexes UE headers, UCLASS/UPROPERTY autocomplete, status bar shows project info
- [ ] Live Coding works on Windows
- [ ] `.code-workspace` survives UBT refresh
- [ ] `Create Unreal Clangd Project` scaffolds new project
- [ ] `Uninstall` cleans all generated files
- [ ] (Optional) MCP tools callable by AI in Cursor
- [ ] README complete with screenshots
- [ ] `.vsix` installs successfully