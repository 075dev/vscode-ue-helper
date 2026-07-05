# VSCodeUEHelper 用户文档

> 本目录 (`docs/`) 是 **VSCodeUEHelper** 的用户文档，面向安装并使用此插件的 UE C++ 开发者。
> 如果你想了解插件的内部架构、开发流程或修改代码，请参阅 [`../doc/`](../doc/) 目录。

## 文档索引

| 文档 | 内容 |
|---|---|
| [01-user-guide.md](./01-user-guide.md) | 用户使用指南——安装、配置、状态栏、命令面板、设置 |
| [02-plugin-usage.md](./02-plugin-usage.md) | 插件使用说明——安装、配置、常用命令、clangd 工作流与故障排查 |
| [03-localization-experience.md](./03-localization-experience.md) | 本地化体验——clangd 诊断信息的中文显示说明 |

## 一句话说明

**VSCodeUEHelper** 是 VS Code 上针对 Unreal Engine C++ 开发的"一站式"插件，提供：

- `.uproject` 与 UE 引擎自动检测
- UBT Build / Rebuild / Clean 集成
- Live Coding 热重载（Windows）
- clangd 智能补全（含 LSP Proxy 与本地化）
- WebView 控制面板

## 文档约定

- **用户文档**（本目录）：面向终端用户，关注"怎么用"
- **开发文档**（[`doc/`](../doc/)）：面向插件维护者，关注"为什么这样设计 / 如何修改"