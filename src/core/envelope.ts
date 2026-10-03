/**
 * 契约全局错误码 (来源: openapi.yaml components.schemas.Error.code 枚举,9 项,值逐字一致)
 * @see openapi.yaml components.schemas.Error.code
 * @see 决策 D5
 */
export type ContractErrorCode =
  | 'PROJECT_NOT_DETECTED' | 'UBT_NOT_FOUND' | 'BUILD_FAILED'
  | 'LIVE_CODING_UNAVAILABLE' | 'CLANGD_NOT_AVAILABLE' | 'OPERATION_CANCELLED'
  | 'MCP_CONTEXT_NOT_INITIALIZED' | 'UNKNOWN_TOOL' | 'INTERNAL_ERROR';

/** EC_PROJECT_NOT_DETECTED 常量 (契约全局错误码) @see openapi.yaml components.schemas.Error.code */
export const EC_PROJECT_NOT_DETECTED: ContractErrorCode = 'PROJECT_NOT_DETECTED';
/** EC_UBT_NOT_FOUND 常量 (契约全局错误码) @see openapi.yaml components.schemas.Error.code */
export const EC_UBT_NOT_FOUND: ContractErrorCode = 'UBT_NOT_FOUND';
/** EC_BUILD_FAILED 常量 (契约全局错误码) @see openapi.yaml components.schemas.Error.code */
export const EC_BUILD_FAILED: ContractErrorCode = 'BUILD_FAILED';
/** EC_LIVE_CODING_UNAVAILABLE 常量 (契约全局错误码) @see openapi.yaml components.schemas.Error.code */
export const EC_LIVE_CODING_UNAVAILABLE: ContractErrorCode = 'LIVE_CODING_UNAVAILABLE';
/** EC_CLANGD_NOT_AVAILABLE 常量 (契约全局错误码) @see openapi.yaml components.schemas.Error.code */
export const EC_CLANGD_NOT_AVAILABLE: ContractErrorCode = 'CLANGD_NOT_AVAILABLE';
/** EC_OPERATION_CANCELLED 常量 (契约全局错误码) @see openapi.yaml components.schemas.Error.code */
export const EC_OPERATION_CANCELLED: ContractErrorCode = 'OPERATION_CANCELLED';
/** EC_MCP_CONTEXT_NOT_INITIALIZED 常量 (契约全局错误码) @see openapi.yaml components.schemas.Error.code */
export const EC_MCP_CONTEXT_NOT_INITIALIZED: ContractErrorCode = 'MCP_CONTEXT_NOT_INITIALIZED';
/** EC_UNKNOWN_TOOL 常量 (契约全局错误码) @see openapi.yaml components.schemas.Error.code */
export const EC_UNKNOWN_TOOL: ContractErrorCode = 'UNKNOWN_TOOL';
/** EC_INTERNAL_ERROR 常量 (契约全局错误码) @see openapi.yaml components.schemas.Error.code */
export const EC_INTERNAL_ERROR: ContractErrorCode = 'INTERNAL_ERROR';

/**
 * 契约错误对象 (来源: openapi.yaml components.schemas.Error; code/message 必填,details 可选)
 * @see openapi.yaml components.schemas.Error
 * @see 决策 D5
 */
export interface ContractError {
  code: ContractErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * 契约 envelope (来源: openapi.yaml components.schemas.Envelope; data 为 allOf 扩展位,见决策 D5)
 * @see openapi.yaml components.schemas.Envelope
 * @see 决策 D5
 */
export interface Envelope<T = unknown> {
  ok: boolean;
  summary?: string;
  data?: T;
  error?: ContractError;
}

/**
 * 返回 ok=true 的 envelope
 * @param data 业务数据
 * @param summary 总结描述
 * @returns Envelope<T>
 */
export function okEnvelope<T>(data?: T, summary?: string): Envelope<T> {
  const env: Envelope<T> = { ok: true };
  if (summary !== undefined) {
    env.summary = summary;
  }
  if (data !== undefined) {
    env.data = data;
  }
  return env;
}

/**
 * 返回 ok=false 的 envelope
 * @param code 错误码
 * @param message 错误信息
 * @param details 补充信息
 * @returns Envelope<never>
 */
export function errEnvelope(code: ContractErrorCode, message: string, details?: Record<string, unknown>): Envelope<never> {
  return {
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
  };
}
