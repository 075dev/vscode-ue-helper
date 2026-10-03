/**
 * selectTarget.test.ts —— executeSelectTarget 契约 envelope 对齐单元测试
 *
 * 覆盖(决策 D5):
 *   1. 正常选择 → okEnvelope(data=选中值, summary 复用现有文案),持久化 + 信息提示
 *   2. 用户取消 QuickPick → errEnvelope(OPERATION_CANCELLED),不持久化不提示
 *   3. QuickPick 异常 → 函数出口兜底 errEnvelope(INTERNAL_ERROR)
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import { executeSelectTarget } from '@commands/selectTarget';
import { initI18n } from '@i18n';

const { pickTargetMock } = vi.hoisted(() => ({
  pickTargetMock: vi.fn(),
}));

vi.mock('@ui/quickPicks', () => ({
  pickTarget: pickTargetMock,
}));

function createLoggerMock(): { logger: Logger; errorMock: Mock<unknown[], void> } {
  const errorMock: Mock<unknown[], void> = vi.fn();
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: errorMock,
      debug: vi.fn(),
      show: vi.fn(),
      channel: {} as never,
      prefix: 'test',
      currentLevel: 'info' as const,
      setLevel: vi.fn(),
      log: vi.fn(),
      getLevel: vi.fn(),
      getOutputChannel: vi.fn(),
      dispose: vi.fn(),
    } as unknown as Logger,
    errorMock,
  };
}

function createConfigMock(): { config: Config; updateMock: Mock<[], Promise<void>> } {
  const updateMock = vi.fn(() => Promise.resolve());
  return { config: { update: updateMock } as unknown as Config, updateMock };
}

describe('executeSelectTarget', () => {
  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
  });

  it('选中目标 → okEnvelope(data=选中值),持久化并弹信息提示', async () => {
    pickTargetMock.mockResolvedValue('Editor');
    const { config, updateMock } = createConfigMock();

    const result = await executeSelectTarget(config, createLoggerMock().logger);

    expect(result.ok).toBe(true);
    expect(result.data).toBe('Editor');
    expect(result.summary).toContain('Editor');
    expect(updateMock).toHaveBeenCalledWith('target', 'Editor');
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('取消 QuickPick → OPERATION_CANCELLED,不持久化不提示', async () => {
    pickTargetMock.mockResolvedValue(undefined);
    const { config, updateMock } = createConfigMock();

    const result = await executeSelectTarget(config, createLoggerMock().logger);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('OPERATION_CANCELLED');
    expect(result.error?.message).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('QuickPick 抛异常 → 出口兜底 INTERNAL_ERROR', async () => {
    pickTargetMock.mockRejectedValue(new Error('boom'));
    const { logger, errorMock } = createLoggerMock();

    const result = await executeSelectTarget(createConfigMock().config, logger);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
    expect(result.error?.message).toContain('boom');
    expect(errorMock).toHaveBeenCalled();
  });
});
