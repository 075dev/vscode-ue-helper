/**
 * VSCodeUEHelperError —— 项目级错误基类 + 错误码常量
 *
 * 扩展自 `Error`,带 `code` 字段关联 `E_*` 常量。
 * 设计目标:让 catch 块可以 `if (e instanceof VSCodeUEHelperError) handleErrorCode(e.code)` 路由。
 *
 * ## 错误码常量
 *
 * - `E_CONFIG_INVALID` —— 配置无效(JSON parse 失败 / 字段缺失)
 * - `E_DETECTION_NOT_READY` —— detection.ready Promise 未 resolve(检查是否在 workspace 中打开 .code-workspace)
 * - `E_BUILD_FAILED` —— UBT / Live Coding 进程失败
 * - `E_PROXY_CRASHED` —— clangd proxy 子进程异常退出(查 `~/.vscode/extensions/.../logs/` 里的 proxy 日志)
 *
 * ## 用法
 *
 * 仅供新代码使用,不替换现有 throw 路径。`@core/result` 的 `Err(code, msg)`
 * 工厂配合 `E_*` 常量使用,运行时 throw 用 `throw new VSCodeUEHelperError(code, msg)`。
 *
 * ```ts
 * import { VSCodeUEHelperError, isVSCodeUEHelperError, E_PROXY_CRASHED } from '@core/errors';
 *
 * try {
 *   await proxy.restart();
 * } catch (e) {
 *   if (isVSCodeUEHelperError(e) && e.code === E_PROXY_CRASHED) {
 *     logger.error('[clangd] proxy crashed:', e.message);
 *     vscode.window.showErrorMessage(t('proxy.crashed'));
 *   } else {
 *     throw e;
 *   }
 * }
 * ```
 *
 * ## 新增错误码流程
 *
 * 1. 在本文件加 `export const E_NEW_CODE = 'E_NEW_CODE' as const;`
 * 2. 扩展 `ErrorCode` union type:`| typeof E_NEW_CODE`
 * 3. 在 `src/core/AGENTS.md` "错误码体系" 段补充说明
 */

/** 项目级错误基类。所有自定义错误用 `throw new VSCodeUEHelperError(code, msg)`。 */
export class VSCodeUEHelperError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VSCodeUEHelperError';
  }
}

// 错误码常量(可扩展,新增需同步扩展 ErrorCode union)
export const E_CONFIG_INVALID = 'E_CONFIG_INVALID';
export const E_DETECTION_NOT_READY = 'E_DETECTION_NOT_READY';
export const E_BUILD_FAILED = 'E_BUILD_FAILED';
export const E_PROXY_CRASHED = 'E_PROXY_CRASHED';

/** 所有合法错误码的联合类型。`isVSCodeUEHelperError` 配合后,e.code 是 ErrorCode 之一。 */
export type ErrorCode =
  | typeof E_CONFIG_INVALID
  | typeof E_DETECTION_NOT_READY
  | typeof E_BUILD_FAILED
  | typeof E_PROXY_CRASHED;

/** 类型守卫:未知值是否是 VSCodeUEHelperError? */
export function isVSCodeUEHelperError(e: unknown): e is VSCodeUEHelperError {
  return e instanceof VSCodeUEHelperError;
}
