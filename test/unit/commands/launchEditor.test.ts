/**
 * launchEditor 命令测试 —— Wave2 envelope 对齐(决策 D5/C8)
 *
 * 覆盖:
 *   - 成功启动 → okEnvelope(summary 复用现有成功文案)
 *   - 未找到 .uproject → ok:false + PROJECT_NOT_DETECTED(契约 404)
 *   - 未选引擎 → ok:false + UBT_NOT_FOUND
 *   - 启动异常 → ok:false + INTERNAL_ERROR(showErrorMessage 行为保持原样)
 *
 * @build / @commands/_resolve 全部打桩;vscode 走全局 mock(test/unit/setup.ts),
 * 不依赖真实 UE 工程。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import { initI18n } from '@i18n';
import { executeLaunchEditor } from '@commands/launchEditor';

const mockLaunch = vi.fn<unknown[], Promise<void>>();
const mockResolveProjectOrPick = vi.fn<unknown[], Promise<unknown>>();
const mockResolveEngineOrPick = vi.fn<unknown[], Promise<unknown>>();
const mockPersistSelection = vi.fn<unknown[], Promise<unknown>>();

vi.mock('@build', () => ({
  launchEditor: (...args: unknown[]) => mockLaunch(...args),
}));

vi.mock('@commands/_resolve', () => ({
  resolveProjectOrPick: (...args: unknown[]) => mockResolveProjectOrPick(...args),
  resolveEngineOrPick: (...args: unknown[]) => mockResolveEngineOrPick(...args),
  persistSelection: (...args: unknown[]) => mockPersistSelection(...args),
}));

describe('executeLaunchEditor(envelope 对齐)', () => {
  const config = {
    target: 'Editor',
    platform: 'Win64',
    configuration: 'Development',
  } as unknown as Config;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
  const detection = {} as unknown as DetectionHandles;

  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
    mockLaunch.mockResolvedValue(undefined);
    mockResolveProjectOrPick.mockResolvedValue({
      path: 'D:/MyGame/MyGame.uproject',
      name: 'MyGame',
    });
    mockResolveEngineOrPick.mockResolvedValue({ path: 'E:/UE_5.3', version: '5.3' });
    mockPersistSelection.mockResolvedValue(undefined);
  });

  it('启动成功 → ok:true + summary,弹窗行为保持原样', async () => {
    const env = await executeLaunchEditor(config, logger, detection);

    expect(env).toMatchObject({ ok: true });
    expect(env.error).toBeUndefined();
    expect(env.summary).toBeTruthy();
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockLaunch).toHaveBeenCalledWith({
      engineRoot: 'E:/UE_5.3',
      platform: 'Win64',
      projectPath: 'D:/MyGame/MyGame.uproject',
    });
  });

  it('未找到 .uproject → ok:false + PROJECT_NOT_DETECTED(契约 404),不启动编辑器', async () => {
    mockResolveProjectOrPick.mockResolvedValue(undefined);

    const env = await executeLaunchEditor(config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_DETECTED' } });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('未选引擎 → ok:false + UBT_NOT_FOUND,不启动编辑器', async () => {
    mockResolveEngineOrPick.mockResolvedValue(undefined);

    const env = await executeLaunchEditor(config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'UBT_NOT_FOUND' } });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('启动异常 → ok:false + INTERNAL_ERROR,仍弹错误提示(行为保持)', async () => {
    mockLaunch.mockRejectedValue(new Error('ENOENT: UnrealEditor.exe not found'));

    const env = await executeLaunchEditor(config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect((env.error as { message?: string }).message).toContain('ENOENT');
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});
