# Coding Conventions

**Analysis Date:** 2026-07-23

> 范围：VSCodeUEHelper (Windows-only VS Code 扩展，UE 5.2+ C++)。本文件记录代码风格、命名、模式、错误处理与所有"仓库陷阱"——改代码前必读。

## 1. TypeScript strict 配置（`tsconfig.json`）

| 开关 | 值 | 作用 |
| --- | --- | --- |
| `target` | `ES2022` | Node 18+ / VS Code 1.85+ 运行时 |
| `module` / `moduleResolution` | `Node16` | 与 `vscode` 模块解析一致 |
| `lib` | `["ES2022"]` | 不用 DOM（扩展宿主不提供） |
| `strict` | `true` | 主开关（隐式打开 `noImplicitAny` + `strictNullChecks` + `strictFunctionTypes` + `strictBindCallApply` + `strictPropertyInitialization` + `noImplicitThis` + `alwaysStrict`） |
| `noUncheckedIndexedAccess` | `true` | `arr[i]` 类型为 `T \| undefined` —— 强制处理越界 |
| `noUnusedLocals` / `noUnusedParameters` | `true` | 未用变量/参数报错；参数可用 `_` 前缀豁免 |
| `noImplicitReturns` | `true` | 函数所有路径必须 return |
| `noFallthroughCasesInSwitch` | `true` | `case` 必须 `break`/`return` |
| `esModuleInterop` | `true` | 允许 `import x from 'commonjs-mod'` |
| `skipLibCheck` | `true` | 不检查 `node_modules/@types` |
| `forceConsistentCasingInFileNames` | `true` | Windows 必需 |
| `resolveJsonModule` | `true` | 允许 `import en from './en.json'`（i18n 用） |
| `isolatedModules` | `true` | esbuild 单文件转译兼容 |
| `declaration` / `declarationMap` / `sourceMap` | `true` | 输出 .d.ts + source map |

**路径别名**（`tsconfig.json` / `esbuild.config.mjs` / `vitest.config.ts` 三处同步声明，禁止相对导入）：

```
@/*     → src/*
@core   → src/core/index
@detection → src/detection/index
@build  → src/build/index
@clangd → src/clangd/index
@i18n   → src/i18n/index
@parsers/* → src/parsers/*
@commands → src/commands/index
@ui     → src/ui/index
@mcp    → src/mcp/index
```

⚠️ 历史残留：根 `AGENTS.md` 提到 `@platform` 别名 —— `src/platform/` 目录不存在，是死别名，禁止新增。

## 2. ESLint 强制规则（`.eslintrc.json`）

### 3 条 `@typescript-eslint` 错误级（必读）

| 规则 | 级别 | 含义 | 故意不 await 怎么写 |
| --- | --- | --- | --- |
| `@typescript-eslint/no-floating-promises` | `error` | 禁止裸 `foo()`（Promise 必须 await / `.then` / `.catch`） | `void foo();` |
| `@typescript-eslint/no-misused-promises` | `error` | 禁止在期望同步值的位置 await Promise（反之亦然） | 显式解包：`const r = await foo(); use(r)` |
| `@typescript-eslint/await-thenable` | `error` | 禁止 `await` 非 thenable | 几乎不会触发，但防止误用 |

### 错误级自定义规则

- `no-restricted-syntax` 锁 4 类 SSoT 旁路（Phase 9）：
  1. `vscode.workspace.workspaceFile` 直读（除 `src/detection/index.ts` + `src/core/workspace.ts` 之外）
  2. `vscode.workspace.workspaceFolders` 直读（同上例外）
  3. `vscode.workspace.getWorkspaceFolder(...)` 直读（`src/clangd/compileCommands/task.ts` 用原生 `vscode.WorkspaceFolder` 构造 `vscode.Task` 处带注释豁免）
  4. 模块内 `new Logger(...)` —— 必须用 `sharedLogger`（`src/core/logger.ts`），主入口与测试例外
- `no-restricted-imports` 锁 1 类：禁止从 `@clangd/clangdConfig` 或 `**/clangdConfig` import —— `.clangd` 唯一写入走 `ClangdOps` (`@clangd/clangdOps`)。`clangd/index.ts` 与 `clangdOps.ts` 例外（带 `eslint-disable-next-line`）。

### 其他错误级

- `prefer-const`、`eqeqeq: always`、`curly: all`
- `@typescript-eslint/no-unused-vars`（`^_` 前缀豁免）
- 警告级：`no-explicit-any`、`explicit-function-return-type`（`allowExpressions: true`）、`no-non-null-assertion`、`prefer-nullish-coalescing`
- 测试目录 override：`no-restricted-syntax: off`、`no-non-null-assertion: off`、`explicit-function-return-type: off`（测试用 factory + fixture 即可）

## 3. Prettier 规则（`.prettierrc`）

| 选项 | 值 |
| --- | --- |
| `semi` | `true`（分号必须） |
| `singleQuote` | `true` |
| `trailingComma` | `"all"` |
| `printWidth` | `100`（md: 120；json: 100） |
| `tabWidth` | `2` |
| `useTabs` | `false` |
| `arrowParens` | `"always"` |
| `endOfLine` | `"lf"`（提交前 git 会自动转换 CRLF） |

## 4. 命名约定

- **文件**：`kebab-case.ts`（如 `clangdOps.ts`、`workspaceContext.ts`）。barrel 用 `index.ts`。
- **测试**：`*.test.ts` 与源码镜像，位于 `test/unit/<mirror>/`。
- **类 / 类型**：`PascalCase`（`WorkspaceState`、`ClangdOps`、`MsvcParser`），无 `I` 前缀。
- **接口**：`PascalCase`（`WorkspaceStateOptions`、`DetectionResult`），无 `I` 前缀。
- **函数 / 变量**：`camelCase`。
- **常量 / 枚举值**：`UPPER_SNAKE_CASE`（`MAX_RETRIES`、`DiagnosticSeverity.Error`）。
- **私有成员**：不用 `_` 前缀（ESLint 已开 `noUnusedLocals`，靠作用域隔离）。
- **VS Code 命令 ID**：`vscodeUEHelper.<verb-noun>`（如 `vscodeUEHelper.build`、`vscodeUEHelper.liveCoding`）。
- **i18n key**：`section.subname.text` 形式（`cmd.build`、`ui.welcome.real`、`perf.clangdGen.tooltip`）。

## 5. 日志前缀

每个模块日志加 `[moduleName]` 前缀，便于 grep 定位：

```ts
logger.info('[detection] workspaceFile =', workspaceFile);
logger.warn('[clangd] no projectPath: skip incremental watcher');
logger.info(`[build] task provider registered`);
```

输出格式（`src/core/logger.ts`）：

```
14:23:45.678 [INFO] [clangd] activated (status bar + perf ready)
14:23:45.679 [WARN] [detection] no engine root found
```

模块内禁止 `new Logger(...)` —— 用 `sharedLogger`（`src/core/logger.ts:169`）单例，或在主入口 `extension.ts:30` 例外创建。错误信息中带 `[SSoT]` 前缀（如 `[SSoT] use workspace.workspaceFile from @core/workspace`）。

## 6. 注释

**强制中文**。所有 JSDoc / 行内注释 / TODO 注释一律中文（英文专有名词、代码标识符、错误码除外）。`AGENTS.md` / `*AGENTS.md` / `1.log` 等历史文档也保持中文。

- 解释 **为什么**，不是 **做什么**（避免 `// 计数器加 1` 这种废话）。
- 复杂业务逻辑必须有 JSDoc 段。
- TODO 格式：`// TODO: <描述>`（无 username，用 git blame）。
- 公共 API 函数用 `@param` / `@returns` / `@throws` 标注。

## 7. i18n 模式

所有用户可见字符串走 `t(key, params)`，对应 `src/i18n/locales/en.json` + `zh.json` 两份。

```ts
import { initI18n, t } from '@i18n';

// extension.ts 第一行必须 initI18n()（Logger 内部可能用翻译）
initI18n();

// 用法
window.showInformationMessage(t('ui.welcome.real'), 'Open');
const text = t('perf.clangdGen.tooltip', { ms: '3500' });
```

- 双语 key 必须同步（CI 没有强制，但缺中文会暴露）。
- 缺 key 时 fallback 到 `en`。
- 占位符 `{name}` 在 `params` 里给 `string | number`。
- 命令 `title` / `title@zh` 在 `package.json#contributes.commands` 声明，**不**走 `t()`。
- `test/unit/i18n/perfStatusBar.test.ts` 守卫新增 key 双语覆盖。

## 8. 错误处理

### VS Code API（同步抛错可能）

```ts
try {
  await config.update('key', value);
} catch (err) {
  logger.error('failed to update config', err);
  vscode.window.showErrorMessage(t('error.updateFailed'));
}
```

### Promise / async

- **禁止裸 `foo()`**（`no-floating-promises`）：每个 Promise 必须 `await` / `.then` / `.catch` / `void`。
- fire-and-forget 显式写 `void foo();`。
- 配置写完必须 refresh：`await config.update(); 立刻读 config.xxx` 会拿到旧值（VS Code 同进程内不主动通知 WorkspaceConfiguration 失效）—— 见仓库陷阱 #10。

### 解析器（MsvcParser / UbtParser）

抛错策略：无法解析的输入静默忽略（不抛）；致命错误由调用方 `try/catch` 兜底。

### 自定义错误

项目里没专门定义 `*Error` 类（沿用 `Error`），靠错误信息前缀定位模块（如 `[SSoT]`、`[build]`）。

## 9. 资源清理

**所有 VS Code 资源必须 `push` 到 `context.subscriptions`**：

```ts
const cmd = vscode.commands.registerCommand('vscodeUEHelper.x', handler);
context.subscriptions.push(cmd);

const watcher = vscode.workspace.createFileSystemWatcher(pattern);
context.subscriptions.push(watcher);

const statusBar = vscode.window.createStatusBarItem();
context.subscriptions.push(statusBar);
```

`EventEmitter` / `withProgress` / `registerTaskProvider` / `createDiagnosticCollection` 等所有 `Disposable` 同理。**绝不**允许孤儿资源 —— 扩展停用时会泄漏。

## 10. 新增命令 4 步流程

每加一个 VS Code 命令必须同步 4 处（漏一步 i18n 会暴露或命令找不到）：

1. **`package.json#contributes.commands`** —— 加 `{ command, title, "title@zh", category, icon? }`。
2. **`src/commands/xxx.ts`** —— 写 `export async function executeXxx(...args)` 处理器。
3. **`src/commands/index.ts`** —— 在 `activateCommands` 调 `context.subscriptions.push(registerCommand('vscodeUEHelper.xxx', executeXxx))`。
4. **`src/i18n/locales/{en,zh}.json`** —— 加 `cmd.xxx` key + 标题文案（命令提示走 `t('cmd.xxx')`；`title@zh` 是命令面板显示用的另一份）。

参考：`src/commands/AGENTS.md` 列出 19 个命令注册表。

## 11. 路径处理（绝对路径用于诊断）

Problems 面板跳转需要 **绝对路径**（`vscode.Diagnostic` 接受 `Uri.file(absolutePath)`）。MSVC 编译输出：

- **行号 1-based**，VS Code `Position.line` 0-based —— 解析后 `line - 1`。
- **列号 1-based**，VS Code `Position.character` 0-based —— 解析后 `col - 1`。
- 路径在 Windows 上是反斜杠，统一转 forward slash（`MsvcParser` 末尾 `replace(/\\/g, '/')`）。
- 正则定义在 `package.json#contributes.problemMatchers[0].pattern.regexp` 和 `src/parsers/msvcParser.ts#MSVC_RE` **必须同步**（见仓库陷阱 #7）：

```
^(.*?)\((\d+)(?:,(\d+))?\)\s*:\s*(error|warning|note|fatal error)\s+([A-Z]+\d+)\s*:\s*(.*)$
```

捕获组：`1=file` `2=line` `3=column?` `4=severity` `5=code` `6=message`。

## 12. 入口激活顺序（硬约束）

`src/extension.ts` 是唯一入口，顺序不能换：

```
initI18n()        ← 必须最先，Logger 内部可能用翻译
→ Logger + Config
→ activateDetection(context, config, logger)         // 返回 DetectionHandles + ready Promise
→ new WorkspaceState({ detection, logger })          // [Phase 8] 单一真相源
→ new ClangdOps({ workspace, logger })               // [Phase 8] .clangd 统一 API
→ activateBuild / activateClangd / activateUI
→ activateCommands（最后一个，依赖全部 handles）
→ ControlPanelProvider.register(...)
→ runFirstTimeInit(...) // fire-and-forget (void)
```

`detection.ready` 是 Promise，UI 必须 `await` 它再渲染，避免竞态。

## 13. 仓库陷阱（来自根 `AGENTS.md` 13 条 + 验证）

每条都解释 **为什么** + **怎么绕**：

1. **`npm run test:integration` 已坏 / `npm test` = unit + integration** —— `package.json` 的 `test` 脚本现在为 `"npm run test:unit"`，但历史文档与多处 CI 假设 `test` 会跑 integration 步。`test/integration/runTests.js` 不存在。**只跑 unit 用 `npm run test:unit`**。⚠️ 2026-07-23 实测 `package.json:470` `test: npm run test:unit`，与 AGENTS.md 不一致 —— 文档比代码滞后。
2. **`completionMode` 设置已废弃** —— `package.json` 标 `deprecationMessage`，`'fast'` 在 `Config.completionMode` getter 归一化为 `'slow'`。`resources/preparse-includes/ue5-fast.json` 已删，只剩 `ue5-slow.json`。**不要新增 fast/slow 分支代码**。`Config.completionMode` getter 仍存在是兼容历史，新代码禁读。
3. **`resources/README.md` 描述过时** —— 还提 `ue5-fast.json` 和缺失的 `banner.png`，与现状不符。
4. **`.bak` 测试文件** —— `test/unit/commands/clangdProxyCommands.test.ts.bak` 是手备份，`.gitignore` 第 31 行有 `*.bak`（git 不会跟踪），但文件仍在 working tree 里 —— 别在 `find` / grep 时把它当真。提交前清掉。
5. **MCP 只在 Cursor / Claude Code 启动** —— 检测 `CURSOR_TRACE_ID` / `CURSOR_USER_DATA_DIR` / `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_SSE_PORT` 环境变量，普通 VS Code 里 MCP 是 no-op。改 MCP 不要假设 always-on。
6. **chokidar 必须在 vitest mock** —— `test/unit/setup.ts:249-264` 已 mock `chokidar.watch` 返回 chainable，否则 `fileWatcher.test.ts` 会启动真实 fs watcher 卡死进程。`test/unit/clangd/fileWatcher.test.ts` 用 `vi.hoisted` 提供 `__emit` 主动触发。
7. **MSVC 错误正则双处同步** —— `package.json#contributes.problemMatchers[0].pattern.regexp` + `src/parsers/msvcParser.ts#MSVC_RE` 字符串必须完全一致。改一处忘另一处 → 编译输出有但 Problems 面板看不到。
8. **`headerWatcher` 已删** —— Phase 8 改为 proxy 端 `UeDiagnosticWatcher` 被动触发 UBT 重生成（`src/clangd/proxy/ueDiagnosticWatcher.ts`），不要再加回主动 watcher。
9. **`out/` 必须清理** —— `npm run clean` 只删 `out/src/` 和 `out/test/`（防 `.vsix` 残留），不删 `out/extension.js`。`npm run build` 内部先 clean 再 bundle。手动 `rm -rf out` 可强制全清。
10. **`Config.update` 写完必须 refresh** —— `src/core/config.ts` 内部已处理 `WorkspaceConfiguration` 失效通知，但调用方常见误用：`await config.update(); 立刻读 config.xxx` 仍拿旧值（VS Code 同进程内不主动 notify）。改动该类代码要测试写入后读回。
11. **`completionMode` API 还在但语义死** —— getter 强制归一化为 `'slow'`。`Config.completionMode` 字段还在，新代码禁读判断分支。
12. **`populateAddCompletions` 是撒谎型兼容层 —— 已删（Phase 9）** —— grep `src/` 全仓库零匹配，函数不存在。AGENTS.md 此条目仅作历史档案，**不要"复活"**该函数。新代码直接调 `createCompletionFiles()`（仍是单一写入点）。
13. **6 个汉化 TODO 是僵尸承诺** —— `src/clangd/proxy/localization.ts:79/91/103` + `src/clangd/proxy/bridge.ts:676/685/694` 都写"后续实现"，未排进任何 phase。规划时不要假设汉化已上线。

## 14. 其他风格细节

- **依赖方向**：`src/extension.ts` → `core/detection/build/clangd/commands/ui/mcp/rules/i18n`，模块间单向依赖，禁止反向 import。
- **barrel 文件**：每个顶层目录有 `index.ts` 汇总公开 API（如 `src/clangd/index.ts` 导出 `ClangdOps` 等）。
- **ESM/CJS**：`module: Node16` + `esModuleInterop`，主入口 `out/extension.js` 是 CJS bundle（esbuild 配置）。
- **导出风格**：命名导出优先；只有 `extension.ts` 用默认导出。
- **错误码前缀**：`[SSoT]`、`[Phase 9]`、`[T4.5]` 等保留供治理规则使用。

---

*Convention analysis: 2026-07-23*
*Update when patterns change*
