---
phase: 03-compileCommands重构
plan: 05
subsystem: clangd
tags: [compile-commands, barrel, api-compatibility, integration]
requires:
  - phase: 03-01..03-04
    provides: "task/cache/symlink/fillMissing 四子模块与主入口接线"
provides:
  - "顶层 @clangd FillResult 类型重导出"
  - "Phase 3 自动化集成验证证据"
affects: [compileCommands, phase-04]
tech-stack:
  added: []
  patterns:
    - "公共 barrel 由运行时导出断言与类型使用共同守卫"
key-files:
  created: []
  modified:
    - src/clangd/index.ts
    - test/unit/clangd/index.test.ts
key-decisions:
  - "FillResult 加入顶层 @clangd；GenerateOptions 不扩大顶层契约"
patterns-established:
  - "重构收口时同时核对主入口、顶层 barrel 与直接 caller"
requirements-completed:
  - PERF-01
completed: 2026-07-23
status: complete
---

# Plan 03-05: index 重导出与集成验证

**Status:** COMPLETE（计划交付完成；自动化与 build smoke 已完成；真实 UE / Extension Host 人工验证仍 pending）
**Date:** 2026-07-23
**Wave:** 5（depends on 03-01..03-04）
**Code commit:** `bd36b79 chore(clangd): phase 3.5 verify index re-exports`

## 交付

- `src/clangd/index.ts` 的 compileCommands export block 新增 `type FillResult`，保留四个公共函数原名与来源。
- `test/unit/clangd/index.test.ts` 按既有 barrel smoke 风格增加 `FillResult` 类型结构断言；四个函数的运行时导出断言保持完整。
- `@clangd/compileCommands` 继续导出 `generateCompileCommands`、`linkToWorkspaceRoot`、`isClangdAvailable`、`fillMissingCompileCommands`、`FillResult`、`GenerateOptions`。

## 结构与 caller 证据

| 检查        | 结果                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 主入口行数  | `src/clangd/compileCommands.ts` = **492**（≤ 500）                                                                                |
| 四子模块    | `task.ts` 299、`cache.ts` 114、`symlink.ts` 156、`fillMissing.ts` 299；全部存在                                                   |
| 命名冲突    | 不存在 `src/clangd/compileCommands/fingerprint.ts`；既有 `src/clangd/fingerprint.ts` 保持 SHA256 职责                             |
| 依赖方向    | 主入口单向导入四子模块；子模块未反向导入主入口                                                                                    |
| 重复实现    | `linkToWorkspaceRoot` 仅在 `symlink.ts`；`fillMissingCompileCommands` 仅在 `fillMissing.ts`                                       |
| 直接 caller | 3 个：`src/commands/createProject.ts`、`test/unit/clangd/compileCommandsPerf.test.ts`、`test/unit/commands/createProject.test.ts` |
| 顶层 caller | `src/commands/generateCompileCommands.ts` 继续通过 `@clangd` 导入生成、链接、fillMissing 与三个既有 helper                        |

## 验证证据

| Gate                   | 结果                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | **PASS**, exit 0                                                                                                       |
| `npm run lint`         | **PASS**, exit 0；0 errors / 125 个存量 `consistent-type-imports` warnings                                             |
| `npm run test:unit`    | **PASS**, 75 files / 856 tests；一次并行门禁遇到 `proxyLogTailer` 计时抖动，单测重跑 9/9、完整 suite 重跑 856/856 通过 |
| `npm run build`        | **PASS**, exit 0；生成 `out/extension.js`、`out/clangdProxy.js`、`out/launcher/proxy-launcher.bat`                     |
| touched-file Prettier  | **PASS**：`npx prettier --check src/clangd/index.ts test/unit/clangd/index.test.ts`                                    |
| `npm run format:check` | **FAIL（存量）**：exit 1；本计划文件不在失败清单，未扩大范围格式化                                                     |

### format:check 精确失败清单（26）

`src/clangd/clangdOps.ts`, `src/clangd/compileCommandsFallback.ts`, `src/clangd/completionFiles.ts`, `src/clangd/diagnostics/io.ts`, `src/clangd/fingerprint.ts`, `src/clangd/preparseIncludes.ts`, `src/clangd/proxy/ueDiagnosticWatcher.ts`, `src/clangd/ueHelpers.ts`, `src/clangd/ueLinkManager.ts`, `src/clangd/uhtGeneration.ts`, `src/clangd/windowsSdk.ts`, `src/commands/_resolve.ts`, `src/commands/createProject.ts`, `src/commands/firstRunInit.ts`, `src/commands/generateCompileCommands.ts`, `src/core/logger.ts`, `src/detection/index.ts`, `src/extension.ts`, `test/unit/clangd/ueLinkManager.test.ts`, `test/unit/clangd/uhtGeneration.test.ts`, `test/unit/commands/createProject.test.ts`, `test/unit/setup.ts`, `.eslintrc.json`, `AGENTS.md`, `CONTRIBUTING.md`, `README.md`。

## 真实 UE / Extension Host smoke

未伪造执行。仓库与可用环境中未发现可运行的 `.uproject` fixture / UE 引擎与 UBT；当前工具也不能启动并操控真实 VS Code Extension Development Host。因此无法实测：

1. `VSCodeUEHelper: Generate Compile Commands` 首次 UBT 路径；
2. 产出的非空、可解析 `compile_commands.json`；
3. 第二次运行的 cache fast-path；
4. 真实 symlink/copy 目标。

`npm run build` 是本环境可执行的 smoke，已通过。真实 UE 命令保留为 `03-VERIFICATION.md` 中的人工 verification debt，未伪造通过。

## Deviations from Plan

1. 全仓 `format:check` 因 26 个未触及存量文件失败；遵照用户要求未执行全仓 formatter，仅格式化并验证本计划两个文件。
2. 四子模块合计 868 行，高于研究估算约 770 行，但主入口 492 行满足硬目标，且无重复实现；差异主要来自模块级注释与独立类型说明。
3. 真实 UE / Extension Host 环境不可用，未执行人工命令 smoke；明确记录，不声明通过。

## Self-Check: PASSED

自动化交付、结构/API/caller 核对与可执行 build smoke 均完成；环境限制和存量门禁失败均已精确披露。
