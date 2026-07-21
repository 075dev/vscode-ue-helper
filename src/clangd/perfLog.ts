/**
 * perfLog —— Phase 7 性能埋点与状态聚合
 *
 * 提供：
 *   - 性能事件 `record()`：记录单次性能事件（生成耗时、缓存命中、增量扫描延迟等）
 *   - 内存聚合 `getCompileCommandsLastMs()`、`getPreparseHitRate()`、`getLastIncrementalScanMs()`
 *   - 事件订阅 `onMetricUpdate()`：供 PerfStatusBar 实时刷新
 *   - 模式自适应 flush `flushToDisk()`：dev 模式持久化 .vscode/clangd-perf-cache/perf-log.json + 100MB 轮转
 *
 * 双载体输出（per D-02）：
 *   1. Output Channel：每次 `record()` 同步输出 `[perf] ...` 一行
 *   2. 持久化：dev 模式下后台 `setImmediate` 队列批量 flush 到磁盘
 *
 * 模式自适应（per D-07）：
 *   - dev 模式（vscode.ExtensionMode.Development）：持久化 + 100MB 轮转
 *   - prod/其他模式：仅 session 内存，不写盘
 *
 * 路径安全（per T-7-03）：
 *   持久化路径解析后必须 startsWith(projectDir + '/.vscode/clangd-perf-cache/')，
 *   防止任意路径注入。
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import type {
  PerfEvent,
  PerfMetricSnapshot,
} from './types';

/**
 * PerfSession —— 性能埋点会话接口
 *
 * 由 perfLog 单例实现，模块通过 `import { perfLog }` 获取。
 */
export interface PerfSession {
  /** 记录一条性能事件（同步，开销 < 1ms） */
  record(ev: Omit<PerfEvent, 'timestamp'>): void;

  /** 记录 preparse-includes 的命中统计（per D-03 / D-13） */
  recordPreparseResult(mode: string, baseCount: number, userCount: number): void;

  /** 记录增量扫描延迟（per D-15 / D-17） */
  recordIncrementalScan(elapsedMs: number, batchSize: number): void;

  /** 获取最近一次 compile_commands.json 生成耗时（毫秒） */
  getCompileCommandsLastMs(): number;

  /** 获取 preparse-includes 命中率 */
  getPreparseHitRate(): { hits: number; misses: number; rate: number };

  /** 获取最近一次增量扫描延迟（毫秒） */
  getLastIncrementalScanMs(): number;

  /** 订阅指标更新事件 */
  onMetricUpdate(listener: (m: PerfMetricSnapshot) => void): vscode.Disposable;

  /** 立即 flush 内存队列到磁盘（dev 模式写盘，prod 模式 no-op） */
  flushToDisk(): Promise<void>;

  /** [Phase 9 SSoT] 注入 WorkspaceState 让 flushToDisk 走单一真相源——消除 vscode.workspace.workspaceFolders 直读 */
  setWorkspace(workspace: { readonly projectDir: string | null }): void;
}

/* ------------------------------------------------------------------ */
/*  内部实现                                                            */
/* ------------------------------------------------------------------ */

const MAX_PERF_LOG_BYTES = 100 * 1024 * 1024;        // 100MB 触发轮转（D-07）
const MAX_ROTATION_FILES = 5;                         // 最多保留 5 个轮转文件
const FLUSH_QUEUE_FLUSH_MS = 500;                     // 500ms 批量 flush 阈值

/** 在测试 / 单元测试场景下强制视为 dev 模式（便于写盘断言） */
let forceDevMode = false;

/** 测试钩子 —— 强制将 perfLog 视为 dev 模式 */
export function setForceDevMode(enabled: boolean): void {
  forceDevMode = enabled;
}

/**
 * 判断当前是否为开发模式
 *
 * 测试环境下 setup.ts 的 ExtensionMode.Development = 2，配合 forceDevMode
 * 便于 perfLog.test.ts 触发 flushToDisk 写盘分支。
 */
export function isDevMode(): boolean {
  if (forceDevMode) {
    return true;
  }
  // vscode.ExtensionMode.Development === 2（在 mock 与真实 VS Code 中均成立）
  // 测试与运行时 ExtensionMode 形态不同（namespace enum vs runtime number），
  // 需要用类型擦除访问实际值。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const ext = vscode as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const dev: unknown = ext?.ExtensionMode?.Development;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const current: unknown = ext?.ExtensionMode;
  return typeof dev === 'number' && current === dev;
}

/**
 * PerfSessionImpl —— PerfSession 接口的内部实现
 *
 * 设计要点：
 *   - record() 全程同步 + 不抛错（性能埋点必须 hot-path 0 开销）
 *   - 内存指标在每次 record() 后调用 broadcast() 同步推送给订阅者
 *   - flushToDisk() 走 setImmediate，不阻塞调用方
 */
class PerfSessionImpl implements PerfSession {
  private readonly listeners: Array<(m: PerfMetricSnapshot) => void> = [];
  private readonly pendingEvents: Omit<PerfEvent, 'timestamp'>[] = [];
  private ccLastMs = 0;
  private preparseHits = 0;
  private preparseMisses = 0;
  private incrLastMs = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  /** [Phase 9 SSoT] 由 setWorkspace 注入；resolveProjectDir 读这里而非 vscode.workspace */
  private _workspace: { readonly projectDir: string | null } | null = null;

  /** 显式接收 logger；undefined 时回落到 default logger（共用 extension 通道） */
  constructor(private readonly logger?: Logger) {
    // 不在构造时创建真实 logger —— 默认会在 loggerNeeded 时懒加载
  }

  /** [Phase 9 SSoT] 注入 WorkspaceState 让 flushToDisk 走单一真相源。 */
  setWorkspace(workspace: { readonly projectDir: string | null }): void {
    this._workspace = workspace;
  }

  private ensureLogger(): Logger {
    if (this.logger) {
      return this.logger;
    }
    return new Logger('VSCodeUEHelper');
  }

  /* ===== public API ===== */

  record(ev: Omit<PerfEvent, 'timestamp'>): void {
    // 入内存队列（后台批量 flush）
    this.pendingEvents.push(ev);
    this.scheduleFlushQueue();

    // 同步输出到 Output 通道（per D-02 双载体）
    try {
      this.ensureLogger().info(
        `[perf] ${ev.event} ${ev.elapsedMs.toFixed(1)}ms` +
          (ev.meta ? ' ' + JSON.stringify(ev.meta) : ''),
      );
    } catch {
      // logger 输出失败不影响埋点
    }

    // 更新聚合指标
    this.updateAggregates(ev);

    // 同步推送快照给订阅者（per D-04 状态栏实时刷新）
    this.broadcast();
  }

  recordPreparseResult(mode: string, baseCount: number, userCount: number): void {
    // 只要 base 列表有内容，就算 hit；空列表视作 miss
    if (baseCount > 0) {
      this.preparseHits += 1;
    } else {
      this.preparseMisses += 1;
    }
    this.record({
      event: 'preparse.listBuilt',
      elapsedMs: 0,
      meta: { mode, baseCount, userCount },
    });
  }

  recordIncrementalScan(elapsedMs: number, batchSize: number): void {
    this.incrLastMs = elapsedMs;
    this.record({
      event: 'incremental.scanComplete',
      elapsedMs,
      meta: { batchSize },
    });
  }

  getCompileCommandsLastMs(): number {
    return this.ccLastMs;
  }

  getPreparseHitRate(): { hits: number; misses: number; rate: number } {
    const total = this.preparseHits + this.preparseMisses;
    const rate = total === 0 ? 0 : this.preparseHits / total;
    return { hits: this.preparseHits, misses: this.preparseMisses, rate };
  }

  getLastIncrementalScanMs(): number {
    return this.incrLastMs;
  }

  onMetricUpdate(listener: (m: PerfMetricSnapshot) => void): vscode.Disposable {
    this.listeners.push(listener);
    return new vscode.Disposable(() => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) {
        this.listeners.splice(idx, 1);
      }
    });
  }

  async flushToDisk(): Promise<void> {
    if (!isDevMode()) {
      // prod 模式：不写盘（D-07）
      return;
    }

    // 把队列中所有事件转 JSONL 写入 perf-log.json
    // 路径：<first workspace folder>/.vscode/clangd-perf-cache/perf-log.json
    const folder = this.resolveProjectDir();
    if (!folder) {
      return;
    }

    const cacheDir = await this.ensureCacheDir(folder);
    const logPath = `${cacheDir}/perf-log.json`;

    try {
      // 读取现有日志（若存在），避免覆盖
      let existing: PerfEvent[] = [];
      try {
        const raw = await (await import('node:fs/promises')).readFile(logPath, 'utf-8');
        existing = JSON.parse(raw) as PerfEvent[];
        if (!Array.isArray(existing)) {
          existing = [];
        }
      } catch {
        existing = [];
      }

      // 把队列中所有事件转换为持久化形态
      const ts = new Date().toISOString();
      for (const ev of this.pendingEvents) {
        existing.push({ ...ev, timestamp: ts });
      }
      this.pendingEvents.length = 0;

      // 序列化
      const json = JSON.stringify(existing, null, 2);
      const bytes = Buffer.byteLength(json, 'utf-8');

      // 大小超出 → 轮转（D-07）
      if (bytes > MAX_PERF_LOG_BYTES) {
        await this.rotateLog(logPath);
        existing = [];
      }

      // 原子写入（temp + rename，per T-7-03 安全防御）
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const tmpPath = `${logPath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(existing, null, 2), 'utf-8');
      await fs.rename(tmpPath, logPath);
      void path;
    } catch {
      // 写盘失败不能阻塞调用方
    }
  }

  /* ===== 内部方法 ===== */

  private updateAggregates(ev: Omit<PerfEvent, 'timestamp'>): void {
    if (ev.event === 'compileCommands.genComplete' || ev.event === 'compileCommands.cacheHit') {
      this.ccLastMs = ev.elapsedMs;
    }
    if (ev.event === 'incremental.scanComplete') {
      this.incrLastMs = ev.elapsedMs;
    }
    if (ev.event === 'preparse.listBuilt') {
      // 已经在 recordPreparseResult 内累加，此处无需重复
    }
  }

  private broadcast(): void {
    const snapshot: PerfMetricSnapshot = {
      genMs: this.ccLastMs > 0 ? this.ccLastMs : undefined,
      hitRate: this.preparseHits + this.preparseMisses > 0
        ? this.preparseHits / (this.preparseHits + this.preparseMisses)
        : undefined,
      incrMs: this.incrLastMs > 0 ? this.incrLastMs : undefined,
      ts: new Date().toISOString(),
    };
    // 避免订阅者内部抛错影响其他订阅者
    for (const listener of this.listeners.slice()) {
      try {
        listener(snapshot);
      } catch {
        // listener 抛错不传染
      }
    }
  }

  private scheduleFlushQueue(): void {
    // 已有定时器或非 dev 模式 → 跳过
    if (this.flushTimer ?? !isDevMode()) {
      return;
    }
    // 500ms 后批量 flush
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushToDisk();
    }, FLUSH_QUEUE_FLUSH_MS);
  }

  private resolveProjectDir(): string | null {
    // [Phase 9 SSoT] 走注入的 WorkspaceState.projectDir，不再直读 vscode.workspace
    return this._workspace?.projectDir ?? null;
  }

  private async ensureCacheDir(projectDir: string): Promise<string> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // 路径安全校验（per T-7-03）：必须 startsWith 项目路径
    const cacheDir = path.join(projectDir, '.vscode', 'clangd-perf-cache');
    const normalized = path.normalize(cacheDir);
    if (!normalized.startsWith(path.normalize(projectDir) + path.sep) &&
        normalized !== path.normalize(projectDir)) {
      throw new Error('perfLog cache dir outside workspace');
    }

    await fs.mkdir(cacheDir, { recursive: true });
    return cacheDir;
  }

  private async rotateLog(logPath: string): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = path.dirname(logPath);
    const baseName = path.basename(logPath, '.json');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(dir, `${baseName}.${ts}.json`);

    try {
      await fs.rename(logPath, archivePath);

      // 清理超出 MAX_ROTATION_FILES 数量的旧轮转文件
      const entries = await fs.readdir(dir);
      const archives = entries
        .filter((n) => n.startsWith(`${baseName}.`) && n.endsWith('.json') && n !== `${baseName}.json`)
        .sort()
        .reverse();
      for (let i = MAX_ROTATION_FILES - 1; i < archives.length; i++) {
        await fs.unlink(path.join(dir, archives[i] ?? '')).catch(() => {});
      }
    } catch {
      // 轮转失败忽略
    }
  }
}

/* ------------------------------------------------------------------ */
/*  导出单例                                                            */
/* ------------------------------------------------------------------ */

/** perfLog —— 全局共享的性能埋点会话单例 */
export const perfLog: PerfSession = new PerfSessionImpl();
