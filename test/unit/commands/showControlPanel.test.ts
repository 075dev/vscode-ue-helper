/**
 * showControlPanel.test.ts —— executeShowControlPanel 契约 envelope 对齐单元测试
 *
 * 覆盖(决策 D5):
 *   1. 打开面板 → okEnvelope(纯 UI 命令,summary 复用"打开控制面板"语义)
 *   2. show 抛异常 → 函数出口兜底 errEnvelope(INTERNAL_ERROR)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeShowControlPanel } from '@commands/showControlPanel';

const { showMock } = vi.hoisted(() => ({
  showMock: vi.fn(),
}));

vi.mock('@ui/controlPanel', () => ({
  ControlPanelProvider: { show: showMock },
}));

describe('executeShowControlPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('打开面板 → okEnvelope,并触发聚焦命令', () => {
    const result = executeShowControlPanel();

    expect(result.ok).toBe(true);
    expect(result.summary).toBeTruthy();
    expect(result.data).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(showMock).toHaveBeenCalledOnce();
  });

  it('show 抛异常 → 出口兜底 INTERNAL_ERROR', () => {
    showMock.mockImplementation(() => {
      throw new Error('panel boom');
    });

    const result = executeShowControlPanel();

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
    expect(result.error?.message).toContain('panel boom');
  });
});
