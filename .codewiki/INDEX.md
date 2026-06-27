# VSCodeUEHelper — Codewiki 索引

## 项目概览
- **类型**: VS Code Extension
- **语言**: TypeScript (69 .ts 文件)
- **入口**: [`activate()`](src/extension.ts:56) in `src/extension.ts`
- **构建**: esbuild → `out/extension.js` (Node 18, CJS)
- **测试**: vitest (覆盖率目标 ≥80%)
- **模块数**: 11 (commands 15 / detection 10 / clangd 9 / build 7 / ui 6 / parsers 4 / mcp 4 / core 3 / rules 2 / i18n 1 / platform 0)

## 模块导航
| 模块 | 路径 | 职责 | 文件数 | 详情 |
|------|------|------|--------|------|
| core | src/core/ | 基础工具：Logger, Config, 命令注册 | 3 | [→](modules/core.md) |
| i18n | src/i18n/ | 国际化（中英双语，70+ keys） | 1 | [→](modules/i18n.md) |
| detection | src/detection/ | 项目+引擎发现（信任 .code-workspace） | 10 | [→](modules/detection.md) |
| build | src/build/ | UBT 构建, Live Coding, 启动 Editor | 7 | [→](modules/build.md) |
| clangd | src/clangd/ | clangd 配置, Windows SDK/MSVC, 工作区备份 | 9 | [→](modules/clangd.md) |
| commands | src/commands/ | 15 个 VS Code 命令的实现 | 15 | [→](modules/commands.md) |
| ui | src/ui/ | 状态栏(11按钮), QuickPick, Output 通道, Problems 面板 | 6 | [→](modules/ui.md) |
| mcp | src/mcp/ | Model Context Protocol 服务器 (auto/Cursor/Claude Code) | 4 | [→](modules/mcp.md) |
| parsers | src/parsers/ | MSVC / UBT / Linker 输出解析器 | 4 | [→](modules/parsers.md) |
| rules | src/rules/ | AI Agent Rules (Cursor / Claude Code) | 2 | [→](modules/rules.md) |
| platform | src/platform/ | 预留（跨平台抽象层，空目录） | 0 | [→](modules/platform.md) |
| extension | src/extension.ts | 入口，串联所有模块激活 | 1 | [→](modules/extension.md) |

## 命令映射（package.json 注册 15 个命令）
| 命令 | 文件 | 用途 |
|------|------|------|
| `vscodeUEHelper.build` | commands/build.ts | UBT 编译 |
| `vscodeUEHelper.rebuild` | commands/build.ts | Clean + Build |
| `vscodeUEHelper.clean` | commands/build.ts | UBT 清理 |
| `vscodeUEHelper.launchEditor` | commands/launchEditor.ts | 启动 Unreal Editor |
| `vscodeUEHelper.liveCoding` | commands/liveCoding.ts | Live Coding 热重载 |
| `vscodeUEHelper.generateCompileCommands` | commands/generateCompileCommands.ts | 生成 compile_commands.json |
| `vscodeUEHelper.createProject` | commands/createProject.ts | 创建 .clangd + completions |
| `vscodeUEHelper.toggleCompletionMode` | commands/toggleCompletionMode.ts | fast/slow 补全切换 |
| `vscodeUEHelper.showProjectInfo` | commands/showProjectInfo.ts | 显示项目状态 |
| `vscodeUEHelper.setSystemIncludes` | commands/setSystemIncludes.ts | SDK/MSVC/C++ 标准 |
| `vscodeUEHelper.installRules` | commands/installRules.ts | 安装 AI rules |
| `vscodeUEHelper.uninstall` | commands/uninstall.ts | 清理生成文件 |
| `vscodeUEHelper.openWorkspaceFile` | commands/openWorkspaceFile.ts | 打开 .code-workspace |
| `vscodeUEHelper.regenerateWorkspace` | commands/regenerateWorkspace.ts | 重新生成工作区 |
| `vscodeUEHelper.selectConfig` | commands/selectConfig.ts | 选 BuildConfiguration |
| `vscodeUEHelper.selectTarget` | commands/selectTarget.ts | 选 BuildTarget |

## 依赖概览
详见 [dependencies.md](dependencies.md)

## 更新信息
- 生成时间: 2026-06-26
- Codewiki 版本: 1.0.0
- 对应 commit: HEAD
