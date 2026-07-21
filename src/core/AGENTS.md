# core 模块 —— 横切基础设施

**重要**：无 `index.ts` 是**设计如此**，**不要新建**。所有调用通过 `@core/<name>` 路径别名。模块边界与别名映射见根 `AGENTS.md`。

## 核心文件

| 文件 | 调用密度 | 职责 |
|---|---|---|
| `logger.ts` | 36 import | OutputChannel 封装，info/warn/error/debug 四级 |
| `config.ts` | 22 import | `vscodeUEHelper.*` 设置的读/写代理（带 refresh） |
| `workspace.ts` | 13 import / 36 callers | **[Phase 8]** `WorkspaceState` —— 项目/引擎路径单一真相源 |
| `command-registry.ts` | — | `vscode.commands.registerCommand` 包装，自动 push 到 `context.subscriptions` |

## Logger 约定

```typescript
const logger = new Logger('moduleName');              // 前缀 = Output 面板标题 + 每行前缀
logger.info('[detection] workspaceFile = ...');       // 模块内进一步细分加 [subArea]
```

- 默认级别 `info`，用户可调到 `debug`（设置 `vscodeUEHelper.lspLoggingLevel`）。
- 时间戳精确到毫秒：`14:23:45.678 [INFO] [moduleName] ...`
- 对象参数走 `JSON.stringify`，注意循环引用。
- 一次性构造：插件共享一个 Logger 实例（在 `extension.ts` 创建），模块内部**禁止**自己 new。

## Config 双真相陷阱 [Pitfall #10]

`Config.update(key, value)` 签名返回 `Promise<void>`（详见 `src/core/config.ts:268-297`）。它内部已调 `this.refreshRoot()`，所以**当前实例**能读新值；但**不要**按"返回新 Config 实例"使用：

```typescript
// 错误：update 不返回新 Config 实例
const freshConfig = await config.update();           // TS 报错 + 运行时 freshConfig === undefined
console.log(freshConfig.completionMode);             // TypeError

// 正确：update 接收 (key, value)，当前实例读
await config.update('clangdHeaderWatcher.enabled', true);
console.log(config.clangdHeaderWatcherEnabled);      // 已是新值
```

**`completionMode` 设置已完全删除**（H4-B 决策，见 REMEDIATION-PLAN §十二）。Config getter 永远返回 `'slow'` 字面量，UI 移除 toggle 按钮。

## WorkspaceState [Phase 8 + 9 SSoT 收尾]

**单一真相源**（Phase 8）+ **selected* 收敛**（Phase 9）。构造时订阅 `detection.ready` 并 `setResult`，所有模块通过 `workspace` getter 拿派生路径：

```typescript
const workspace = new WorkspaceState({ detection, logger, workspaceContext: detection.workspaceContext });
// ... 派生路径 getter ── 20+ Level 1/2/3 字段
workspace.projectDir                 // 项目根目录（来自 .uproject）
workspace.engineRoot                 // 引擎根目录（来自 Build.version）
workspace.workspaceFile              // .code-workspace 绝对路径
workspace.workspaceFolders           // 已分配 role 的 folders[]
workspace.workspaceRoot              // .code-workspace 的 dirname
workspace.clangdConfigPath            // 项目根 .clangd
workspace.clangdHelperDir            // .vscode/vscodeuehelper/
workspace.compileCommandsPath        // compile_commands.json 路径
// ... 6 个补全文件路径（macroHelperPath / addCompletionsPath / addMacroCompletionsPath ...）

// ... 用户选择（Phase 9 新增，持久化于 workspaceContext.memento）
workspace.selectedProject            // string | null
workspace.selectedEngine             // string | null
await workspace.setSelectedProject(project)
await workspace.setSelectedEngine(engine)
```

**SSoT 规则（必须遵守，违反会被 ESLint 拦下）**：

| ❌ 禁止 | ✅ 改用 |
|---|---|
| `vscode.workspace.workspaceFile` 直读 | `workspace.workspaceFile` |
| `vscode.workspace.workspaceFolders` 直读 | `workspace.workspaceFolders` |
| `vscode.workspace.getWorkspaceFolder(...)` 直读（除构造 vscode.Task 时） | `workspace.workspaceFolders` |
| `detection.workspaceContext.getSelectedProject()` 等 | `workspace.selectedProject` / `workspace.selectedEngine` |
| `detection.workspaceContext.setProject(...)` / `setEngine(...)` | `workspace.setSelectedProject(...)` / `workspace.setSelectedEngine(...)` |
| `path.join(root, '.clangd')` 等文件路径拼接 | `workspace.clangdConfigPath` / `workspace.compileCommandsPath` |

ESLint 锁规则见仓库根 `.eslintrc.json` 内的 `no-restricted-syntax` / `no-restricted-imports`。
新增 getter 必须经过"派生规则"审核——见根 AGENTS.md 顶部 WorkspaceState 设计原则 §2。

**迁移指南**：
- 老 API `activate*(detection)` 内部转调 `workspace` getter，向后兼容。
- **新代码应直接接 `workspace` 参数**，**不要新增 `projectDir: string`** 类型参数。
- 命令函数 `workspace` 参数为可选时——表示老调用方/test 兼容，生产 `commands/index.ts` 必传。

## command-registry 模式

```typescript
import { registerCommand } from '@core/command-registry';

registerCommand(context, 'vscodeUEHelper.myCmd', () => executeMy(...));
// ↑ 自动 push 到 context.subscriptions，调用方不用 dispose
```

**禁止**：
- 直接 `vscode.commands.registerCommand` 后忘记 push 到 subscriptions（切工作区会泄漏）。
- 重复注册同一 command ID（VS Code 会警告并覆盖）。
