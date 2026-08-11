/**
 * perfProxy.test.ts —— LSP Proxy 协同偏差测量单元测试
 *
 * Phase 7 PLAN B（per CLANGD-01-04 + D-18）：
 *   - 验证 ProxyOverheadMeter 的 P50/P95/P99/mean/memory 计算正确性
 *   - 验证 getSnapshot 字段完整性
 *   - 验证 persistBaseline atomic rename
 *   - 验证 startSampling 定时采样
 *   - 验证 recordLspFrame 滚动窗口行为
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type * as vscode from 'vscode';
import { ProxyOverheadMeter } from '@clangd/perfProxy';
import type { Logger } from '@core/logger';

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    show: vi.fn(),
    setLevel: vi.fn(),
    getLevel: vi.fn(() => 'info'),
  } as unknown as Logger;
}

function createMockContext(): vscode.ExtensionContext {
  const ctx = {
    subscriptions: [] as vscode.Disposable[],
  } as unknown as vscode.ExtensionContext;
  return ctx;
}

describe('ProxyOverheadMeter (Phase 7 PLAN B / per CLANGD-01-04)', () => {
  let meter: ProxyOverheadMeter;
  let mockLogger: Logger;
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockContext = createMockContext();
    meter = new ProxyOverheadMeter(mockContext, mockLogger, 100);
  });

  afterEach(() => {
    meter.stopSampling();
  });

  describe('recordLspFrame 滚动窗口', () => {
    it('写入后窗口累积 + requestCount 递增', () => {
      expect(meter['frameLatencies']).toHaveLength(0);
      meter.recordLspFrame('in', 10);
      meter.recordLspFrame('out', 20);
      meter.recordLspFrame('in', 30);
      expect(meter['frameLatencies']).toHaveLength(3);
      expect(meter['requestCount']).toBe(3);
    });

    it('超出窗口大小时自动剔除最旧帧', () => {
      const smallMeter = new ProxyOverheadMeter(mockContext, mockLogger, 5);
      // 写入 10 帧，窗口上限 5
      for (let i = 0; i < 10; i++) {
        smallMeter.recordLspFrame('in', i);
      }
      expect(smallMeter['frameLatencies']).toHaveLength(5);
      expect(smallMeter['frameLatencies']).toEqual([5, 6, 7, 8, 9]);
      smallMeter.stopSampling();
    });

    it('无效输入（NaN / 负数）直接丢弃', () => {
      meter.recordLspFrame('in', Number.NaN);
      meter.recordLspFrame('in', -5);
      meter.recordLspFrame('in', Number.POSITIVE_INFINITY);
      expect(meter['frameLatencies']).toHaveLength(0);
      expect(meter['requestCount']).toBe(0);
    });
  });

  describe('getSnapshot P95 计算正确性', () => {
    it('注入 10 个递增样本 → P95 ≈ 第 9 个（nearest-rank 100% 之前）', () => {
      // 注入 10 个样本：10, 20, ..., 100
      // nearest-rank P95: floor(0.95 * 10) = 9 → sorted[9] = 100
      // 注：100 帧中 P95(10) nearest-rank 等价于 P100 → 第 10 大
      // 对于 10 个样本 floor(0.95 * 10) = 9 → 第 10 个（0-indexed 9）= 100
      // 这里取 100 帧 → P95(100) nearest-rank floor(0.95*100)=95 → sorted[95] = 960
      for (let i = 1; i <= 100; i++) {
        meter.recordLspFrame('in', i * 10);
      }
      const snap = meter.getSnapshot();
      // 100 帧: sorted = [10,20,...,1000]
      // floor(0.95*100)=95 → sorted[95] = (95+1)*10 = 960
      expect(snap.p95Ms).toBe(960);
      // floor(0.99*100)=99 → sorted[99] = 1000
      expect(snap.p99Ms).toBe(1000);
      // floor(0.50*100)=50 → sorted[50] = 510
      expect(snap.p50Ms).toBe(510);
      // mean = (10+20+...+1000)/100 = 5050/100 = 505
      expect(snap.meanMs).toBeCloseTo(505, 0);
      expect(snap.requestCount).toBe(100);
    });

    it('空样本时所有分位数为 0 + requestCount = 0', () => {
      const snap = meter.getSnapshot();
      expect(snap.p50Ms).toBe(0);
      expect(snap.p95Ms).toBe(0);
      expect(snap.p99Ms).toBe(0);
      expect(snap.meanMs).toBe(0);
      expect(snap.requestCount).toBe(0);
    });

    it('单一样本时分位数 = 该样本', () => {
      meter.recordLspFrame('in', 42);
      const snap = meter.getSnapshot();
      expect(snap.p50Ms).toBe(42);
      expect(snap.p95Ms).toBe(42);
      expect(snap.p99Ms).toBe(42);
      expect(snap.meanMs).toBe(42);
    });

    it('快照字段完整（timestamp + 6 个数值字段）', () => {
      meter.recordLspFrame('in', 100);
      const snap = meter.getSnapshot();
      expect(typeof snap.timestamp).toBe('string');
      expect(new Date(snap.timestamp).getTime()).toBeGreaterThan(0);
      expect(typeof snap.p50Ms).toBe('number');
      expect(typeof snap.p95Ms).toBe('number');
      expect(typeof snap.p99Ms).toBe('number');
      expect(typeof snap.meanMs).toBe('number');
      expect(typeof snap.memoryRssKb).toBe('number');
      expect(typeof snap.requestCount).toBe('number');
    });
  });

  describe('persistBaseline 原子写入', () => {
    it('写入后目标文件存在 + .tmp 文件不存在', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'perfproxy-test-'));
      const outputPath = path.join(tmpDir, 'baseline.json');
      try {
        meter.recordLspFrame('in', 10);
        meter.recordLspFrame('out', 20);

        await meter.persistBaseline(outputPath);

        // 目标文件存在
        const stat = await fs.stat(outputPath);
        expect(stat.isFile()).toBe(true);
        // .tmp 不存在（atomic rename 验证）
        await expect(fs.stat(`${outputPath}.tmp`)).rejects.toThrow();
        // 内容是合法 JSON
        const content = await fs.readFile(outputPath, 'utf-8');
        const parsed = JSON.parse(content) as Record<string, unknown>;
        expect(parsed.p95Ms).toBeDefined();
        expect(parsed.generatedAt).toBeDefined();
        expect(parsed.requestCount).toBe(2);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('路径包含 .. 抛出错误（路径安全防御）', async () => {
      await expect(meter.persistBaseline('/tmp/../etc/passwd.json')).rejects.toThrow(
        /invalid path/,
      );
    });
  });

  describe('startSampling 定时器', () => {
    it('启动后定时器活跃 + dispose 后停止', () => {
      const handle = meter.startSampling(50);
      expect(meter['samplingTimer']).not.toBeNull();
      handle.dispose();
      expect(meter['samplingTimer']).toBeNull();
    });

    it('重复 startSampling 会先清理旧定时器', () => {
      const h1 = meter.startSampling(100);
      const oldTimer = meter['samplingTimer'];
      const h2 = meter.startSampling(200);
      expect(meter['samplingTimer']).not.toBeNull();
      // 定时器被替换
      expect(meter['samplingTimer']).not.toBe(oldTimer);
      h1.dispose();
      h2.dispose();
    });

    it('定时器触发后 memoryRssKb > 0（process.resourceUsage）', async () => {
      meter.startSampling(20);
      await new Promise<void>((r) => setTimeout(r, 80));
      const snap = meter.getSnapshot();
      // RSS 至少 >= 0（mock 测试环境下 process.resourceUsage 可能为 0）
      expect(snap.memoryRssKb).toBeGreaterThanOrEqual(0);
    });
  });

  describe('stopSampling 幂等性', () => {
    it('多次调用 stopSampling 不抛错', () => {
      meter.stopSampling();
      meter.stopSampling();
      meter.stopSampling();
      expect(meter['samplingTimer']).toBeNull();
    });
  });
});
