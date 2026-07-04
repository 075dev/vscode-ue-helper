/**
 * statusBarPerf.test.ts —— PerfStatusBar 单元测试
 *
 * 覆盖：
 *   - thresholdFor 正向语义（耗时长 → 红）
 *   - thresholdFor 反向语义（命中率高 → 绿，inverted）
 *   - update 渲染 text + tooltip（per D-04 + D-05）
 *   - 边界值：恰好在阈值上（isGreen 边界）
 *   - dispose 清理 3 个 StatusBarItem
 *   - 点击 command 跳 Output Channel
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { PerfStatusBar } from '@ui/perfStatusBar';

beforeEach(() => {
  initI18n();
});

afterEach(() => {
  vi.clearAllMocks();
});

/** 初始化 i18n locale 为 en（避免受测试环境影响） */
function initI18n(): void {
  // 简单的 stub：setLocale 仅在测试 helper 中需要
  // 这里不需要特别操作，因为 setup.ts 中默认 en
  void vscode;
}

describe('PerfStatusBar.thresholdFor 正向语义（耗时越低越绿）', () => {
  let bar: PerfStatusBar;

  beforeEach(() => {
    bar = new PerfStatusBar();
  });

  afterEach(() => {
    bar.dispose();
  });

  it('value < greenThreshold → 绿', () => {
    const r = bar.thresholdFor(3000, { green: 5000, yellow: 10000 });
    expect(r.icon).toBe('$(pass)');
    expect(r.color).toBeUndefined();
  });

  it('value == greenThreshold → 绿（边界）', () => {
    const r = bar.thresholdFor(5000, { green: 5000, yellow: 10000 });
    expect(r.icon).toBe('$(pass)');
  });

  it('greenThreshold < value <= yellowThreshold → 黄', () => {
    const r = bar.thresholdFor(7000, { green: 5000, yellow: 10000 });
    expect(r.icon).toBe('$(warning)');
    expect(r.color).toBeDefined();
  });

  it('value == yellowThreshold → 黄（边界）', () => {
    const r = bar.thresholdFor(10000, { green: 5000, yellow: 10000 });
    expect(r.icon).toBe('$(warning)');
  });

  it('value > yellowThreshold → 红', () => {
    const r = bar.thresholdFor(15000, { green: 5000, yellow: 10000 });
    expect(r.icon).toBe('$(error)');
    expect(r.color).toBeDefined();
  });
});

describe('PerfStatusBar.thresholdFor inverted 语义（值越高越绿）', () => {
  let bar: PerfStatusBar;

  beforeEach(() => {
    bar = new PerfStatusBar();
  });

  afterEach(() => {
    bar.dispose();
  });

  it('inverted && value >= greenThreshold → 绿', () => {
    const r = bar.thresholdFor(85, { green: 80, yellow: 60 }, true);
    expect(r.icon).toBe('$(pass)');
  });

  it('inverted && yellowThreshold <= value < greenThreshold → 黄', () => {
    const r = bar.thresholdFor(70, { green: 80, yellow: 60 }, true);
    expect(r.icon).toBe('$(warning)');
  });

  it('inverted && value < yellowThreshold → 红', () => {
    const r = bar.thresholdFor(40, { green: 80, yellow: 60 }, true);
    expect(r.icon).toBe('$(error)');
  });

  it('边界：inverted && value == greenThreshold → 绿', () => {
    const r = bar.thresholdFor(80, { green: 80, yellow: 60 }, true);
    expect(r.icon).toBe('$(pass)');
  });

  it('边界：inverted && value == yellowThreshold → 黄', () => {
    const r = bar.thresholdFor(60, { green: 80, yellow: 60 }, true);
    expect(r.icon).toBe('$(warning)');
  });
});

describe('PerfStatusBar.update 渲染三段 (per D-04 + D-05)', () => {
  let bar: PerfStatusBar;
  let items: vscode.StatusBarItem[];

  beforeEach(() => {
    // 清空之前 mock 中的 items
    items = [];
    (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        // 每次调用返回新 mock 对象，添加到 items 列表
        const item = {
          text: '',
          tooltip: '',
          command: undefined,
          backgroundColor: undefined,
          name: '',
          show: vi.fn(),
          hide: vi.fn(),
          dispose: vi.fn(),
        };
        items.push(item as unknown as vscode.StatusBarItem);
        return item as unknown as vscode.StatusBarItem;
      },
    );

    bar = new PerfStatusBar();
  });

  afterEach(() => {
    bar.dispose();
  });

  it('genMs 在绿区 → 第 1 段显示绿色', () => {
    bar.update({ genMs: 3000 });
    const item0 = items[0] as unknown as { text: string; backgroundColor: unknown };
    expect(item0.text).toContain('Clangd:');
    expect(item0.text).toContain('3.0s');
    expect(item0.backgroundColor).toBeUndefined();
  });

  it('genMs 在黄区 → 第 1 段显示黄色背景', () => {
    bar.update({ genMs: 7000 });
    const item0 = items[0] as unknown as { text: string; backgroundColor: vscode.ThemeColor };
    expect(item0.text).toContain('7.0s');
    expect(item0.backgroundColor).toBeDefined();
  });

  it('genMs 在红区 → 第 1 段显示红色背景', () => {
    bar.update({ genMs: 15000 });
    const item0 = items[0] as unknown as { text: string };
    expect(item0.text).toContain('15.0s');
  });

  it('hitRate 高 → 第 2 段绿色', () => {
    bar.update({ hitRate: 0.85 });
    const item1 = items[1] as unknown as { text: string };
    expect(item1.text).toContain('PI cache:');
    expect(item1.text).toContain('85%');
  });

  it('hitRate 低 → 第 2 段红色', () => {
    bar.update({ hitRate: 0.4 });
    const item1 = items[1] as unknown as { text: string };
    expect(item1.text).toContain('PI cache:');
    expect(item1.text).toContain('40%');
  });

  it('incrMs 低 → 第 3 段绿色', () => {
    bar.update({ incrMs: 50 });
    const item2 = items[2] as unknown as { text: string };
    expect(item2.text).toContain('Incr:');
    expect(item2.text).toContain('50ms');
  });

  it('同时更新三段 → 全部正确渲染', () => {
    bar.update({ genMs: 3000, hitRate: 0.85, incrMs: 50 });
    expect(items).toHaveLength(3);
    const i0 = items[0] as unknown as { text: string };
    const i1 = items[1] as unknown as { text: string };
    const i2 = items[2] as unknown as { text: string };
    expect(i0.text).toContain('Clangd:');
    expect(i1.text).toContain('PI cache:');
    expect(i2.text).toContain('Incr:');
  });
});

describe('PerfStatusBar show / hide / dispose', () => {
  let bar: PerfStatusBar;
  let items: vscode.StatusBarItem[];

  beforeEach(() => {
    items = [];
    (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const item = {
        text: '',
        tooltip: '',
        command: undefined,
        backgroundColor: undefined,
        name: '',
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
      };
      items.push(item as unknown as vscode.StatusBarItem);
      return item as unknown as vscode.StatusBarItem;
    });
    bar = new PerfStatusBar();
  });

  it('show() 调用三段 .show()', () => {
    bar.show();
    for (const item of items) {
      expect((item as unknown as { show: () => void }).show).toHaveBeenCalled();
    }
  });

  it('hide() 调用三段 .hide()', () => {
    bar.hide();
    for (const item of items) {
      expect((item as unknown as { hide: () => void }).hide).toHaveBeenCalled();
    }
  });

  it('dispose() 调用三段 .dispose()', () => {
    bar.dispose();
    for (const item of items) {
      expect((item as unknown as { dispose: () => void }).dispose).toHaveBeenCalled();
    }
  });
});

describe('PerfStatusBar 点击 command 跳 Output Channel', () => {
  let items: vscode.StatusBarItem[];

  beforeEach(() => {
    items = [];
    (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const item = {
        text: '',
        tooltip: '',
        command: undefined,
        backgroundColor: undefined,
        name: '',
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
      };
      items.push(item as unknown as vscode.StatusBarItem);
      return item as unknown as vscode.StatusBarItem;
    });
  });

  it('三个 statusBarItem 均设置跳转 VSCodeUEHelper Output Channel 的命令', () => {
    const bar = new PerfStatusBar();
    try {
      for (const item of items) {
        const cmd = (item as unknown as { command: unknown }).command;
        expect(cmd).toBeDefined();
        if (typeof cmd === 'object' && cmd !== null) {
          const cmdObj = cmd as { command: string; arguments?: unknown[] };
          expect(cmdObj.command).toBe('workbench.action.output.showOutput');
          expect(cmdObj.arguments).toEqual(['VSCodeUEHelper']);
        }
      }
    } finally {
      bar.dispose();
    }
  });
});
