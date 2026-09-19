/**
 * selectTarget.test.ts —— executeSelectTarget 契约 envelope 对齐单元测试
 *
 * 覆盖(决策 D5):
 *   1. 正常选择 → okEnvelope(data=选中值, summary 复用现有文案),持久化 + 信息提示
 *   2. 用户取消 QuickPick → errEnvelope(OPERATION_CANCELLED),不持久化不提示
 *   3. QuickPick 异常 → 函数出口兜底 errEnvelope(INTERNAL_ERROR)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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

function createLoggerMock(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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
  } as unknown as Logger;
}

function createConfigMock(): Config {
  return {
    update: vi.fn(() => Promise.resolve()),
  } as unknown as Config;
}

describe('executeSelectTarget', () => {
  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
  });

  it('选中目标 → okEnvelope(data=选中值),持久化并弹信息提示', async () => {
    pickTargetMock.mockResolvedValue('Editor');
    const config = createConfigMock();

    const result = await executeSelectTarget(config, createLoggerMock());

    expect(result.ok).toBe(true);
    expect(result.data).toBe('Editor');
    expect(result.summary).toContain('Editor');
    expect(config.update).toHaveBeenCalledWith('target', 'Editor');
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('取消 QuickPick → OPERATION_CANCELLED,不持久化不提示', async () => {
    pickTargetMock.mockResolvedValue(undefined);
    const config = createConfigMock();

    const result = await executeSelectTarget(config, createLoggerMock());

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('OPERATION_CANCELLED');
    expect(result.error?.message).toBeTruthy();
    expect(config.update).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('QuickPick 抛异常 → 出口兜底 INTERNAL_ERROR', async () => {
    pickTargetMock.mockRejectedValue(new Error('boom'));
    const logger = createLoggerMock();

    const result = await executeSelectTarget(createConfigMock(), logger);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
    expect(result.error?.message).toContain('boom');
    expect(logger.error).toHaveBeenCalled();
  });
});
