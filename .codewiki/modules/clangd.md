# clangd 模块文档

## 基本信息
- **路径**: `src/clangd/`
- **文件数**: 9
- **语言**: TypeScript
- **职责**: clangd IntelliSense 配置、compile_commands.json 生成、Windows SDK/MSVC 发现、工作区备份。

## 符号表

### 导出函数

| 函数名 | 文件:行号 | 签名 | 说明 |
|--------|----------|------|------|
| activateClangd | `src/clangd/index.ts` | `activateClangd(context, config, logger, detection)` | 启动 clangd 状态栏 + 工作区备份 |
| generateCompileCommands | `src/clangd/compileCommands.ts` | 生成 compile_commands.json | 调 UBT 生成 |
| writeClangdConfig | `src/clangd/clangdConfig.ts` | 写 `.clangd` 配置文件 | 配置 clangd 行为 |
| discoverSystemIncludes | `src/clangd/windowsSdk.ts:32-194` | 发现 Windows SDK/MSVC include 路径 | 通过 InstalledDir 反查 |
| toggleCompletionMode | `src/clangd/completionMode.ts` | fast/slow 切换 | 精选 vs 全面头文件列表 |
| backupWorkspace | `src/clangd/workspaceBackup.ts` | 备份 .code-workspace | 防止 UBT 刷新覆盖 |
| installCompletions | `src/clangd/completionFiles.ts` | 安装补全头文件 | addCompletions.h 模板 |

### 导出类型

| 类型名 | 文件:行号 | 说明 |
|--------|----------|------|
| ClangdConfig | `src/clangd/types.ts` | clangd 配置项 |
| CompletionMode | `src/clangd/types.ts` | `'fast' \| 'slow'` |
| SystemIncludes | `src/clangd/types.ts` | SDK/MSVC 包含路径 |

## 关键算法

### clangd 路径发现（InstalledDir）

`src/clangd/windowsSdk.ts:32-194` — 通过 MSVC 的 InstalledDir 反查 include 路径，兼容不同 VS 版本和安装路径。

### compile_commands.json symlink 策略

生成后做 symlink 到项目根目录，让 clangd 能找到。

### 工作区备份

`autoBackupWorkspace=true` 时，UBT 生成前自动备份 `.code-workspace`，生成后恢复——防止 UBT 覆盖用户设置。

## 对外依赖

| 依赖模块 | 导入的符号 | 用途 |
|----------|-----------|------|
| @detection | DetectionHandles | 获取引擎/项目信息 |
| @core/logger | Logger | 日志 |
| @core/config | Config | 读取 clangdPath/completionMode/autoBackupWorkspace |

## 被依赖情况

- `extension.ts` — 第三个激活（`src/extension.ts:81`）
- `commands/` — generateCompileCommands, createProject, toggleCompletionMode, setSystemIncludes 命令
- `mcp/` — MCP 工具可能查询 clangd 状态
