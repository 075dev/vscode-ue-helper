# commands 模块知识库

## 模块概述

**16 个 VS Code 命令处理器**，用户交互的入口点。所有命令都绑定到 `vscodeUEHelper.*` 命名空间。

## 命令列表

| 命令 ID | 实现文件 | 功能 |
|---|---|---|
| `showProjectInfo` | `showProjectInfo.ts` | 显示项目/引擎检测结果 |
| `build` | `build.ts` | UBT 构建 |
| `rebuild` | `build.ts` | 清理 + 构建 |
| `clean` | `build.ts` | 清理构建产物 |
| `launchEditor` | `launchEditor.ts` | 启动 Unreal Editor |
| `liveCoding` | `liveCoding.ts` | Live Coding 热重载 |
| `generateCompileCommands` | `generateCompileCommands.ts` | 生成 compile_commands.json |
| `toggleCompletionMode` | `toggleCompletionMode.ts` | 切换 clangd 补全模式 (fast/slow) |
| `createProject` | `createProject.ts` | 创建 UE Clangd 项目脚手架 |
| `installRules` | `installRules.ts` | 安装 AI Agent 规则 |
| `uninstall` | `uninstall.ts` | 清理所有生成文件 |
| `setSystemIncludes` | `setSystemIncludes.ts` | 设置系统包含路径 (Windows) |
| `openWorkspaceFile` | `openWorkspaceFile.ts` | 打开 .code-workspace |
| `selectConfig` | `selectConfig.ts` | 选择构建配置 |
| `selectTarget` | `selectTarget.ts` | 选择构建目标 |

## 实现模式

### 标准命令函数签名
```typescript
export async function executeXxx(
  config: Config,        // 全局配置
  logger: Logger,        // 日志器
  detection: DetectionHandles,  // 检测层句柄
  // 可选: clangd?: ClangdHandles
): Promise<void>
```

### 注册模式 (index.ts)
```typescript
registerCommand(context, 'vscodeUEHelper.xxx', () =>
  executeXxx(config, logger, detection),
);
```

## 关键约定

### 错误处理
```typescript
try {
  // 业务逻辑
} catch (err) {
  logger.error('[module] operation failed:', err);
  vscode.window.showErrorMessage(t('key.error'));
}
```

### 用户交互
- **成功**：`showInformationMessage` + 日志
- **警告**：`showWarningMessage` + 日志
- **错误**：`showErrorMessage` + 日志
- **选择**：`showQuickPick` 返回 `T | undefined`

### 依赖管理
- 每个命令只依赖它真正需要的模块
- 禁止在命令层做复杂业务逻辑 - 委托给对应的模块 (build/clangd/detection)
- 命令层只负责：参数收集 → 调用下层 → 结果展示

## 新增命令步骤

1. **package.json**：在 `contributes.commands` 添加命令定义
2. **实现文件**：`src/commands/newCommand.ts` 写 `executeNewCommand`
3. **注册**：`index.ts` 导入 + `registerCommand` 调用
4. **国际化**：在 `i18n/locales/zh.ts` + `en.ts` 添加用户可见字符串
