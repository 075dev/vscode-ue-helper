# build 模块文档

## 基本信息
- **路径**: `src/build/`
- **文件数**: 7
- **语言**: TypeScript
- **职责**: UBT 构建系统、Live Coding 热重载、启动 Unreal Editor、Task Provider。

## 符号表

### 导出函数

| 函数名 | 文件:行号 | 签名 | 说明 |
|--------|----------|------|------|
| activateBuild | `src/build/index.ts` | `activateBuild(context, config, logger, detection)` | 注册 UBT Task Provider |
| runBuild | `src/build/buildRunner.ts` | 执行 UBT 编译 | spawn `cmd.exe /c Build.bat` |
| buildUBTCommand | `src/build/ubt.ts` | 构造 UBT 命令行参数 | 拼接 target/platform/config |
| resolveEditorPath | `src/build/launchEditor.ts` | 解析 UE Editor 可执行文件路径 | 从引擎目录推导 |
| liveCoding | `src/build/liveCoding.ts` | 触发 Live Coding 热重载 | Windows-only |

### 导出类型

| 类型名 | 文件:行号 | 说明 |
|--------|----------|------|
| BuildTask | `src/build/taskProvider.ts` | VS Code Task 定义 |
| BuildOptions | `src/build/types.ts` | 构建配置选项 |

## 进程模型

### Fire-and-forget（启动 Editor）

```
src/build/launchEditor.ts
spawn('cmd', ['/c', 'start', '', editor.exe, projectPath], {
  detached: true,
  stdio: 'ignore'
})
```

### Long-running with cancellation（UBT 构建）

```
src/build/buildRunner.ts
spawn('cmd.exe', ['/c', 'Build.bat', ...args], {
  detached: !win32  // Linux/Mac 可 detach
})
+ AbortSignal 支持取消
```

### 进程树杀灭

```
taskkill /F /T /PID <pid>
// 杀整棵进程树: cmd.exe → Build.bat → dotnet → UnrealBuildTool
```

## 关键约束

- `.bat` 文件**不能**直接 spawn，必须 `cmd.exe /c Build.bat ...`
- `child.kill()` **不够**——必须 `taskkill /F /T` 杀整棵树
- Live Coding 只在 Windows 上可用（`when: "isWindows"`）

## 对外依赖

| 依赖模块 | 导入的符号 | 用途 |
|----------|-----------|------|
| @detection | DetectionHandles | 获取项目/引擎路径 |
| @core/logger | Logger | 构建日志 |
| @core/config | Config | 读取 BuildConfiguration/Target/Platform |
| @parsers | UbtParser, MsvcParser | 解析构建输出 |
| execa (npm) | execa | 进程 spawn |

## 被依赖情况

- `extension.ts` — 第二个激活（`src/extension.ts:78`）
- `commands/` — build/rebuild/clean/launchEditor/liveCoding 命令
- `mcp/` — MCP 工具可能调用构建
