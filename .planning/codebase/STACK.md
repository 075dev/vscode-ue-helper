---
date: 2026-06-30
generator: gsd-map-codebase (orchestrator fallback)
focus: tech
---

# Stack — vscode-ue-helper

技术栈速览：这是一个面向 Unreal Engine C++ 开发的 VS Code 扩展，通过自研的 clangd LSP 代理、可选的 MCP 服务器以及与 UBT 的深度集成，把"构建 / Live Coding / 智能提示"三个高频痛点统一在一起。

## Languages & Runtime

- **主语言**：TypeScript 5.x（`tsconfig.json` 启用 `strict: true` 及全部严格选项）
- **目标 ECMA**：`ES2022`，模块系统 `Node16` + `moduleResolution: Node16`
- **运行时**：
  - VS Code Engine `^1.85.0`（扩展宿主）
  - Node.js `>=18.0.0`（构建/打包阶段）
  - 此外还有一个独立 Node 子进程：`out/clangdProxy.js`（不被 VS Code 限制，可独立运行）
- **被调用方**：Unreal Build Tool (`BuildTool.exe` / `BuildTool`)、`clangd` / `clangd.exe`、Windows SDK 相关 MSVC 工具链

## Bundler / Build Pipeline

- **`esbuild.config.mjs`**：单文件 esbuild 配置，编译两个入口
  - `src/extension.ts → out/extension.js`（扩展主入口，`vscode` 标记 external）
  - `src/clangd/proxy/cli.ts → out/clangdProxy.js`（代理 CLI，**不依赖 vscode**，独立 Node 进程）
  - 监听模式：`node esbuild.config.mjs --watch`
  - 生产模式：minify + 去掉 sourcemap
- **打包**：`vsce package` → `vscode-ue-helper-0.1.0.vsix`（已发布的预构建版本在仓库根目录可见）
- **TypeScript 别名**：`@/*` 映射到 `src/*`，以及 `@core`、`@detection`、`@build`、`@clangd`、`@i18n`、`@parsers`、`@commands`、`@ui`、`@mcp`、`@rules`、`@platform` 全部模块级别名（esbuild alias 与 tsconfig `paths` 同步）
- **配套 launcher 生成**：`esbuild` 构建过程中额外生成两个启动脚本：
  - `out/launcher/proxy-launcher.bat`（Windows）
  - `out/launcher/proxy-launcher.sh`（Unix，`chmod 0o755`）
  - 这两个文件配合 `clangd.useScriptAsExecutable=true` 工作

## Linting & Formatting

- **ESLint** (`.eslintrc.json`)
  - `eslint:recommended` + `@typescript-eslint/recommended` + `recommended-requiring-type-checking`
  - 自定义规则：`no-floating-promises` / `no-misused-promises` / `await-thenable` 全是 `error`
  - `no-explicit-any` 是 `warn`，`explicit-function-return-type` 是 `warn`
  - `eqeqeq: ["error", "always"]` + `curly: ["error", "all"]`（强风格）
  - 允许下划线前缀的未使用变量（`^_`）
- **Prettier** (`.prettierrc`)
  - `singleQuote: true`、`trailingComma: "all"`、`printWidth: 100`、`tabWidth: 2`、`endOfLine: "lf"`

## Testing

- **Vitest `^1.3`**（`vitest.config.ts`）
  - 入口：`test/unit/**/*.test.ts`
  - 排除：集成测试、node_modules
  - `globals: false`、`environment: "node"`
  - 覆盖率（v8）：`text/html/lcov`，阈值 `lines/funcs/stmts: 80`，`branches: 75`，排除 `src/extension.ts` 与 `.d.ts`
  - `setupFiles: ["test/unit/setup.ts"]`
  - 与 esbuild 同款路径别名
- **集成测试**：`test/integration/runTests.js`（走 `@vscode/test-electron`）
- **CI 脚本**：
  - `npm run typecheck`（`tsc --noEmit`）
  - `npm run lint` / `lint:fix`
  - `npm run format` / `format:check`
  - `npm run test:unit` / `test:integration` / `test`

## Production Dependencies

| Pkg | Version | 用途 |
|---|---|---|
| `@modelcontextprotocol/sdk` | `^1.0.0` | MCP 服务器实现，对接 Cursor / Claude Code |
| `chokidar` | `^3.6.0` | 跨平台文件监听（UBT 输出、`.clangd`、workspace 文件刷新） |
| `execa` | `^8.0.1` | 安全 spawn 子进程（UBT、clangd、GenerateProjectFiles） |
| `json5` | `^2.2.3` | 解析 UE 的 `.uproject`（允许注释和尾逗号） |
| `neverthrow` | `^6.1.0` | `Result<T,E>` 类型，避免在 MCP / clangd 管道里抛异常 |
| `xstate` | `^5.9.0` | 状态机（用于代理进程生命周期、UBT 状态流转） |
| `yaml` | `^2.9.0` | 解析 UE 的 `*.Build.cs` / `DefaultEngine.ini` 等 YAML 类配置 |

## Dev Dependencies

| Pkg | Version |
|---|---|
| `@types/node` | `^20.11.0` |
| `@types/vscode` | `^1.85.0` |
| `@typescript-eslint/eslint-plugin` / `parser` | `^7.0.0` |
| `@vscode/test-electron` | `^2.3.8` |
| `esbuild` | `^0.20.0` |
| `eslint` | `^8.57.0` |
| `prettier` | `^3.2.5` |
| `typescript` | `^5.3.3` |
| `vitest` | `^1.3.0` |
| `vsce` | `^2.15.0` |

## Configuration Surface (from `package.json` contributes.configuration)

完整声明见 `package.json`，关键键（前缀 `vscodeUEHelper.*`）：

- `ueVersion` — 首选 UE 版本
- `configuration` — `Debug / DebugGame / Development / Shipping / Test`
- `target` — `Editor / Game / Server / Client`
- `platform` — `Win64 / Mac / Linux`
- `clangdPath` — clangd 二进制路径
- `completionMode` — `fast / slow`（UE 宏补全模式）
- `autoBackupWorkspace` — 防止 UBT 刷新覆盖 `.code-workspace`
- `useMCP` — `auto / always / never`（仅在 Cursor / Claude Code 自动启用）
- `lspLoggingLevel` — `error / warn / info / debug`
- `clangdProxy.enabled` — 启用 clangd LSP 代理
- `clangdProxy.keepaliveMax` (默认 20) / `keepaliveTtlSec` (默认 900)
- `clangdProxy.realClangdPath` — 真实 clangd 路径
- `clangdProxy.logPath` — 代理日志文件
- `clangdProxy.localization.enabled` / `mode` / `targets`（汉化开关：`append` / `override`，针对 `diagnostics` / `codeActions` / `hover`）

## Activation Model

`activationEvents`：
- `workspaceContains:**/*.uproject`（打开 UE 工程时自动激活）
- 五个 `onCommand:*`（命令面板前置激活：`build` / `liveCoding` / `showProjectInfo` / `diagnoseProject` 等）

## Extension Dependencies

- `extensionDependencies`: `llvm-vs-code-extensions.vscode-clangd`（强制 clangd 扩展同时安装）
- `extensionPack`: 同样这条（确保装 clangd）

## Commands Surface

20 个命令（`vscodeUEHelper.*`），含中英双语 `title` / `title@zh`，分类统一为 `"UE Helper"`：
`build` / `rebuild` / `clean` / `launchEditor` / `liveCoding` / `generateCompileCommands` / `diagnoseProject` / `createProject` / `toggleCompletionMode` / `showProjectInfo` / `setSystemIncludes` / `installRules` / `uninstall` / `openWorkspaceFile` / `regenerateWorkspace` / `selectConfig` / `selectTarget` / `enableClangdProxy` / `disableClangdProxy` / `showClangdProxyStatus`。

命令面板白名单：`menus.commandPalette` 显式列出了 7 个，其余走 `when` 条件或全局可用。`liveCoding` 与 `setSystemIncludes` 仅 `isWindows`。

## problemMatchers

`ue-helper-msvc`：`^(.*)\((\d+)(?:,(\d+))?\):\s+(error|warning|note|fatal error)\s+([A-Z]+\d+):\s+(.*)$`，把 MSVC 编译错误直接吸到 VS Code Problems 面板。

## i18n

- `src/i18n/index.ts` 注册
- `src/i18n/locales/en.json` / `zh.json`（中英两套 locale）
- VS Code 配置描述同款双语（`description` + `description@zh`）

## Bundled Resources

- `resources/icon.png` — 扩展图标
- `resources/preparse-includes/ue5-fast.json` / `ue5-slow.json` — UE 头文件预解析白名单（补全模式 fast/slow 的基础数据）

## ESBuild 输出 banner

`// VSCodeUEHelper — generated by esbuild` — 用来在 stack trace 里快速识别编译产物。
