# ADR 0001: Phase 8 SSoT —— WorkspaceState 单一真相源

- **状态**: Accepted
- **阶段**: Phase 8 + 9 收尾
- **影响范围**: 13 import / 36 callers 全部模块

## 背景

Phase 7 之前,仓库内访问 `.code-workspace` / `.uproject` / UE 引擎路径的方式有 4 种:

1. `vscode.workspace.workspaceFile` (VS Code 原生 API)
2. `vscode.workspace.workspaceFolders` (VS Code 原生 API)
3. `vscode.workspace.getWorkspaceFolder(...)` (VS Code 原生 API)
4. `detection.workspaceContext.getSelectedProject()` / `getSelectedEngine()` (detection 层自实现)

问题:

- **数据源分散**:`workspaceFile` 是只读的,`workspaceContext.memento` 是可写的持久化,两个 API 各自维护同一份"项目 / 引擎"信息,谁先谁后无 contract
- **派生字段不集中**:`clangdConfigPath` / `compileCommandsPath` 等路径,每个模块各自 `path.join(root, '.clangd')` 拼,根路径从哪拿不统一
- **测试难**: 每个模块都要 mock 完整的 `detection` + `vscode.workspace`,13+ 处重复 setup
- **detection.ready 竞态**: `workspace` getter 在 `detection.ready` resolve 前被读会拿到 null,不同模块处理方式不同,容易埋 NPE

## 决策

新建 `src/core/workspace.ts`,导出 `WorkspaceState` 类,作为项目 / 引擎 / 派生路径的**唯一真相源**(SSoT — Single Source of Truth)。

具体契约:

- 构造时订阅 `detection.ready` Promise,resolve 后调 `setResult` 一次性写入所有派生字段
- 20+ 个 getter (Level 1/2/3 派生) 集中管理:`projectDir` / `engineRoot` / `workspaceFile` / `clangdConfigPath` 等
- `selectedProject` / `selectedEngine` 等用户选择,持久化到 `workspaceContext.memento`(per Phase 9 收尾,统一从 `@core/workspace` 暴露)
- ESLint `no-restricted-syntax` 锁 4 类 bypass: `vscode.workspace.workspaceFile` / `workspaceFolders` / `getWorkspaceFolder` / `detection.workspaceContext.getSelected*`

## 被证伪的方案

**方案 A: 维持分散读,加 JSDoc 注释** —— 拒。注释不强制,5 个 callers 改一遍很快又会有第 6 个,不可持续。

**方案 B: 抽象 `ProjectContext` interface,各模块自己实现** —— 拒。仍然分散,只是从 4 种 API 变成 1 种 interface 但 N 个实现,N > 1 的真相源比 4 个真相源更难排查。

**方案 C: 用 vscode-extension-common API 抽象** —— 拒。VS Code 原生 API 已经够用,引第三方只增加包大小,无功能增益。

## 后果

**正面**:

- 36 callers 收敛到 1 个 import (`@core/workspace`),新代码不再需要"我应该读哪个 API"心智负担
- 检测就绪前访问派生 getter 不误报,统一返回 stale-but-typed 占位值(Phase 8 锁定)
- 测试可注入 mock workspace,不需要完整 mock detection
- ESLint 锁规则让"绕过 SSoT"在 code review 前就被 lint 拦截

**负面**:

- 旧 `activate*(detection)` 函数的 backward compatibility 维护成本 —— 老调用方 / test 仍可传 `detection`,内部转调 workspace getter
- 13 import 的迁移工作量(已在 Phase 8 一次性完成)
- 派生 getter 数量冻结,新增必须经过"派生规则"审核(根 AGENTS.md §2)

## 参考

- `src/core/workspace.ts` 实现
- `src/core/AGENTS.md` §WorkspaceState 段
- 根 `AGENTS.md` §仓库陷阱(13 import 的迁移记录)
- Phase 8 commit history(可在 `git log --grep=phase-8` 查)
