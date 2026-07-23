# Codebase Structure

**Analysis Date:** 2026-07-23

## Directory Layout

```
VSCodeUEHelper/                                       # 根目录 D:/AIWorkSpace/VScodePlugin/VSCodeUEHelper
├── src/                       # TypeScript 源码 (137 .ts 文件)
│   ├── extension.ts            # 唯一 VS Code 扩展入口 (activate / deactivate)
│   ├── core/                   # 横切基础设施 (Logger, Config, WorkspaceState, command-registry)
│   │   └── types/              # 共享类型 (diagnostic.ts)
│   ├── detection/              # .code-workspace 信任模型检测 (project + engine 解析)
│   ├── build/                  # UBT 构建 + Live Coding + Editor 启动 (扁平,无 DDD 三层)
│   │   └── domain/             # DDD 参考骨架 (entities / value-objects / events / repositories) — 仅参考,非生产路径
│   ├── clangd/                 # .clangd / compile_commands.json / UE 宏补全 (顶层)
│   │   ├── compileCommands/    # 生成任务的纯函数子模块 (task.ts)
│   │   ├── diagnostics/        # Diagnose Clangd Project 命令的内部检查器
│   │   └── proxy/              # 独立 LSP 代理 CLI 进程 (17 文件, esbuild 第二 bundle 入口)
│   ├── parsers/                # 纯函数输出解析器 (msvc, ubt, linker, uproject)
│   ├── commands/               # 19 个命令处理器 + 1 个 firstRunInit orchestrator + 1 个 _resolve
│   ├── ui/                     # 状态栏 (11 按钮) / QuickPick / 通知 / Problems / ControlPanel Webview
│   ├── mcp/                    # MCP 服务器 (仅 Cursor / Claude Code 环境激活)
│   ├── rules/                  # AI Agent 规则生成 (Cursor .mdc + Copilot instructions)
│   └── i18n/                   # 国际化: index.ts + locales/{en,zh}.json
│
├── test/                       # Vitest 单元测试 (72 .test.ts 文件, ~12k 行)
│   └── unit/                   # 测试入口 (vitest.config.ts 锁定 test/unit/**/*.test.ts)
│       ├── core/               # workspace.test.ts (284 行, 12 行为测试) + ssot.test.ts (142 行, 13 回归守卫)
│       ├── detection/
│       ├── build/domain/       # ubt-task.entity.test.ts
│       ├── clangd/             # 镜像 src/clangd/ 布局 + compileCommands/ + proxy/ (e2e 套件)
│       ├── commands/
│       ├── parsers/
│       ├── ui/
│       ├── mcp/
│       ├── i18n/
│       └── setup.ts            # Vitest setup — mock chokidar
│
├── resources/                  # 静态资源 (打进 .vsix)
│   ├── icon.png
│   ├── preparse-includes/      # UE 预解析头列表 (fast.json 已删除, 仅 slow 保留)
│   │   └── ue5-slow.json
│   └── README.md               # 已知过时: 还提到 ue5-fast.json + 缺失的 banner.png
│
├── scripts/                    # 维护脚本 (不进 .vsix)
│   ├── clean-out.mjs           # 清 out/src + out/test 防 .vsix 残留
│   ├── extract-ue-docs.ts      # UE 源码头注释抽取 (npx tsx 跑) → 给 proxy/ueDocLookup 用
│   ├── measure-proxy-overhead.mjs  # LSP 代理 P50/P95/P99 + RSS 采样 (perf:baseline/after/diff)
│   ├── check-i18n.cjs / check-i18n-v2.cjs  # i18n key 同步检查
│   ├── find-hardcoded.cjs / find-hardcoded-v2.cjs  # 硬编码字符串扫描
│   ├── cov-matrix.cjs          # 覆盖率矩阵
│   └── gen-icon.ps1            # 图标生成 (PowerShell)
│
├── out/                        # esbuild 构建产物 (git-ignored)
│   ├── extension.js            # 主 bundle (vscode 标 external)
│   ├── extension.js.map
│   ├── clangdProxy.js          # 第二 bundle (零 vscode 依赖, Node CLI)
│   ├── clangdProxy.js.map
│   ├── package.json            # vsce 写入的简化 package.json
│   └── launcher/
│       └── proxy-launcher.bat  # Windows 启动器 (Unix .sh 已被 N2 死代码清理删除)
│
├── coverage/                   # v8 覆盖率报告 (vitest --coverage, 阈值 80/80/75/80)
│
├── doc/                        # 旧文档 (与 .planning/ 重叠; 部分内容已过时)
│
├── .vscode/                    # 编辑器配置
│   ├── launch.json             # F5 → Run Extension 配置
│   ├── tasks.json              # npm scripts 包装成 VS Code Task
│   ├── settings.json           # Prettier + ESLint + clangd 推荐
│   └── extensions.json         # 推荐扩展 (Prettier / ESLint / clangd / TS Next)
│
├── .planning/                  # GSD 计划 + 本次生成的 codebase 文档
│   └── codebase/
│       ├── ARCHITECTURE.md
│       └── STRUCTURE.md
│
├── .codegraph/                 # 本地代码图索引 (git-ignored)
├── .hermes/                    # Hermes Agent 工作区记忆 (git-ignored)
├── .serena/                    # Serena 工具缓存 (git-ignored)
│
├── AGENTS.md                   # 仓库知识库 (中文, agent 入口) — 入口顺序 / 陷阱 / 模块索引
├── README.md                   # 用户面向 README
├── CHANGELOG.md
├── AUDIT-REPORT.md             # Phase 0 审计
├── REMEDIATION-PLAN.md         # H1-H4 死代码 / 重复代码清理计划
│
├── package.json                # 扩展清单 (platforms: ["win32"], contributes.commands 21 个)
├── package-lock.json
├── tsconfig.json               # strict + path aliases (无 @rules / @platform)
├── esbuild.config.mjs          # 双 bundle 构建 (extension + clangdProxy + launcher.bat)
├── vitest.config.ts            # Vitest + v8 coverage 阈值 80/80/75/80
├── .eslintrc.json              # 锁定 3 类 syntax bypass + 1 类 import bypass
├── .prettierrc
├── .gitignore
├── .gitattributes
├── .vscodeignore               # 排除 src/ test/ *.mjs AGENTS.md .planning/ 等
└── LICENSE
```

## Directory Purposes

**`src/`**
- Purpose: TypeScript 源码根目录
- Contains: 137 个 `.ts` 文件 + 每个模块的 `AGENTS.md`
- Subdirectories: 11 个 (`core/`, `detection/`, `build/`, `clangd/`, `parsers/`, `commands/`, `ui/`, `mcp/`, `rules/`, `i18n/`, `extension.ts`)
- 关键文件: `src/extension.ts` (唯一入口)

**`src/core/`**
- Purpose: 横切基础设施,**无 `index.ts`**(设计如此,通过 `@core/<name>` 路径别名导入)
- Contains: `logger.ts` (36 src imports), `config.ts` (22 src imports), `workspace.ts` (Phase 8 SSoT, 31 src-callers), `command-registry.ts` (vscode.commands 包装), `runtime-detect.ts`, `core/types/diagnostic.ts`
- Subdirectories: `types/`

**`src/detection/`**
- Purpose: `.code-workspace` 信任模型检测 (不做文件系统扫描)
- Contains: `index.ts` (`activateDetection`), `uprojectScanner.ts`, `engineDiscovery.ts`, `vsBuildTools.ts`, `workspaceContext.ts` (持久化), `workspaceFolders.ts` (role 分配), `types.ts`

**`src/build/`**
- Purpose: UBT 命令构造 + 进程执行 + 诊断解析 + Task Provider + Live Coding + Editor 启动
- Contains: `index.ts`, `ubt.ts`, `buildRunner.ts`, `taskProvider.ts`, `liveCoding.ts`, `launchEditor.ts`, `types.ts`
- Subdirectories: `domain/` (DDD 参考骨架,**非生产路径**)
- 备注: `application/` 和 `infrastructure/` 空壳已被 H3 决策删除,业务代码继续从 `@build` 顶层 import

**`src/build/domain/`**
- Purpose: DDD 参考骨架 (entities / value-objects / events / repositories)
- Contains: `entities/ubt-task.entity.ts` (含完整测试), `value-objects/{build-configuration,build-platform,build-target,ubt-task-id}.vo.ts`, `events/{ubt-task-created,ubt-task-completed}.event.ts`, `repositories/ubt-task.repository.ts`
- 状态: 仅供未来 DDD 迁移参考;何时重新引入 `application/` / `infrastructure/` 待业务复杂度增长时再评估

**`src/clangd/`**
- Purpose: clangd 集成 (`.clangd` 写通过 `ClangdOps`,compile_commands.json 生成,UE 宏补全,系统包含发现)
- Contains (27 个顶层文件): `index.ts` (`activateClangd`), `clangdOps.ts` (Phase 8 SSoT), `clangdConfig.ts` (default + render), `compileCommands.ts` / `compileCommandsCache.ts` / `compileCommandsFallback.ts`, `completionMode.ts` (locked to slow), `completionFiles.ts`, `preparseIncludes.ts`, `workspaceBackup.ts`, `windowsSdk.ts`, `ueClangdCompat.ts`, `ueMacroCompletion*.ts`, `ueReflectionLinter*.ts`, `proxyManager.ts`, `fileWatcher.ts`, `intermediateUhtCollector.ts`, `headerCache.ts`, `fingerprint.ts`, `flagGlossary.ts`, `perfLog.ts`, `perfProxy.ts`, `proxyLogChannel.ts`, `proxyLogTailer.ts`, `ueLinkManager.ts`, `uhtGeneration.ts`, `createRspMatchers.ts`, `modifyRspFiles.ts`, `diagnoseProject.ts`
- Subdirectories: `compileCommands/` (`task.ts`), `diagnostics/` (内部检查器 4 文件,无 index.ts), `proxy/` (17 文件,独立 CLI)

**`src/clangd/proxy/`**
- Purpose: 独立 LSP 代理 CLI 进程
- 关键: **不由主扩展加载**,无 `index.ts`(设计),不能 `import 'vscode'`
- 入口: `cli.ts` (esbuild 第二 bundle 的 entryPoint)
- 测试: 17 个测试文件 (最大单测套件),含 `e2eHarness.test.ts` (584 行)

**`src/parsers/`**
- Purpose: 纯函数输出解析器
- Contains: `msvcParser.ts` (与 `package.json#contributes.problemMatchers` 共用正则, Pitfall #7), `ubtParser.ts`, `linkerParser.ts`, `uprojectParser.ts` (json5 包装)

**`src/commands/`**
- Purpose: 19 个 VS Code 命令处理器 + 1 个 firstRunInit orchestrator + 1 个 _resolve 参数解析器
- Contains: 22 个 `.ts` 文件
- 标准签名: `export async function executeXxx(config, logger, detection, ...): Promise<void>`

**`src/ui/`**
- Purpose: 用户界面 (状态栏 + QuickPick + 通知 + Problems + ControlPanel Webview)
- Contains: `index.ts` (`activateUI`), `statusBar.ts` (11 按钮固定布局), `quickPicks.ts`, `notifications.ts`, `problemsPanel.ts`, `outputChannel.ts`, `controlPanel.ts` + `controlPanel.html.ts` + `controlPanelMessages.ts`, `projectExplorer.ts` + `projectExplorerFs.ts` + `projectExplorerModel.ts`, `perfStatusBar.ts`

**`src/mcp/`**
- Purpose: MCP 服务器,**仅在 Cursor / Claude Code 环境自动启用**
- 环境检测: `process.env.CURSOR_TRACE_ID || CURSOR_USER_DATA_DIR || CLAUDE_CODE_ENTRYPOINT || CLAUDE_CODE_SSE_PORT`
- Contains: `index.ts` (env check + activateMcp), `server.ts` (@modelcontextprotocol/sdk stdio), `tools.ts` (6 工具), `lifecycle.ts`

**`src/rules/`**
- Purpose: AI agent 规则文件生成 (Cursor .mdc + Copilot instructions)
- Contains: `cursorRules.ts` (export `UE_HELPER_RULES_MDC`, `UE_HELPER_COPILOT_INSTRUCTIONS`), `index.ts`
- 备注: `@rules` 路径别名在 `AGENTS.md` 文档中提及但**未在 `tsconfig.json` / `esbuild.config.mjs` / `vitest.config.ts` 中注册**;目前通过相对路径在 `src/rules/` 内部或经 `mcp` 访问

**`src/i18n/`**
- Purpose: 双语字符串
- Contains: `index.ts` (`initI18n()` + `t(key, params)`), `locales/en.json`, `locales/zh.json`
- 约束: `initI18n()` 必须在 `activate()` 第一个调用

**`test/unit/`**
- Purpose: Vitest 单元测试
- 入口: `test/unit/**/*.test.ts` (由 `vitest.config.ts` 锁定)
- Setup: `test/unit/setup.ts` mock chokidar (Pitfall #6,否则 fileWatcher 测试启动真实 fs watcher 卡住进程)
- 镜像: 与 `src/` 1:1 镜像目录布局 (除 `test/unit/clangd/proxy/` 17 个文件外),每个 `src/<module>/X.ts` 对应 `test/unit/<module>/X.test.ts`
- 已知遗留: `test/unit/commands/clangdProxyCommands.test.ts.bak` (手备份,`.gitignore` 未排除,Pitfall #4)

**`resources/`**
- Purpose: 静态资源 (打进 `.vsix`)
- 关键: `icon.png`, `preparse-includes/ue5-slow.json` (fast.json 已删除, Pitfall #2/11)
- 已知问题: `resources/README.md` 描述过时,仍提 `ue5-fast.json` + 缺失的 `banner.png`

**`scripts/`**
- Purpose: 维护脚本 (不进 `.vsix`)
- 关键: `clean-out.mjs`, `extract-ue-docs.ts`, `measure-proxy-overhead.mjs`
- 其它: `check-i18n*.cjs`, `find-hardcoded*.cjs`, `cov-matrix.cjs`, `gen-icon.ps1`

**`out/`**
- Purpose: esbuild 构建产物
- 产物: `extension.js` (主,vscode external) + `clangdProxy.js` (独立 CLI) + `launcher/proxy-launcher.bat`
- Source maps: `*.js.map` (生产构建会去掉)
- `npm run clean` 只删 `out/src/` + `out/test/`(防 `.vsix` 残留),**不删** `out/extension.js` (Pitfall #9)

**`coverage/`**
- Purpose: v8 覆盖率报告 (`vitest --coverage`)
- 阈值: 80/80/75/80 (lines/functions/branches/statements),见 `vitest.config.ts`
- 排除: `src/extension.ts`, `src/**/*.d.ts`

**`.planning/`**
- Purpose: GSD 计划目录
- 包含: `codebase/ARCHITECTURE.md`, `codebase/STRUCTURE.md` (本次任务生成),加其它 phase 文档
- Git: 保留(项目仓库)

**`AGENTS.md`**
- Purpose: 仓库知识库(中文,LLM agent 入口)
- 关键: 入口顺序(硬约束)、Phase 8 + 9 架构总结、12 个 Pitfall、风格约定、新增命令 4 步流程

## Key File Locations

**Entry Points:**
- `src/extension.ts` — VS Code 扩展主入口(activate / deactivate)
- `src/clangd/proxy/cli.ts` — 独立 LSP 代理 CLI 入口(esbuild 第二 bundle)
- `src/commands/firstRunInit.ts` — `runFirstTimeInit`,首次激活的 fire-and-forget orchestrator
- `test/unit/setup.ts` — Vitest setup(必须,否则 fileWatcher 测试卡死)

**Configuration:**
- `package.json` — 扩展清单(`platforms: ["win32"]`, `contributes.commands` 21 条, `contributes.problemMatchers` MSVC 正则)
- `tsconfig.json` — strict + 11 个 path aliases
- `esbuild.config.mjs` — 双 bundle 构建配置
- `vitest.config.ts` — Vitest + 覆盖率阈值
- `.eslintrc.json` — 锁定 3 类 syntax bypass + 1 类 import bypass (SSoT 守卫)
- `.prettierrc`
- `.gitignore` / `.gitattributes` / `.vscodeignore`

**Core Logic (Phase 8 + 9 SSoT):**
- `src/core/workspace.ts` — `WorkspaceState`(31 src-callers,Level 0-3 getter 层级,`selectedProject` / `selectedEngine` 持久化)
- `src/clangd/clangdOps.ts` — `ClangdOps` (Phase 8 SSoT, 9 src-callers, `readConfig / exists / writeFull / mutate / applyAddFlags`)
- `src/core/logger.ts` — `Logger` 共享单例, `[moduleName]` 前缀
- `src/core/config.ts` — `vscodeUEHelper.*` 设置代理, `update(key, value)` 写后自动 refresh
- `src/core/command-registry.ts` — `registerCommand(context, id, fn)` 自动 push 到 subscriptions

**Module Activators:**
- `src/detection/index.ts` — `activateDetection`
- `src/build/index.ts` — `activateBuild`
- `src/clangd/index.ts` — `activateClangd`
- `src/ui/index.ts` — `activateUI`
- `src/commands/index.ts` — `activateCommands` (19 命令注册,必须最后)
- `src/mcp/index.ts` — `activateMcp` (env check)

**UI Surface:**
- `src/ui/statusBar.ts` — 11 状态栏按钮
- `src/ui/quickPicks.ts` — 引擎/配置/目标选择器
- `src/ui/problemsPanel.ts` — `DiagnosticManager` 写 VS Code Problems
- `src/ui/controlPanel.ts` — ControlPanel Webview provider

**Clangd proxy:**
- `src/clangd/proxy/cli.ts` — CLI 入口(parseArgs + LspBridge + ProcessBridge)
- `src/clangd/proxy/bridge.ts` — LspBridge (JSON-RPC 转发 + 拦截)
- `src/clangd/proxy/processBridge.ts` — ProcessBridge (spawn 真实 clangd)
- `src/clangd/proxy/ueDiagnosticWatcher.ts` — Phase 8 被动 UBT 重建触发器

**Tests (SSoT 守卫):**
- `test/unit/core/workspace.test.ts` (284 行) — 12 个 `WorkspaceState` 行为测试
- `test/unit/core/ssot.test.ts` (142 行) — 13 个 SSoT 回归守卫(防止 `detection.workspaceContext.*` 直读复活)
- `test/unit/clangd/proxy/e2eHarness.test.ts` — 584 行 e2e 套件

**Documentation:**
- `AGENTS.md` — 中文仓库知识库(LLM agent 主入口)
- `README.md` — 用户面向
- `CHANGELOG.md`
- `AUDIT-REPORT.md` — Phase 0 审计
- `REMEDIATION-PLAN.md` — H1-H4 清理计划
- `doc/` — 旧文档(部分过时)
- `src/<module>/AGENTS.md` — 每个模块的子 AGENTS.md

## Naming Conventions

**Files:**
- `kebab-case.ts` — 大多数模块文件(`clangdConfig.ts`, `compileCommands.ts`)
- `camelCase.ts` — 复合词(`fileWatcher.ts`, `ueMacroCompletionProvider.ts`)
- `PascalCase` 后缀 — 类型 / 类 / 抽象 (`WorkspaceState` 类在 `workspace.ts`; UBT task entity 在 `ubt-task.entity.ts`)
- `*.entity.ts` / `*.vo.ts` / `*.event.ts` / `*.repository.ts` — DDD 子目录(`src/build/domain/`)
- `*.test.ts` — Vitest 测试(强制后缀)
- `*.bak` — 已知手备份(应避免,见 Pitfall #4)
- `AGENTS.md` — 每个模块知识库(中文)
- `UPPERCASE.md` — 仓库级文档(`AGENTS.md`, `README.md`, `CHANGELOG.md`, `LICENSE`)

**Directories:**
- `kebab-case` — 复合词(`compile-commands`, `preparse-includes`, `vscode-ue-helper`)
- 单数名词 — 概念目录(`src/build/`, `src/core/`, `src/clangd/`, `src/detection/`)
- 复数 — 集合(`resources/`, `scripts/`, `commands/`, `locales/`)
- `domain/` / `application/` / `infrastructure/` — DDD 分层命名(目前 `domain/` 是参考,后两个空壳已删)
- `tests` 镜像布局: `test/unit/<mirror-of-src>/<file>.test.ts`

**Special Patterns:**
- 模块入口: `index.ts`(`src/<module>/index.ts` 导出 `activate*` + 公共类型)。**例外**:`src/core/` 无 `index.ts`(用 `@core/<name>`);`src/clangd/proxy/` 无 `index.ts`(外部 clangd 扩展直调 cli bundle);`src/clangd/diagnostics/` 无 `index.ts`(从 `diagnoseProject.ts` 内部相对导入)
- 路径别名: `@core`, `@detection`, `@build`, `@clangd`, `@i18n`, `@parsers`, `@commands`, `@ui`, `@mcp`(9 个,**`@rules` 和 `@platform` 文档提及但未注册**,后者已死)
- 命令 ID: `vscodeUEHelper.<verb><Noun>` 全小写驼峰(`vscodeUEHelper.toggleCompletionMode` 已删,`vscodeUEHelper.build`, `vscodeUEHelper.createProject`)
- 导出函数命令实现: `executeXxx(config, logger, detection, ...)`(`executeBuild`, `executeCreateProject`, `executeLiveCoding`)
- 导出函数切换: `toggleXxx` / `enableXxx` / `disableXxx`(`toggleCompletionMode` 已删,`enableClangdProxy` / `disableClangdProxy` 保留)
- 日志前缀: `[moduleName]`(强制,见 `src/core/AGENTS.md`);模块内进一步细分加 `[subArea]`(`[detection] workspaceFile = ...`)
- 代码注释: **中文强制**(AGENTS.md 明文)
- i18n key: 点号分隔的命名空间(`ui.welcome.real`, `build.success`, `commands.project.create`)
- VS Code 资源 disposable: 必须 push 到 `context.subscriptions`(或用 `@core/command-registry` 自动处理)
- 故意不 await: `void foo()`(ESLint `no-floating-promises` `error` 级)

## Where to Add New Code

**New Command (4 步,见 `AGENTS.md` + `src/commands/AGENTS.md`):**
1. 定义: 在 `package.json#contributes.commands` 加 `{ command: 'vscodeUEHelper.xxx', title: '%commands.xxx.title%' }` (i18n key 形式)
2. 实现: `src/commands/xxx.ts` 写 `export async function executeXxx(config, logger, detection, ...): Promise<void>`
3. 注册: `src/commands/index.ts` 导入 + `registerCommand(context, 'vscodeUEHelper.xxx', () => executeXxx(...))`
4. i18n: `src/i18n/locales/{en,zh}.json` 加 `commands.xxx.*` 键(双份同步)
- 测试: `test/unit/commands/xxx.test.ts`(与命令文件同目录镜像)

**New Status Bar Button:**
- 实现: `src/ui/statusBar.ts` 在 `activateUI` 流程加新 `vscode.window.createStatusBarItem`
- 注册: 把 disposable push 到 `context.subscriptions` 或本模块的 `disposables` 数组
- 图标: VS Code Octicons,见 `src/ui/AGENTS.md` 表

**New Clangd/UBT Feature:**
- 业务代码: `src/<layer>/<feature>.ts`(扁平,不走 DDD `domain/` 路径)
- 派生路径: 加到 `src/core/workspace.ts` 的 Level 1-3 getter(必须经过派生规则审核)
- 写 `.clangd`: 走 `ClangdOps.mutate(...)`,**禁止** `path.join + fs.writeFile`
- 测试: `test/unit/<layer>/<feature>.test.ts`

**New MCP Tool:**
- 实现: `src/mcp/tools.ts` 加新工具定义 + handler
- 注册: `src/mcp/server.ts` 的 `setRequestHandler('tools/list', ...)` / `setRequestHandler('tools/call', ...)`
- 文档: `src/mcp/AGENTS.md` 工具表同步
- 测试: 0 测试现状,首测写在 `test/unit/mcp/tools.test.ts`(e2e 需手动启动 Cursor,不要写 mock e2e)

**New Completion File / Add Flag:**
- 单一写入点: `src/clangd/completionFiles.ts` 的 `createCompletionFiles()`
- `.clangd` `CompileFlags.Add` 调整: 走 `ClangdOps.mutate(ctx => { ctx.config.CompileFlags.Add.push(...) })`

**New AI Agent Rule:**
- 字符串: 加到 `src/rules/cursorRules.ts` 的 `UE_HELPER_RULES_MDC` (Cursor .mdc) 或 `UE_HELPER_COPILOT_INSTRUCTIONS` (Copilot)
- 触发命令: 已有 `commands/installRules.ts` (覆盖 .cursor/rules/*.mdc + .github/copilot-instructions.md)

**New Detection Source:**
- 实现: 加到 `src/detection/`,扩展 `DetectionHandles` (改 `src/detection/types.ts`)
- 等待消费方: 在 `WorkspaceState` 构造时增加一个新的 setter 或扩展 `setResult` 接收面
- 等待点: `activateUI` / `activateCommands` 内部已 `await detection.ready`

**New Path / Field on WorkspaceState:**
- 步骤: ①在 `src/core/workspace.ts` 加 getter;②`test/unit/core/workspace.test.ts` 加行为测试;③`test/unit/core/ssot.test.ts` 视情况加 SSoT 守卫;④同步更新 `src/core/AGENTS.md` 的 Level 1-3 字段表
- 约束: 不允许外部扩展字段;派生规则仅 `WorkspaceState` 内部可改

**Utilities (共享):**
- Logger 调用: `sharedLogger.info('[<module>] ...')` 来自 `@core/logger`
- 命令注册: `import { registerCommand } from '@core/command-registry'`
- 通知: `import { notifyInfo, notifyWarn, notifyError } from '@ui/notifications'`
- i18n: `import { t } from '@i18n'`
- 类型: `@core/types/diagnostic` 共享 `ParsedDiagnostic` 接口

## Special Directories

**`out/`**
- Purpose: esbuild 构建产物
- Source: 由 `esbuild.config.mjs` 生成 (`npm run build`)
- Committed: No (`.gitignore` 排除)
- 备注: 含 `out/extension.js` (主 bundle, vscode external) + `out/clangdProxy.js` (Node CLI) + `out/launcher/proxy-launcher.bat` (Windows 启动器)
- 陷阱: `npm run clean` 只删 `out/src/` + `out/test/`,**不删** `out/extension.js` (Pitfall #9)

**`coverage/`**
- Purpose: v8 覆盖率 HTML / lcov / text 报告
- Source: `vitest --coverage` (CI / `npm run test:unit -- --coverage`)
- Committed: No

**`.codegraph/` / `.hermes/` / `.serena/`**
- Purpose: 工具本地索引(代码图 / Agent 记忆 / Serena 缓存)
- Committed: No (`.gitignore` 排除)

**`doc/`**
- Purpose: 旧文档(与 `.planning/` 内容重叠)
- 状态: 部分过时,新文档以 `.planning/` 为准

**`node_modules/`**
- Purpose: 依赖
- Committed: No

**`scripts/`**
- Purpose: 维护脚本(不进 `.vsix`,`.vscodeignore` 排除)
- 关键: `clean-out.mjs` / `extract-ue-docs.ts` / `measure-proxy-overhead.mjs`

**`.planning/`**
- Purpose: GSD 计划 + codebase 映射文档
- Committed: Yes (项目仓库)
- 包含: `codebase/ARCHITECTURE.md`, `codebase/STRUCTURE.md`, 其它 phase 文档

## Quick Reference: 关键位置速查表 (LLM 用)

| 需求 | 位置 |
|---|---|
| 改入口激活顺序 | `src/extension.ts` (硬约束,见 `AGENTS.md`) |
| 改路径派生规则 | `src/core/workspace.ts` (Level 0-3 getter) |
| 改 `.clangd` 默认值 | `src/clangd/clangdConfig.ts` (default + render only) |
| 改 `.clangd` 写入逻辑 | `src/clangd/clangdOps.ts` (Phase 8 SSoT 单一入口) |
| 改 MSVC 错误解析 | `src/parsers/msvcParser.ts` **和** `package.json#contributes.problemMatchers` (保持同步, Pitfall #7) |
| 改 UBT 命令结构 | `src/build/ubt.ts` |
| 改状态栏按钮 | `src/ui/statusBar.ts` |
| 加新命令 | 4 步:`package.json` + `src/commands/<name>.ts` + `src/commands/index.ts` + `src/i18n/locales/{en,zh}.json` |
| 改代理 CLI 行为 | `src/clangd/proxy/cli.ts` (entry) + `src/clangd/proxy/bridge.ts` (消息) + `src/clangd/proxy/processBridge.ts` (spawn) |
| 改 MCP 工具 | `src/mcp/tools.ts` (env 检测在 `src/mcp/index.ts`) |
| 加 i18n 文案 | `src/i18n/locales/en.json` + `src/i18n/locales/zh.json` (双份同步) |
| 修 Pitfall | `AGENTS.md` 仓库陷阱 1-13 |
| 看模块知识 | `src/<module>/AGENTS.md` (有则读,无则看 `AGENTS.md` 总表) |
| 跑测试 | `npm run test:unit` (单测, Vitest);**不跑** `npm test` (Pitfall #1, integration 已坏) |
| 跑类型检查 | `npm run typecheck` (tsc --noEmit,必须零错误) |
| 跑 lint | `npm run lint` (ESLint 守 SSoT) |
| 测 LSP 代理开销 | `npm run perf:baseline` / `perf:after` / `perf:diff` (< 1% 偏差) |
| 打包发布 | `npm run package` → `.vsix` (prepackage 自动 build) |

---

*Structure analysis: 2026-07-23*
*Update when directories move, modules are added/removed, or build artifacts change.*
