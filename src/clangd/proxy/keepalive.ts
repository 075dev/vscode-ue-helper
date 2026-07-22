/**
 * keepalive.ts — didClose 保活状态机
 *
 * 职责：
 * - 延迟转发 textDocument/didClose 通知，避免 clangd 频繁释放文档解析状态
 * - 当 textDocument/didOpen 命中保活 URI 时，改为发送全量 textDocument/didChange
 * - LRU 淘汰：超过 keepaliveMax 时淘汰最旧条目
 * - TTL 过期：超过 keepaliveTtlSec 后转发原始 didClose
 * - shutdown flush：返回所有待处理的 didClose
 *
 * 设计决策：
 * - 使用 Map 保证插入顺序（LRU 顺序）
 * - 不依赖外部存储，不跨进程持久化
 * - 所有方法同步返回 KeepaliveAction[]，调用者负责转发
 */

// 默认配置
const DEFAULT_MAX = 20;
const DEFAULT_TTL_SEC = 900;

/** 保活配置选项 */
export interface KeepaliveOptions {
  /** 最大保活条目数，默认 20 */
  max?: number;
  /** TTL 秒数，默认 900（15 分钟） */
  ttlSec?: number;
}

/** 保活条目 */
interface KeepaliveEntry {
  /** 原始 didClose 的 params，用于转发 */
  originalParams: unknown;
  /** 插入时间戳（ms） */
  timestamp: number;
}

/**
 * 保活动作类型
 * - forwardDidClose: 转发原始 didClose 通知
 * - forwardDidOpen: 转发原始 didOpen 通知
 * - forwardDidChange: 转发全量 didChange 通知（由保活命中触发）
 */
export type KeepaliveActionType = 'forwardDidClose' | 'forwardDidOpen' | 'forwardDidChange';

/** 保活动作 */
export interface KeepaliveAction {
  type: KeepaliveActionType;
  uri: string;
  params: unknown;
}

/**
 * didClose 保活状态机
 *
 * 状态：Open（文件在编辑器中打开）、Keepalive（didClose 延迟）、Flushed/Evicted（已转发）
 * 不跨进程持久化，每次创建新实例。
 */
export class Keepalive {
  /** URI → 保活条目，按插入顺序 */
  private readonly entries: Map<string, KeepaliveEntry>;
  private readonly max: number;
  private readonly ttlMs: number;

  constructor(options?: KeepaliveOptions) {
    this.entries = new Map();
    this.max = options?.max ?? DEFAULT_MAX;
    this.ttlMs = (options?.ttlSec ?? DEFAULT_TTL_SEC) * 1000;
  }

  /** 当前保活条目数 */
  get size(): number {
    return this.entries.size;
  }

  /**
   * 处理 textDocument/didClose
   * - 将 URI 加入保活列表
   * - 如果超过 max，淘汰最旧条目并返回 forwardDidClose 动作
   */
  handleDidClose(uri: string, params: unknown): KeepaliveAction[] {
    const actions: KeepaliveAction[] = [];

    // 加入保活列表（或更新 LRU 位置）
    this.entries.set(uri, {
      originalParams: params,
      timestamp: Date.now(),
    });

    // LRU 淘汰：超出 max 时移除最旧条目（Map 第一个）
    while (this.entries.size > this.max) {
      const firstKey = this.entries.keys().next();
      if (firstKey.done) {
        break;
      }
      const evictedUri = firstKey.value;
      const evicted = this.entries.get(evictedUri);
      this.entries.delete(evictedUri);
      if (evicted) {
        actions.push({
          type: 'forwardDidClose',
          uri: evictedUri,
          params: evicted.originalParams,
        });
      }
    }

    return actions;
  }

  /**
   * 处理 textDocument/didOpen
   * - 如果 URI 在保活中且 params 包含 text 和 version，发出 forwardDidChange（全量文本）
   * - 如果 URI 在保活中但缺少 text 或 version，先 flush didClose 再转发 didOpen
   * - 如果 URI 不在保活中，直接转发 didOpen
   */
  handleDidOpen(uri: string, params: unknown): KeepaliveAction[] {
    const actions: KeepaliveAction[] = [];
    const entry = this.entries.get(uri);

    if (!entry) {
      // URI 不在保活中，直接转发 didOpen
      actions.push({ type: 'forwardDidOpen', uri, params });
      return actions;
    }

    // URI 在保活中，检查是否有 text 和 version
    const p = params as Record<string, unknown>;
    const td = p.textDocument as Record<string, unknown> | undefined;
    const hasText = td && typeof td.text === 'string';
    const hasVersion = td && typeof td.version === 'number';

    if (hasText && hasVersion) {
      // 完整信息：发出全量 didChange
      this.entries.delete(uri);
      actions.push({
        type: 'forwardDidChange',
        uri,
        params: {
          textDocument: {
            uri: td.uri,
            version: td.version,
          },
          contentChanges: [{ text: td.text }],
        },
      });
    } else {
      // 缺少 text 或 version：先 flush didClose 再转发 didOpen
      this.entries.delete(uri);
      actions.push({
        type: 'forwardDidClose',
        uri,
        params: entry.originalParams,
      });
      actions.push({ type: 'forwardDidOpen', uri, params });
    }

    return actions;
  }

  /**
   * TTL 过期检查
   * - 返回所有超时条目的 forwardDidClose 动作
   * - 由调用者定期调用（例如每次收到消息时）
   */
  tick(): KeepaliveAction[] {
    const actions: KeepaliveAction[] = [];
    const now = Date.now();

    for (const [uri, entry] of this.entries) {
      if (now - entry.timestamp >= this.ttlMs) {
        this.entries.delete(uri);
        actions.push({
          type: 'forwardDidClose',
          uri,
          params: entry.originalParams,
        });
      }
    }

    return actions;
  }

  /**
   * shutdown flush
   * - 返回所有待处理的 forwardDidClose 动作（按插入顺序）
   * - 清空保活列表
   */
  flush(): KeepaliveAction[] {
    const actions: KeepaliveAction[] = [];

    for (const [uri, entry] of this.entries) {
      actions.push({
        type: 'forwardDidClose',
        uri,
        params: entry.originalParams,
      });
    }

    this.entries.clear();
    return actions;
  }
}
