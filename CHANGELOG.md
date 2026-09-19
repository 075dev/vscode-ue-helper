# Changelog

All notable changes to VSCodeUEHelper are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **控制面板按项目可用性收敛**：工作区未检测到 `.uproject` 时面板整体不可用——显示"未检测到 UE 项目"空状态（隐藏全部分页与按钮），仅保留"创建 UE 项目"入口；检测到项目后自动恢复。检测到项目但无引擎时，UBT 类按钮（构建/重构建/清理/启动编辑器/Live Coding/生成编译数据库）按适用度置灰，诊断/工具/代理类按钮仍可用。扩展侧 `executeCommand` 增加服务端兜底校验（webview 的 disabled 可被伪造消息绕过），无项目/无引擎时拒绝执行并回推原因。
- **控制面板按钮适用档位**：`BUTTON_GROUPS` 每个按钮声明 `requirement`（`always` / `project` / `engine`），由 `COMMAND_REQUIREMENT` 查表供 webview 渲染与扩展侧兜底共用，`panelState` 消息把项目/引擎存在性推到 webview 驱动刷新（检测完成、可见性恢复、用户切换项目/引擎选择时）。

- **未检测到项目时不再弹"从 .uproject 重新生成工作区"**：`WorkspaceState` 的字段缺失通知此前在任何派生字段（projectDir / projectName / engineRoot 等）被读取且缺失时都会弹警告——哪怕 detection 根本没发现 `.uproject`（非 UE 工作区的正常场景）。现在无项目时只写日志、绝不弹窗；仅当"检测到了项目但字段仍缺失"这种真实异常才提示。
- **未检测到项目时状态栏整体隐身**：`detection.ready` 未发现任何 `.uproject` 时，插件的全部状态栏项不再显示——8 个操作按钮（含原先仍会显示的 Config / Target / 项目信息）全部隐藏，UHT 状态项与性能三段指标（`showPerfInStatusBar` 开启时）也不再出现；检测到项目后按需出现。
- **UHT 状态项改版**：原右下角"UE Link Sync"状态项（`UE✓` / `UE Sync` / `UE throttle` 等缩写）迁移到**左下角项目信息按钮右侧**，文案统一为简短自解释的 "UHT" 系列——空闲 `✓ UHT`、排队 `✏ UHT…`、节流倒计时 `🕐 UHT in 3.2s`、生成中 `⟳ UHT…`、完成 `✓ UHT 850ms`、失败 `✗ UHT Failed`；tooltip 全部改为中文详细说明（UnrealHeaderTool 状态机、耗时、生成头文件数、节流合并统计）。
- **状态栏项目信息按钮精简为仅项目名**：左下角按钮不再拼接"引擎版本 | 平台"段，只显示 `$(file-code) 项目名`；引擎版本（含路径）与平台保留在悬停 tooltip 中，信息不丢失。平台设置变化后 tooltip 同步刷新（按钮文本只依赖项目名，无需重绘）。
- **进度弹窗可自动隐藏**：新增 `vscodeUEHelper.progressLocation` 设置（默认 `window`）——构建 / Create Project / 生成 compile_commands 的进度改在状态栏显示小转圈，任务结束自动消失，不再弹出右下角通知弹窗（VS Code 的通知进度没有"自动折叠"API，状态栏位置是标准的不打扰方案）；设为 `notification` 可恢复旧的右下角弹窗行为。

### Added

- **UE 惯例感知的源/头文件切换命令**：`vscodeUEHelper.switchHeaderSource`（快捷键 `Alt+O`，已挂编辑器右键菜单）。修复"从头文件切换经常跳到引擎 `ObjectMacros.h`"的问题——该症状来自 clangd 扩展 `clangd.switchSourceHeader` 的实现：它按"头文件符号在索引中的定义位置"投票选目标、平票取路径字典序最小者，UE 头文件符号定义分散且后台索引不完整时票源稀疏，`Engine/Source/Runtime/CoreUObject/Public/UObject/ObjectMacros.h` 的路径字典序几乎最靠前于是屡屡胜出（本插件预包含链进一步放大了引擎公共头在索引中的富集度）。新命令不依赖索引，改用确定性路径规则：同目录同 stem 互换扩展名 → `Public`↔`Private`↔`Classes` 目录互换（保留子路径，插件模块路径同样支持）→ `X.generated.h` 剥 `.generated` 双侧匹配 → `.inl` 对应主头文件 → workspace 同 stem 搜索兜底（排除 Intermediate/Binaries 等目录，多候选弹 QuickPick）。
- **编辑器感知构建**（借鉴 [engine-link](https://github.com/rmoubayed/engine-link) / [UE Build Bridge](https://marketplace.visualstudio.com/items?itemName=Alingkumo.unreal-engine-link) 的 editor-aware build）：`build` 前通过 `tasklist` 检测 Unreal Editor 是否运行，运行中则提示改走 Live Coding（避免 DLL 锁定失败），`editorAwareBuild` 设置可关闭；MCP / silent 调用自动跳过。
- **新增源文件提示刷新 compile_commands**（借鉴 [boocs/unreal-clangd](https://github.com/boocs/unreal-clangd)）：增量 watcher 现在区分 add/change/unlink，检测到新增 C++ 文件时按 10 分钟节流提示一键刷新编译数据库（`CompileCommandsRefreshHint`）。
- **MCP 工具扩到 9 个**（对齐 engine-link / UE Build Bridge 的工具面）：新增 `ue_rebuild`、`ue_clean`（独立工具名）与 `ue_get_build_errors` —— 返回最近一次构建的结构化诊断（error/warning 计数、出错文件去重、截断明细），让 AI 代理闭环"构建 → 读错误 → 修复"。
- **clang-tidy 行级屏蔽命令**（借鉴 boocs/unreal-clangd）：`vscodeUEHelper.noLintCurrentLine`（行尾 `// NOLINT`）与 `vscodeUEHelper.noLintNextLine`（上方 `// NOLINTNEXTLINE`），幂等跳过已屏蔽行，支持多光标，已挂编辑器右键菜单。
- **createProject 可选生成 .clang-format / .clang-tidy**（借鉴 boocs/unreal-clangd）：`scaffold.clangFormat`（默认开）与 `scaffold.clangTidy`（默认关）控制；只创建缺失项不覆盖已有配置；模板显式禁用会让 clang-tidy 在 Lyra 类项目崩溃的 `readability-static-accessed-through-instance`。
- **复制 UBT 构建命令**（借鉴 [vscode-boreal](https://github.com/mainframeindustries/vscode-boreal)）：`vscodeUEHelper.copyBuildCommand` 把当前项目/引擎/配置对应的 UBT 命令行（含 -Rebuild/-Clean）复制到剪贴板，便于在任意终端复现构建问题。
- **.clang-format 模板升级为 UE5 C++ 编码标准风格**：`scaffoldClangFormatAndTidy` 生成的 `.clang-format` 从"基础版"重写为对齐 Epic UE 编码标准 + 社区验证配置（[TensorWorks/UE-Clang-Format](https://github.com/TensorWorks/UE-Clang-Format)，MIT）的完整版——UE 反射宏识别（`StatementMacros`：GENERATED_BODY/UPROPERTY 等宏后的代码不再被错误缩进折行）、Allman 大括号（if/for/while 大括号换行）、Tab 缩进（4 宽，UE 标准）、case 标签/预处理指令/命名空间内容缩进、UE 枚举不折行、`ColumnLimit: 0` 不强制折行（UE_LOG/Slate 长表达式友好）、include 不自动排序（避免破坏编译语义）；需 clang-format/clangd ≥ 13（模板头已注明）。只影响新生成的文件，已存在的用户配置不覆盖。

### Fixed

- **Live Coding 不再打开新项目实例**：点击 Live Coding 按钮此前 spawn 一个不带 `-Project` 的全新 `UnrealEditor.exe`（`-ExecCmds` 方式）——UE 弹出项目管理器且热重载作用在错误实例上。已改为 UBT `-LiveCoding` 官方方式：直接连接正在运行的编辑器触发热重载，不弹任何新窗口（编辑器未运行时回退为普通构建）；编译期间进度实时可见、可取消，失败时弹出 UBT 输出尾部错误。
- **设置/命令/视图的中文说明从未生效（非标准本地化字段）**：`package.json` 此前用 `description@zh` / `title@zh` / `name@zh` 字段写中文——VS Code 会忽略这些非标准字段，中文用户在设置界面只看到英文；且中文语言文件误命名为 `package.nls.zh.json`（VS Code 只加载 `package.nls.zh-cn.json`）。已全量迁移到标准 nls 机制：`package.json` 用 `%key%` 占位符，`package.nls.json`（英文默认）与 `package.nls.zh-cn.json`（简体中文）提供翻译——覆盖 22 个设置项（含 `progressLocation` 的枚举描述与 `clangd.userAddFlags` 的 markdown 说明）、26 个命令标题、2 个侧边栏视图名。新增 `nlsPlaceholders.test.ts` 守护测试（占位符缺键/孤儿键/`@zh` 回归/文件名）防再次失效。
- **控制面板分页无法切换（webview 脚本被注释截断）**：`controlPanel.html.ts` 内联脚本注释中含字面 `</script` 序列——HTML 解析器据此在注释中间提前终止 `<script>` 块，整个 IIFE 从未执行，分页/按钮/保存/状态刷新全部失灵，残余脚本文本被当作正文渲染。已改写注释并加回归测试（生成的 HTML 必须恰好一对 script 开合标签）。
- **激活提示**: 补齐 `package.json#activationEvents` 的 18 个缺失 `onCommand` 事件,使全部 22 个命令 ID 在被点击时立即触发激活,不再显示 "Extension 'VSCodeUEHelper' is activating…"。仓库根 AGENTS.md 与 `src/commands/AGENTS.md` 同步把"在 `activationEvents` 加 `onCommand`"纳入新增命令铁律,避免回归。
- **typecheck 清零**: 修复 `firstRunInit.test.ts` 中 5 处 mock 谓词解构的历史类型错误，`npm run typecheck` 恢复零错误。

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
