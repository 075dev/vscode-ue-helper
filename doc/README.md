# VSCodeUEHelper 中文项目说明书

> 本目录 (`doc/`) 是 **VSCodeUEHelper** 的中文项目文档。读者不需要先读 `README.md`，本文档是自洽的。

---

## 目录

| 文档 | 内容 |
|---|---|
| [01-architecture.md](./01-architecture.md) | 整体架构、数据流、模块依赖 |
| [02-modules.md](./02-modules.md) | 每个模块的详细职责、文件列表、关键类型/函数 |
| [03-user-guide.md](./03-user-guide.md) | 用户使用指南：安装、配置、状态栏、命令面板、设置 |
| [04-developer-guide.md](./04-developer-guide.md) | 开发指南：如何加新命令、修改检测逻辑、调试、测试、打包 |
| [05-code-reference.md](./05-code-reference.md) | 关键算法与代码说明：路径解析、进程管理、UBT 协议等 |

---

## 一句话说明

**VSCodeUEHelper** 是 VS Code 上针对 Unreal Engine C++ 开发的"一站式"插件，融合了两个开源项目的设计：

- **engine-link**（Cursor IDE 扩展）—— UBT 构建、Live Coding 热重载、MCP AI 集成、10 个状态栏按钮
- **unreal-clangd**（VS Code 扩展）—— clangd 智能补全、`compile_commands.json` 生成、Windows SDK/MSVC 自动发现、工作区备份

---

## 目标用户

- **UE C++ 程序员** —— 需要在 VS Code（而不是 Rider / Visual Studio）里写 UE 代码
- **AI 辅助编码用户** —— 想让 Claude Code / Cursor 等 AI 工具能感知 UE 项目（通过 MCP 协议）
- **从 Rider / VS 迁移过来的人** —— 想要状态栏按钮 + Live Coding + 一键构建的工作流

---

## 关键特性一览

### 1. 状态栏（11 个按钮）

从左到右：`$(play) Build` · `$(refresh) Rebuild` · `$(trash) Clean` · `$(gear) Config` · `$(symbol-class) Target` · `$(device-desktop) Platform` · `$(library) MSVC/SDK` · `$(file-code) Project` · `$(package) UE Engine` · `$(zap) Live Coding` · `$(rocket) Launch`

### 2. 智能补全

- clangd 自动接管 C/C++ 智能感知
- `addCompletions.h` + `addMacroCompletions.h` 让 UCLASS / UPROPERTY 宏能被识别
- Windows SDK + MSVC 版本选择，生成正确的 `-imsvc` 标志

### 3. 构建 / Live Coding

- 通过 UnrealBuildTool 编译（点 Build 或 `Ctrl+Shift+B`）
- Live Coding 热重载（Windows：`Ctrl+Alt+F11`）
- 取消按钮可杀掉整个 UBT 进程树（cmd.exe → Build.bat → dotnet → UnrealBuildTool）
- MSVC / 链接器错误自动解析，跳转到 Problems 面板

### 4. 项目 / 引擎检测

- 从 `.code-workspace` 的 `folders[]` 读取项目根目录 + 引擎根目录
- 项目 .uproject 是 JSON5（容忍注释 + 尾部逗号）
- 引擎版本从 `<Engine>/Engine/Build/Build.version` 读

### 5. MCP 集成（Cursor / Claude Code）

- 自动启动 MCP 服务器，让 AI 工具能感知 UE 项目结构
- AI 工具可以列出模块、查 .uproject 字段、读 .clangd 配置

---

## 技术栈

- **语言**：TypeScript（strict mode + `noUncheckedIndexedAccess`）
- **打包**：esbuild（CJS 输出）
- **测试**：Vitest（26 个测试覆盖 4 个领域）
- **国际化**：内置 zh / en 翻译（通过 `vscode.env.language` 自动选择）
- **MCP**：`@modelcontextprotocol/sdk` v1

---

## 阅读顺序建议

| 读者 | 顺序 |
|---|---|
| **想用插件** | [03-user-guide.md](./03-user-guide.md) |
| **想改插件 / 贡献代码** | [01-architecture.md](./01-architecture.md) → [02-modules.md](./02-modules.md) → [04-developer-guide.md](./04-developer-guide.md) → [05-code-reference.md](./05-code-reference.md) |
| **想理解某个具体 bug** | [02-modules.md](./02-modules.md) 找到对应模块 → [05-code-reference.md](./05-code-reference.md) 看算法 → 直接看 `src/` 下源码 |