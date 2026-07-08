/**
 * bridge.ts —— LSP 代理桥接
 *
 * 职责：
 * - 接收客户端侧帧字节，解析 LSP 消息
 * - 对 textDocument/didClose 应用保活语义
 * - 记录请求-响应关联（用于后续本地化）
 * - 转发序列化帧到服务器传输层
 * - 服务器→客户端路径：解析帧字节，默认透传
 * - 暴露关联/本地化钩子点
 *
 * 设计原则：
 * - 不依赖 vscode
 * - 不写入 stdout（stdout 是 LSP 协议通道）
 * - 所有日志通过回调或 stderr
 * - 使用 T1 LspFramingParser 解析
 * - 使用 T2 RequestCorrelation 关联
 * - 使用 T3 Keepalive 保活
 */

import { LspFramingParser, encodeMessage } from './framing';
import type { JsonRpcMessage } from './framing';
import { isRequest, isNotification, getMethod, getId, RequestCorrelation } from './messages';
import { Keepalive } from './keepalive';
import type { KeepaliveAction } from './keepalive';
import {
  applyLocalizationToDiagnostic,
  applyLocalizationToCodeAction,
  applyLocalizationToHover,
  stripOriginalText,
} from './localization';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 服务器传输层接口 */
export interface ServerTransport {
  /** 向服务器发送数据 */
  send(data: Buffer): void;
  /** 注册服务器数据回调 */
  onData(handler: (data: Buffer) => void): void;
  /** 关闭传输层 */
  close(): void;
}

/** 桥接钩子 */
export interface BridgeHooks {
  /** 服务器响应时调用（含关联的 method） */
  onServerResponse?: (msg: JsonRpcMessage, method: string | undefined) => void;
  /** 服务器通知时调用 */
  onServerNotification?: (msg: JsonRpcMessage) => void;
  /** [Phase 8] textDocument/publishDiagnostics 通知时调用（用于 UE 诊断拦截） */
  onPublishDiagnostics?: (params: {
    uri: string;
    diagnostics: Array<{
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      severity: number;
      source?: string;
      message: string;
    }>;
  }) => void;
  /**
   * [Phase 8] textDocument/didSave 通知时调用（保存事件）。
   *
   * UBT 触发改到保存后：publishDiagnostics 含未保存缓冲区，此时 UBT 读磁盘（旧内容）重建无效。
   * didSave 时磁盘已更新，UBT 能读到刚保存的内容，重建 .generated.h 才有效。
   */
  onDidSave?: (uri: string) => void;
}

/** 本地化选项 */
export interface LocalizationOptions {
  /** 是否启用本地化 */
  enabled: boolean;
  /** 本地化模式：append（原文 + 翻译）或 zh-only（仅翻译） */
  mode: 'append' | 'zh-only';
}

/** 桥接选项 */
export interface LspBridgeOptions {
  /** 最大保活条目数，默认 20 */
  keepaliveMax?: number;
  /** TTL 秒数，默认 900（15 分钟） */
  keepaliveTtlSec?: number;
  /** 桥接钩子 */
  hooks?: BridgeHooks;
  /** 本地化选项（可选，不传则禁用本地化） */
  localization?: LocalizationOptions;
  /** 日志函数（可选，用于打印汉化流程） */
  log?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// LspBridge
// ---------------------------------------------------------------------------

/**
 * LSP 代理桥接器。
 *
 * 管理客户端→服务器和服务器→客户端两条消息路径。
 * 客户端→服务器路径应用保活语义和关联记录。
 * 服务器→客户端路径默认透传，暴露钩子点。
 */
export class LspBridge {
  /** 客户端→服务器解析器 */
  private readonly clientParser = new LspFramingParser();
  /** 服务器→客户端解析器 */
  private readonly serverParser = new LspFramingParser();
  /** 请求-响应关联器 */
  private readonly correlation = new RequestCorrelation();
  /** didClose 保活状态机 */
  private readonly keepalive: Keepalive;
  /** 服务器传输层 */
  private readonly transport: ServerTransport;
  /** 桥接钩子 */
  private readonly hooks: BridgeHooks | undefined;
  /** 本地化选项 */
  private readonly localization: LocalizationOptions | undefined;
  /** 日志函数 */
  private readonly log: ((msg: string) => void) | undefined;
  /** 客户端输出回调 */
  private clientOutputHandler: ((frame: Buffer) => void) | null = null;
  /** [Phase 8] 各文档最近一次 didOpen/didChange 的 version（用于强制 re-parse 注入 didChange） */
  private readonly lastDocVersions = new Map<string, number>();
  /** [Phase 8] 规范化 uri → VS Code 原始 uri。注入 didChange 必须用 VS Code 原始 uri，
   *  否则 clangd DraftStore 查不到（"non-added document"），didChange 被拒绝。 */
  private readonly originalUris = new Map<string, string>();

  constructor(transport: ServerTransport, options?: LspBridgeOptions) {
    this.transport = transport;
    this.hooks = options?.hooks;
    this.localization = options?.localization;
    this.log = options?.log;
    this.keepalive = new Keepalive({
      max: options?.keepaliveMax,
      ttlSec: options?.keepaliveTtlSec,
    });

    this.log?.(
      this.localization
        ? `[bridge] localization ENABLED: mode=${this.localization.mode}`
        : '[bridge] localization DISABLED',
    );

    // 监听服务器数据
    this.transport.onData((data: Buffer) => this.handleServerData(data));
  }

  // ─── 客户端→服务器路径 ──────────────────────────────────────

  /**
   * 喂入客户端发送的帧字节。
   *
   * 解析后：
   * - 请求：记录关联后转发
   * - textDocument/didClose：进入保活
   * - textDocument/didOpen：检查保活命中
   * - 其他通知：直接转发
   *
   * @param data - 客户端帧字节
   */
  feedClientFrame(data: Buffer): void {
    const messages = this.clientParser.feed(data);

    for (const msg of messages) {
      this.processClientMessage(msg);
    }
  }

  /**
   * 处理单条客户端消息。
   */
  private processClientMessage(msg: JsonRpcMessage): void {
    // 每次处理客户端消息时检查 TTL 过期
    this.checkTtlExpiry();

    // 请求：记录关联后转发
    if (isRequest(msg)) {
      this.correlation.record(msg.id, msg.method);
      this.sendToServer(msg);
      return;
    }

    // 通知：检查保活
    if (isNotification(msg)) {
      const method = getMethod(msg);
      if (method === 'textDocument/didClose') {
        this.handleDidClose(msg);
        return;
      }
      if (method === 'textDocument/didOpen') {
        this.handleDidOpen(msg);
        return;
      }
      if (method === 'textDocument/didSave') {
        this.handleDidSave(msg);
        return;
      }
      if (method === 'textDocument/didChange') {
        this.handleDidChange(msg);
        return;
      }
      // 其他通知直接转发
      this.sendToServer(msg);
      return;
    }

    // 响应/错误响应（客户端不应发送这些，但透传以防万一）
    this.sendToServer(msg);
  }

  /**
   * 检查 TTL 过期条目并转发。
   */
  private checkTtlExpiry(): void {
    const actions = this.keepalive.tick();
    for (const action of actions) {
      this.executeKeepaliveAction(action);
    }
  }

  /**
   * 处理 textDocument/didClose 通知。
   */
  private handleDidClose(msg: JsonRpcMessage): void {
    const params = msg.params as Record<string, unknown> | undefined;
    const td = params?.textDocument as Record<string, unknown> | undefined;
    const uri = td?.uri;

    if (typeof uri !== 'string') {
      // 畸形 didClose，直接转发
      this.sendToServer(msg);
      return;
    }

    // 进入保活
    const actions = this.keepalive.handleDidClose(uri, msg.params);

    // 处理保活动作（LRU 淘汰等）
    for (const action of actions) {
      this.executeKeepaliveAction(action);
    }

    // 清理 version + 原始 uri 记录
    const normalized = this.normalizeUri(uri);
    this.lastDocVersions.delete(normalized);
    this.originalUris.delete(normalized);
  }

  /**
   * 处理 textDocument/didOpen 通知。
   */
  private handleDidOpen(msg: JsonRpcMessage): void {
    const params = msg.params as Record<string, unknown> | undefined;
    const td = params?.textDocument as Record<string, unknown> | undefined;
    const uri = td?.uri;

    if (typeof uri !== 'string') {
      // 畸形 didOpen，直接转发
      this.sendToServer(msg);
      return;
    }

    // 检查保活命中
    const actions = this.keepalive.handleDidOpen(uri, msg.params);

    for (const action of actions) {
      this.executeKeepaliveAction(action);
    }

    // 记录 version（didOpen 携带初始 version）+ 原始 uri（注入 didChange 时必须用 VS Code 原始形式）
    const version = td?.version;
    if (typeof version === 'number') {
      this.lastDocVersions.set(this.normalizeUri(uri), version);
    }
    this.originalUris.set(this.normalizeUri(uri), uri);
  }

  /**
   * 处理 textDocument/didSave 通知。
   *
   * 转发给 clangd，并触发 onDidSave hook。UeDiagnosticWatcher 据此在**保存后**触发 UBT
   * （publishDiagnostics 含未保存缓冲区，此时 UBT 读磁盘旧内容重建无效；didSave 后磁盘已更新）。
   */
  private handleDidSave(msg: JsonRpcMessage): void {
    this.sendToServer(msg);
    const params = msg.params as Record<string, unknown> | undefined;
    const td = params?.textDocument as Record<string, unknown> | undefined;
    const uri = td?.uri;
    if (typeof uri === 'string') {
      this.hooks?.onDidSave?.(uri);
    }
  }

  /**
   * 处理 textDocument/didChange 通知。
   *
   * 转发给 clangd，并记录文档 version（用于 UeDiagnosticWatcher 在 UBT 成功后注入
   * 强制 re-parse 的 didChange 时复用 version，避免与 VS Code 的 version 计数器失序）。
   */
  private handleDidChange(msg: JsonRpcMessage): void {
    this.sendToServer(msg);
    const params = msg.params as Record<string, unknown> | undefined;
    const td = params?.textDocument as Record<string, unknown> | undefined;
    const uri = td?.uri;
    const version = td?.version;
    if (typeof uri === 'string' && typeof version === 'number') {
      this.lastDocVersions.set(this.normalizeUri(uri), version);
    }
    if (typeof uri === 'string') {
      this.originalUris.set(this.normalizeUri(uri), uri);
    }
  }

  /**
   * [Phase 8] 获取文档最近一次记录的 version（didOpen/didChange）。
   * UeDiagnosticWatcher 注入强制 re-parse 的 didChange 时复用，避免 version 失序。
   * key 规范化（解码 %3A、盘符大写）以匹配 UeDiagnosticWatcher 存储的规范化 uri。
   */
  getLastDocVersion(uri: string): number | undefined {
    return this.lastDocVersions.get(this.normalizeUri(uri));
  }

  /**
   * [Phase 8] 获取 VS Code 原始 uri（didOpen/didChange 时记录）。
   * 注入 textDocument/didChange 必须用此原始形式，clangd DraftStore 才能匹配到文档。
   */
  getOriginalUri(uri: string): string | undefined {
    return this.originalUris.get(this.normalizeUri(uri));
  }

  /**
   * 规范化 file URI：解码 %3A → ':'，盘符大写。
   * VS Code didSave/didOpen 的 uri 用 %3A 编码，clangd publishDiagnostics 用 ':'，
   * 统一为 clangd 内部形式（盘符大写）作为 lastDocVersions 的 key。
   */
  private normalizeUri(uri: string): string {
    return decodeURIComponent(uri).replace(
      /^file:\/\/\/([a-zA-Z]):/,
      (_m, drive: string) => `file:///${drive.toUpperCase()}:`,
    );
  }

  /**
   * 执行保活动作。
   */
  private executeKeepaliveAction(action: KeepaliveAction): void {
    const msg: JsonRpcMessage = {
      jsonrpc: '2.0',
      method: this.actionToMethod(action),
      params: action.params,
    };
    this.sendToServer(msg);
  }

  /**
   * 将保活动作类型转换为 LSP 方法名。
   */
  private actionToMethod(action: KeepaliveAction): string {
    switch (action.type) {
      case 'forwardDidClose':
        return 'textDocument/didClose';
      case 'forwardDidOpen':
        return 'textDocument/didOpen';
      case 'forwardDidChange':
        return 'textDocument/didChange';
    }
  }

  /**
   * 向服务器发送消息。
   */
  private sendToServer(msg: JsonRpcMessage): void {
    this.transport.send(encodeMessage(msg));
  }

  // ─── 服务器→客户端路径 ──────────────────────────────────────

  /**
   * 处理服务器发来的数据。
   */
  private handleServerData(data: Buffer): void {
    // 每次收到服务器数据时检查 TTL 过期
    this.checkTtlExpiry();

    const messages = this.serverParser.feed(data);

    for (const msg of messages) {
      this.processServerMessage(msg);
    }
  }

  /**
   * 处理单条服务器消息。
   *
   * 响应/错误响应：查找关联 method，应用本地化（如果启用），然后转发。
   * 通知：如果是 publishDiagnostics，应用本地化；否则透传。
   */
  private processServerMessage(msg: JsonRpcMessage): void {
    // 响应/错误响应：查找关联并调用钩子
    const id = getId(msg);
    if (id !== undefined) {
      const method = this.correlation.lookup(id);
      this.hooks?.onServerResponse?.(msg, method);
      // 响应只消费一次关联
      this.correlation.remove(id);

      // 根据原始请求 method 应用本地化
      const localized = this.applyLocalizationToResponse(msg, method);
      this.sendToClient(localized);
      return;
    }

    // 通知：调用通知钩子
    const method = getMethod(msg);
    if (method !== undefined) {
      this.hooks?.onServerNotification?.(msg);
      // 对 publishDiagnostics 通知应用本地化
      if (method === 'textDocument/publishDiagnostics') {
        // [Phase 8] 转发诊断给 UE 诊断监听器（用于识别 UE 宏报错 + 触发 UBT）
        const params = msg.params as {
          uri: string;
          diagnostics: Array<{
            range: { start: { line: number; character: number }; end: { line: number; character: number } };
            severity: number;
            source?: string;
            message: string;
          }>;
        };
        if (params && params.uri && params.diagnostics) {
          this.hooks?.onPublishDiagnostics?.(params);
        }

        const localized = this.localizeDiagnosticsNotification(msg);
        this.sendToClient(localized);
        return;
      }
    }

    // 默认透传
    this.sendToClient(msg);
  }

  /**
   * 对响应消息应用本地化。
   *
   * 根据原始请求 method 决定本地化策略：
   * - textDocument/codeAction → 本地化 title 和 disabled.reason
   * - textDocument/hover → 本地化 hover 内容
   * - 其他 → 透传
   */
  private applyLocalizationToResponse(msg: JsonRpcMessage, method: string | undefined): JsonRpcMessage {
    if (!this.localization || !this.localization.enabled) {
      return msg;
    }

    if (method === 'textDocument/codeAction') {
      return this.localizeCodeActionResult(msg);
    }

    if (method === 'textDocument/hover') {
      return this.localizeHoverResult(msg);
    }

    if (method === 'textDocument/completion') {
      return this.localizeCompletionResult(msg);
    }

    if (method === 'textDocument/signatureHelp') {
      return this.localizeSignatureHelpResult(msg);
    }

    if (method === 'textDocument/inlayHint') {
      return this.localizeInlayHintResult(msg);
    }

    return msg;
  }

  /**
   * 对翻译结果应用 mode（append 或 zh-only）处理。
   * append：保留原文 + [翻译]；zh-only：仅保留翻译部分。
   */
  private applyMode(original: string, translated: string): string {
    if (!this.localization) {
      return original;
    }
    if (this.localization.mode === 'zh-only') {
      return stripOriginalText(original, translated);
    }
    return translated; // append 模式：genericTranslate 已返回 "原文 [翻译]"
  }

  /**
   * 本地化 textDocument/publishDiagnostics 通知。
   *
   * 修改 diagnostics[].message 和 diagnostics[].relatedInformation[].message。
   */
  private localizeDiagnosticsNotification(msg: JsonRpcMessage): JsonRpcMessage {
    if (!this.localization || !this.localization.enabled) {
      return msg;
    }

    const params = msg.params as Record<string, unknown> | undefined;
    if (!params) {
      return msg;
    }

    const diagnostics = params.diagnostics as Array<Record<string, unknown>> | undefined;
    if (!diagnostics || !Array.isArray(diagnostics)) {
      return msg;
    }

    this.log?.(`[bridge] localizeDiagnostics: received ${diagnostics.length} diagnostics`);

    const localizedDiags = diagnostics.map((diag) => {
      const cloned = { ...diag };
      const message = cloned.message;
      if (typeof message === 'string') {
        const original = message;
        const translated = applyLocalizationToDiagnostic(message);
        cloned.message = this.applyMode(original, translated);
        if (cloned.message !== original) {
          this.log?.(`[bridge]   ✓ "${original}" → "${String(cloned.message)}"`);
        } else {
          this.log?.(`[bridge]   - "${original}" (no translation)`);
        }
      }
      // 处理 relatedInformation
      const relatedInfo = cloned.relatedInformation as Array<Record<string, unknown>> | undefined;
      if (relatedInfo && Array.isArray(relatedInfo)) {
        cloned.relatedInformation = relatedInfo.map((info) => {
          const infoCloned = { ...info };
          const infoMsg = infoCloned.message;
          if (typeof infoMsg === 'string') {
            infoCloned.message = this.applyMode(infoMsg, applyLocalizationToDiagnostic(infoMsg));
          }
          return infoCloned;
        });
      }
      return cloned;
    });

    return {
      ...msg,
      params: { ...params, diagnostics: localizedDiags },
    };
  }

  /**
   * 本地化 textDocument/codeAction 响应。
   *
   * 修改 CodeAction.title 和 CodeAction.disabled.reason。
   * 不修改 edit/command/data。
   */
  private localizeCodeActionResult(msg: JsonRpcMessage): JsonRpcMessage {
    const result = msg.result;
    if (!Array.isArray(result)) {
      return msg;
    }

    const localizedActions = result.map((action: unknown) => {
      if (typeof action !== 'object' || action === null) {
        return action;
      }
      const act = action as Record<string, unknown>;
      const cloned = { ...act };

      // 本地化 title
      if (typeof cloned.title === 'string') {
        const original = cloned.title;
        const translated = applyLocalizationToCodeAction(original);
        cloned.title = this.applyMode(original, translated);
      }

      // 本地化 disabled.reason
      const disabled = cloned.disabled;
      if (typeof disabled === 'object' && disabled !== null) {
        const d = disabled as Record<string, unknown>;
        if (typeof d.reason === 'string') {
          const original = d.reason;
          const translated = applyLocalizationToCodeAction(original);
          cloned.disabled = { ...d, reason: this.applyMode(original, translated) };
        }
      }

      // edit/command/data 保持原样（不克隆）
      return cloned;
    });

    return { ...msg, result: localizedActions };
  }

  /**
   * 本地化 textDocument/hover 响应。
   *
   * 处理 MarkupContent（{ kind, value }）和 MarkedString 数组。
   * 保护围栏代码块和内联代码跨度。
   */
  private localizeHoverResult(msg: JsonRpcMessage): JsonRpcMessage {
    const result = msg.result as Record<string, unknown> | undefined;
    if (!result) {
      this.log?.('[bridge] localizeHover: no result');
      return msg;
    }

    const contents = result.contents;
    if (!contents) {
      this.log?.('[bridge] localizeHover: no contents');
      return msg;
    }

    this.log?.('[bridge] localizeHover: received hover content');

    const clonedResult = { ...result };

    // MarkupContent: { kind: 'markdown', value: string }
    if (typeof contents === 'object' && contents !== null && !Array.isArray(contents)) {
      const mc = contents as Record<string, unknown>;
      if (typeof mc.value === 'string') {
        const original = mc.value;
        this.log?.(`[bridge] localizeHover: original="${original.substring(0, 200)}"`);
        const translated = applyLocalizationToHover(original);
        this.log?.(`[bridge] localizeHover: translated="${translated.substring(0, 200)}"`);
        const newValue = this.applyMode(original, translated);
        clonedResult.contents = {
          ...mc,
          value: newValue,
        };
        if (newValue !== original) {
          this.log?.(`[bridge]   ✓ hover MarkupContent translated`);
        } else {
          this.log?.(`[bridge]   - hover MarkupContent (no translation)`);
        }
      }
    }

    // MarkedString 数组: Array<string | { language, value }>
    if (Array.isArray(contents)) {
      clonedResult.contents = contents.map((item: unknown) => {
        if (typeof item === 'string') {
          const original = item;
          this.log?.(`[bridge] localizeHover string: "${original.substring(0, 200)}"`);
          const localized = applyLocalizationToHover(original);
          const result = this.applyMode(original, localized);
          if (result !== original) {
            this.log?.(`[bridge]   ✓ hover string: "${original}" → "${result}"`);
          } else {
            this.log?.(`[bridge]   - hover string: (no translation)`);
          }
          return result;
        }
        if (typeof item === 'object' && item !== null) {
          const ms = item as Record<string, unknown>;
          if (typeof ms.value === 'string') {
            const original = ms.value;
            const localized = applyLocalizationToHover(original);
            const result = this.applyMode(original, localized);
            if (result !== original) {
              this.log?.(`[bridge]   ✓ hover code: "${original.substring(0, 60)}..." → "${result.substring(0, 60)}..."`);
            }
            return { ...ms, value: result };
          }
        }
        return item;
      });
    }

    return { ...msg, result: clonedResult };
  }

  /**
   * 本地化 textDocument/completion 响应。
   *
   * TODO: 后续实现 Completion 项 label/detail 汉化。
   */
  private localizeCompletionResult(msg: JsonRpcMessage): JsonRpcMessage {
    return msg;
  }

  /**
   * 本地化 textDocument/signatureHelp 响应。
   *
   * TODO: 后续实现 SignatureHelp 参数名/标签汉化。
   */
  private localizeSignatureHelpResult(msg: JsonRpcMessage): JsonRpcMessage {
    return msg;
  }

  /**
   * 本地化 textDocument/inlayHint 响应。
   *
   * TODO: 后续实现 InlayHint 类型名/标签汉化。
   */
  private localizeInlayHintResult(msg: JsonRpcMessage): JsonRpcMessage {
    return msg;
  }

  /**
   * 向客户端发送消息。
   */
  private sendToClient(msg: JsonRpcMessage): void {
    this.clientOutputHandler?.(encodeMessage(msg));
  }

  // ─── 公共 API ────────────────────────────────────────────────

  /**
   * 注册客户端输出回调。
   *
   * @param handler - 收到服务器→客户端帧时调用
   */
  onClientOutput(handler: (frame: Buffer) => void): void {
    this.clientOutputHandler = handler;
  }

  /**
   * 刷新所有待处理的 didClose。
   *
   * 在子进程关闭、收到 shutdown/exit 或进程信号时调用。
   */
  flush(): void {
    const actions = this.keepalive.flush();
    for (const action of actions) {
      this.executeKeepaliveAction(action);
    }
  }

  /**
   * 处理进程信号（SIGINT/SIGTERM）。
   *
   * 刷新所有待处理 didClose，确保文件关闭通知在退出前发送。
   * 由 processBridge 的 onChildClose/onChildError 回调或外部信号处理器调用。
   */
  handleSignal(): void {
    this.flush();
  }

  /**
   * 关闭桥接。
   *
   * 先刷新待处理 didClose，再关闭传输层。
   */
  close(): void {
    this.flush();
    this.transport.close();
  }

  // ─── 消息注入 API ──────────────────────────────────────────────

  /**
   * 向真实 clangd 注入一条客户端→服务器通知（Phase 8 HeaderWatcher 支持）。
   *
   * 用途：HeaderWatcher 完成 UBT codegen 后，通过 proxy 主动推送
   * workspace/didChangeWatchedFiles 通知给 clangd，触发 clangd 立即重索引
   * 变更的 .generated.h 文件。
   *
   * 为什么不走 extension → VS Code → clangd 路径：
   *   - extension 无法直接发送 LSP 通知给 clangd（VS Code 语言客户端 API 不暴露）
   *   - proxy 已经有到 clangd 的 stdin 通道，可以直接注入
   *   - 绕过 VS Code 文件监视延迟（~100-500ms）
   *
   * @param method - 通知方法名（如 'workspace/didChangeWatchedFiles'）
   * @param params - 通知参数
   */
  injectClientNotification(method: string, params: unknown): void {
    const msg: JsonRpcMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.sendToServer(msg);
    this.log?.(`[bridge] injected client notification: ${method}`);
  }
}
