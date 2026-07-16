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

`Config.update()` 写后，**同进程内** `WorkspaceConfiguration` 不会主动失效：

```typescript
// 错误：立刻读还是旧值
await config.update('completionMode', 'slow');
console.log(config.completionMode);   // 仍是 'fast'

// 正确：Config.update 内部已 refresh，消费方拿新 Config 实例
const freshConfig = await config.update();           // 返回新 Config
console.log(freshConfig.completionMode);             // 'slow'
```

**`completionMode` 已废弃** —— Config getter 强制归一化为 `'slow'`（详见根 AGENTS.md 陷阱 #11）。

## WorkspaceState [Phase 8]

**单一真相源**。构造时订阅 `detection.ready` 并 `setResult`，所有模块通过 `workspace` getter 拿派生路径：

```typescript
const workspace = new WorkspaceState({ detection, logger });
// ... workspace.projectDir        动态从 DetectionResult 派生
//     workspace.engineRoot
//     workspace.ubtPath            compute-on-demand
//     workspace.knownRoots
//     workspace.errorMessage
```

**迁移指南**：
- 老 API `activate*(detection)` 内部转调 `workspace` getter，向后兼容。
- **新代码应直接接 `workspace` 参数**，**不要新增 `projectDir: string`** 类型参数 —— 这正是 `@deprecated` 集中区域。

## command-registry 模式

```typescript
import { registerCommand } from '@core/command-registry';

registerCommand(context, 'vscodeUEHelper.myCmd', () => executeMy(...));
// ↑ 自动 push 到 context.subscriptions，调用方不用 dispose
```

**禁止**：
- 直接 `vscode.commands.registerCommand` 后忘记 push 到 subscriptions（切工作区会泄漏）。
- 重复注册同一 command ID（VS Code 会警告并覆盖）。
