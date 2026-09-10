<!-- Parent: ../AGENTS.md -->
# rules 模块 —— AI Agent 规则生成器

> 治理参考：`.specify/memory/constitution.md` §V（Minimal, Traceable, Reversible Evolution）。本模块负责把 UE C++ 工作流约束以 `.mdc` / `copilot-instructions.md` 形式落到项目根，供 Cursor / GitHub Copilot 加载；规则文本与仓库其他约束（`AGENTS.md` / `CONTRIBUTING.md`）保持一致，不引入独立规则集。

## 模块概述

把 UE Helper 的 C++ 约定（UBT / Live Coding / `TObjectPtr` / 模块依赖声明 / `.clangd` 由扩展管理）以两种格式写盘：

- **Cursor** —— `.cursor/rules/unreal-cpp.mdc`（Markdown Components，带 frontmatter + globs）
- **GitHub Copilot** —— `.github/copilot-instructions.md`（纯 Markdown）

## 核心文件

| 文件              | 职责                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| `index.ts`        | 模块入口，`re-export` 规则字符串                                            |
| `cursorRules.ts`  | `UE_HELPER_RULES_MDC`（Cursor 规则）+ `UE_HELPER_COPILOT_INSTRUCTIONS`（Copilot 指令） |

## 触发入口

`vscodeUEHelper.installRules` 命令（`src/commands/installRules.ts`）调用本模块把规则写到项目根。卸载命令 `vscodeUEHelper.uninstall` 负责清理写入的规则文件。

## 关键约束

- **规则文本与宪法一致**：所有"必须用 UBT" / "不要直接编辑 `.clangd`" / "Live Coding 是 Windows only" 等约束，**先**在 `.specify/memory/constitution.md` 与 `AGENTS.md` 落定，再同步到本模块的规则字符串
- **不动 strings 之外**：本模块**只**导出字符串常量；不读 `vscode.workspace.*`、不写文件（写入由 `installRules` 命令负责）
- **新增规则条目**：先改 `cursorRules.ts` 的 `UE_HELPER_RULES_MDC`，再验证 `UE_HELPER_COPILOT_INSTRUCTIONS`（从 MDC 派生）仍合理；不要在两处各维护一份独立规则

## 测试

当前无单元测试；规则字符串被 `installRules` 命令间接验证。改文案后建议在真实 Cursor / Copilot 环境里做一次 review。
