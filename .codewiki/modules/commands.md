# commands 模块文档

## 基本信息
- **路径**: `src/commands/`
- **文件数**: 15
- **语言**: TypeScript
- **职责**: 15 个 VS Code 命令的实现——用户交互的入口，调用 detection/build/clangd 服务。

## 符号表

### 导出函数

| 函数名 | 文件:行号 | 命令 ID | 说明 |
|--------|----------|---------|------|
| activateCommands | `src/commands/index.ts` | — | 注册所有命令到 VS Code |
| executeBuild('build') | `src/commands/build.ts` | `vscodeUEHelper.build` | UBT 编译 |
| executeBuild('rebuild') | `src/commands/build.ts` | `vscodeUEHelper.rebuild` | Clean + Build |
| executeBuild('clean') | `src/commands/build.ts` | `vscodeUEHelper.clean` | UBT 清理 |
| executeLaunchEditor | `src/commands/launchEditor.ts` | `vscodeUEHelper.launchEditor` | 启动 Unreal Editor |
| executeLiveCoding | `src/commands/liveCoding.ts` | `vscodeUEHelper.liveCoding` | Live Coding 热重载 |
| executeGenerateCompileCommands | `src/commands/generateCompileCommands.ts` | `vscodeUEHelper.generateCompileCommands` | 生成 compile_commands.json |
| executeCreateProject | `src/commands/createProject.ts` | `vscodeUEHelper.createProject` | 创建 .clangd + completions |
| executeToggleCompletionMode | `src/commands/toggleCompletionMode.ts` | `vscodeUEHelper.toggleCompletionMode` | fast/slow 切换 |
| showProjectInfo | `src/commands/showProjectInfo.ts` | `vscodeUEHelper.showProjectInfo` | 显示项目状态到 Output |
| executeSetSystemIncludes | `src/commands/setSystemIncludes.ts` | `vscodeUEHelper.setSystemIncludes` | SDK/MSVC/C++ 标准 |
| executeInstallRules | `src/commands/installRules.ts` | `vscodeUEHelper.installRules` | 安装 AI rules |
| executeUninstall | `src/commands/uninstall.ts` | `vscodeUEHelper.uninstall` | 清理生成文件 |
| executeOpenWorkspaceFile | `src/commands/openWorkspaceFile.ts` | `vscodeUEHelper.openWorkspaceFile` | 打开 .code-workspace |
| executeRegenerateWorkspace | `src/commands/regenerateWorkspace.ts` | `vscodeUEHelper.regenerateWorkspace` | 从 .uproject 重新生成工作区 |
| executeSelectConfig | `src/commands/selectConfig.ts` | `vscodeUEHelper.selectConfig` | QuickPick 选 BuildConfiguration |
| executeSelectTarget | `src/commands/selectTarget.ts` | `vscodeUEHelper.selectTarget` | QuickPick 选 BuildTarget |

## 命令分类

### 构建相关 (3)
`build`, `rebuild`, `clean` — 都在 `src/commands/build.ts`，通过参数区分模式。

### 编辑器相关 (2)
`launchEditor`, `liveCoding` — Windows-only，Live Coding 有 `when: "isWindows"` 限制。

### clangd 相关 (3)
`generateCompileCommands`, `createProject`, `toggleCompletionMode`

### 配置相关 (3)
`setSystemIncludes`, `selectConfig`, `selectTarget`

### 项目/工作区相关 (3)
`showProjectInfo`, `openWorkspaceFile`, `regenerateWorkspace`

### 管理 (2)
`installRules`, `uninstall`

## 对外依赖

| 依赖模块 | 用途 |
|----------|------|
| @detection | 获取项目/引擎信息（所有命令） |
| @build | 执行构建/启动 Editor/Live Coding |
| @clangd | compile_commands 生成、clangd 配置 |
| @core/logger | 日志 |
| @core/config | 读取/更新配置 |
| @ui | QuickPick、Output 通道显示 |

## 被依赖情况

- `extension.ts` — 最后激活（`src/extension.ts:87`），传入 detection + clangd handles
- 不直接被其他模块导入——commands 是**用户入口**，通过 `vscode.commands.registerCommand` 注册
