/**
 * fileWatcher —— chokidar 增量扫描器（Phase 7 PLAN B / per D-15/D-16）
 *
 * 用途：
 *   - 监听 UE C++ 项目源码目录的文件变更
 *   - 100ms debounce + 头/源分级后，通过 onBatch 回调批量通知调用方
 *   - 调用方接收到 IncrementalBatch 后调用 perfLog.recordIncrementalScan 记录延迟
 *
 * 关键决策（per D-15 + CONTEXT Discretion）：
 *   - 选择 chokidar over VS Code FileSystemWatcher
 *   - 理由：(a) 项目已有 chokidar ^3.6.0 依赖；(b) awaitWriteFinish 内置防抖；
 *           (c) UE 5000+ 文件下 Windows 句柄压力可控；(d) 不主动发送 LSP didChangeWatchedFiles
 *           — clangd 自己的 FileSystemWatcher 已在工作
 *
 * Pitfall 防御：
 *   - Pitfall 2：ignored 数组强制排除 Intermediate/Binaries/DerivedDataCache/Saved/.git
 *   - Pitfall 3：patterns 用 path.join(projectDir, ...) 限定项目内绝对路径
 *   - Pitfall 4：tooltip 说明度量的是 chokidar 内部延迟，不是 clangd 索引更新总延迟
 *   - Pitfall 6：usePolling false（默认），5000+ 文件场景可在 fileWatcher.ts 头部 JSDoc 降级为 usePolling true
 */

import * as vscode from 'vscode';
import chokidar from 'chokidar';

/**
 * IncrementalFileWatcher 选项
 */
export interface FileWatcherOptions {
  /** 监听模式（glob 数组，必须是绝对项目内路径，不依赖 chokidar 解析） */
  patterns: string[];
  /** Debounce 时长（毫秒），默认 100（per D-15） */
  debounceMs?: number;
  /** 额外忽略的 glob 模式（追加到默认 ignored 数组） */
  ignoredPatterns?: string[];
}

/**
 * 一次 flush 的增量扫描批次
 *
 * 调用方通过 onBatch 收到该对象后，可：
 *   - 调用 perfLog.recordIncrementalScan(elapsedMs, fileCount)
 *   - 触发状态栏更新（头文件 vs 源文件分级）
 *   - 通知 LSP 协同层（未来扩展）
 */
export interface IncrementalBatch {
  /** 本次批次的文件路径列表 */
  files: string[];
  /**
   * 本次批次中「新增」（chokidar add 事件）的文件子集。
   * 模式借鉴 boocs/unreal-clangd：新增 .h/.cpp 说明 compile_commands.json
   * 可能缺条目，调用方可据此提示用户刷新编译数据库（change/unlink 无需）。
   */
  addedFiles: string[];
  /** 从首个事件到 flush 的总延迟（毫秒） */
  totalLatencyMs: number;
  /** 头文件数量（.h / .hpp / .inl） */
  headerCount: number;
  /** 源文件数量（.cpp / .cc / .c） */
  sourceCount: number;
}

/** 默认 debounce 时长（per D-15） */
const DEFAULT_DEBOUNCE_MS = 100;

/** 头文件扩展名正则（大小写不敏感） */
const HEADER_EXT_RE = /\.(h|hpp|inl)$/i;

/** 源文件扩展名正则（大小写不敏感） */
const SOURCE_EXT_RE = /\.(cpp|cc|c)$/i;

/** chokidar 事件类型（本模块只关心这三种） */
interface WatchedEvent {
  file: string;
  event: 'add' | 'change' | 'unlink';
}

/** 默认 ignored 数组（per D-15/Pitfall 2 防御） */
const DEFAULT_IGNORED = [
  '**/Intermediate/**',
  '**/Binaries/**',
  '**/DerivedDataCache/**',
  '**/Saved/**',
  '**/.git/**',
  '**/node_modules/**',
];

/**
 * IncrementalFileWatcher —— chokidar 包装的增量扫描器
 *
 * 用法：
 *   ```ts
 *   const watcher = new IncrementalFileWatcher();
 *   watcher.onBatch = (batch) => {
 *     perfLog.recordIncrementalScan(batch.totalLatencyMs, batch.files.length);
 *     logger.info(`[Incr] ${batch.headerCount}H + ${batch.sourceCount}S in ${batch.totalLatencyMs}ms`);
 *   };
 *   const handle = watcher.start({
 *     patterns: [
 *       path.join(projectDir, 'Source', '**', '*.{h,hpp,inl,cpp}'),
 *       path.join(projectDir, 'Plugins', '**', 'Source', '**', '*.{h,hpp,inl,cpp}'),
 *     ],
 *     debounceMs: 100,
 *   });
 *   // 后续 handle.dispose() 即可停止
 *   ```
 */
export class IncrementalFileWatcher {
  /** onBatch 回调（可选） */
  public onBatch?: (batch: IncrementalBatch) => void;

  private watcher: chokidar.FSWatcher | null = null;
  /** 待 flush 的事件缓冲（文件路径 + 事件类型，保插入序） */
  private batchedEvents: WatchedEvent[] = [];
  private firstEventMs: number | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs: number = DEFAULT_DEBOUNCE_MS;

  /**
   * 启动 chokidar 监听
   *
   * @param options 监听选项
   * @returns Disposable，调用 dispose() 停止监听
   */
  start(options: FileWatcherOptions): vscode.Disposable {
    // 清理之前可能残留的监听器（重复调用 start 安全）
    this.dispose();

    const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.debounceMs = debounceMs;

    const ignored = [...DEFAULT_IGNORED, ...(options.ignoredPatterns ?? [])];

    // chokidar.watch 配置：awaitWriteFinish 内部防抖 + pollInterval 50ms
    this.watcher = chokidar.watch(options.patterns, {
      ignored,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: debounceMs,
        pollInterval: 50,
      },
    });

    // 统一事件 handler：add / change / unlink（记录事件类型供 addedFiles 分级）
    const onChange = (filePath: string, event: WatchedEvent['event']): void => {
      // 防御：dispose 后事件不应再入队（chokidar mock 的 listeners 可能未移除）
      if (this.watcher === null) {
        return;
      }
      this.batchedEvents.push({ file: filePath, event });
      if (this.firstEventMs === null) {
        this.firstEventMs = performance.now();
      }
      this.scheduleFlush();
    };

    this.watcher.on('add', (filePath: string) => onChange(filePath, 'add'));
    this.watcher.on('change', (filePath: string) => onChange(filePath, 'change'));
    this.watcher.on('unlink', (filePath: string) => onChange(filePath, 'unlink'));

    return new vscode.Disposable(() => this.dispose());
  }

  /**
   * 内部调度 flush：debounce 时长后清空缓冲区 + 触发 onBatch
   */
  private scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush();
    }, this.debounceMs);
  }

  /**
   * 立即清空当前批次并触发 onBatch
   */
  private flush(): void {
    if (this.batchedEvents.length === 0) {
      return;
    }
    const elapsed = this.firstEventMs !== null ? performance.now() - this.firstEventMs : 0;
    const events = this.batchedEvents.slice();
    const files = events.map((e) => e.file);
    const addedFiles = events.filter((e) => e.event === 'add').map((e) => e.file);
    const headerCount = files.filter((f) => HEADER_EXT_RE.test(f)).length;
    const sourceCount = files.filter((f) => SOURCE_EXT_RE.test(f)).length;

    this.batchedEvents = [];
    this.firstEventMs = null;

    const batch: IncrementalBatch = {
      files,
      addedFiles,
      totalLatencyMs: elapsed,
      headerCount,
      sourceCount,
    };

    // 调用方回调（无回调时不抛错）
    try {
      this.onBatch?.(batch);
    } catch {
      // 调用方错误不传染 watcher 生命周期
    }
  }

  /**
   * 关闭 chokidar watcher + 清理缓冲区 + 取消待处理 timer
   *
   * 多次调用安全（重复 dispose 不会抛错）。
   */
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
    this.batchedEvents = [];
    this.firstEventMs = null;
  }
}
