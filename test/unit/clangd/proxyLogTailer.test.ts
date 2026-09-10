/**
 * proxyLogTailer.test.ts —— ProxyLogTailer 单元测试
 *
 * 测试策略：
 * - 用小 pollIntervalMs（10ms）+ sleep 等待轮询，避免真实 500ms 拖慢测试
 * - 临时日志文件用 mkdtempSync 隔离
 * - mock OutputChannel 收集 appendLine 调用，断言行内容
 *
 * 覆盖：已存在文件读取、增量追加、文件不存在、truncate 重置、半行缓冲、
 * Windows 行尾、空行跳过、dispose 停止。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as vscode from 'vscode';
import type { Logger } from '@core/logger';
import { ProxyLogTailer } from '@clangd/proxyLogTailer';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 等待若干毫秒，让轮询周期跑完 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 构造收集 appendLine 行的 mock channel */
function makeChannel(): { channel: vscode.OutputChannel; lines: string[] } {
  const lines: string[] = [];
  const channel = {
    appendLine: (l: string) => {
      lines.push(l);
    },
    append: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.OutputChannel;
  return { channel, lines };
}

/** 构造全 vi.fn() 的 mock Logger */
function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('ProxyLogTailer', () => {
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'proxy-tailer-'));
    logFile = join(tmpDir, 'proxy.log');
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // ─── 已存在文件 ─────────────────────────────────────────────

  it('start 后读取已存在的日志文件内容', async () => {
    const { channel, lines } = makeChannel();
    writeFileSync(logFile, '[clangd-proxy] started\n[clangd-proxy] argv: []\n');
    const tailer = new ProxyLogTailer(logFile, channel, makeLogger(), 10);

    tailer.start();
    await sleep(40);

    expect(lines).toContain('[clangd-proxy] started');
    expect(lines).toContain('[clangd-proxy] argv: []');
    tailer.dispose();
  });

  // ─── 增量追加 ───────────────────────────────────────────────

  it('追加内容后只读取新增部分', async () => {
    const { channel, lines } = makeChannel();
    writeFileSync(logFile, 'line1\n');
    const tailer = new ProxyLogTailer(logFile, channel, makeLogger(), 10);

    tailer.start();
    await sleep(40);
    expect(lines).toEqual(['line1']);

    appendFileSync(logFile, 'line2\n');
    await sleep(40);
    expect(lines).toEqual(['line1', 'line2']);

    tailer.dispose();
  });

  // ─── 文件不存在 ─────────────────────────────────────────────

  it('文件不存在时 start 不报错，创建后读取', async () => {
    const { channel, lines } = makeChannel();
    const tailer = new ProxyLogTailer(logFile, channel, makeLogger(), 10);

    tailer.start();
    await sleep(40);
    expect(lines).toEqual([]);

    writeFileSync(logFile, 'late entry\n');
    await sleep(40);
    expect(lines).toEqual(['late entry']);

    tailer.dispose();
  });

  // ─── truncate / 轮转 ────────────────────────────────────────

  it('文件被截断时重置 offset 不崩溃', async () => {
    const { channel, lines } = makeChannel();
    writeFileSync(logFile, 'aaaa\n'.repeat(100));
    const tailer = new ProxyLogTailer(logFile, channel, makeLogger(), 10);

    tailer.start();
    await sleep(40);
    expect(lines.length).toBe(100);

    // 截断为短内容（size 变小 → offset 重置）
    writeFileSync(logFile, 'fresh\n');
    await sleep(40);
    // 重置后从头读，最后一条应是 fresh
    expect(lines[lines.length - 1]).toBe('fresh');

    tailer.dispose();
  });

  // ─── 半行缓冲 ───────────────────────────────────────────────

  it('半行（无 \\n 结尾）不提前 flush，拼齐后才输出', async () => {
    const { channel, lines } = makeChannel();
    writeFileSync(logFile, 'partial');
    const tailer = new ProxyLogTailer(logFile, channel, makeLogger(), 10);

    tailer.start();
    await sleep(40);
    expect(lines).toEqual([]);

    appendFileSync(logFile, ' line\n');
    await sleep(40);
    expect(lines).toEqual(['partial line']);

    tailer.dispose();
  });

  // ─── Windows 行尾 ───────────────────────────────────────────

  it('Windows 行尾 \\r\\n 被清理为纯净行', async () => {
    const { channel, lines } = makeChannel();
    writeFileSync(logFile, 'line1\r\nline2\r\n');
    const tailer = new ProxyLogTailer(logFile, channel, makeLogger(), 10);

    tailer.start();
    await sleep(40);
    expect(lines).toEqual(['line1', 'line2']);

    tailer.dispose();
  });

  // ─── 空行跳过 ───────────────────────────────────────────────

  it('空行被跳过，不产生面板噪声', async () => {
    const { channel, lines } = makeChannel();
    writeFileSync(logFile, 'a\n\nb\n');
    const tailer = new ProxyLogTailer(logFile, channel, makeLogger(), 10);

    tailer.start();
    await sleep(40);
    expect(lines).toEqual(['a', 'b']);

    tailer.dispose();
  });

  // ─── dispose 停止 ───────────────────────────────────────────

  it('dispose 后停止轮询，后续追加不再读取', async () => {
    const { channel, lines } = makeChannel();
    writeFileSync(logFile, 'before\n');
    const tailer = new ProxyLogTailer(logFile, channel, makeLogger(), 10);

    tailer.start();
    await sleep(40);
    tailer.dispose();

    appendFileSync(logFile, 'after\n');
    await sleep(40);
    expect(lines).toEqual(['before']);
  });

  // ─── 重复 start / dispose 幂等 ──────────────────────────────

  it('重复 start 与重复 dispose 均安全', async () => {
    const { channel, lines } = makeChannel();
    writeFileSync(logFile, 'x\n');
    const tailer = new ProxyLogTailer(logFile, channel, makeLogger(), 10);

    tailer.start();
    tailer.start(); // 重复 start 应忽略
    await sleep(40);
    expect(lines).toEqual(['x']);

    tailer.dispose();
    tailer.dispose(); // 重复 dispose 应忽略
  });
});
