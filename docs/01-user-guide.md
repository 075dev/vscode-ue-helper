# 03 · 用户使用指南

> 本文档面向 **UE C++ 程序员**，介绍如何安装、配置、使用 VSCodeUEHelper。

---

## 1. 安装

### 系统要求

- VS Code 1.85+
- Node.js 18+ （仅打包时需要，运行时不需要）
- Unreal Engine 4.27+ / 5.x（任何 UE 项目都能用）
- **Windows**：Visual Studio 2019/2022 + Windows SDK（建议）/ 或 LLVM 19+（可选，用作 clangd）
- **macOS / Linux**：Xcode / clang + Linux 工具链

### 从 .vsix 安装（推荐开发使用）

```bash
cd D:/AIWorkSpace/VScodePlugin/VSCodeUEHelper
npm install
npm run build
npm run package
# → out/vscode-ue-helper-0.1.0.vsix
```

然后在 VS Code 里 `Ctrl+Shift+P` → "Extensions: Install from VSIX" → 选刚才生成的 .vsix。

### 从 Marketplace 安装（待发布）

Phase 7 待发布 —— 走 `vsce publish`。

---

## 2. 第一次启动

当你打开包含 `.uproject` 的工作区时，VSCodeUEHelper 自动激活。期望发生：

1. 状态栏底部出现 **11 个按钮**
2. `$(file-code) XianDreamwalking`（项目名）和 `$(package) UE 5.8.0`（引擎版本）正常显示
3. Output 面板里能看到 `[VSCodeUEHelper] Activating...` 和 `[detection] projects: XianDreamwalking | engines: 5.8.0`

**如果只看到 `$(warning) No Project` / `$(warning) No Engine`**：检查 `.code-workspace` 的 `folders[]` 是否正确。详细排查见 §6。

---

## 3. 状态栏 11 个按钮

按从左到右顺序：

```
[$(play) Build]    [$(refresh) Rebuild]   [$(trash) Clean]
[$(gear) Config]   [$(symbol-class) Target]  [$(device-desktop) Platform]
[$(library) MSVC/SDK]
[$(file-code) Project]  [$(package) UE Engine]
[$(zap) Live Coding]   [$(rocket) Launch]
```

| 按钮 | 文字（举例） | 点击行为 |
|---|---|---|
| `$(play)` | `Build` | 用 UBT 编译当前项目 |
| `$(refresh)` | `Rebuild` | Clean + Build |
| `$(trash)` | `Clean` | 清构建产物 |
| `$(gear)` | `Development` | 弹 QuickPick 切换 Build Configuration |
| `$(symbol-class)` | `Editor` | 弹 QuickPick 切换 Target 类型 |
| `$(device-desktop)` | `Win64` | 显示当前 Platform（暂未绑定命令） |
| `$(library)` | `MSVC/SDK` | 弹 QuickPick 选 Windows SDK + MSVC + C++ 标准 |
| `$(file-code)` | `XianDreamwalking` | 显示项目信息（Output 面板） |
| `$(package)` | `UE 5.8.0` | 显示项目信息（Output 面板） |
| `$(zap)` | `Live Coding` | 触发 Live Coding 热重载（Windows） |
| `$(rocket)` | `Launch` | 启动 Unreal Editor |

**Build/Rebuild/Clean**：高亮背景（prominent）—— 视觉上更突出。
**Project/Engine 缺失时**：警告背景（红黄色） + `$(warning) No ...` 文字。
**MSVC/SDK / Live Coding / Launch**：高亮背景。

---

## 4. 命令面板（Ctrl+Shift+P）

输入 "UE Helper" 或 "vscodeUEHelper" 看完整命令列表。

### 常用命令

| 命令 | 说明 |
|---|---|
| `UE Helper: Build` | 编译项目 |
| `UE Helper: Rebuild` | Clean + Build |
| `UE Helper: Clean` | 清理构建产物 |
| `UE Helper: Launch Unreal Editor` | 启动 Editor |
| `UE Helper: Live Coding (Hot Reload)` | Live Coding 热重载（Windows） |
| `UE Helper: Generate compile_commands.json` | 重新生成 compile_commands.json |
| `UE Helper: Create Unreal Clangd Project` | 一次性创建 .clangd + addCompletions.h |
| `UE Helper: Set System Includes (Windows SDK / C++ Standard)` | 选 Windows SDK + MSVC + C++ 标准 |
| `UE Helper: Select Build Configuration` | 切换 Configuration |
| `UE Helper: Select Build Target` | 切换 Target 类型 |
| `UE Helper: Toggle Clangd Completion Mode (Fast/Slow)` | 快速/慢速补全模式 |
| `UE Helper: Show Project Info` | 弹输出面板显示项目状态 |
| `UE Helper: Open .code-workspace` | 在编辑器里打开 .code-workspace |
| `UE Helper: Regenerate Workspace from .uproject` | 从 .uproject 重新生成工作区文件 |
| `UE Helper: Install AI Agent Rules` | 复制 AI 规则到项目 |
| `UE Helper: Uninstall (Clean Generated Files)` | 清理 .clangd / compile_commands.json 等 |

---

## 5. 配置

打开 VS Code 设置（`Ctrl+,`）→ 搜 "vscodeUEHelper"：

| 配置 | 默认 | 说明 |
|---|---|---|
| `vscodeUEHelper.configuration` | `Development` | Build configuration |
| `vscodeUEHelper.target` | `Editor` | Target 类型（Editor/Game/Server/Client） |
| `vscodeUEHelper.platform` | `Win64` | 目标平台 |
| `vscodeUEHelper.clangdPath` | 空 | clangd.exe 完整路径（自动检测失败时设置） |
| `vscodeUEHelper.completionMode` | `fast` | 快速/慢速模式（影响 addCompletions.h 大小） |
| `vscodeUEHelper.autoBackupWorkspace` | `true` | 自动备份 .code-workspace |
| `vscodeUEHelper.useMCP` | `auto` | MCP 服务器模式（auto/always/never） |
| `vscodeUEHelper.lspLoggingLevel` | `info` | 日志详细级别 |
| `vscodeUEHelper.clangdProxy.enabled` | `false` | 启用 Clangd LSP Proxy（关闭文件保活 + 汉化） |
| `vscodeUEHelper.clangdProxy.realClangdPath` | 空 | **可选** 高级覆盖：留空时 proxy 会自动复用 `vscodeUEHelper.clangdPath` / 第三方 `clangd.path` / PATH；普通用户无需手动填写 |
| `vscodeUEHelper.clangdProxy.logPath` | 空 | proxy 日志文件路径；为空时只写 stderr |
| `vscodeUEHelper.clangdProxy.localization.enabled` | `false` | 启用诊断 / CodeAction / Hover 的汉化 |

建议在 **workspace 级别**配置（写到 `.vscode/settings.json`），不要污染全局设置。

#### Clangd LSP Proxy 解析顺序与安全回滚

启用 Proxy 时（`UE Helper: Enable Clangd LSP Proxy`），插件会按以下顺序自动解析真实 clangd 路径：

1. `vscodeUEHelper.clangdProxy.realClangdPath`（高级覆盖，常规用户留空）
2. `vscodeUEHelper.clangdPath`
3. 第三方 clangd 扩展当前的 `clangd.path`（自动排除 proxy launcher 自身）
4. 备份中的原始 `clangd.path`
5. 系统 PATH 中的 `clangd(.exe)`
6. Windows 默认 LLVM 安装目录（`C:\Program Files\LLVM\bin` 等）

如果上述全部无法定位有效 clangd，Enable 不会写入任何 clangd / proxy 配置，会回滚 `clangdProxy.enabled=false` 并在 Output 面板报错。

---

## 6. 故障排查

### "状态栏显示 No Project / No Engine"

1. 打开 Output 面板（`Ctrl+Shift+U`）选 "VSCodeUEHelper" 通道
2. 看 `[detection]` 开头的日志
3. 常见原因：
   - **没有 .code-workspace**：插件只读 `.code-workspace` 的 `folders[]`。没有这个文件就没法检测
   - **`.code-workspace` 格式错**：JSON 解析失败
   - **`.uproject` 不是合法 JSON5**：之前我们用 `JSON.parse` 失败过，已改 `JSON5.parse` 支持尾部逗号
   - **引擎路径不对**：`folders[1]` 指向的不是真的 UE 根目录（缺少 `Engine/Build/Build.version`）

### "Build 点击没反应 / spawn EINVAL"

之前遇到过：直接 spawn `.bat` 文件 Node 会返回 EINVAL。当前实现已经用 `cmd.exe /c Build.bat ...` 包装。如果还有问题：

1. 看 Output 面板错误信息
2. 确认 `Build.bat` 路径正确（`<UE>/Engine/Build/BatchFiles/Build.bat`）
3. 试试在终端手动跑同样的命令

### "Build 卡住，取消按钮无效"

插件用 `taskkill /F /T /PID <pid>` 杀整个进程树。如果取消还是无效：

1. 打开任务管理器，结束 `UnrealBuildTool.exe` 和 `dotnet.exe`
2. 看 Output 面板错误

### "clangd 不工作 / 看不到 UE 类型"

1. 确认 `compile_commands.json` 已生成：项目根目录下应该有这个文件
2. 如果没有，运行 `UE Helper: Generate compile_commands.json`
3. 确认 .clangd 文件存在：项目根目录下应该有这个文件
4. 如果没有，运行 `UE Helper: Create Unreal Clangd Project`
5. Windows 上：运行 `UE Helper: Set System Includes` 选对 SDK + MSVC 版本
6. 重启 clangd：调出命令面板 → "Clangd: Restart language server"

### "MSVC/SDK 按钮点了没反应 / 报 LLVM not found"

按提示：
1. 安装 LLVM：去 https://github.com/llvm/llvm-project/releases 下载 `LLVM-XX.X.X-win64.exe`
2. 安装时勾选 "Add LLVM to the system environment PATH"
3. 重启 VS Code

或者手动设置 `vscodeUEHelper.clangdPath` 到 `C:\Program Files\LLVM\bin\clangd.exe`。

### "Live Coding 不工作"

- 仅 Windows 支持
- 需要先 Build 一次（Live Coding 基于已编译的二进制）
- 引擎版本 ≥ 4.27

### "Clangd LSP Proxy 反复提示 Server process exited with code 0"

启用 Proxy 后，如果 Output 面板里反复出现 `Server process exited with code 0` / `connection disposed` 等重启循环，说明 proxy CLI 启动后立即正常退出，而不是作为 LSP 服务器保活。

该问题在**当前版本**已修复：

- bundled CLI `clangdProxy.js` 入口已接通 `process.stdin` ↔ `LspBridge.feedClientFrame()` 与 `bridge.onClientOutput()` ↔ `process.stdout`
- 回归测试 `test/unit/clangd/proxy/cliStdio.test.ts` 与 `e2eCliRestartLoop.test.ts` 覆盖「启动后不应立即退出」

受影响的范围（请升级到当前版本）：

- 老版本扩展（v0.1.0 之前或本仓库 2026-06 之前的快照）—— 老 CLI 入口没有接通 stdin/stdout
- 自定义 launcher / 手工打包脚本 —— 如果没有调用 bundled `runProxy(process.argv.slice(2))`，需要更新

升级步骤：

1. 升级到包含本次 stdio 修复的 VSCodeUEHelper 版本
2. 重新构建：`npm run build`
3. 重新启用 Proxy：`UE Helper: Disable Clangd LSP Proxy` → `UE Helper: Enable Clangd LSP Proxy`
4. 重启 clangd 或 Reload Window

---

## 7. 配合 AI 工具（Cursor / Claude Code）

VSCodeUEHelper 启动 MCP 服务器，让 AI 工具能感知 UE 项目结构。

### 启用 MCP

设置 `vscodeUEHelper.useMCP`：
- `auto`（默认）—— 仅在 Cursor / Claude Code 中自动启用
- `always` —— 强制启用
- `never` —— 禁用

### 可用的 MCP Tools

启动后，AI 工具能调用：
- `ue_list_projects` —— 列出当前工作区的 UE 项目
- `ue_read_uproject` —— 读 .uproject 字段
- `ue_read_clangd_config` —— 读 .clangd 配置
- 更多待添加

---

## 8. 中英双语

插件界面文字根据 VS Code 语言自动切换（`zh` ↔ `en`）。

强制切换：在命令面板运行：
- `Configure Display Language` → 选中文/英文

不影响命令 ID（命令 ID 始终是英文的 `vscodeUEHelper.xxx`）。

---

## 下一步

- [04-developer-guide.md](./04-developer-guide.md) —— 改插件
- [05-code-reference.md](./05-code-reference.md) —— 关键算法