# core 模块文档

## 基本信息
- **路径**: `src/core/`
- **文件数**: 3
- **语言**: TypeScript
- **职责**: 基础工具层——Logger、Config、命令注册。所有模块的公共依赖。

## 符号表

### 导出类

| 类名 | 文件:行号 | 说明 | 公开方法 |
|------|----------|------|----------|
| Logger | `src/core/logger.ts` | 轻量 Logger，封装 `vscode.OutputChannel` | `info()`, `warn()`, `error()`, `show()` |
| Config | `src/core/config.ts` | `vscode.workspace.getConfiguration` 强类型包装 | `get`, `update(key, value, target)` |

### 导出函数

| 函数名 | 文件:行号 | 签名 | 说明 |
|--------|----------|------|------|
| registerCommand | `src/core/command-registry.ts` | `registerCommand(context, id, callback): Disposable` | 包装 `vscode.commands.registerCommand`，自动 dispose |

### 关键类型

| 类型名 | 文件:行号 | 说明 |
|--------|----------|------|
| BuildConfiguration | `src/core/config.ts` | `'Debug' \| 'DebugGame' \| 'Development' \| 'Shipping' \| 'Test'` |
| BuildTarget | `src/core/config.ts` | `'Editor' \| 'Game' \| 'Server' \| 'Client'` |
| BuildPlatform | `src/core/config.ts` | `'Win64' \| 'Mac' \| 'Linux'` |

## 内部依赖图

```
Logger ──→ vscode.OutputChannel (VS Code API)
Config ──→ vscode.workspace.getConfiguration (VS Code API)
command-registry ──→ vscode.commands.registerCommand
```

- `Logger` 接受 `i18n` 的翻译（`extension.ts` 先调 `initI18n()` 再 `new Logger()`）

## 对外依赖

| 依赖模块 | 导入的符号 | 用途 |
|----------|-----------|------|
| vscode | OutputChannel, WorkspaceConfiguration | VS Code 宿主 API |

## 被依赖情况

被**所有**模块依赖——core 是基础设施层：
- `extension.ts` — 创建 Logger/Config 实例
- `detection/` — 使用 Logger 记录检测结果
- `build/` — 使用 Logger + Config 读取构建配置
- `clangd/` — 使用 Logger + Config
- `commands/` — 使用 `registerCommand` 注册命令
- `ui/` — 使用 Logger
