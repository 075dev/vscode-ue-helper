# VSCodeUEHelper —— 仓库知识库

VS Code 扩展，给 Unreal Engine 5.2+ C++ 开发用：UBT 构建、Live Coding 热重载、clangd 智能提示、可选 MCP AI Agent 集成。所有代码注释强制中文。

## 状态速览

- 0.1.0 已发布；0.6.x 合并 fast/slow 为 slow；**Phase 8 + 9 架构**：`WorkspaceState`（13 import / 36 callers）+ `ClangdOps`（22 callers）单一真相源，`phase 9 SSoT 收尾`完成——
  - `.clangd` 唯一写入：删 `writeClangdConfig` / `findClangdConfig`，统一走 `ClangdOps.{writeFull|mutate|applyAddFlags}`
  - 29 处 `detection.workspaceContext.getSelected*` 收敛到 `workspace.selectedProject` / `selectedEngine`，新增 `resolveSelectedProject/Engine()` 收口 10 个命令文件重复模式
  - 全局 `.eslintrc.json` 锁定 3 类 syntax bypass + 1 类 import bypass
  - 13 个 `test/unit/core/ssot.test.ts` 回归守卫 + 12 个 `test/unit/core/workspace.test.ts` 行为测试
- **19 个命令**（`package.json#contributes.commands`），11 个状态栏按钮（`src/ui/statusBar.ts`）。`completionMode` 设置与 `toggleCompletionMode` 命令已删除（H4-B 决策）。
- 单元测试 56 个文件 + 1 个 .bak 手备份（共约 10.4k 行），`npm run test:unit` 跑 Vitest；v8 覆盖率阈值 80/80/75/80。

## 模块文档

进入具体模块前先读对应的 AGENTS.md：

| 模块                   | 路径                         | 内容                                                                     |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| build                  | `src/build/AGENTS.md`        | UBT 命令结构、MSVC 诊断解析、Task Provider、Live Coding、DDD 三层结构    |
| clangd                 | `src/clangd/AGENTS.md`       | compile_commands.json、`.clangd` 结构、workspace 备份、proxy/ 子目录索引 |
| clangd/proxy           | `src/clangd/proxy/AGENTS.md` | 独立 LSP 代理 CLI 进程、stdio 协议、汉化/TODO                            |
| commands               | `src/commands/AGENTS.md`     | 19 个命令注册表、新增命令 4 步流程                                       |
| detection              | `src/detection/AGENTS.md`    | "信任 .code-workspace" 检测模型、DetectionHandles、Phase 8 增强          |
| ui                     | `src/ui/AGENTS.md`           | 11 个状态栏按钮布局、QuickPick 模式、ControlPanel Webview                |
| core                   | `src/core/AGENTS.md`         | Logger/Config/WorkspaceState 横切基础设施、Config.update 陷阱            |
| mcp                    | `src/mcp/AGENTS.md`          | MCP 服务器（仅 Cursor/Claude Code 环境激活）、6 个工具                   |
| i18n / parsers / rules | （合并到根）                 | i18n 见下方"风格与约定"、parsers 是纯函数、rules 是 AI 规则生成器        |

## 常用命令

```bash
npm run build         # clean + esbuild → out/extension.js + out/clangdProxy.js + launcher 脚本
npm run watch         # esbuild 监听模式
npm run typecheck     # tsc --noEmit（必须零错误）
npm run lint          # ESLint src test
npm run format:check  # Prettier
npm run test:unit     # Vitest（测试入口 test/unit/**/*.test.ts）
npm run package       # vsce package → .vsix
npm run perf:baseline # LSP 代理开销采样 → .vscode/clangd-perf-cache/proxy-baseline.json
npm run perf:after    # 同上，输出 proxy-after.json
npm run perf:diff     # 对比两个 JSON，< 1% 偏差算通过
```

调试：VS Code 里按 `F5` 启动 Extension Development Host（`launch.json` 配置 `Run Extension`）。

## 关键架构（agent 容易踩坑的地方）

### 入口与激活顺序

`src/extension.ts` 是唯一入口，**顺序是硬约束**：

```
initI18n()        ← 必须最先，Logger 内部可能用翻译
→ Logger + Config
→ activateDetection(context, config, logger)         // 返回 DetectionHandles + ready Promise
→ new WorkspaceState({ detection, logger })          // [Phase 8] 单一真相源
→ new ClangdOps({ workspace, logger })               // [Phase 8] .clangd 统一 API
→ activateBuild / activateClangd / activateUI
→ activateCommands（最后一个，依赖全部 handles）
→ ControlPanelProvider.register(...)
→ runFirstTimeInit(...) // fire-and-forget
```

`detection.ready` 是 Promise，UI 必须 await 它再渲染，避免竞态。

### 双 esbuild 输出

`esbuild.config.mjs` 同时构建两个 bundle：

1. `out/extension.js` —— 主扩展，`vscode` 标 external（运行时由 VS Code 提供）。
2. `out/clangdProxy.js` —— clangd LSP 代理 CLI，**不依赖 vscode**，作为独立子进程跑。
   - 配套生成 `out/launcher/proxy-launcher.bat`（Windows）和 `.sh`（Unix，自动 chmod 755，Windows 上失败被吞掉）。
   - 启动方式：把 `clangd.path` 指向 launcher，配合 `clangd.useScriptAsExecutable=true`。

### 路径别名（必须用）

`tsconfig.json`、`esbuild.config.mjs`、`vitest.config.ts` 三处声明。**禁止相对导入**：

```typescript
import { Logger } from '@core/logger'; // ✅
import { Logger } from '../../core/logger'; // ❌ 违反风格
```

可用别名：`@core`、`@detection`、`@build`、`@clangd`、`@commands`、`@ui`、`@parsers`、`@mcp`、`@rules`、`@i18n`、`@platform`（**注意 `@platform` 是死的**——`src/platform/` 目录不存在，是历史残留）。

### `.code-workspace` 检测模型

不扫文件系统，**完全信任** `.code-workspace` 的 `folders[]`：

- `path === '.'` → 项目根（找 `<name>.uproject`）
- `name === 'UE5'` → 引擎根（读 `Engine/Build/Build.version`）
- 其他 → unknown

如果用户只打开单文件夹（无 workspace 文件），detection 直接返回空结果，UI 显示警告。

## 仓库陷阱（容易误导的点）

1. **`npm run test:integration` 已坏**——脚本指向 `test/integration/runTests.js`，该目录不存在。`npm test` 跑 unit + integration，integration 步会失败。**只跑 unit**：`npm run test:unit`。
2. **`completionMode` 设置已废弃**——`package.json` 里 `deprecationMessage` 标明，值 `'fast'` 在 `Config.completionMode` getter 归一化为 `'slow'`。`resources/preparse-includes/ue5-fast.json` 已被删除，只剩 `ue5-slow.json`。**不要新增 fast/slow 分支代码**。
3. **`resources/README.md` 描述过时**——还提到 `ue5-fast.json` 和缺失的 `banner.png`，与现状不符。
4. **`.bak` 测试文件未忽略**——`test/unit/commands/clangdProxyCommands.test.ts.bak` 是手备份，`.gitignore` 没排除；提交前别把它带上。
5. **MCP 只在 Cursor / Claude Code 启动**——检测 `CURSOR_TRACE_ID` / `CURSOR_USER_DATA_DIR` / `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_SSE_PORT` 环境变量，普通 VS Code 里 MCP 是 no-op。改 MCP 时不要假设 always-on。
6. **chokidar 必须在 vitest mock**——`test/unit/setup.ts` 已 mock，否则 `fileWatcher` 测试会启动真实 fs watcher 卡住进程。
7. **MSVC 错误正则**：`^(.*)\((\d+)(?:,(\d+))?\):\s+(error|warning|note|fatal error)\s+([A-Z]+\d+):\s+(.*)$`，定义在 `package.json#contributes.problemMatchers`，`src/parsers/msvcParser.ts` 用同一正则。改一处要同步另一处。
8. **`headerWatcher` 已删**——Phase 8 改为 proxy 端 `UeDiagnosticWatcher` 被动触发 UBT 重生成，不要重新加回主动 watcher。
9. **`out/` 必须清理**——`npm run clean` 只删 `out/src/` 和 `out/test/`（防打包残留），不会删 `out/extension.js`。`npm run build` 内部会先 clean 再 bundle。
10. **`Config.update` 写完必须 refresh**——`src/core/config.ts` 内部已处理，但调用方常见误用：`await config.update(); 立刻读 config.xxx` 会拿到旧值（VS Code 同进程内不主动通知 WorkspaceConfiguration 失效）。改动该类代码要测试写入后读回。
11. **`completionMode` 设置已死但 API 还在**——`Config.completionMode` getter 强制归一化为 `'slow'`，`package.json` 标 `deprecationMessage`，但旧代码路径仍存在。新代码不要再读 `config.completionMode` 判断分支（详情见 `src/core/AGENTS.md`）。
12. ~~**`populateAddCompletions` 是撒谎型兼容层**~~ —— ✅ **已解决（Phase 9）**：grep `src/` 全仓库零匹配，函数不存在。AGENTS.md 此条目仅作历史档案保留，未来读者不要"复活"该函数。新代码直接调 `createCompletionFiles()`（仍是单一写入点）。
13. **6 个汉化 TODO 是僵尸承诺**——`src/clangd/proxy/localization.ts:79/91/103` + `src/clangd/proxy/bridge.ts:676/685/694` 都写 "后续实现"，未排进任何 phase。规划时不要假设汉化已上线。

## 风格与约定

- **TypeScript strict 全开**：`strict`、`noUncheckedIndexedAccess`、`noUnusedLocals/Parameters`、`noImplicitReturns`、`noFallthroughCasesInSwitch`。
- **ESLint 强制**：`@typescript-eslint/no-floating-promises`、`no-misused-promises`、`await-thenable` 都是 `error`。故意不 await 用 `void foo()`。
- **i18n 优先**：所有用户可见字符串走 `t('key', params)`，对应 `src/i18n/locales/{en,zh}.json`。改文案要同步两份。
- **日志前缀**：每个模块日志加 `[moduleName]`，例如 `[detection] workspaceFile = ...`。
- **资源清理**：所有 VS Code 资源（StatusBarItem、命令、Watcher）必须 push 到 `context.subscriptions`。
- **新增命令 4 步**：① `package.json#contributes.commands` 加定义；② `src/commands/xxx.ts` 写 `executeXxx`；③ `src/commands/index.ts` `registerCommand`；④ i18n 双语 key。
- **绝对路径用于诊断**——Problems 面板需要绝对路径；MSVC 输出 1-based，VS Code 0-based，解析时要减 1。

## 打包 / 发布注意

- `package.json` 的 `repository.url` 还是 `YOUR_USERNAME/vscode-ue-helper` 占位符，发布前要改。
- `.vscodeignore` 已排除 `src/`、`test/`、`tsconfig.json`、`*.mjs`、`AGENTS.md`、`CLAUDE.md`、`.planning/`、`.codegraph/`、`scripts/`、`*.log`、`*.map`、`doc/`、`docs/`。打包后只有 `out/extension.js`、`out/clangdProxy.js`、`out/launcher/*`、`resources/icon.png`、`package.json` 进入 `.vsix`。
- `npm run package` 内部 `prepackage` 钩子会自动 `npm run build`。
- 无 CI / pre-commit / Husky 配置（`.github/`、`hooks/` 都不存在）。所有门禁靠开发者本地命令。

## 目录速查

```
src/
├── extension.ts        # 唯一入口
├── core/               # Logger, Config, command-registry, WorkspaceState
├── detection/          # uprojectScanner, engineDiscovery, vsBuildTools, workspaceContext
├── build/              # ubt, buildRunner, taskProvider, liveCoding, launchEditor
│   ├── domain/         # DDD 风格: entities, value-objects, events, repositories
│   ├── application/
│   └── infrastructure/
├── clangd/             # clangdConfig, compileCommands, completionMode, completionFiles
│   ├── diagnostics/    # Diagnose Clangd Project 命令用的检查器
│   └── proxy/          # 独立 LSP 代理 CLI: cli, bridge, processBridge, framing
├── parsers/            # msvcParser, ubtParser, linkerParser, uprojectParser
├── commands/           # 19 个命令处理器
├── ui/                 # statusBar, quickPicks, notifications, problemsPanel, outputChannel
├── mcp/                # Model Context Protocol 服务器（Cursor/Claude Code）
├── rules/              # AI Agent 规则生成（Cursor + Copilot）
└── i18n/               # en.json, zh.json
resources/
├── icon.png
└── preparse-includes/ue5-slow.json  # fast.json 已删除
scripts/
├── clean-out.mjs       # 清 out/src out/test（防 .vsix 残留）
├── extract-ue-docs.ts  # UE 源码头注释抽取（用 npx tsx 跑）
└── measure-proxy-overhead.mjs  # LSP 代理 perf:baseline/after/diff
test/
└── unit/               # Vitest 入口，测试文件与 src/ 镜像目录布局
.vscode/
├── launch.json         # F5 启动配置
├── tasks.json          # npm scripts 包装成 VS Code 任务
├── settings.json       # Prettier + ESLint + clangd 推荐
└── extensions.json     # 推荐扩展（Prettier/ESLint/clangd/TS Next）
```
