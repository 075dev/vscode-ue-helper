/**
 * framing.ts —— LSP stdio 帧解析器/序列化器
 *
 * 职责：
 * - 基于 Buffer 的 LSP JSON-RPC 帧解析（Content-Length 头）
 * - 序列化器使用 UTF-8 字节长度，而非 JS 字符串长度
 * - 支持拼接帧、部分帧、垃圾恢复
 *
 * 设计决策：
 * - 不依赖行分割（\n）或 JS 字符串长度，全部基于 Buffer 操作
 * - Content-Length 值必须是正整数，否则跳过该帧
 * - 头部扫描使用 Buffer.indexOf 查找 \r\n\r\n 分隔符
 * - JSON 解析失败时跳过该帧并继续扫描
 * - 超大 Content-Length 被拒绝（> 64MB 视为无效）以防止 OOM
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** JSON-RPC 消息（请求/通知/响应/错误） */
export interface JsonRpcMessage {
  jsonrpc: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 头部结束分隔符 */
const HEADER_SEPARATOR = Buffer.from('\r\n\r\n', 'ascii');

/** Content-Length 前缀（ASCII） */
const CONTENT_LENGTH_PREFIX = Buffer.from('Content-Length:', 'ascii');

/** 最大可接受的 Content-Length 值（64MB） */
const MAX_CONTENT_LENGTH = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 序列化器
// ---------------------------------------------------------------------------

/**
 * 将 JSON-RPC 消息编码为 LSP stdio 帧。
 *
 * 使用 Buffer.byteLength(json, 'utf-8') 计算 UTF-8 字节长度，
 * 而非 JS 的 string.length（后者对多字节字符不准确）。
 *
 * @param message - JSON-RPC 消息对象
 * @returns 完整的 LSP 帧 Buffer（Content-Length 头 + 双 CRLF + JSON 体）
 */
export function encodeMessage(message: JsonRpcMessage): Buffer {
  const json = JSON.stringify(message);
  const utf8 = Buffer.from(json, 'utf-8');
  const header = `Content-Length: ${utf8.byteLength}\r\n\r\n`;
  const headerBuf = Buffer.from(header, 'ascii');
  return Buffer.concat([headerBuf, utf8]);
}

// ---------------------------------------------------------------------------
// 解析器
// ---------------------------------------------------------------------------

/**
 * LSP stdio 帧解析器。
 *
 * 基于 Buffer 的状态机，维护内部缓冲区，支持增量喂入数据。
 * 不依赖行分割或 JS 字符串长度。
 */
export class LspFramingParser {
  /** 内部累积缓冲区 */
  private buffer = Buffer.alloc(0);

  /**
   * 喂入原始字节数据，尝试解析出完整的 JSON-RPC 消息。
   *
   * @param chunk - 新到达的字节数据
   * @returns 解析出的完整消息数组（可能为空）
   */
  feed(chunk: Buffer): JsonRpcMessage[] {
    // 将新数据追加到内部缓冲区
    this.buffer = Buffer.concat([this.buffer, chunk]);

    const messages: JsonRpcMessage[] = [];

    while (this.buffer.length > 0) {
      // 尝试解析一帧
      const result = this.tryParseOne();

      if (result === null) {
        // 没有足够数据完成一帧，等待更多数据
        break;
      }

      const [message, consumed] = result;
      if (message !== null) {
        messages.push(message);
      }
      // 移除已消费的字节
      this.buffer = this.buffer.subarray(consumed);
    }

    return messages;
  }

  /**
   * 尝试从缓冲区头部解析一帧。
   *
   * @returns [消息 | null, 消费字节数] 或 null（数据不足）
   */
  private tryParseOne(): [JsonRpcMessage | null, number] | null {
    // 查找头部结束分隔符 \r\n\r\n
    const sepIdx = this.buffer.indexOf(HEADER_SEPARATOR);
    if (sepIdx === -1) {
      // 还没收到完整的头部
      // 但如果缓冲区已经很大且没有分隔符，可能是垃圾数据，跳过
      if (this.buffer.length > 4096) {
        // 丢弃前 1024 字节，尝试恢复
        this.buffer = this.buffer.subarray(1024);
        return this.tryParseOne();
      }
      return null;
    }

    // 提取头部区域（不含 \r\n\r\n）
    const headerEnd = sepIdx + HEADER_SEPARATOR.length;
    const headerBuf = this.buffer.subarray(0, sepIdx);

    // 解析 Content-Length
    const contentLength = this.parseContentLength(headerBuf);

    if (contentLength === null) {
      // 无效的 Content-Length，跳过此帧
      // 跳过到分隔符之后，继续扫描
      return [null, headerEnd];
    }

    if (contentLength < 0) {
      // 负长度无效，跳过
      return [null, headerEnd];
    }

    if (contentLength > MAX_CONTENT_LENGTH) {
      // 超大长度拒绝，跳过
      return [null, headerEnd];
    }

    // 检查是否有足够数据
    const frameEnd = headerEnd + contentLength;
    if (this.buffer.byteLength < frameEnd) {
      // 数据不足，等待更多
      return null;
    }

    // 提取 JSON 体
    const bodyBuf = this.buffer.subarray(headerEnd, frameEnd);

    // Content-Length 为 0 时返回空 JSON-RPC 消息
    if (contentLength === 0) {
      return [{ jsonrpc: '' }, frameEnd];
    }

    // 解析 JSON
    try {
      const text = bodyBuf.toString('utf-8');
      const parsed = JSON.parse(text) as JsonRpcMessage;
      return [parsed, frameEnd];
    } catch {
      // JSON 解析失败，跳过此帧
      return [null, frameEnd];
    }
  }

  /**
   * 从头部 Buffer 中解析 Content-Length 值。
   *
   * 支持头部中包含其他头（如 Content-Type），只提取 Content-Length。
   * 值前后允许空白字符。
   *
   * @param headerBuf - 头部 Buffer（不含 \r\n\r\n）
   * @returns 解析出的长度值，或 null（无效）
   */
  private parseContentLength(headerBuf: Buffer): number | null {
    // 查找 "Content-Length:" 前缀
    const prefixIdx = headerBuf.indexOf(CONTENT_LENGTH_PREFIX);
    if (prefixIdx === -1) {
      return null;
    }

    // 从前缀后开始，找到行尾（\r\n）
    const valueStart = prefixIdx + CONTENT_LENGTH_PREFIX.length;
    const lineEnd = headerBuf.indexOf('\r\n', valueStart, 'ascii');
    const valueEnd = lineEnd === -1 ? headerBuf.byteLength : lineEnd;

    // 提取值部分并去除空白
    const valueBuf = headerBuf.subarray(valueStart, valueEnd);
    const valueStr = valueBuf.toString('ascii').trim();

    if (valueStr.length === 0) {
      return null;
    }

    // 尝试解析为数字
    const num = Number(valueStr);
    if (!Number.isFinite(num) || !Number.isInteger(num)) {
      return null;
    }

    return num;
  }

  /**
   * 重置解析器，清空内部缓冲区。
   */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * 返回内部缓冲区中尚未消费的字节。
   */
  leftover(): Buffer {
    return this.buffer;
  }
}
