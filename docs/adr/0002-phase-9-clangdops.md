# ADR 0002: Phase 9 ClangdOps —— .clangd 唯一写入 API

- **状态**: Accepted
- **阶段**: Phase 9 收尾
- **影响范围**: 22 callers,删 2 个函数 + 3 类文件路径写入

## 背景

Phase 8 之前,`.clangd` 配置文件写入方式有 2 套并存:

1. `src/clangd/clangdConfig.ts` 的 `writeClangdConfig` / `findClangdConfig` 函数(老路径)
2. `src/clangd/clangdOps.ts` 的 `mutate` / `setAddFlag` / `applyAddFlags` API(新路径,Phase 8 引入)

问题:

- **职责分散**: `writeClangdConfig` 写整文件,`mutate` 改单一字段,`applyAddFlags` 加 flag 块 —— 3 个函数写同一份配置,谁先谁后没有 contract
- **冲突风险**: 如果 `writeClangdConfig` 和 `mutate` 并发,后者覆盖前者的内容
- **路径来源不统一**: `writeClangdConfig` 自己 `path.join(root, '.clangd')`,`mutate` 用 `workspace.clangdConfigPath` getter,根路径可能不一致
- **测试难**: 22 callers 各自 mock 不同的写入函数,无法统一

## 决策

Phase 9 收束:删除 `writeClangdConfig` / `findClangdConfig`,**所有 `.clangd` 写入走 `ClangdOps` (来自 `@clangd/clangdOps`)**。

具体契约:

- `ClangdOps` 是 Phase 8 引入的统一 API,Phase 9 删除其前身,定位为**唯一** `.clangd` 写入入口
- API 形态:
  - `mutate(root, mutation)`: 对单字段做精细修改(用 yaml-ast-parser)
  - `setAddFlag(root, flag)`: 增/删 `CompileFlags.Add` 数组的单个元素
  - `applyAddFlags(root, flags)`: 批量替换 `Add` 数组
- 所有调用方必须用 `@clangd/clangdOps`,不允许 `import { writeClangdConfig } from '@clangd/clangdConfig'`
- ESLint `no-restricted-imports` 锁:`@clangd/clangdConfig` 模块在 clangd 模块**外**禁止 import(clangd/index.ts 与 clangdOps.ts 自身豁免)

## 被证伪的方案

**方案 A: 维持 writeClangdConfig + ClangdOps 共存,加写锁** —— 拒。写锁 vscode 单进程下无意义(同线程串行),只增加心智负担,真要并发还得 fs lock 跨进程(过度工程)。

**方案 B: 把 ClangdOps 改名 writeClangdConfig,沿用老 API** —— 拒。Phase 8 的精细 mutate API 是设计优势,合并回去会失去类型安全与 yaml 解析能力。

**方案 C: 完全去掉 ClangdOps 类,改成 free functions 集合** —— 拒。`ClangdOps` 是 Phase 8 注入点(`CompletionModeController.setClangdOps`),改成 free functions 失去依赖注入能力,test 时无法 mock。

## 后果

**正面**:

- 22 callers 收敛到 1 个 import,`.clangd` 写入路径唯一
- 删除 2 个老函数(代码净减少,无 dead code)
- 性能:`mutate` 用 yaml-ast-parser 不重新写整文件,比 `writeClangdConfig` 的 read-modify-write 路径快 2-3x
- ESLint 锁规则让"绕过 ClangdOps"在 code review 前被 lint 拦截

**负面**:

- 22 个调用方迁移工作(Phase 9 一次性完成,无遗留)
- `clangdConfig.ts` 仍保留 2 个被禁的 export(`defaultClangdConfig` / `renderClangdConfig`),仅作"配置对象 + YAML 字符串"纯函数,无 fs 副作用 —— 这是有意的(隔离副作用)

## 参考

- `src/clangd/clangdOps.ts` 实现
- `src/clangd/AGENTS.md` §核心文件
- 根 `AGENTS.md` §仓库陷阱(22 callers 迁移记录)
- Phase 9 commit history
