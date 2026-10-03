# VSCodeUEHelper —— 开发者文档

本目录面向插件维护者和贡献者，记录架构决策、模块参考、开发流程。

终端用户文档见仓库根目录 [`../README.md`](../README.md)。

## 文档目录

| 文档 | 内容 | 谁该读 |
|---|---|---|
| [01-architecture.md](./01-architecture.md) | 整体架构、双 esbuild、激活顺序、`.code-workspace` 检测模型、Phase 8 `WorkspaceState` / `ClangdOps`、MCP 生命周期 | 所有人（先读） |
| [02-modules.md](./02-modules.md) | 10 个模块的入口、文件清单、关键类型/函数 | 改具体模块前 |
| [04-developer-guide.md](./04-developer-guide.md) | 环境搭建、命令清单、测试、调试、新增/修改命令、打包发布、仓库陷阱 | 贡献者、新成员入门 |

## 编号说明

历史 `doc/03-user-guide.md` 已删除（用户文档并入根 `README.md`），保留 04 号以维持外部链接的稳定性。

## 其他文档位置

- **终端用户文档**：[`README.md`](../README.md)（功能矩阵、命令清单、配置项）
- **每个模块内部**：`src/<module>/AGENTS.md`（模块级速查和约定）
- **AI Agent 速查**：[`AGENTS.md`](../AGENTS.md)（OpenCode agent 上下文）

## 文档维护约定

- 改 `package.json` 同步更新 `01-architecture.md` 的模块表
- 改模块入口导出同步更新 `02-modules.md` 的关键类型
- 改 npm scripts 同步更新 `04-developer-guide.md` 的命令清单
- 改仓库陷阱清单同步更新 `04-developer-guide.md` 第 13 节

## 文档不会覆盖

- 上游项目的设计模式（见 `README.md#Inspiration`）
- UE C++ 本身的约定（见 `src/rules/cursorRules.ts` 的导出常量）
- clangd LSP 协议细节（见 [clangd 官方文档](https://clangd.llvm.org/extensions.html)）