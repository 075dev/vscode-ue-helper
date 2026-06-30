---
date: 2026-06-30
generator: gsd-map-codebase (orchestrator fallback)
focus: arch — structure
---

# Structure — vscode-ue-helper

## Repo Layout

```
VSCodeUEHelper/                          ← 仓库根
├── .claude/                             ← Claude Code 项目指令（用户 / 项目级 memory）
├── .codegraph/                          ← CodeGraph MCP 索引
├── .codewiki/                           ← 旧 wiki 数据
├── .hermes/                             ← Hermes 助手数据
├── .omo/                                ← Omo 工作流残留
├── .vscode/                             ← VS Code 工程设置（调试此扩展用）
├── .vscodeignore                        ← 打包到 .vsix 时排除的文件清单
│
├── .eslintrc.json                       ← ESLint 配置
├── .gitattributes                       ← LFS / 行尾等
├── .gitignore
├── .prettierrc                          ← Prettier 配置
│
├── AGENTS.md                            ← 给 AI 协作者的项目说明（必须读）
├── ANALYSIS_detection_build.md          ← 历史分析文档
├── CHANGELOG.md                         ← 版本变更
├── README.md
│
├── esbuild.config.mjs                   ← esbuild 多入口构建脚本
├── package.json                         ← 扩展清单 + 依赖 + 脚本 + contributes
├── package-lock.json
├── tsconfig.json                        ← TS 路径别名 + strict 全部开
├── vitest.config.ts                     ← 测试配置 + 覆盖率阈值
│
├── analysis/                            ← 历史分析文档归档
├── doc/                                 ← 文档
│
├── node_modules/                        ← （gitignored）
├── out/                                 ← esbuild 编译产物（gitignored）
│
├── resources/
│   ├── icon.png                         ← 扩展图标
│   └── preparse-includes/
│       ├── ue5-fast.json                ← 精选 UE 头清单（fast 模式）
│       └── ue5-slow.json                ← 几乎全部 UE 头（slow 模式）
│
├── scripts/                             ← 通用脚本
├── temp_writer.js / temp_writer.mjs    ← 残留临时文件
├── vscode-ue-helper-0.1.0.vsix         ← 已发布的 .vsix 包（不应提交）
│
├── src/                                 ← 主源码目录
│   ├── extension.ts                     ← 扩展入口
│   │
│   ├── build/                           ← UBT / Editor / Live Coding
│   │   ├── AGENTS.md
│   │   ├── buildRunner.ts
│   │   ├── launchEditor.ts
│   │   ├── liveCoding.ts
│   │   ├── taskProvider.ts
│   │   ├── types.ts
│   │   ├── ubt.ts
│   │   └── index.ts
│   │
│   ├── clangd/                          ← clangd 集成（最大）
│   │   ├── AGENTS.md
│   │   ├── clangdConfig.ts
│   │   ├── compileCommands.ts
│   │   ├── completionFiles.ts
│   │   ├── completionMode.ts
│   │   ├── createRspMatchers.ts
│   │   ├── diagnoseProject.ts
│   │   ├── index.ts
│   │   ├── modifyRspFiles.ts
│   │   ├── preparseIncludes.ts
│   │   ├── proxyManager.ts
│   │   ├── types.ts
│   │   ├── ueClangdCompat.ts
│   │   ├── ueHelpers.ts
│   │   ├── ueMacroCompletionData.ts
│   │   ├── ueMacroCompletionProvider.ts
│   │   ├── ueMacroCompletions.ts
│   │   ├── windowsSdk.ts
│   │   ├── workspaceBackup.ts
│   │   │
│   │   ├── diagnostics/
│   │   │   ├── checks.ts
│   │   │   ├── format.ts
│   │   │   ├── io.ts
│   │   │   └── types.ts
│   │   │
│   │   └── proxy/                       ← 自研 LSP 代理
│   │       ├── bridge.ts
│   │       ├── cli.ts
│   │       ├── cliArgs.ts
│   │       ├── cliRuntime.ts
│   │       ├── framing.ts
│   │       ├── keepalive.ts
│   │       ├── localization.ts
│   │       ├── messages.ts
│   │       ├── processBridge.ts
│   │       ├── realClangdResolver.ts
│   │       ├── settingsManager.ts
│   │       └── status.ts
│   │
│   ├── commands/                        ← VS Code 命令处理器
│   │   ├── AGENTS.md
│   │   ├── build.ts
│   │   ├── createProject.ts
│   │   ├── diagnoseProject.ts
│   │   ├── disableClangdProxy.ts
│   │   ├── enableClangdProxy.ts
│   │   ├── generateCompileCommands.ts
│   │   ├── installRules.ts
│   │   ├── launchEditor.ts
│   │   ├── liveCoding.ts
│   │   ├── openWorkspaceFile.ts
│   │   ├── regenerateWorkspace.ts
│   │   ├── selectConfig.ts
│   │   ├── selectTarget.ts
│   │   ├── setSystemIncludes.ts
│   │   ├── showClangdProxyStatus.ts
│   │   ├── showProjectInfo.ts
│   │   ├── toggleCompletionMode.ts
│   │   ├── uninstall.ts
│   │   └── index.ts
│   │
│   ├── core/
│   │   ├── command-registry.ts
│   │   ├── config.ts
│   │   └── logger.ts
│   │
│   ├── detection/                       ← 工程探测
│   │   ├── AGENTS.md
│   │   ├── engineDiscovery.ts
│   │   ├── engineLocator.ts
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── uprojectAssociation.ts
│   │   ├── uprojectScanner.ts
│   │   ├── vsBuildTools.ts
│   │   ├── workspaceContext.ts
│   │   ├── workspaceEngines.ts
│   │   └── workspaceFolders.ts
│   │
│   ├── i18n/
│   │   ├── index.ts
│   │   └── locales/
│   │       ├── en.json
│   │       └── zh.json
│   │
│   ├── mcp/                             ← MCP 服务器
│   │   ├── index.ts
│   │   ├── lifecycle.ts
│   │   ├── server.ts
│   │   └── tools.ts
│   │
│   ├── parsers/
│   │   ├── linkerParser.ts
│   │   ├── msvcParser.ts
│   │   ├── ubtParser.ts
│   │   └── uprojectParser.ts
│   │
│   ├── platform/                        ← 平台分支代码
│   │   └── (由 esbuild 分支处理)
│   │
│   ├── rules/
│   │   ├── cursorRules.ts
│   │   └── index.ts
│   │
│   └── ui/
│       ├── AGENTS.md
│       ├── index.ts
│       ├── notifications.ts
│       ├── outputChannel.ts
│       ├── problemsPanel.ts
│       ├── quickPicks.ts
│       └── statusBar.ts
│
└── test/
    ├── fixtures/                        ← 测试用静态资源
    ├── integration/                     ← 集成测试（当前为空）
    │   └── runTests.js
    └── unit/
        ├── setup.ts                     ← vitest 全局 setup
        ├── clangd/
        │   └── proxy/
        └── commands/
```

## Key Locations（实现时常找的入口）

| 任务 | 看这里 |
|---|---|
| 增加新命令 | `src/commands/AGENTS.md` → `src/core/command-registry.ts` → `src/commands/<name>.ts` → `package.json#contributes.commands` |
| 添加新配置项 | `package.json#contributes.configuration.properties` → `src/core/config.ts` → 各 consumer |
| 调整构建 | `src/build/ubt.ts` → `src/build/buildRunner.ts` → `src/parsers/ubtParser.ts` |
| 调整 clangd 代理 | `src/clangd/proxy/cli.ts`（入口）→ `bridge.ts` / `processBridge.ts` / `keepalive.ts` / `localization.ts` |
| 改 i18n 字符串 | `src/i18n/locales/{en,zh}.json` 对应 key |
| 改 MCP 工具 | `src/mcp/tools.ts`（注册）→ 实际 handler 写哪里按调用约定 |
| 加新平台分支 | `src/platform/` + `esbuild.config.mjs` 的 external 列表 |
| 加新解析器 | `src/parsers/` 抄一个 parser，实现统一 `parseLine` 接口 |

## Naming Conventions

- **目录 / 文件**：kebab-case（`ueMacroCompletion.ts` / `proxyManager.ts` / `workspaceBackup.ts`）
- **类 / 类型**：PascalCase（`MCPServer` / `UBTInvocation` / `ClangdProxyStatus`）
- **函数 / 变量**：camelCase（`loadConfig` / `enableProxy` / `keepAliveDocs`）
- **常量 / 枚举值**：UPPER_SNAKE 或 PascalCase（视场景；命令标题用自然语言）
- **命令 ID**：`vscodeUEHelper.<verb>` 全小写驼峰
- **i18n 文件名**：`<locale>.json` —— `en.json` / `zh.json`
- **测试文件名**：`<unit>.test.ts`，与实现同目录镜像（或上层聚合）

## Key Files Deep Reference

### `package.json`
> 扩展的"事实来源"。
- `engines.vscode` —— 最低 VS Code 版本
- `activationEvents` —— 何时拉起扩展
- `contributes.commands` —— 20 个命令清单
- `contributes.configuration` —— 全部 `vscodeUEHelper.*` 配置
- `contributes.menus.commandPalette` —— 命令面板显隐控制
- `contributes.problemMatchers` —— UBT/MSVC 错误模式
- `extensionDependencies` —— 强制 clangd 扩展

### `tsconfig.json`
- 所有 strict 选项打开
- 14 个 `@xxx` 路径别名 — esbuild `alias` 完全同步

### `esbuild.config.mjs`
- 多入口共享 `sharedOptions`
- 两个 entry points：`src/extension.ts` 和 `src/clangd/proxy/cli.ts`
- 构建后自动生成 `out/launcher/*.bat|sh`

### `vitest.config.ts`
- 阈值：lines 80 / functions 80 / branches 75 / statements 80
- `setupFiles: ['test/unit/setup.ts']`

### `AGENTS.md`（多个）
> 每个主要 domain（`build/`、`clangd/`、`commands/`、`detection/`、`ui/`、`src/platform/`）都有自己的 `AGENTS.md`，是给 AI 协作者的简介 + 协作约定。新人改这些子目录前应先读对应 AGENTS.md。

## Module Boundaries & Disposal

- 所有需要 `Disposable` 的对象通过 `vscode.ExtensionContext.subscriptions.push(...)` 集中管理
- 命令注册通过 `CommandRegistry.disposable()` 统一释放
- chokidar watchers 在 deactivate 时 close
- Proxy 进程在 deactivate 时优雅杀进程（SIGTERM → SIGKILL 兜底）

## Things to Note in Future Mappings

1. `temp_writer.{js,mjs}` 在仓库根，应清理
2. `vscode-ue-helper-0.1.0.vsix` 已提交历史，应从 release artifacts 路径外移（已 gitignored）
3. `src/platform/` 当前为空（仅有 `index.ts` 占位），实际平台分支走 `if (process.platform === 'win32')` 类内联判定
