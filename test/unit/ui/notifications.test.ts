/**
 * notifications 测试 —— 进度显示位置配置(progressLocation)
 *
 * 背景:VS Code 的通知进度(右下角弹窗)没有"自动折叠"API,任务期间会一直
 * 占着通知区。`vscodeUEHelper.progressLocation` 默认 'window'(状态栏 spinner,
 * 任务结束自动消失、不弹窗);设为 'notification' 回到旧行为。
 *
 * 覆盖:
 *   - resolveProgressLocation:默认 window / 显式 notification / 非法值回退 window
 *   - withProgress:按配置透传 location,并保留 report/token 语义
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { resolveProgressLocation, withProgress } from '@ui/notifications';

/** 覆盖 setup.ts 的全局 getConfiguration mock,让 progressLocation 可控 */
function mockSetting(value: string | undefined): void {
  (vscode.workspace.getConfiguration as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (section: string) => ({
      get: (key: string, def?: unknown) => {
        if (section === 'vscodeUEHelper' && key === 'progressLocation') {
          return value;
        }
        return def;
      },
      update: vi.fn(),
    }),
  );
}

describe('resolveProgressLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('默认(未配置)→ 状态栏 Window(自动隐藏,不弹窗)', () => {
    mockSetting(undefined);
    expect(resolveProgressLocation()).toBe(vscode.ProgressLocation.Window);
  });

  it('显式 notification → 右下角通知弹窗', () => {
    mockSetting('notification');
    expect(resolveProgressLocation()).toBe(vscode.ProgressLocation.Notification);
  });

  it('非法值 → 回退 window', () => {
    mockSetting('garbage');
    expect(resolveProgressLocation()).toBe(vscode.ProgressLocation.Window);
  });
});

describe('withProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('默认把 Window 位置与 cancellable 传给 withProgress', async () => {
    mockSetting(undefined);
    const result = await withProgress('fake title', () => Promise.resolve(42));

    expect(result).toBe(42);
    const opts = (vscode.window.withProgress as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { location: number; title: string; cancellable: boolean };
    expect(opts.location).toBe(vscode.ProgressLocation.Window);
    expect(opts.title).toBe('fake title');
    expect(opts.cancellable).toBe(true);
  });

  it('配置 notification 时位置透传为 Notification', async () => {
    mockSetting('notification');

    await withProgress('t', () => Promise.resolve(undefined));

    const opts = (vscode.window.withProgress as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { location: number };
    expect(opts.location).toBe(vscode.ProgressLocation.Notification);
  });

  it('task 收到的 report 透传 message/increment', async () => {
    mockSetting(undefined);
    let capturedReport: ((msg: string, increment?: number) => void) | undefined;

    await withProgress('t', (report) => {
      capturedReport = report;
      return Promise.resolve();
    });

    // setup.ts 的 withProgress mock 立即执行 task 并注入 {report: vi.fn()}
    expect(capturedReport).toBeTypeOf('function');
    const progressArg = (vscode.window.withProgress as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![1] as (p: { report: (o: unknown) => void }, t: unknown) => Promise<unknown>;
    const fakeReport = vi.fn();
    void progressArg({ report: fakeReport }, undefined);
    capturedReport!('step 2', 50);
    expect(fakeReport).toHaveBeenCalledWith({ message: 'step 2', increment: 50 });
  });
});
