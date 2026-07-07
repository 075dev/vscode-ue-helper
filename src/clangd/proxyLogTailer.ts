/**
 * proxyLogTailer.ts —— clangd proxy 日志文件 tailer
 *
 * 职责：
 * - 轮询读取 proxy 日志文件的新增内容（按 byte offset 增量读取）
 * - 按行分割后转发到独立 OutputChannel（'VSCodeUEHelper Proxy'）
 * - 处理边界：文件不存在（proxy 未启动）、truncate/轮转、半行（无 \n 结尾）
 *
 * 为什么用纯轮询而非 fs.watch：
 * - fs.watch 在 Windows 网络盘 / WSL 跨平台行为不一致，漏事件难调试
 * - proxy 日志量小，500ms 轮询的 stat() 开销可忽略
 * - 轮询天然兼容文件被删除后重建（fs.watch 在 rename 后会失效）
 *
 * 设计原则：
 * - 不依赖 vscode 之外的运行时模块（仅 node:fs）
 * - Disposable，可重复 start；dispose 后停止轮询
 * - 读取异常不抛出，仅 logger.warn，下次轮询重试
 */

import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { Logger } from '@core/logger';

/** 轮询间隔（毫秒）—— 平衡实时性与 CPU 开销 */
const POLL_INTERVAL_MS = 500;

/**
 * ProxyLogTailer —— 增量 tail 一个日志文件并按行转发到 OutputChannel。
 */
export class ProxyLogTailer implements vscode.Disposable {
  /** 下次读取的文件字节偏移（已读到的位置） */
  private offset = 0;
  /** 跨轮询的半行缓冲（未遇到 \n 的尾部） */
  private lineBuffer = '';
  /** 轮询定时器句柄 */
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** 是否已 dispose */
  private disposed = false;

  /** 轮询间隔（毫秒），默认 POLL_INTERVAL_MS，测试可注入更小值 */
  private readonly pollIntervalMs: number;

  constructor(
    /** proxy 写入的日志文件绝对路径 */
    private readonly logPath: string,
    /** 转发目标 Output 通道 */
    private readonly channel: vscode.OutputChannel,
    /** tailer 自身日志（写主扩展日志，便于排查 tailer 故障） */
    private readonly logger: Logger,
    /** 轮询间隔（毫秒），仅测试用，生产留默认 */
    pollIntervalMs: number = POLL_INTERVAL_MS,
  ) {
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * 启动轮询。重复调用安全（已运行则忽略）。
   * 启动时立即检查一次，随后按 POLL_INTERVAL_MS 周期检查。
   */
  start(): void {
    if (this.disposed || this.pollTimer) {
      return;
    }
    // 首次立即检查，避免等一个周期才看到已有日志
    void this.check();
    this.pollTimer = setInterval(() => {
      void this.check();
    }, this.pollIntervalMs);
    this.logger.info(`[proxyLogTailer] started tailing ${this.logPath}`);
  }

  /** 停止轮询并清理缓冲。重复调用安全。 */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.lineBuffer = '';
    this.logger.info('[proxyLogTailer] stopped');
  }

  /**
   * 单次检查：stat → 增量读取 → flush 行。
   * 全程不抛异常；文件不存在或读取失败时静默/告警并等下个周期。
   */
  private async check(): Promise<void> {
    if (this.disposed) {
      return;
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(this.logPath);
    } catch {
      // 文件还不存在（proxy 尚未启动）—— 静默等待，下个周期重试
      return;
    }
    if (!stat.isFile()) {
      return;
    }

    // 文件被截断/轮转（size 比 offset 小）—— 重置，从头读
    if (stat.size < this.offset) {
      this.offset = 0;
      this.lineBuffer = '';
    }

    // 无新内容
    if (stat.size === this.offset) {
      return;
    }

    try {
      const length = stat.size - this.offset;
      const buf = Buffer.alloc(length);
      const fd = await fs.promises.open(this.logPath, 'r');
      try {
        // position 传 this.offset，从上次读到的位置开始
        const { bytesRead } = await fd.read(buf, 0, length, this.offset);
        // 只推进实际读到的字节（stat 与 read 之间文件可能变化）
        this.offset += bytesRead;
        this.lineBuffer += buf.toString('utf-8', 0, bytesRead);
        this.flushLines();
      } finally {
        await fd.close();
      }
    } catch (err) {
      // 读取中途文件被删/锁等 —— 告警，下个周期重试
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[proxyLogTailer] read error: ${msg}`);
    }
  }

  /**
   * 将 lineBuffer 中完整的行（以 \n 分隔）逐行写入 channel。
   * 半行（无 \n 结尾）保留在 lineBuffer，等下次拼齐。
   */
  private flushLines(): void {
    let idx: number;
    while ((idx = this.lineBuffer.indexOf('\n')) >= 0) {
      const line = this.lineBuffer.slice(0, idx);
      this.lineBuffer = this.lineBuffer.slice(idx + 1);
      // 去掉 Windows 行尾 \r；跳过空行避免面板噪声
      const trimmed = line.replace(/\r$/, '');
      if (trimmed.length > 0) {
        this.channel.appendLine(trimmed);
      }
    }
  }
}
