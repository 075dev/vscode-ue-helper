# VSCodeUEHelper 开发过程文档

> 本目录 (`doc/`) 是 **VSCodeUEHelper** 的开发过程文档，面向插件维护者和贡献者。
> 如果你是终端用户（想了解怎么使用插件），请参阅 [`../docs/`](../docs/) 目录。

## 主文档（01-05 系列）

| 文档 | 内容 |
|---|---|
| [01-architecture.md](./01-architecture.md) | 整体架构、数据流、模块依赖 |
| [02-modules.md](./02-modules.md) | 每个模块的详细职责、文件列表、关键类型/函数 |
| [03-user-guide.md](./03-user-guide.md) | 用户使用指南（完整版，作为开发参考保留在主文档系列） |
| [04-developer-guide.md](./04-developer-guide.md) | 开发指南：如何加新命令、修改检测逻辑、调试、测试、打包 |
| [05-code-reference.md](./05-code-reference.md) | 关键算法与代码说明：路径解析、进程管理、UBT 协议等 |

> 注：`03-user-guide.md` 同时存在 `docs/01-user-guide.md`。`doc/` 这份作为开发系列完整版保留，
> `docs/` 那份面向终端用户。两份内容会随场景分化（开发版可能包含内部实现说明）。

## 子主题文档

| 文档 | 内容 |
|---|---|
| [Clangd LSP Proxy 与 Unreal Clangd 集成功能清单.md](./Clangd%20LSP%20Proxy%20%E4%B8%8E%20Unreal%20Clangd%20%E9%9B%86%E6%88%90%E5%8A%9F%E8%83%BD%E6%B8%85%E5%8D%95.md) | Clangd LSP Proxy 与 Unreal Clangd 集成的功能点清单（中文） |
| [clangd-flow-analysis.md](./clangd-flow-analysis.md) | clangd 工作流程分析 |
| [clangd-ue-performance-optimization.md](./clangd-ue-performance-optimization.md) | clangd 在 UE 工程中的性能优化研究 |
| [phase-7-perf-baseline.md](./phase-7-perf-baseline.md) | Phase 7 性能优化基线 |
| [rider-clangd-research.md](./rider-clangd-research.md) | Rider + clangd 工作流调研 |
| [ue-clangd-ecosystem-research.md](./ue-clangd-ecosystem-research.md) | UE + clangd 生态调研 |

## 文档约定

- **开发过程文档**（本目录）：面向维护者，包含架构、设计、研究、参考
- **用户文档**（[`../docs/`](../docs/)）：面向终端用户，关注"怎么用"