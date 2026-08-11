<!-- Parent: ../../AGENTS.md -->
# core 模块 —— 横切基础设施

> 治理参考：`.specify/memory/constitution.md`。Core 是宪法 §II 的“真相源交付层”：派生路径统一由 `WorkspaceState` 暴露；`.clangd` 操作由依赖 `WorkspaceState` 的 `@clangd/clangdOps` 暴露；`registerCommand` 提供命令生命周期管理。业务层（含命令 / UI / MCP / 设置监听）必须走这些 API；ESLint `no-restricted-syntax` / `no-restricted-imports` 负责锁定绕过路径。

**重要**：无 `index.ts` 是**设计如此**，**不要新建**。所有调用通过 `@core/<name>` 路径别名（见宪法 Additional Constraints："相对导入禁止当存在 alias"）。

## 核心文件

| 文件                  | 调用密度               | 职责                                                                                                                            |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `logger.ts`           | 36 import              | `OutputChannel` 封装；`info` / `warn` / `error` / `debug` 四级；带 `[moduleName]` 前缀                                          |
| `config.ts`           | 22 import              | `vscodeUEHelper.*` 设置的读 / 写代理（带 `refreshRoot`）                                                                        |
| `workspace.ts`        | 13 import / 36 callers | **[Phase 8]** `WorkspaceState` —— 项目 / 引擎路径**单一真相源**（宪法 §II）；也是 `selectedProject` / `selectedEngine` 的真相源 |
| `command-registry.ts` | —                      | `vscode.commands.registerCommand` 包装，自动 push 到 `context.subscriptions`（宪法 §III）                                       |
| `runtime-detect.ts`   | —                      | AI 编辑器宿主检测（Cursor / Claude Code），供 MCP / commands 共用                                                               |
| `result.ts`           | —                      | `Result<T, E>` 类型 + `Ok` / `Err` / `isOk` 守卫                                                                                |
| `errors.ts`           | —                      | `VSCodeUEHelperError` + `E_*` 错误码常量                                                                                        |

## Logger 约定

```typescript
const logger = new Logger('moduleName'); // 前缀 = Output 面板标题 + 每行前缀
logger.info('[detection] workspaceFile = ...'); // 模块内进一步细分加 [subArea]
```

- 默认级别 `info`，用户可调到 `debug`（设置 `vscodeUEHelper.lspLoggingLevel`）。
- 时间戳精确到毫秒：`14:23:45.678 [INFO] [moduleName] ...`
- 对象参数走 `JSON.stringify`，注意循环引用。
- **一次性构造**：插件共享一个 Logger 实例（在 `extension.ts` 创建），模块内部**禁止**自己 `new`。
- 满足宪法 §III observable logs 要求：每个日志行带模块前缀 + 上下文。

## Config 双真相陷阱 [Pitfall #10]

`Config.update(key, value, target=Workspace)` 签名返回 `Promise<void>`（详见 `src/core/config.ts`）。它内部已调 `this.refreshRoot()`，所以**当前实例**能读新值；但**不要**按"返回新 Config 实例"使用：

```typescript
// 错误：update 不返回新 Config 实例
const freshConfig = await config.update(); // TS 报错 + 运行时 freshConfig === undefined
console.log(freshConfig.completionMode); // TypeError

// 正确：update 接收 (key, value)，当前实例读
await config.update('platform', 'Win64');
console.log(config.platform); // 已是新值
```

**`completionMode` 设置已完全删除**（H4-B 决策 + Plan B 收束，见 REMEDIATION-PLAN §十二）。`Config` getter 永远返回 `'slow'` 字面量；新代码**禁止**读 `config.completionMode` 决策分支，UI 也已移除相关 toggle 状态栏按钮（详见 `src/clangd/AGENTS.md` 与 `src/ui/AGENTS.md`）。

## WorkspaceState [Phase 8 + 9 SSoT 收尾]

**单一真相源**（Phase 8）+ **`selectedProject` / `selectedEngine` 收敛**（Phase 9）。构造时订阅 `detection.ready` 并 `setResult`，所有模块通过 `workspace` getter 拿派生路径：

```typescript
const workspace = new WorkspaceState({ detection, logger, workspaceContext: detection.workspaceContext });
// 派生路径 getter（Level 1/2/3 共 20+ 字段）
workspace.projectDir; // 项目根目录（来自 .uproject）
workspace.engineRoot; // 引擎根目录（来自 Build.version）
workspace.workspaceFile; // .code-workspace 绝对路径
workspace.workspaceFolders; // 已分配 role 的 folders[]
workspace.workspaceRoot; // .code-workspace 的 dirname
workspace.clangdConfigPath; // 项目根 .clangd
workspace.clangdHelperDir; // .vscode/vscodeuehelper/
workspace.compileCommandsPath; // compile_commands.json 路径
// ... 6 个补全文件路径（macroHelperPath / addCompletionsPath / addMacroCompletionsPath ...）

// 用户选择（Phase 9 新增，持久化于 workspaceContext.memento）
workspace.selectedProject; // string | null
workspace.selectedEngine; // string | null
await workspace.setSelectedProject(project);
await workspace.setSelectedEngine(engine);
```

**SSoT 规则（必须遵守，违反会被 ESLint 拦下）**：

| ❌ 禁止                                                                  | ✅ 改用                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `vscode.workspace.workspaceFile` 直读                                    | `workspace.workspaceFile`                                                |
| `vscode.workspace.workspaceFolders` 直读                                 | `workspace.workspaceFolders`                                             |
| `vscode.workspace.getWorkspaceFolder(...)` 直读（除构造 vscode.Task 时） | `workspace.workspaceFolders`                                             |
| `detection.workspaceContext.getSelectedProject()` 等                     | `workspace.selectedProject` / `workspace.selectedEngine`                 |
| `detection.workspaceContext.setProject(...)` / `setEngine(...)`          | `workspace.setSelectedProject(...)` / `workspace.setSelectedEngine(...)` |
| `path.join(root, '.clangd')` 等文件路径拼接                              | `workspace.clangdConfigPath` / `workspace.compileCommandsPath`           |

ESLint 锁规则见仓库根 `.eslintrc.json` 内的 `no-restricted-syntax` / `no-restricted-imports`。
新增 getter 必须经过"派生规则"审核 —— 见宪法 §II。

**迁移指南**：

- 老 API `activate*(detection)` 内部转调 `workspace` getter，向后兼容。
- **新代码应直接接 `workspace` 参数**，**不要新增 `projectDir: string`** 类型参数。
- 命令函数 `workspace` 参数为可选时 —— 表示老调用方 / test 兼容，生产 `commands/index.ts` 必传。

## command-registry 模式

```typescript
import { registerCommand } from '@core/command-registry';

registerCommand(context, 'vscodeUEHelper.myCmd', () => executeMy(...));
// ↑ 自动 push 到 context.subscriptions，调用方不用 dispose
```

**禁止**：

- 直接 `vscode.commands.registerCommand` 后忘记 push 到 subscriptions（切工作区会泄漏，违反宪法 §III）。
- 重复注册同一 command ID（VS Code 会警告并覆盖）。

## Result<T, E> 使用约定

新代码遇到"业务预期失败"（配置无效 / detection 未就绪 / 进程崩溃），优先用 `Result<T, E>`（`@core/result`）而非 `throw`。调用方通过 `isOk` / `isErr` 类型守卫分支，无需 try / catch。

不替换现有 `throw` 路径 —— 仅供新增 / 重构代码使用。错误码关联 `@core/errors` 的 `E_*` 常量。

```typescript
import { Ok, Err, isOk } from '@core/result';
import { E_CONFIG_INVALID, VSCodeUEHelperError } from '@core/errors';

function readConfig(): Result<Config> {
  if (!existsSync(path)) return Err(E_CONFIG_INVALID, 'config file missing');
  return Ok(JSON.parse(readFileSync(path, 'utf-8')));
}
```

## 错误码体系

项目级错误用 `VSCodeUEHelperError` 类 + `E_*` 常量（均来自 `@core/errors`）：

- `E_CONFIG_INVALID`：配置无效（JSON parse 失败 / 字段缺失）
- `E_DETECTION_NOT_READY`：`detection.ready` Promise 未 resolve（检查是否在 workspace 中打开 `.code-workspace`）
- `E_BUILD_FAILED`：UBT / Live Coding 进程失败
- `E_PROXY_CRASHED`：clangd proxy 子进程异常退出（查 `~/.vscode/extensions/.../logs/` 里的 proxy 日志）

catch 块用 `isVSCodeUEHelperError(e)` 类型守卫路由：

```typescript
import { isVSCodeUEHelperError, E_DETECTION_NOT_READY } from '@core/errors';

try { ... }
catch (e) {
  if (isVSCodeUEHelperError(e) && e.code === E_DETECTION_NOT_READY) {
    vscode.window.showWarningMessage(t('detection.notReady'));
  } else { throw e; }
}
```

新错误码添加：在 `src/core/errors.ts` 加 `E_*` 常量 + 扩展 `ErrorCode` union type。

## 日志、i18n、生命周期约束（宪法 §III）

- **日志**：Core 自身模块日志前缀 `[core]`；模块外调用 Logger 时使用更具体的模块前缀（`[detection]` / `[commands]` 等）。
- **i18n**：Core 抛出的错误码 + 错误消息必须能在调用方翻译为双语 key；Core 本身不直接 `vscode.window.show*` —— 通知交给 UI 层（`@ui/notifications.ts`）。
- **生命周期**：`Logger` / `Config` / `WorkspaceState` 由 `extension.ts` 一次构造并由扩展上下文拥有；模块内部禁止自建重复实例。

## 跨模块输入约束

- `Config` 设置写入必须经 `update(key, value)`；**不**直接 `vscode.workspace.getConfiguration().update()`。
- `WorkspaceState` 派生字段命名遵循 `Level1.Level2` 风格（如 `clangdConfigPath` / `addCompletionsPath`）—— 新增 getter 必须有清晰一级 / 二级归类。
