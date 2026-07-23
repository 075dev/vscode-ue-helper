# 调试指南

VSCodeUEHelper 扩展的调试手册。开发期 + 用户侧问题排查都查本文。

## 1. 启动 Extension Development Host (EDH)

按 `F5` 启动 EDH(`.vscode/launch.json` 配置 `Run Extension`)。
EDH 是独立 VS Code 窗口,加载当前扩展源代码(非 Marketplace 版本)。

- 启动前:确认 `npm run watch` 已在跑(esbuild 监听模式)
- 启动后:EDH 窗口独立,主窗口与 EDH 窗口可并存
- 停止:EDH 窗口关闭即停;也可在主窗口 `Run → Stop Debugging`

## 2. 扩展日志位置

| 位置 | 内容 | 路径/入口 |
|---|---|---|
| **EDH 窗口 "输出" 面板** | 所有模块日志(info/warn/error/debug) | 下拉选 `VSCodeUEHelper` (共享 channel,所有模块共用) |
| **DevTools Console** | `console.log` / `console.warn` / `console.error` | EDH 窗口 `Ctrl+Shift+I` → Console |
| **主进程终端** | esbuild 错误 / tsc 错误 / 启动崩溃 | 仓库根 `npm run watch` 终端 |
| **clangd proxy 子进程日志** | LSP 协议层日志 | Windows: `%USERPROFILE%\.vscode\extensions\<publisher>.<name>-<version>\logs\`<br>命名: `vscode-ue-helper-proxy-<timestamp>.log` |
| **UE 引擎侧输出** | UBT / Live Coding 进程输出 | Output 面板 `UE Build` / `UE Live Coding` channel(若启用) |

## 3. Attach 到 clangd proxy 子进程

proxy 是独立 Node 子进程,默认不阻塞 LSP。Attach 步骤:

1. EDH 打开项目,触发任何 LSP 请求(didOpen / didChange)
2. 任务管理器 / Process Explorer 找 `node.exe` 进程(command line 含 `clangdProxy.js`)
3. 用 `chrome --inspect=9229` 启动(在 launcher 脚本前加 `NODE_OPTIONS=--inspect=9229` 环境变量)
4. Chrome 打开 `chrome://inspect`,选 9229 端口的 target

> **注意**: proxy stdout 是 LSP 协议,写日志必须用 stderr 或 `--log-path` 选项(per AGENTS.md 仓库陷阱 #11)。

## 4. 常见问题排查

### 4.1 MSVC 路径未检测

- **症状**: UBT 报错 `cl.exe not found`
- **检查**: `Settings → Extensions → VSCodeUEHelper` 看 "MSVC path" 设置
- **修复**: 重装 Visual Studio Build Tools,或手动填 MSVC 路径(扩展通过 `vswhere.exe` 自动发现,默认路径 `%ProgramFiles(x86)%\Microsoft Visual Studio\`)

### 4.2 clangd 启动失败

- **症状**: 编辑器无智能提示,"输出" 面板无 `[clangd]` 日志
- **检查**: `Settings → Extensions → VSCodeUEHelper → Clangd: Path` 是否指向 `out/launcher/proxy-launcher.bat`
- **修复**: 跑 `npm run build` 重新生成 launcher;或手动设置 clangd 路径

### 4.3 UBT 报错无诊断

- **症状**: "输出" 面板有 UBT 错误,但 Problems 面板空白
- **检查**: `Settings → Extensions → VSCodeUEHelper → Use Script As Executable` 是否勾选
- **修复**: 重启 EDH;或手动 `> Diagnose Clangd Project` 命令

### 4.4 Live Coding 不触发 (ueLinkManager H1)

- **症状**: 保存 `.h` 不自动 UHT + 不自动 reparse
- **检查**: Live Coding 状态栏按钮(右下角 `$(check) UE✓` / `$(sync~spin) UE Sync` / `$(clock) UE throttle ...` / `$(alert) UE Sync Error`)
- **修复**: 检查 `.uproject` 文件存在 + Engine path 设置正确;保存文件须在 `Source/` 或 `Plugins/.../Source/` 路径下;mtime 跳过的保存会自动跳过 UHT(状态栏看 tooltip 验证)
- **详细**: 见 `src/clangd/ueLinkManager.ts` 顶部 docstring

### 4.5 检测不到 .uproject

- **症状**: 状态栏 "项目" 按钮空白,所有命令显示 "no project"
- **检查**: `.code-workspace` 的 `folders[]` 第一项 `path === '.'` 是否指向项目根
- **修复**: 编辑 `.code-workspace` 确认 `path` 字段;或用 `> Create Clangd Project` 命令重建工作区

### 4.6 MCP 工具不生效

- **症状**: Cursor / Claude Code 里 `ue_build` 等工具不出现
- **检查**: `Settings → Extensions → VSCodeUEHelper → Use MCP` 必须设 `'auto'` / `'always'`(`'auto'` 仅在 Cursor/Claude Code 启动时激活)
- **修复**: 重启 Cursor/Claude Code;检查 `process.env.CURSOR_TRACE_ID` 等环境变量(见 `src/mcp/AGENTS.md`)

## 5. 性能 / 内存问题

- **冷启动慢**: 看 EDH 启动时间,仓库承诺 < 3s(vs Rider ~10s)。若 > 5s,检查 `npm run build` 产物大小
- **索引慢**: 跑 `> Toggle Performance Log` 命令 + 看 `VSCodeUEHelper-perf` 面板。`genMs` / `hitRate` / `incrMs` 三指标
- **内存高**: 任务管理器看 `code.exe` 进程,仓库承诺 < 1.5GB(中等 UE5 项目)。若 > 2GB,八成是 LSP proxy 句柄泄漏,重启 EDH

## 6. 报告 Bug

GitHub Issues 模板:附以下信息

- EDH "输出" 面板的 `VSCodeUEHelper` channel 完整日志(从启动到崩溃)
- 任务管理器 `code.exe` 进程内存占用
- 复现步骤(最小可复现 demo)
- VS Code 版本(`Help → About`) + 扩展版本(`Extensions` 面板) + Engine 版本(`Help → About Unreal Editor`)
- 操作系统版本 + 架构(Win10 22H2 x64 / Win11 23H2 ARM 等)
