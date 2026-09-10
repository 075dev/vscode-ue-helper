/**
 * messages.ts —— JSON-RPC/LSP 消息分类与关联
 *
 * 职责：
 * - 定义严格的 request/response/notification/error 类型
 * - 提供类型守卫（isRequest, isNotification, isResponse, isErrorResponse）
 * - 提供辅助谓词（getMethod, getId, getResult, getError）
 * - 提供请求-响应关联（RequestCorrelation），用于根据原始请求 method 本地化响应
 *
 * 设计原则：
 * - 所有未知 JSON 从 unknown 收窄，不使用 any
 * - 畸形 id/method 不抛异常，直接透传（返回 undefined）
 * - 类型守卫遵循 JSON-RPC 2.0 规范
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** JSON-RPC 请求（有 id 和 method） */
export interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: unknown;
}

/** JSON-RPC 通知（有 method，无 id 或 id 为 null） */
export interface JsonRpcNotification {
  jsonrpc: string;
  method: string;
  params?: unknown;
}

/** JSON-RPC 成功响应（有 id 和 result） */
export interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result: unknown;
}

/** JSON-RPC 错误响应（有 id 和 error） */
export interface JsonRpcErrorResponse {
  jsonrpc: string;
  id: number | string;
  error: JsonRpcError;
}

/** JSON-RPC 错误对象 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

/**
 * 判断未知消息是否为 JSON-RPC 请求。
 *
 * 请求必须有 id（number 或 string，不能是 null）和 method（string）。
 */
export function isRequest(msg: unknown): msg is JsonRpcRequest {
  if (typeof msg !== 'object' || msg === null) {
    return false;
  }
  const m = msg as Record<string, unknown>;
  if (typeof m.method !== 'string') {
    return false;
  }
  const id = m.id;
  return (typeof id === 'number' || typeof id === 'string') && id !== null;
}

/**
 * 判断未知消息是否为 JSON-RPC 通知。
 *
 * 通知必须有 method（string），且无 id 或 id 为 null。
 */
export function isNotification(msg: unknown): msg is JsonRpcNotification {
  if (typeof msg !== 'object' || msg === null) {
    return false;
  }
  const m = msg as Record<string, unknown>;
  if (typeof m.method !== 'string') {
    return false;
  }
  // 通知：无 id 或 id 为 null
  return m.id === undefined || m.id === null;
}

/**
 * 判断未知消息是否为 JSON-RPC 成功响应。
 *
 * 成功响应必须有 id（number 或 string）和 result 字段（值可为 null/falsy）。
 * result 字段必须存在（即使值为 null/false/0），且不能有 error 字段。
 */
export function isResponse(msg: unknown): msg is JsonRpcResponse {
  if (typeof msg !== 'object' || msg === null) {
    return false;
  }
  const m = msg as Record<string, unknown>;
  const id = m.id;
  if (typeof id !== 'number' && typeof id !== 'string') {
    return false;
  }
  // 必须有 result 字段（即使值为 null/false/0）
  if (!('result' in m)) {
    return false;
  }
  // 不能有 error 字段
  if ('error' in m) {
    return false;
  }
  return true;
}

/**
 * 判断未知消息是否为 JSON-RPC 错误响应。
 *
 * 错误响应必须有 id（number 或 string）和 error 对象。
 */
export function isErrorResponse(msg: unknown): msg is JsonRpcErrorResponse {
  if (typeof msg !== 'object' || msg === null) {
    return false;
  }
  const m = msg as Record<string, unknown>;
  const id = m.id;
  if (typeof id !== 'number' && typeof id !== 'string') {
    return false;
  }
  const err = m.error;
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 辅助谓词
// ---------------------------------------------------------------------------

/**
 * 从消息中提取 method。
 *
 * 仅当 method 为 string 时返回，否则返回 undefined。
 * 不抛异常。
 */
export function getMethod(msg: unknown): string | undefined {
  if (typeof msg !== 'object' || msg === null) {
    return undefined;
  }
  const method = (msg as Record<string, unknown>).method;
  if (typeof method === 'string') {
    return method;
  }
  return undefined;
}

/**
 * 从消息中提取 id。
 *
 * 仅当 id 为 number 或 string 时返回，否则返回 undefined。
 * null id 视为 undefined（通知）。
 * 不抛异常。
 */
export function getId(msg: unknown): number | string | undefined {
  if (typeof msg !== 'object' || msg === null) {
    return undefined;
  }
  const id = (msg as Record<string, unknown>).id;
  if (id === null || id === undefined) {
    return undefined;
  }
  if (typeof id === 'number' || typeof id === 'string') {
    return id;
  }
  return undefined;
}

/**
 * 从消息中提取 result。
 *
 * 返回 result 字段的值（可能为 null/false/0），或 undefined（无 result 字段）。
 * 不抛异常。
 */
export function getResult(msg: unknown): unknown {
  if (typeof msg !== 'object' || msg === null) {
    return undefined;
  }
  const m = msg as Record<string, unknown>;
  if ('result' in m) {
    return m.result;
  }
  return undefined;
}

/**
 * 从消息中提取 error 对象。
 *
 * 仅当 error 为非 null 对象时返回，否则返回 undefined。
 * 不抛异常。
 */
export function getError(msg: unknown): JsonRpcError | undefined {
  if (typeof msg !== 'object' || msg === null) {
    return undefined;
  }
  const err = (msg as Record<string, unknown>).error;
  if (typeof err === 'object' && err !== null) {
    return err as JsonRpcError;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 请求-响应关联
// ---------------------------------------------------------------------------

/**
 * 请求-响应关联器。
 *
 * 记录发出请求的 id → method 映射，以便在收到响应时根据 method 进行本地化。
 *
 * 线程安全：否（JS 单线程）。
 * 内存：所有关联存储在 Map 中，调用 clear() 或 remove() 释放。
 */
export class RequestCorrelation {
  /** id → method 映射 */
  private readonly map = new Map<number | string, string>();

  /**
   * 记录一个请求的 id → method 关联。
   *
   * @param id - 请求的 id
   * @param method - 请求的 method
   */
  record(id: number | string, method: string): void {
    this.map.set(id, method);
  }

  /**
   * 查找 id 对应的 method。
   *
   * @param id - 要查找的 id
   * @returns 对应的 method，或 undefined（未找到）
   */
  lookup(id: number | string): string | undefined {
    return this.map.get(id);
  }

  /**
   * 移除一个 id 的关联。
   *
   * @param id - 要移除的 id
   */
  remove(id: number | string): void {
    this.map.delete(id);
  }

  /**
   * 清除所有关联。
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * 当前关联数。
   */
  get size(): number {
    return this.map.size;
  }
}
