/**
 * ueLinkManager —— 保存 .h 后自动触发 UHT codegen 的事件入口
 *
 * ## 设计目标
 * 用户保存带 UE 反射宏（UCLASS/UPROPERTY/UFUNCTION/USTRUCT/UINTERFACE/UENUM）
 * 的 .h 后，让 UHT 重新 codegen + 通知 clangd reparse，体感对标 Rider。
 *
 * ## 实测性能结论（2026-07 XianDreamwalking 项目）
 * 10206 源文件下，加 InputCache 反而慢 3-7 倍（UHT 启动本身是大头）。
 * 见 src/clangd/uhtGeneration.ts 的 REVERTED 注释。
 *
 * 真实有效加速（本文档实现）：
 *   1. mtime 跳过：保存但 mtime 未变 → 0ms 跳过 UHT（用户保存的非反射 .h / Ctrl+S 无变化）
 *   2. 5s 全局节流：5s 内多次保存合并成 1 次 UHT（避免连续保存 fork 多个 dotnet）
 *   3. 状态栏反馈：UHT 跑时显 `$(sync~spin) UE Sync`，让用户知道在等而不是卡住
 *
 * ## Rider 对比
 * Rider 通过 IPC 让 UE Editor 进程内嵌 UHT 跑——无 fork 开销。
 * 我们 fork 新 dotnet 进程（3-4s 是物理下界），但靠"无变更跳过 + 5s 节流"
 * 把常见保存场景压缩到 ~0ms 体感。
 *
 * ## 状态机
 *   idle        → 收到 onDidSave（白名单 + mtime 检查）
 *   debouncing  → 同文件 200ms 内多次保存合并
 *   throttled   → 距上次 UHT 启动 < 5s，setTimeout(remaining)
 *   running-uht → runUhtCodegen 在跑
 *   notify      → triggerReparse 写 trigger 文件
 *   error       → 上次 UHT 失败（log warn，不弹错误）
 *
 * ## 不在本文档实现（未来 H1 扩展）
 *   - 写 stub .generated.h 跳过 UHT（stub 模式，P-C 路径，单独 phase）
 *   - 元文件（.Build.cs / .Target.cs / .uproject / .uplugin）保存触发 project model 再生
 */

import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import * as vscode from 'vscode';
import { runUhtCodegen, type UhtResult } from '@clangd/uhtGeneration';
import { triggerReparse } from '@clangd/proxy/generatedHeaderWatcher';
import type { Config } from '@core/config';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';

/* ------------------------------------------------------------------ */
/*  常量                                                                */
/* ------------------------------------------------------------------ */

/** 全局节流：5s 内多次保存合并成 1 次 UHT。
 *  经验值：用户在 Rider 下手动连续保存（Ctrl+S）通常 1-2s 间隔，
 *  5s 能覆盖"快速连击保存"场景但仍能在用户感知"暂停"时立即触发。 */
const GLOBAL_THROTTLE_MS = 5_000;

/** 文件级 debounce：同文件 200ms 内多次保存合并。
 *  避免编辑器 auto-save 抖动触发多次 UHT。 */
const FILE_DEBOUNCE_MS = 200;

/** UE 反射宏正则（预过滤 .h 是否需要 UHT codegen）。 */
const REFLECTION_MACRO_RE = /\b(UCLASS|UPROPERTY|UFUNCTION|USTRUCT|UINTERFACE|UENUM)\s*\(/;

/** 默认 status bar 优先级（放最右，避免影响现有 11 个 Left 按钮）。 */
const STATUS_BAR_PRIORITY = -1000; // Right alignment, 越负越靠右

/* ------------------------------------------------------------------ */
/*  类型                                                                */
/* ------------------------------------------------------------------ */

/** 状态机节点。discriminated union，TypeScript 收窄。 */
export type UeLinkState =
  | { kind: 'idle' }
  | { kind: 'debouncing'; file: string; timer: NodeJS.Timeout }
  | { kind: 'throttled'; fireAt: number; timer: NodeJS.Timeout }
  | { kind: 'running-uht'; startedAt: number; file: string }
  | { kind: 'notify'; file: string; changedFiles: string[] }
  | { kind: 'error'; message: string };

/** 状态机的不可变快照（供测试 + UI 用）。 */
export interface UeLinkSnapshot {
  state: UeLinkState['kind'];
  /** 最近一次 UHT 完成时间戳（毫秒），0 = 从未跑过 */
  lastUhtCompletedAt: number;
  /** 最近一次 UHT 耗时（毫秒） */
  lastUhtDurationMs: number;
  /** 最近一次 UHT 生成的 .generated.h 数（-1 = 未跑过） */
  lastGeneratedCount: number;
  /** mtime 跳过的次数（性能指标） */
  mtimeSkippedCount: number;
  /** 5s 节流合并的次数 */
  throttledMergedCount: number;
}

/** ueLinkManager 构造参数。 */
export interface UeLinkManagerOptions {
  config: Config;
  logger: Logger;
  workspace: WorkspaceState;
}

/* ------------------------------------------------------------------ */
/*  ueLinkManager                                                       */
/* ------------------------------------------------------------------ */

/**
 * 事件入口 + 状态机 + 5s 节流 + mtime 跳过 + 状态栏反馈。
 *
 * 生命周期：
 *   - constructor: 订阅 onDidSaveTextDocument + 创建 status bar
 *   - onDidSave(.h) → 状态机驱动
 *   - dispose: 取消所有 timer + 释放 status bar + 取消订阅
 */
export class UeLinkManager implements vscode.Disposable {
  /* ── 状态 ── */
  private state: UeLinkState = { kind: 'idle' };
  private lastUhtCompletedAt = 0;
  private lastUhtDurationMs = 0;
  private lastGeneratedCount = -1;
  private mtimeSkippedCount = 0;
  private throttledMergedCount = 0;

  /** .h 文件最近一次 UHT 处理时的 mtime（毫秒）。mtime 未变 → 跳过。 */
  private readonly lastHandledMtime = new Map<string, number>();

  /* ── 依赖 ── */
  private readonly config: Config;
  private readonly logger: Logger;
  private readonly workspace: WorkspaceState;
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  constructor(opts: UeLinkManagerOptions) {
    this.config = opts.config;
    this.logger = opts.logger;
    this.workspace = opts.workspace;

    // Status bar item：放最右，不影响现有 11 个 Left 按钮
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      STATUS_BAR_PRIORITY,
    );
    this.statusBarItem.name = 'UE Helper: Link Sync';
    this.statusBarItem.command = undefined; // 无命令，只显示状态；hover 看详情
    this.statusBarItem.tooltip =
      'UE Link: 保存 .h 后自动触发 UHT codegen（mtime 跳过 + 5s 节流）';
    this.statusBarItem.text = '$(check)  UE✓';
    this.statusBarItem.show();

    // 订阅保存事件
    const saveSub = vscode.workspace.onDidSaveTextDocument((doc) => {
      this.onDidSave(doc.uri, doc.languageId);
    });
    this.disposables.push(saveSub);
    this.disposables.push(this.statusBarItem);
  }

  /* ── 公开 API ── */

  /** 状态快照（供测试 + UI）。 */
  snapshot(): UeLinkSnapshot {
    return {
      state: this.state.kind,
      lastUhtCompletedAt: this.lastUhtCompletedAt,
      lastUhtDurationMs: this.lastUhtDurationMs,
      lastGeneratedCount: this.lastGeneratedCount,
      mtimeSkippedCount: this.mtimeSkippedCount,
      throttledMergedCount: this.throttledMergedCount,
    };
  }

  /** 强制重置所有状态（包括 mtime 缓存 + 节流计时）。 */
  reset(): void {
    this.clearTimers();
    this.state = { kind: 'idle' };
    this.lastHandledMtime.clear();
    this.updateStatusBar();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearTimers();
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
    this.disposables.length = 0;
  }

  /* ── 测试钩子 ───────────────────────────────────────── */

  /**
   * 测试用入口：直接触发 onDidSave 逻辑（不依赖 vscode mock）。
   * 仅供 unit test 调用，生产代码不暴露。命名带 `ForTest` 后缀避免误用。
   * @internal
   */
  async onDidSaveForTest(uri: { fsPath: string } | string, languageId: string): Promise<void> {
    const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
    await this.onDidSaveForTestAsync(fsPath, languageId);
  }

  private async onDidSaveForTestAsync(fsPath: string, languageId: string): Promise<void> {
    // 与 private onDidSave 共用：白名单 + 异步 handleSaveAsync
    if (languageId !== 'cpp' && languageId !== 'c' && !fsPath.endsWith('.h')) {
      return;
    }
    if (!fsPath.endsWith('.h')) {
      return;
    }
    const projectDir = this.workspace.projectDir;
    if (!projectDir) {
      return;
    }
    const rel = path.relative(projectDir, fsPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return;
    }
    // 路径用 / 标准化（Windows 上 path.relative 返回 \），避免 /Source\/ 正则在 Windows 失效
    const relNorm = rel.split(path.sep).join('/');
    const inSource = /^Source\//.test(relNorm);
    const inPluginSource = /^Plugins\/[^/]+\/Source\//.test(relNorm);
    if (!inSource && !inPluginSource) {
      return;
    }

    await this.handleSaveAsync(vscode.Uri.file(fsPath));
  }
  /* ── 事件入口 ── */

  private onDidSave(uri: vscode.Uri, languageId: string): void {
    if (this.disposed) {
      return;
    }
    // 1. 文件白名单：必须是 .h（contentType C++ header）
    if (languageId !== "cpp" && languageId !== "c" && !uri.fsPath.endsWith(".h")) {
      return;
    }
    if (!uri.fsPath.endsWith(".h")) {
      return;
    }

    // 2. 路径白名单：必须在 projectDir/Source/ 或 Plugins/**/Source/
    // 路径用 / 标准化（Windows 上 path.relative 返回 \），避免 /Source\/ 正则在 Windows 失效
    const projectDir = this.workspace.projectDir;
    if (!projectDir) {
      return;
    }
    const rel = path.relative(projectDir, uri.fsPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return;
    }
    const relNorm = rel.split(path.sep).join("/");
    const inSource = /^Source\//.test(relNorm);
    const inPluginSource = /^Plugins\/[^/]+\/Source\//.test(relNorm);
    if (!inSource && !inPluginSource) {
      return;
    }

    // 3. 内容预过滤：含 UE 反射宏才需要 UHT
    // 这里不能直接读 fs（避免阻塞 onDidSave 同步路径），改用 mtime 命中跳过的策略：
    // - 如果 mtime 未变 → 直接跳过（无需读内容，常见 case：Ctrl+S 触发但实际无变化）
    // - 如果 mtime 变了 → 必须读内容判断是否含反射宏（用 fs.promises.stat + 异步读）
    void this.handleSaveAsync(uri);
  }

  private async handleSaveAsync(uri: vscode.Uri): Promise<void> {
    const fsPath = uri.fsPath;

    // 3a. mtime 快速路径：同文件 mtime 未变 → 跳过
    let mtimeMs = 0;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      mtimeMs = stat.mtime;
    } catch {
      // 文件可能在保存后立即被其他工具修改；保守起见继续走 UHT
    }
    const lastMtime = this.lastHandledMtime.get(fsPath);
    if (lastMtime !== undefined && lastMtime === mtimeMs && mtimeMs > 0) {
      this.mtimeSkippedCount++;
      this.logger.info(
        `[ueLink] mtime unchanged, skip UHT: ${path.basename(fsPath)} (skip count=${this.mtimeSkippedCount})`,
      );
      this.updateStatusBar();
      return;
    }

    // 3b. 内容预过滤：读磁盘检查是否含 UE 反射宏
    let content: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      content = new TextDecoder('utf-8').decode(bytes);
    } catch {
      return;
    }
    if (!REFLECTION_MACRO_RE.test(content)) {
      // 不是反射头，记录 mtime（下次 Ctrl+S 同文件 mtime 还会变，但内容不会改回反射宏）
      // 仍记录 mtime 避免下次重复读 fs
      if (mtimeMs > 0) {
        this.lastHandledMtime.set(fsPath, mtimeMs);
      }
      this.logger.info(
        `[ueLink] no reflection macro, skip UHT: ${path.basename(fsPath)}`,
      );
      this.updateStatusBar();
      return;
    }

    // 4. 含反射宏：记录 mtime + 走节流状态机
    if (mtimeMs > 0) {
      this.lastHandledMtime.set(fsPath, mtimeMs);
    }
    this.scheduleRun(fsPath);
  }

  /* ── 状态机 ── */

  private scheduleRun(file: string): void {
    // 已经在 debouncing/throttled/running：清掉旧 timer，更新状态
    this.clearTimers();

    // 全局节流：如果距上次 UHT 启动 < 5s，等剩余时间
    const sinceLastUht = this.lastUhtCompletedAt > 0
      ? performance.now() - this.lastUhtCompletedAt
      : Infinity;
    if (sinceLastUht < GLOBAL_THROTTLE_MS) {
      const remaining = GLOBAL_THROTTLE_MS - sinceLastUht;
      this.throttledMergedCount++;
      this.state = {
        kind: 'throttled',
        fireAt: Date.now() + remaining,
        timer: setTimeout(() => { void this.runUht(file); }, remaining),
      };
      this.logger.info(
        `[ueLink] throttled, will fire in ${remaining.toFixed(0)}ms (merged count=${this.throttledMergedCount})`,
      );
      this.updateStatusBar();
      return;
    }

    // 文件级 debounce：200ms 后跑（合并同文件抖动保存）
    this.state = {
      kind: 'debouncing',
      file,
      timer: setTimeout(() => { void this.runUht(file); }, FILE_DEBOUNCE_MS),
    };
    this.updateStatusBar();
  }

  private async runUht(triggerFile: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    const projectPath = this.workspace.selectedProject;
    const enginePath = this.workspace.selectedEngine;
    if (!projectPath || !enginePath) {
      this.logger.warn('[ueLink] runUht: project or engine not selected, skip');
      this.state = { kind: 'idle' };
      this.updateStatusBar();
      return;
    }

    // .uproject 文件名（无后缀）= target name（UE 约定），无需从 detection result 拿 name
    const buildTargetName = `${path.basename(projectPath, '.uproject')}Editor`;

    this.state = { kind: 'running-uht', startedAt: performance.now(), file: triggerFile };
    this.updateStatusBar();

    const startMs = performance.now();
    let result: UhtResult;
    try {
      result = await runUhtCodegen({
        project: projectPath,
        engineRoot: enginePath,
        buildTargetName,
        buildType: this.config.configuration,
        logger: this.logger,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[ueLink] UHT spawn failed: ${msg}`);
      this.state = { kind: 'error', message: msg };
      this.lastUhtCompletedAt = performance.now();
      this.lastUhtDurationMs = performance.now() - startMs;
      this.updateStatusBar();
      return;
    }

    this.lastUhtCompletedAt = performance.now();
    this.lastUhtDurationMs = performance.now() - startMs;
    this.lastGeneratedCount = result.generatedHeaderCount;

    if (!result.ran) {
      this.logger.warn(`[ueLink] UHT did not run: ${result.errorMessage ?? 'unknown'}`);
      this.state = { kind: 'error', message: result.errorMessage ?? 'UHT did not run' };
      this.updateStatusBar();
      return;
    }

    // 通知 clangd：写 trigger 文件，proxy 的 chokidar 会立即注入 workspace/didChangeWatchedFiles
    // proxy 不在跑时也无害——trigger 文件写了但没人监听，下次 proxy 启动会读
    const projectDir = path.dirname(projectPath);
    try {
      await triggerReparse(projectDir, result.generatedHeaderPaths);
    } catch (err) {
      this.logger.warn(
        `[ueLink] triggerReparse failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.state = {
      kind: 'notify',
      file: triggerFile,
      changedFiles: result.generatedHeaderPaths,
    };
    this.logger.info(
      `[ueLink] UHT done in ${this.lastUhtDurationMs.toFixed(0)}ms, ` +
        `generated ${result.generatedHeaderCount} .generated.h, ` +
        `triggered reparse (mtime skip=${this.mtimeSkippedCount}, throttled=${this.throttledMergedCount})`,
    );
    // 1s 后回到 idle（让用户看到 "Synced" 状态一会儿）
    setTimeout(() => {
      if (this.state.kind === 'notify') {
        if (!this.disposed) {
          this.state = { kind: 'idle' };
          this.updateStatusBar();
        }
      }
    }, 1000);
  }

  private clearTimers(): void {
    const s = this.state;
    if (s.kind === 'debouncing' || s.kind === 'throttled') {
      clearTimeout(s.timer);
    }
  }

  /* ── Status bar ── */

  private updateStatusBar(): void {
    if (this.disposed) {
      return;
    }
    const s = this.state;
    let text: string;
    let tooltip: string;
    switch (s.kind) {
      case 'idle':
        text = '$(check)  UE✓';
        tooltip =
          `UE Link: idle. ` +
          `Last UHT: ${this.lastUhtDurationMs > 0 ? `${this.lastUhtDurationMs.toFixed(0)}ms ago, ${this.lastGeneratedCount} headers` : 'never'}. ` +
          `Stats: mtime skip=${this.mtimeSkippedCount}, throttled merge=${this.throttledMergedCount}.`;
        break;
      case 'debouncing':
        text = '$(edit)  UE…';
        tooltip = `UE Link: debouncing ${path.basename(s.file)} (200ms)`;
        break;
      case 'throttled': {
        const waitMs = Math.max(0, s.fireAt - Date.now());
        text = `$(clock)  UE throttle ${(waitMs / 1000).toFixed(1)}s`;
        tooltip = `UE Link: throttled, fire in ${waitMs.toFixed(0)}ms`;
        break;
      }
      case 'running-uht':
        text = '$(sync~spin)  UE Sync';
        tooltip = `UE Link: running UHT for ${path.basename(s.file)}...`;
        break;
      case 'notify': {
        const dur = this.lastUhtDurationMs.toFixed(0);
        text = `$(check)  UE Synced ${dur}ms`;
        tooltip = `UE Link: UHT done in ${dur}ms, generated ${this.lastGeneratedCount} headers, reparse triggered`;
        break;
      }
      case 'error':
        text = '$(alert)  UE Sync Error';
        tooltip = `UE Link error: ${s.message}. See Output panel for details.`;
        break;
    }
    this.statusBarItem.text = text;
    this.statusBarItem.tooltip = tooltip;
  }
}
