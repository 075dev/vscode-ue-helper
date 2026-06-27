# extension.ts 入口文档

## 基本信息
- **路径**: `src/extension.ts`
- **文件数**: 1 (143 行)
- **语言**: TypeScript
- **职责**: VS Code 插件入口——按固定顺序激活所有子系统，串联模块依赖。

## 符号表

### 导出函数

| 函数名 | 行号 | 签名 | 说明 |
|--------|------|------|------|
| activate | `src/extension.ts:56` | `activate(context: vscode.ExtensionContext): Promise<void>` | VS Code 激活入口，按顺序初始化所有子系统 |
| deactivate | `src/extension.ts:128` | `deactivate(): void` | VS Code 卸载入口，清理所有 disposable |

## 激活流程（按行号）

| 步骤 | 行号 | 操作 | 依赖 |
|------|------|------|------|
| 1 | 59 | `initI18n()` | 无 |
| 2 | 62 | `new Logger('VSCodeUEHelper')` | i18n |
| 3 | 65 | `new Config()` | 无 |
| 4 | 75 | `activateDetection(context, config, logger)` | Logger, Config |
| 5 | 78 | `activateBuild(context, config, logger, detection)` | Logger, Config, Detection |
| 6 | 81 | `activateClangd(context, config, logger, detection)` | Logger, Config, Detection |
| 7 | 84 | `activateUI(context, config, logger, detection)` | Logger, Config, Detection |
| 8 | 87 | `activateCommands(context, config, logger, detection, clangd)` | Logger, Config, Detection, Clangd |
| 9 | 91 | 报告启动耗时 + 首次欢迎信息 | 全部 |

## 错误处理

| 层级 | 行号 | 策略 |
|------|------|------|
| 整体 try/catch | 71-118 | 任何激活步骤失败 → `logger.error` + `showErrorMessage` |
| deactivate 清理 | 134-142 | 逐条 dispose，单条失败不影响其他清理 |

## 对内依赖

| 导入 | 来源 |
|------|------|
| Logger | `@core/logger` |
| Config | `@core/config` |
| activateDetection | `@detection` |
| activateBuild | `@build` |
| activateClangd | `@clangd` |
| activateUI | `@ui` |
| activateCommands | `@commands` |
| showProjectInfo | `@commands/showProjectInfo` |
| initI18n, t | `@i18n` |

## 被依赖情况

不被任何模块导入——extension.ts 是**唯一入口**，只被 VS Code 宿主调用。

## 模块级变量

| 变量 | 行号 | 用途 |
|------|------|------|
| `logger: Logger` | 41 | 模块级 Logger 实例，deactivate 时也要用 |
| `disposables: Disposable[]` | 44 | 备用 disposable 列表（当前各模块自己管理 context.subscriptions） |
