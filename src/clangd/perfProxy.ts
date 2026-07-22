/**
 * perfProxy —— LSP Proxy 协同偏差测量工具（Phase 7 PLAN B, per CLANGD-01-04）
 *
 * 定位：
 *   - 仅做「只读测量」，**不修改** `src/clangd/proxy/` 下任何文件（per T-7-09）
 *   - 验证 PLAN A 注入后 LSP Proxy 行为偏差 < 1%（per CLANGD-01-04「不引入额外开销」约束）
 *
 * 使用模式：
 *   - 调用方在 LSP 帧通道上**自己额外包一层 timing**，调用 `recordLspFrame(direction, elapsedMs)`
 *     来把单帧延迟推入 ProxyOverheadMeter 的滚动窗口
 *   - 后台 `startSampling(intervalMs)` 定时采集 `process.resourceUsage().maxRSS` 作为内存基线
 *   - `getSnapshot()` 返回当前 P50/P95/P99/mean/memory 快照
 *   - `persistBaseline(outputPath)` 把快照写入 JSON 文件（atomic temp + rename 模式）
 *
 * 关键约束（per T-7-09）：
 *   - perfProxy 必须**禁止**任何对 `src/clangd/proxy/*` 的内部修改
 *   - recordLspFrame 是纯被动 API — 调用方在 proxy 帧通道**外部**注入 timing wrapper
 *   - 测试断言：perfProxy 文件无对 `../proxy/*` 的 import
 *
 * 性能开销：
 *   - recordLspFrame 同步 < 0.1ms（O(1) 入队 + 滚动窗口剔除）
 *   - startSampling 通过 setInterval，CPU 占用可忽略
 *   - getSnapshot O(n log n) 排序最近 100 帧
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Logger, sharedLogger } from '@core/logger';

/** LSP 帧方向 */
export type LspFrameDirection = 'in' | 'out';

/**
 * ProxyOverheadSample —— 单个时间点的 proxy 开销快照
 */
export interface ProxyOverheadSample {
  /** ISO 时间戳 */
  timestamp: string;
  /** P50 延迟（毫秒） */
  p50Ms: number;
  /** P95 延迟（毫秒） */
  p95Ms: number;
  /** P99 延迟（毫秒） */
  p99Ms: number;
  /** 平均延迟（毫秒） */
  meanMs: number;
  /** 进程 RSS 内存（KB） */
  memoryRssKb: number;
  /** 累计 LSP 帧计数 */
  requestCount: number;
}

/**
 * 默认滚动窗口大小（最近 N 帧延迟）
 *
 * 100 帧足够统计 P99，又避免内存膨胀。
 */
const DEFAULT_FRAME_WINDOW = 100;

/**
 * 默认内存采样间隔（毫秒）
 */
const DEFAULT_MEMORY_SAMPLE_INTERVAL_MS = 1000;

/**
 * ProxyOverheadMeter —— LSP Proxy 协同开销测量器
 *
 * 用法（典型场景）：
 *   ```ts
 *   const meter = new ProxyOverheadMeter(context, logger);
 *   meter.startSampling(1000);
 *
 *   // 在 LSP 帧通道外层包裹 timing
 *   const t0 = performance.now();
 *   proxy.send(frame);
 *   proxy.onReceive((f) => {
 *     meter.recordLspFrame('in', performance.now() - t0);
 *   });
 *
 *   // 需要时取快照
 *   const snap = meter.getSnapshot();
 *
 *   // 持久化基线
 *   await meter.persistBaseline('.vscode/clangd-perf-cache/baseline-<ts>.json');
 *   ```
 */
export class ProxyOverheadMeter {
  /** 滚动窗口（最近 N 帧延迟，毫秒） */
  private readonly frameLatencies: number[] = [];
  /** 累计帧计数（in/out 合计） */
  private requestCount = 0;
  /** 当前 RSS 内存（KB），由定时器或 getSnapshot 主动采样 */
  private memoryRssKb = 0;
  /** 定时采样句柄 */
  private samplingTimer: NodeJS.Timeout | null = null;
  /** 滚动窗口上限（构造时可覆盖） */
  private readonly windowSize: number;
  /** 日志器 */
  private readonly logger: Logger;

  constructor(
    private readonly context: vscode.ExtensionContext,
    logger?: Logger,
    windowSize: number = DEFAULT_FRAME_WINDOW,
  ) {
    this.logger = logger ?? sharedLogger;
    this.windowSize = windowSize;
    // 启动时立即采样一次 baseline
    this.sampleMemory();
    // context.subscriptions 注册统一 dispose
    this.context.subscriptions.push(new vscode.Disposable(() => this.stopSampling()));
  }

  /**
   * 启动定时内存采样
   *
   * @param intervalMs 采样间隔（毫秒），默认 1000
   * @returns Disposable，调用 dispose() 停止
   */
  startSampling(intervalMs: number = DEFAULT_MEMORY_SAMPLE_INTERVAL_MS): vscode.Disposable {
    this.stopSampling();
    this.samplingTimer = setInterval(() => {
      this.sampleMemory();
    }, intervalMs);
    this.logger.info(`[perfProxy] memory sampling started: interval=${intervalMs}ms`);
    return new vscode.Disposable(() => this.stopSampling());
  }

  /**
   * 停止定时采样（重复调用安全）
   */
  stopSampling(): void {
    if (this.samplingTimer) {
      clearInterval(this.samplingTimer);
      this.samplingTimer = null;
      this.logger.info('[perfProxy] memory sampling stopped');
    }
  }

  /**
   * 记录单帧 LSP 延迟
   *
   * 调用方应在 proxy 帧通道**外层**包 timing wrapper，把测得的耗时推入此方法。
   * 这是被动 API，proxy 自身完全不知道被测量。
   *
   * @param direction 帧方向（in=client→proxy→server, out=server→proxy→client）
   * @param elapsedMs 该帧耗时（毫秒）
   */
  recordLspFrame(direction: LspFrameDirection, elapsedMs: number): void {
    if (typeof elapsedMs !== 'number' || elapsedMs < 0 || !Number.isFinite(elapsedMs)) {
      // 无效帧直接丢弃（per T-7-09：埋点失败不传染主流程）
      return;
    }
    this.frameLatencies.push(elapsedMs);
    this.requestCount += 1;
    // 滚动窗口：超出窗口大小时从头部剔除
    while (this.frameLatencies.length > this.windowSize) {
      this.frameLatencies.shift();
    }
    this.logger.debug(
      `[perfProxy] frame ${direction} recorded: ${elapsedMs.toFixed(2)}ms ` +
        `(window=${this.frameLatencies.length}/${this.windowSize})`,
    );
  }

  /**
   * 取当前快照（包含 P50/P95/P99/mean/memory/requestCount）
   *
   * 当样本数 < 2 时：所有分位数 = mean = 0（避免空数组排序抛错）
   */
  getSnapshot(): ProxyOverheadSample {
    this.sampleMemory();
    const samples = this.frameLatencies.slice();
    const sorted = samples.slice().sort((a, b) => a - b);
    const n = sorted.length;
    let p50Ms = 0;
    let p95Ms = 0;
    let p99Ms = 0;
    let meanMs = 0;
    if (n >= 2) {
      const percentile = (p: number): number => {
        const idx = Math.min(n - 1, Math.max(0, Math.floor((p / 100) * n)));
        return sorted[idx] ?? 0;
      };
      p50Ms = percentile(50);
      p95Ms = percentile(95);
      p99Ms = percentile(99);
      let sum = 0;
      for (const v of samples) {
        sum += v;
      }
      meanMs = sum / n;
    } else if (n === 1) {
      const only = samples[0] ?? 0;
      p50Ms = only;
      p95Ms = only;
      p99Ms = only;
      meanMs = only;
    }
    return {
      timestamp: new Date().toISOString(),
      p50Ms,
      p95Ms,
      p99Ms,
      meanMs,
      memoryRssKb: this.memoryRssKb,
      requestCount: this.requestCount,
    };
  }

  /**
   * 把当前快照持久化到 JSON 文件
   *
   * 使用 atomic temp + rename 模式（per T-7-03 / T-7-04）：
   *   1. 写到 `<outputPath>.tmp`
   *   2. fs.rename 覆盖 `<outputPath>`
   *   3. 失败时 `.tmp` 文件不残留
   *
   * @param outputPath 目标 JSON 文件绝对路径
   */
  async persistBaseline(outputPath: string): Promise<void> {
    const snapshot = this.getSnapshot();
    // 路径安全（per T-7-03）：强制要求 .json 后缀 + 拒绝原始路径含 .. 段
    if (outputPath.includes('..')) {
      throw new Error(`perfProxy persistBaseline: invalid path ${outputPath}`);
    }
    if (!outputPath.endsWith('.json')) {
      throw new Error(`perfProxy persistBaseline: output must be .json, got ${outputPath}`);
    }
    const resolved = path.resolve(outputPath);
    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    const tmpPath = `${resolved}.tmp`;
    try {
      await fs.writeFile(
        tmpPath,
        JSON.stringify({ ...snapshot, generatedAt: snapshot.timestamp }, null, 2),
        'utf-8',
      );
      await fs.rename(tmpPath, resolved);
      this.logger.info(
        `[perfProxy] baseline persisted: ${resolved} ` +
          `(p95=${snapshot.p95Ms.toFixed(2)}ms, memory=${snapshot.memoryRssKb}KB, ` +
          `requests=${snapshot.requestCount})`,
      );
    } catch (err) {
      // 清理可能残留的 .tmp
      try {
        await fs.unlink(tmpPath);
      } catch {
        // 清理失败忽略
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`perfProxy persistBaseline failed: ${msg}`);
    }
  }

  /**
   * 内部：采样当前进程 RSS 内存
   */
  private sampleMemory(): void {
    try {
      // Node 内置 process.resourceUsage() 无依赖
      const usage = process.resourceUsage();
      // maxRSS 单位是字节（Linux/macOS），Windows 上也是字节
      const kb = Math.round(usage.maxRSS / 1024);
      this.memoryRssKb = kb;
    } catch {
      // 降级：process.memoryUsage().rss
      try {
        const mem = process.memoryUsage();
        this.memoryRssKb = Math.round(mem.rss / 1024);
      } catch {
        this.memoryRssKb = 0;
      }
    }
  }
}
