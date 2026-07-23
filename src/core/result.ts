/**
 * Result<T, E> —— 显式错误通道的轻量封装
 *
 * 替代 `throw new Error(...)` 模式,适用于错误是预期业务流一部分的场景
 * (例:用户配置无效、detection 未就绪、UBT 失败等)。
 *
 * 零依赖、约 30 行实现,只供新代码选用 —— 不替换现有 throw 路径。
 * 错误码关联 `@core/errors` 的 `E_*` 常量。
 *
 * ## 用法
 *
 * ```ts
 * import { Ok, Err, isOk, isErr } from '@core/result';
 * import { E_CONFIG_INVALID } from '@core/errors';
 *
 * function parseConfig(raw: string): Result<Config> {
 *   if (!raw) return Err(E_CONFIG_INVALID, 'config file missing');
 *   return Ok(JSON.parse(raw));
 * }
 *
 * const result = parseConfig(input);
 * if (isOk(result)) {
 *   console.log(result.value); // 类型: Config
 * } else {
 *   console.error(result.error.code, result.error.message);
 * }
 * ```
 *
 * ## 形式选择说明
 *
 * 选 `{ ok: true; value: T } | { ok: false; error: E }` discriminated union 形式
 * (而非 `{ kind: 'ok', value } | { kind: 'err', error }`),理由:
 * - 与 `vscode` API 风格一致(返回 boolean ok + 详情)
 * - boolean 字段更利于用户写 `if (result.ok)` 而非 `if (result.kind === 'ok')`
 * - 配合 `isOk` / `isErr` 类型守卫,类型推导自然
 */

/** Result 联合类型。成功时 `ok = true` + value,失败时 `ok = false` + error。 */
export type Result<T, E = { code: string; message: string }> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** 构造成功 Result。 */
export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** 构造失败 Result。`code` 通常是 `@core/errors` 的 `E_*` 常量。 */
export function Err<E = { code: string; message: string }>(
  code: string,
  message: string,
): Result<never, E> {
  return { ok: false, error: { code, message } as E };
}

/** 类型守卫:Result 是否成功? */
export function isOk<T, E>(r: Result<T, E>): r is { readonly ok: true; readonly value: T } {
  return r.ok;
}

/** 类型守卫:Result 是否失败? */
export function isErr<T, E>(r: Result<T, E>): r is { readonly ok: false; readonly error: E } {
  return !r.ok;
}
