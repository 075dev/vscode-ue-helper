# VSCodeUEHelper 插件使用说明

> 面向 Unreal Engine C++ 开发者。本文介绍 VSCodeUEHelper 的安装、配置、常用命令、clangd 工作流、clangd LSP Proxy 与故障排查。

---

## 1. 插件简介

VSCodeUEHelper 是一个用于 VS Code 的 Unreal Engine C++ 开发辅助插件，主要提供：

- 自动检测 `.uproject` 与 UE 引擎目录
- UBT Build / Rebuild / Clean 集成
- Unreal Editor 启动
- Windows Live Coding 热重载
- `compile_commands.json` 生成
- `.clangd` 与 UE 宏补全辅助文件生成
- Windows SDK / MSVC / C++ 标准选择
- `.code-workspace` 自动备份与恢复
- Cursor / Claude Code / Copilot AI 规则生成
- 可选 clangd LSP Proxy：关闭文件保活、中文诊断说明、安全回滚

---

## 2. 环境要求

| 项目 | 要求 |
|---|---|
| VS Code | 1.85+ |
| Unreal Engine | 推荐 UE 5.2+，也可用于 UE4.27+ 项目 |
| clangd 扩展 | 推荐 `llvm-vs-code-extensions.vscode-clangd` |
| Node.js | 18+，开发或打包插件时需要 |

Windows 推荐安装 Visual Studio Build Tools、MSVC、Windows SDK、LLVM/clangd。

---

## 3. 安装

### 3.1 从源码构建 VSIX

```bash
npm install
npm run build
npm run package
```

生成文件通常为：

```text
vscode-ue-helper-0.1.0.vsix
```

安装方式：

1. 打开命令面板：`Ctrl+Shift+P`
2. 执行 `Extensions: Install from VSIX...`
3. 选择生成的 `.vsix`

命令行安装：

```bash
code --install-extension vscode-ue-helper-0.1.0.vsix
```

### 3.2 开发模式运行

```bash
npm install
npm run build
```

然后在 VS Code 中按 `F5` 启动 Extension Development Host。

---

## 4. 推荐工作区结构

推荐使用 `.code-workspace` 打开 UE 项目：

```text
MyGame/
├── MyGame.uproject
├── Source/
├── Config/
├── Content/
└── MyGame.code-workspace
```

打开方式：

```bash
code MyGame.code-workspace
```

插件会扫描工作区中的 `.uproject`，并尝试检测 UE 引擎目录、构建工具链和 clangd。

---

## 5. 第一次启动检查

打开项目后，建议先执行：

```text
UE Helper: Show Project Info
```

确认以下内容：

- `.uproject` 是否检测正确
- UE 引擎路径是否检测正确
- 当前 Build Configuration / Target / Platform 是否正确
- clangd 路径是否可用
- Windows 下 MSVC / SDK 是否可用

如果状态栏显示 `No Project` 或 `No Engine`，请检查 `.code-workspace`、`.uproject` 位置和 Output 面板中的 `VSCodeUEHelper` 日志。

---

## 6. 基础配置

### 6.1 UE 引擎检测

```json
{
  "vscodeUEHelper.engineRoot": "",
  "vscodeUEHelper.ueVersion": ""
}
```

| 配置项 | 说明 |
|---|---|
| `vscodeUEHelper.engineRoot` | UE 引擎根目录；为空时自动检测 |
| `vscodeUEHelper.ueVersion` | 偏好的 UE 版本，例如 `5.4` |

自动检测来源包括 Windows 注册表、`UE_ROOT` 环境变量、常见 UE 安装目录和 workspace 中的 Engine 目录。

### 6.2 构建配置

```json
{
  "vscodeUEHelper.configuration": "Development",
  "vscodeUEHelper.target": "Editor",
  "vscodeUEHelper.platform": "Win64"
}
```

常用取值：

| 配置项 | 取值 |
|---|---|
| `configuration` | `Debug`, `DebugGame`, `Development`, `Shipping`, `Test` |
| `target` | `Editor`, `Game`, `Server`, `Client` |
| `platform` | `Win64`, `Mac`, `Linux` |

### 6.3 clangd 配置

```json
{
  "vscodeUEHelper.clangdPath": "",
  "vscodeUEHelper.completionMode": "fast",
  "vscodeUEHelper.autoBackupWorkspace": true
}
```

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `clangdPath` | 空 | clangd 可执行文件路径；为空时自动检测 |
| `completionMode` | `fast` | UE 宏补全模式，`fast` 或 `slow` |
| `autoBackupWorkspace` | `true` | UBT 刷新工作区前备份 `.code-workspace` |

---

## 7. 常用命令

在命令面板输入 `UE Helper` 查看全部命令。

| 命令 | 说明 |
|---|---|
| `UE Helper: Build` | 编译当前 UE 项目 |
| `UE Helper: Rebuild` | Clean + Build |
| `UE Helper: Clean` | 清理构建产物 |
| `UE Helper: Launch Unreal Editor` | 启动 Unreal Editor |
| `UE Helper: Live Coding (Hot Reload)` | Windows 下触发 Live Coding |
| `UE Helper: Generate compile_commands.json` | 生成或刷新 clangd 编译数据库 |
| `UE Helper: Create Unreal Clangd Project` | 创建 `.clangd` 和 UE 宏补全辅助文件 |
| `UE Helper: Toggle Clangd Completion Mode (Fast/Slow)` | 切换补全模式 |
| `UE Helper: Show Project Info` | 显示项目、引擎、工具链状态 |
| `UE Helper: Install AI Agent Rules` | 安装 AI Agent 规则 |
| `UE Helper: Uninstall (Clean Generated Files)` | 清理插件生成文件 |

---

## 8. clangd 工作流

### 8.1 第一次配置

推荐流程：

1. 执行 `UE Helper: Show Project Info`
2. 执行 `UE Helper: Create Unreal Clangd Project`
3. 执行 `UE Helper: Generate compile_commands.json`
4. 等待 clangd 索引完成
5. 执行 `UE Helper: Build` 验证项目可编译

### 8.2 修改 `.Build.cs` 后

修改模块依赖或新增模块后，建议重新执行：

```text
UE Helper: Generate compile_commands.json
```

必要时重启 clangd：

```text
Clangd: Restart language server
```

---

## 9. clangd LSP Proxy

clangd LSP Proxy 是可选功能。启用后调用链为：

```text
VS Code clangd extension
        ↓
VSCodeUEHelper clangd proxy
        ↓
real clangd
```

### 9.1 Proxy 功能

- 延迟转发 `textDocument/didClose`
- 重新打开保活文件时，将 `didOpen` 转换为全量 `didChange`
- 对 diagnostics / codeAction / hover 中常见 clangd 英文提示追加中文说明
- 安全备份并恢复第三方 clangd 扩展设置
- 通过 `out/launcher/proxy-launcher.bat` 或 `out/launcher/proxy-launcher.sh` 接入 clangd 扩展

### 9.2 Proxy 配置

```json
{
  "vscodeUEHelper.clangdProxy.enabled": false,
  "vscodeUEHelper.clangdProxy.keepaliveMax": 20,
  "vscodeUEHelper.clangdProxy.keepaliveTtlSec": 900,
  "vscodeUEHelper.clangdProxy.realClangdPath": "",
  "vscodeUEHelper.clangdProxy.logPath": "",
  "vscodeUEHelper.clangdProxy.localization.enabled": false,
  "vscodeUEHelper.clangdProxy.localization.mode": "append",
  "vscodeUEHelper.clangdProxy.localization.targets": ["diagnostics", "codeActions", "hover"]
}
```

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `clangdProxy.enabled` | `false` | 是否启用 proxy |
| `clangdProxy.keepaliveMax` | `20` | 最多保活的已关闭文件数 |
| `clangdProxy.keepaliveTtlSec` | `900` | 保活时间，单位秒 |
| `clangdProxy.realClangdPath` | 空 | **可选** 高级覆盖：留空时自动复用 `vscodeUEHelper.clangdPath`、当前/备份的 `clangd.path`、PATH 与默认 LLVM 目录；正常用户无需手动填写 |
| `clangdProxy.logPath` | 空 | proxy 日志路径；为空时写 stderr |
| `clangdProxy.localization.enabled` | `false` | 是否启用本地化说明 |
| `clangdProxy.localization.mode` | `append` | `append` 追加，`override` 替换 |
| `clangdProxy.localization.targets` | 全部 | `diagnostics`, `codeActions`, `hover` |

### 9.3 启用 Proxy

大多数情况下**不需要**预先设置 `vscodeUEHelper.clangdProxy.realClangdPath`。直接执行：

```text
UE Helper: Enable Clangd LSP Proxy
```

插件会按以下**自动解析顺序**查找真实 clangd：

1. `vscodeUEHelper.clangdProxy.realClangdPath`（高级覆盖，常规用户保持为空）
2. `vscodeUEHelper.clangdPath`（插件已有的 clangd 配置）
3. 第三方 `clangd.path` 当前值（排除 proxy launcher 自身）
4. 备份中保存的原始 `clangd.path`
5. PATH 中的 `clangd(.exe)`
6. Windows 默认 LLVM 安装目录

只要其中任何一项能解析到有效文件，Enable 就会继续。详见 §9.7 的「安全回滚」说明。

启用时会：

1. 备份 `clangd.path`、`clangd.arguments`、`clangd.useScriptAsExecutable`
2. 将 `clangd.path` 指向 VSCodeUEHelper proxy launcher
3. 将 `clangd.arguments` 设置为 `proxy args -- original clangd args`
4. 设置 `clangd.useScriptAsExecutable=true`
5. 设置 `vscodeUEHelper.clangdProxy.enabled=true`
6. 提示重启 clangd 或 Reload Window

只有需要强制把 proxy 指向**特定版本**的 clangd（例如自编译 build、与 UE 工具链严格匹配）时，才建议填写 `vscodeUEHelper.clangdProxy.realClangdPath`：

```json
{
  "vscodeUEHelper.clangdProxy.realClangdPath": "C:\\Program Files\\LLVM\\bin\\clangd.exe"
}
```

### 9.4 禁用 Proxy

```text
UE Helper: Disable Clangd LSP Proxy
```

禁用时会检查当前 `clangd.path` 是否仍指向 VSCodeUEHelper proxy launcher。若是，则恢复原始设置；若用户已手动修改 `clangd.path`，则不覆盖用户修改，并显示 warning。

### 9.5 查看 Proxy 状态

```text
UE Helper: Show Clangd Proxy Status
```

显示：

- 是否启用
- launcher 路径
- 真实 clangd 路径（`clangdProxy.realClangdPath` 配置值，留空时显示「自动检测」）
- keepalive 配置
- 本地化配置
- logPath
- 是否存在备份
- lastKnownProblem

实际启动时使用的真实 clangd 路径按 §9.7 自动解析顺序查找；该命令仅显示配置值，便于核对覆盖项。

### 9.6 本地化规则

内置规则覆盖：

| clangd 英文模式 | 中文说明 |
|---|---|
| `incomplete type` | 不完整类型 |
| `unknown type name` | 未知类型名 |
| `undeclared identifier` | 未声明标识符 |
| `no member named` | 无此成员 |
| `no matching function` | 无匹配函数 |
| `file not found` | 文件未找到 |
| `macro redefinition` | 宏重定义 |

默认 `append` 模式示例：

```text
use of undeclared identifier 'Foo' [使用了未声明的标识符 'Foo']
```

不会修改：

- `CodeAction.edit`
- `CodeAction.command`
- `CodeAction.data`
- Completion `label`
- Completion `insertText`
- Completion `textEdit`

### 9.7 自动解析与安全回滚

#### 自动解析顺序（无需手动配置 `realClangdPath`）

`UE Helper: Enable Clangd LSP Proxy` 启用时，会按下面顺序查找真实 clangd 路径，找到第一个存在的可执行文件即停止：

1. `vscodeUEHelper.clangdProxy.realClangdPath`（高级覆盖，常规用户保持为空）
2. `vscodeUEHelper.clangdPath`（插件主配置）
3. 第三方 clangd 扩展当前 `clangd.path`（自动排除 proxy launcher 自身）
4. settingsManager 备份中保存的原始 `clangd.path`
5. 系统 `PATH` 中的 `clangd(.exe)`
6. Windows 默认 LLVM 安装目录

只要其中任何一项能解析到真实可执行文件，Enable 就会继续；普通用户不需要手动填写 `realClangdPath`。

#### 安全回滚（找不到真实 clangd 时）

如果上面 6 个来源都无法定位有效文件，Enable 命令会：

- **不会** 写入 `clangd.path` / `clangd.arguments` / `clangd.useScriptAsExecutable`（避免半启用 / 坏 proxy 配置）
- 把 `vscodeUEHelper.clangdProxy.enabled` 回滚为 `false`
- 显示错误提示并把失败原因写入 Output 面板

此时建议先检查：

- `vscodeUEHelper.clangdPath` 是否正确
- PATH 中是否存在 `clangd(.exe)`
- LLVM 是否安装（Windows 默认搜索 `C:\Program Files\LLVM\bin`、`C:\Program Files (x86)\LLVM\bin`、`%LocalAppData%\Programs\LLVM\bin`）

#### 故障排查：反复出现 `Server process exited with code 0`

如果启用 Proxy 后 clangd 扩展 Output 面板里反复出现 `Server process exited with code 0` / `connection disposed` / `client: connection got disposed` 等重启循环，说明 proxy CLI 启动后立即正常退出，而不是作为 LSP 服务器保活。

该问题在**当前版本**已修复：

- bundled CLI `clangdProxy.js` 入口会接好 `process.stdin` ↔ `LspBridge.feedClientFrame()` 与 `bridge.onClientOutput()` ↔ `process.stdout`
- proxy CLI 日志仍只写 stderr 或 logPath，不污染 stdout
- 回归测试 `test/unit/clangd/proxy/cliStdio.test.ts` 与 `e2eCliRestartLoop.test.ts` 覆盖「启动后不应立即退出」

受影响的范围（请升级到当前版本）：

- 老版本扩展（v0.1.0 之前或本仓库 2026-06 之前的快照）—— 老 CLI 入口没有接通 stdin/stdout，启动后即正常退出，clangd 扩展会无限重启
- 手写的 launcher / 自定义打包脚本 —— 如果不再调用 bundled `runProxy(process.argv.slice(2))`，需要更新 launcher 让它调用 bundled CLI 而不是直接 `process.exit`

升级步骤：

1. 升级到包含本次 stdio 修复的 VSCodeUEHelper 版本
2. 重新构建：`npm run build`
3. 重新启用 Proxy：`UE Helper: Disable Clangd LSP Proxy` → `UE Helper: Enable Clangd LSP Proxy`
4. 重启 clangd 或 Reload Window

---

## 10. AI Agent 规则

执行：

```text
UE Helper: Install AI Agent Rules
```

会生成：

```text
.cursor/rules/unreal-cpp.mdc
.github/copilot-instructions.md
```

用于让 Cursor、Claude Code、Copilot 等工具理解 UE C++ 项目结构与约定。

---

## 11. 卸载与清理

执行：

```text
UE Helper: Uninstall (Clean Generated Files)
```

会清理插件生成的辅助文件，例如：

- `.clangd`
- `compile_commands.json`
- `.vscode/unreal-clangd/addCompletions.h`
- `.vscode/unreal-clangd/addMacroCompletions.h`
- AI 规则文件

不会删除你的 UE 源码、`.uproject`、`Content/` 或手写配置。

---

## 12. 日志与故障排查

打开 Output 面板，选择：

```text
VSCodeUEHelper
```

可查看：

- 项目检测日志
- UE 引擎检测日志
- UBT 构建命令与输出
- clangd 配置生成日志
- proxy 状态与错误
- command 执行结果

### 12.1 clangd 不工作

建议依次检查：

1. 是否已生成 `compile_commands.json`
2. 是否存在 `.clangd`
3. `vscodeUEHelper.clangdPath` 是否正确
4. 是否需要执行 `Clangd: Restart language server`
5. Output 面板中是否有错误信息

### 12.2 Proxy 启用后 clangd 不启动

`realClangdPath` 留空时是**可选**覆盖，正常情况下 Enable 会自动解析真实 clangd。如果仍然不启动，建议按顺序检查：

1. `UE Helper: Show Clangd Proxy Status` —— 查看自动解析到的真实 clangd 路径
2. `vscodeUEHelper.clangdPath` 是否正确（最高优先级的自动来源）
3. launcher 文件是否存在（`out/launcher/proxy-launcher.bat` / `.sh`）
4. logPath 是否可写
5. 执行 `UE Helper: Disable Clangd LSP Proxy` 回滚

如果 Output 面板里反复出现 `Server process exited with code 0` 重启循环，参考 §9.7 的修复说明与升级步骤。

### 12.3 诊断 Clangd 项目

当 clangd 索引异常（macro 不识别、跳转失效、completion 全 `__builtin_*`、报红一片等）但又说不清是 `.uproject`、`compile_commands.json`、preparse 头、clangd 路径、还是补全辅助文件出了问题时，优先执行：

```text
UE Helper: Diagnose Clangd Project
```

执行后会在 VS Code Output 面板的 `VSCodeUEHelper` 通道中写入一份结构化报告，每条检查项均按 `PASS` / `WARN` / `FAIL` / `INFO` 输出，典型内容包括：

- `.uproject` 与工作区根的解析
- `.clangd` 是否存在、是否包含预期的 `CompileFlags.Add` 段
- `compile_commands.json` 是否存在、是否覆盖所有模块
- 当前 fast/slow 模式下 preparse headers 列表是否完整、是否解析成功
- clangd 可执行文件是否可解析（`clangdPath`、`PATH`、LLVM 默认目录）
- `.vscode/unreal-clangd/addCompletions.h` / `addMacroCompletions.h` 是否存在、是否被 UE Header Tool 引用
- 切换 fast/slow 时是否实际重写了 `.clangd`

#### 典型失败模式与建议

| 报告中的标记 | 含义 | 推荐下一步 |
|---|---|---|
| `FAIL: .clangd missing` | 未生成 clangd 配置 | 重新执行 `UE Helper: Create Unreal Clangd Project` |
| `FAIL: compile_commands.json missing` | 未生成编译数据库 | 重新执行 `UE Helper: Generate compile_commands.json` |
| `FAIL: preparse header missing` | preparse 头被删除或路径错误 | 重新执行 `UE Helper: Toggle Clangd Completion Mode` 或 `Create Unreal Clangd Project` |
| `FAIL: clangd binary not found` | clangd 不可解析 | 设置 `vscodeUEHelper.clangdPath`，或安装 LLVM 并加入 PATH |
| `FAIL: addMacroCompletions.h missing` | UE 宏补全辅助文件缺失 | `Create Unreal Clangd Project` 会重新生成，并保留 `// USER:` 区段 |
| `WARN: .clangd ParseFlags stripped` | UBT 刷新后 `.clangd` 被覆盖 | 重新执行 `Toggle Clangd Completion Mode` 让插件重写完整文件 |
| `WARN: slow mode switch did not rewrite .clangd` | T1 已修复，升级后该 warn 不应再出现 | 升级后若仍出现，请提 issue 并附 report |

报告不会修改任何文件，仅做只读扫描。可以直接复制 Output 中的内容附在 issue 或给 AI 助手排查。

---

## 13. 推荐工作流\n\n### 13.1 第一次打开项目\n\n1. 打开 `.code-workspace`\n2. 执行 `UE Helper: Show Project Info`\n3. 执行 `UE Helper: Create Unreal Clangd Project`\n4. 执行 `UE Helper: Generate compile_commands.json`\n5. 等待 clangd 索引\n6. 执行 `UE Helper: Build`\n\n### 13.2 日常开发\n\n1. 写代码\n2. `UE Helper: Build`\n3. Windows 下可用 `UE Helper: Live Coding (Hot Reload)`\n4. 修改模块依赖后重新生成 `compile_commands.json`\n\n### 13.3 Proxy 推荐使用场景\n\n适合希望减少 clangd 关闭文件后丢失解析状态、并希望常见英文诊断附带中文说明的用户。**`vscodeUEHelper.clangdProxy.realClangdPath` 是可选覆盖**，普通用户保持为空即可，插件会自动复用 `vscodeUEHelper.clangdPath` 或系统 PATH 中的 clangd。启用后建议重启 clangd 或 Reload Window。\n","filePath":"D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\doc\VSCodeUEHelper-插件使用说明.md"}નલоҳи)rayele... (truncated)        