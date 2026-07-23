# Plan 02-02: TypeScript strict + API surface 规范化

**Status:** COMPLETE
**Date:** 2026-07-23
**Wave:** 2 (depends on 02-01)
**Decisions:** D-11 (any/ts-ignore 收口) / D-12 (Result<T,E>) / D-13 (index 重导出扫查) / D-14 (错误码体系) / D-15 (logger 前缀扫查)

## 修改清单

### 新文件

| 文件 | 行数 | 内容 |
|---|---|---|
| `src/core/result.ts` | 70 | `Result<T, E>` discriminated union + `Ok` / `Err` 工厂 + `isOk` / `isErr` 类型守卫 + 完整中文 JSDoc + 用法示例 |
| `src/core/errors.ts` | 69 | `VSCodeUEHelperError extends Error` + 4 个 `E_*` 常量 (`E_CONFIG_INVALID` / `E_DETECTION_NOT_READY` / `E_BUILD_FAILED` / `E_PROXY_CRASHED`) + `ErrorCode` union type + `isVSCodeUEHelperError` 类型守卫 + 完整中文 JSDoc |
| `test/unit/core/result.test.ts` | 98 | 11 个 test case: Ok 工厂 / Err 工厂 / isOk / isErr / 实际分支用法 |
| `test/unit/core/errors.test.ts` | 107 | 13 个 test case: 4 个常量 / VSCodeUEHelperError 5 个 / isVSCodeUEHelperError 4 个 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `src/core/AGENTS.md` | 追加 2 章节:"Result<T, E> 使用约定"(15 行) + "错误码体系"(20 行) |
| `src/core/logger.ts` | 追加 JSDoc "日志前缀约定" 段(16 行, 含反例清单) |

## D-11 any/ts-ignore 扫查结果

- **`: any`**: 3 处全部在 `src/ui/AGENTS.md` markdown 示例(97/103/109 行),实际 `src/ui/notifications.ts` 已经是干净的(没有 `args: any[]` 函数签名)。**0 真实代码违规**。
- **`as any`**: 1 处在 `src/clangd/perfLog.ts:95` (`vscode as any`),已有 inline `eslint-disable-next-line @typescript-eslint/no-explicit-any`,Plan 02-01 升级 `no-explicit-any: error` 后此 disable 起作用。**0 真实代码违规**。
- **`<any>`**: 0 匹配。
- **`@ts-ignore` / `@ts-expect-error`**: 0 匹配。
- **D-11 结论: 仓库 `any` 现状已合规 (1 处带 inline disable, 0 处违规)。** 本 plan 0 代码改动。

## D-12 Result<T, E> 决策落地

- 选 `{ ok: true; value: T } | { ok: false; error: E }` discriminated union 形式 (而非 `{ kind, value/error }`)。
- 与 `vscode` API 风格一致,boolean 字段利于 `if (result.ok)` 分支。
- 零依赖,~70 行实现,`@core/result` 路径别名。
- **`readonly`** 字段防止外部代码 mutation (类型契约)。
- 不替换现有 `throw` 路径(per CONTEXT §D-12 明确"仅供新代码选用")。

## D-13 index 重导出扫查

- `src/commands/index.ts` 注册 21 个命令,`package.json#contributes.commands` 21 个唯一 ID。**完全匹配,0 改动**。
- `src/clangd/index.ts` 导出 API 包含 `enableClangdProxy` / `disableClangdProxy` / `showClangdProxyStatus` / `diagnoseProject` 等全部 clangd 类命令的 execute 函数。**完整,0 改动**。
- `src/core/index.ts` **不存在是设计意图** (per `.planning/codebase/STRUCTURE.md` 已知约束),`@core/<name>` 直导。本 plan 同样不建 index.ts,新文件用 `@core/result` / `@core/errors`。
- `src/clangd/proxy/` + `src/clangd/diagnostics/` **无 index.ts 是设计意图**,不动。

## D-14 错误码体系

- 4 个 `E_*` 字面量常量 (`'E_CONFIG_INVALID'` 等),用 `ErrorCode` union type 锁定合法集合。
- `VSCodeUEHelperError extends Error` 带 `code` + `cause` 字段,`name` 固定为 `'VSCodeUEHelperError'` 便于 catch 块路由。
- `isVSCodeUEHelperError(e: unknown)` 类型守卫用于 catch 分支。
- 新错误码流程文档化(在 errors.ts 注释 + AGENTS.md 错误码体系段都说明):加常量 + 扩 union + 文档同步。
- **不替换现有 throw 路径** (per CONTEXT §D-14),仅供新代码使用。

## D-15 logger 前缀约定

- 仓库现状:几乎所有 `logger.info/warn/error/debug` 调用首参数都已带 `[<moduleName>]` 前缀,30+ 处扫查 0 违例。
- ESLint 已锁 `new Logger()` 禁止 (per `.eslintrc.json:53-55`),规则覆盖 100%。
- 本 plan 0 代码改动,只把约定文档化到 `src/core/logger.ts` JSDoc "日志前缀约定" 段,含反例清单 (无前缀 / 冒号分隔 / 模块内 new Logger)。
- 3 个例子都是 code review 退回依据,新人 onboarding 直接看 logger.ts 即可。

## 验证

| Gate | 结果 |
|---|---|
| `npm run lint` | **0 errors**, 126 warnings (consistent-type-imports 存量,Plan 02-01 显式推迟) |
| `npm run typecheck` | **0 errors** |
| `npm run test:unit` | **843/843 passed** (74 test files) — 新增 24 个 Result/Errors 测试 |
| 0 个 `package.json` 变更 | ✓ |
| 0 个新 runtime 依赖 | ✓ (Result + Errors 零依赖) |
| 现有 throw 数量前后不变 | ✓ (D-12/D-14 仅新基础设施,不动现有 throw 站点) |

## 后续衔接

- `Result<T, E>` + `VSCodeUEHelperError` + 4 个 `E_*` 常量供后续 phase (3-6) 的"新代码"选用,降低 throw 路径蔓延。
- `errors.ts` 的 `E_CONFIG_INVALID` / `E_DETECTION_NOT_READY` / `E_BUILD_FAILED` / `E_PROXY_CRASHED` 与 `.planning/codebase/CONCERNS.md` 的真实失败模式对应,Phase 3-6 真实引入时按需扩展。
- AGENTS.md "Result 使用约定" + "错误码体系" 段是新人 onboarding 入口,与 Phase 02-03 的 CONTRIBUTING.md 衔接。
