---
phase: 03-compileCommands重构
plan: 04
subsystem: clangd
tags: [compile-commands, fill-missing, source-scan, refactor]
requires:
  - phase: 03-03
    provides: "稳定的 symlink 模块边界"
provides:
  - "独立 fillMissing 子模块与 FillResult 类型"
  - "fillMissing 行为测试迁移到镜像目录"
affects: [03-05, compileCommands, create-project]
tech-stack:
  added: []
  patterns:
    - "Source 与 Plugins/*/Source 扫描边界保持，私有 helper 不外泄"
key-files:
  created:
    - src/clangd/compileCommands/fillMissing.ts
  modified:
    - src/clangd/compileCommands.ts
    - test/unit/clangd/compileCommands/fillMissing.test.ts
key-decisions:
  - "第四子模块命名 fillMissing，避免与既有 SHA256 fingerprint.ts 冲突"
  - "测试以 git move 保留历史，只改直达子模块 import"
patterns-established:
  - "公共类型由主入口 type re-export，子模块保持单向依赖"
requirements-completed:
  - PERF-01
completed: 2026-07-23
status: complete
---

# Plan 03-04: fillMissing 子模块提取 Summary

**`FillResult`、`fillMissingCompileCommands` 与四个私有 helper 已提取到 `fillMissing.ts`，既有 SHA256 fingerprint 职责不变。**

## Accomplishments

- 新增 299 行 `fillMissing.ts`；主入口减少约 275 行并通过命名/type 重导出保持 API。
- `compileCommands.test.ts` 迁至 `compileCommands/fillMissing.test.ts`，8 个行为测试保持，仅被测 import 改为直达子模块。
- 未创建 `compileCommands/fingerprint.ts`，`src/clangd/fingerprint.ts` 零修改并继续负责 cache key。

## Task Commit

- `e501754` — `refactor(clangd): phase 3.4 extract fillMissing sub-module`

## Verification Evidence

- Commit 记录：typecheck、lint、unit suite 855 tests 及 touched-file format check 通过；主入口当时降至 493 行。
- Phase 级最终验证记录主入口 492 行、完整 unit suite 856 tests 与 build 通过（见 `03-VERIFICATION.md`）。
- 含真实项目/插件新 `.cpp` 的 UE 命令路径未执行，未声明通过。

## Deviations from Plan

- `fillMissing.ts` 实际 299 行，高于约 270 行估算；扫描算法、根目录边界和公共 API 未扩张。

## Self-Check

- 实现 commit 存在；对应 PLAN 存在；未声称真实 UE smoke 通过。
