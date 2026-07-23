---
phase: 03-compileCommands重构
plan: 03
subsystem: clangd
tags: [compile-commands, symlink, filesystem, perf]
requires:
  - phase: 03-02
    provides: "稳定的 cache 编排边界"
provides:
  - "独立 symlink/copy 回退子模块"
  - "文件系统回退行为与 perf 静态守卫"
affects: [03-04, compileCommands, compileCommands-perf]
tech-stack:
  added: []
  patterns:
    - "symlink 失败后 copy，copy 失败保留 source/target 诊断"
key-files:
  created:
    - src/clangd/compileCommands/symlink.ts
    - test/unit/clangd/compileCommands/symlink.test.ts
  modified:
    - src/clangd/compileCommands.ts
    - test/unit/clangd/compileCommandsPerf.test.ts
key-decisions:
  - "两个 compileCommands.linkToWorkspaceRoot perf 记录点随实现迁移"
  - "perf 静态测试同时扫描主入口与 symlink 子模块"
patterns-established:
  - "文件系统职责在子模块内闭合，主入口只导入并重导出"
requirements-completed:
  - PERF-01
completed: 2026-07-23
status: complete
---

# Plan 03-03: symlink 子模块提取 Summary

**`linkToWorkspaceRoot` 与其 perf 记录点已提取到 `symlink.ts`，symlink/copy 回退契约由行为测试锁定。**

## Accomplishments

- 新增 156 行 `symlink.ts`，主入口删除旧函数体并继续重导出同名公共 API。
- 新增 6 个 `it`，覆盖目标派生、同路径短路、symlink 成功、symlink 失败转 copy、双失败抛错和既有 symlink 短路。
- `compileCommandsPerf.test.ts` 扩展静态扫描范围，事件名与 `skipped`/`succeeded`/`target` 元数据保持。

## Task Commit

- `9953001` — `refactor(clangd): phase 3.3 extract symlink sub-module`

## Verification Evidence

- Commit 记录：typecheck、lint、unit suite 855 tests 通过；两个 `compileCommands.linkToWorkspaceRoot` 事件名保持。
- Phase 级最终验证又记录完整 unit suite 856 tests 与 build 通过（见 `03-VERIFICATION.md`）。
- 未在真实 Windows UE 工作区观察 symlink 或 copy；该项仍为人工验证债务。

## Deviations from Plan

- 子模块 156 行、测试 258 行，高于估算；额外测试覆盖了 6 条而非最低 4 条文件系统分支，未改变运行时范围。

## Self-Check

- 实现 commit 存在；对应 PLAN 存在；未声称真实 UE smoke 通过。
