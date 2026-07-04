/**
 * perfStatusBar —— clangd 性能三段状态栏
 *
 * 设计原则（per D-04 + D-05 + RESEARCH §Architecture Recommendation）：
 *   - 三个 StatusBarItem 并排（priority 198/199/200，左侧）
 *   - 三色背景映射：绿（无背景） / 黄（statusBarItem.warningBackground） / 红（statusBarItem.errorBackground）
 *   - thresholdFor 支持 inverted 语义（命中率越高越绿）
 *   - i18n tooltip / text 全走 t()
 *   - 不持有项目状态，纯数据驱动；用户通过订阅 perfLog.onMetricUpdate() 实时刷新
 *
 * 性能指标（per D-04）：
 *   - Clangd gen: <5s 绿 / 5-10s 黄 / >10s 红
 *   - PI cache hit rate: >=80% 绿 / 60-80% 黄 / <60% 红（inverted）
 *   - Incremental scan: <100ms 绿 / 100-200ms 黄 / >200ms 红
 *
 * 点击行为：
 *   - 三段均绑定 `workbench.action.output.showOutput` 跳转 Output Channel
 */

import * as vscode from 'vscode';
import { t } from '@i18n';

/** 状态栏指标快照 */
export interface PerfStatusBarMetrics {
  genMs?: number;
  hitRate?: number;
  incrMs?: number;
}

/** 阈值阈值定义（绿色上限 / 黄色上限） */
interface Thresholds {
  green: number;
  yellow: number;
}

/**
 * PerfStatusBar —— 独立管理的 3 段性能状态栏
 *
 * 与 StatusBarManager 解耦（不混入 11 个按钮），便于单元测试和性能单独启用
 */
export class PerfStatusBar implements vscode.Disposable {
  private readonly clangdGenItem: vscode.StatusBarItem;
  private readonly preparseCacheItem: vscode.StatusBarItem;
  private readonly incrementalScanItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  /** 上次更新时的指标（避免空更新时清空 tooltip） */
  private lastMetrics: PerfStatusBarMetrics = {};

  constructor() {
    // priority 200 在最左（高 priority = 更左），依次 199、198
    this.clangdGenItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      200,
    );
    this.clangdGenItem.name = 'UE Helper: Perf Clangd Gen';
    this.clangdGenItem.command = {
      title: 'Show Output',
      command: 'workbench.action.output.showOutput',
      arguments: ['VSCodeUEHelper'],
    };

    this.preparseCacheItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      199,
    );
    this.preparseCacheItem.name = 'UE Helper: Perf PI Cache';
    this.preparseCacheItem.command = {
      title: 'Show Output',
      command: 'workbench.action.output.showOutput',
      arguments: ['VSCodeUEHelper'],
    };

    this.incrementalScanItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      198,
    );
    this.incrementalScanItem.name = 'UE Helper: Perf Incremental Scan';
    this.incrementalScanItem.command = {
      title: 'Show Output',
      command: 'workbench.action.output.showOutput',
      arguments: ['VSCodeUEHelper'],
    };

    this.disposables.push(
      this.clangdGenItem,
      this.preparseCacheItem,
      this.incrementalScanItem,
    );
  }

  /**
   * 更新三段性能指标的视觉呈现
   *
   * @param metrics 任意字段缺失时该段保持上次状态（便于部分刷新）
   */
  update(metrics: PerfStatusBarMetrics): void {
    this.lastMetrics = { ...this.lastMetrics, ...metrics };

    // 第 1 段：Clangd gen 耗时（<5s 绿 / 5-10s 黄 / >10s 红）
    if (typeof metrics.genMs === 'number' && metrics.genMs >= 0) {
      const t1 = this.thresholdFor(metrics.genMs, { green: 5000, yellow: 10000 });
      const seconds = (metrics.genMs / 1000).toFixed(1);
      this.clangdGenItem.text = `${t1.icon} Clangd: ${seconds}s`;
      this.clangdGenItem.backgroundColor = t1.color;
      this.clangdGenItem.tooltip = t('perf.clangdGen.tooltip', { ms: String(Math.round(metrics.genMs)) });
    }

    // 第 2 段：PI cache 命中率（>=80% 绿 / 60-80% 黄 / <60% 红，inverted）
    if (typeof metrics.hitRate === 'number' && metrics.hitRate >= 0 && metrics.hitRate <= 1) {
      // inverted：值越大越绿
      const pct = metrics.hitRate * 100;
      const t2 = this.thresholdFor(pct, { green: 80, yellow: 60 }, true);
      this.preparseCacheItem.text = `${t2.icon} PI cache: ${pct.toFixed(0)}%`;
      this.preparseCacheItem.backgroundColor = t2.color;
      this.preparseCacheItem.tooltip = t('perf.preparseCache.tooltip', { pct: pct.toFixed(0) });
    }

    // 第 3 段：Incremental scan 延迟（<100ms 绿 / 100-200ms 黄 / >200ms 红）
    if (typeof metrics.incrMs === 'number' && metrics.incrMs >= 0) {
      const t3 = this.thresholdFor(metrics.incrMs, { green: 100, yellow: 200 });
      this.incrementalScanItem.text = `${t3.icon} Incr: ${Math.round(metrics.incrMs)}ms`;
      this.incrementalScanItem.backgroundColor = t3.color;
      this.incrementalScanItem.tooltip = t('perf.incrementalScan.tooltip', { ms: String(Math.round(metrics.incrMs)) });
    }
  }

  /** 显示三段状态栏（按需调用） */
  show(): void {
    this.clangdGenItem.show();
    this.preparseCacheItem.show();
    this.incrementalScanItem.show();
  }

  /** 隐藏三段（不影响 dispose） */
  hide(): void {
    this.clangdGenItem.hide();
    this.preparseCacheItem.hide();
    this.incrementalScanItem.hide();
  }

  /**
   * 三色阈值判断（支持 inverted 语义）
   *
   * @param value 当前指标值
   * @param thresholds green（绿上限）/ yellow（黄上限）
   * @param inverted true 用于"越高越绿"的指标（如命中率），false 用于"越低越绿"的指标（如耗时）
   */
  thresholdFor(
    value: number,
    { green, yellow }: Thresholds,
    inverted = false,
  ): { icon: string; color: vscode.ThemeColor | undefined } {
    // 绿条件：inverted ? value >= green : value <= green
    const isGreen = inverted ? value >= green : value <= green;
    if (isGreen) {
      return { icon: '$(pass)', color: undefined };
    }

    // 黄条件：值未到红色但过绿阈值
    const isYellow = inverted ? value >= yellow : value <= yellow;
    if (isYellow) {
      return {
        icon: '$(warning)',
        color: new vscode.ThemeColor('statusBarItem.warningBackground'),
      };
    }

    // 红色：其余全部情况
    return {
      icon: '$(error)',
      color: new vscode.ThemeColor('statusBarItem.errorBackground'),
    };
  }

  /** 释放三段资源 */
  dispose(): void {
    while (this.disposables.length > 0) {
      const d = this.disposables.pop();
      try {
        d?.dispose();
      } catch {
        // 静默忽略 dispose 异常
      }
    }
  }
}
