/**
 * copyBuildCommand 测试 —— 复制 UBT 构建命令
 *
 * 覆盖:
 *   - formatUBTCommandLine 纯函数(空格路径加引号 / 纯路径不加)
 *   - executeCopyBuildCommand:命令行组装、rebuild/clean 参数后缀、剪贴板写入、
 *     未选项目/引擎时返回 undefined
 *
 * _resolve / @build 全部打桩;clipboard 注入,不碰真实 vscode.env。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import { executeCopyBuildCommand, formatUBTCommandLine } from '@commands/copyBuildCommand';

const mockResolveProjectOrPick = vi.fn<unknown[], Promise<unknown>>();
const mockResolveEngineOrPick = vi.fn<unknown[], Promise<unknown>>();
const mockPersistSelection = vi.fn<unknown[], Promise<unknown>>();
const mockBuildUBTCommand = vi.fn<unknown[], unknown>();
const mockResolveUBTPath = vi.fn<unknown[], unknown>();
const mockResolveUBTTarget = vi.fn<unknown[], unknown>();

vi.mock('@commands/_resolve', () => ({
  resolveProjectOrPick: (...args: unknown[]) => mockResolveProjectOrPick(...args),
  resolveEngineOrPick: (...args: unknown[]) => mockResolveEngineOrPick(...args),
  persistSelection: (...args: unknown[]) => mockPersistSelection(...args),
}));

vi.mock('@build', () => ({
  buildUBTCommand: (...args: unknown[]) => mockBuildUBTCommand(...args),
  resolveUBTPath: (...args: unknown[]) => mockResolveUBTPath(...args),
  resolveUBTTarget: (...args: unknown[]) => mockResolveUBTTarget(...args),
}));

describe('formatUBTCommandLine', () => {
  it('路径含空格 → 整体加引号', () => {
    expect(formatUBTCommandLine('C:/Program Files/UE/RunUBT.bat', ['-A', '-B'])).toBe(
      '"C:/Program Files/UE/RunUBT.bat" -A -B',
    );
  });

  it('路径无空格 → 原样拼接', () => {
    expect(formatUBTCommandLine('C:/UE/RunUBT.bat', ['-A'])).toBe('C:/UE/RunUBT.bat -A');
  });

  it('args 为空 → 只返回文件', () => {
    expect(formatUBTCommandLine('C:/UE/RunUBT.bat', [])).toBe('C:/UE/RunUBT.bat');
  });
});

describe('executeCopyBuildCommand', () => {
  const config = {
    target: 'Editor',
    platform: 'Win64',
    configuration: 'Development',
  } as unknown as Config;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
  const detection = {} as unknown as DetectionHandles;

  const writeText = vi.fn<unknown[], Promise<void>>();

  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);

    mockResolveProjectOrPick.mockResolvedValue({
      path: 'D:/My Game/MyGame.uproject',
      name: 'MyGame',
    });
    mockResolveEngineOrPick.mockResolvedValue({ path: 'D:/UE_5.4' });
    mockPersistSelection.mockResolvedValue(undefined);
    mockResolveUBTTarget.mockReturnValue('MyGameEditor');
    mockResolveUBTPath.mockReturnValue('D:/UE_5.4/Engine/Build/BatchFiles/RunUBT.bat');
    mockBuildUBTCommand.mockReturnValue({
      file: 'D:/UE_5.4/Engine/Build/BatchFiles/RunUBT.bat',
      args: ['-Target=MyGameEditor Win64 Development', '-Project=D:/My Game/MyGame.uproject'],
    });
  });

  it('组装完整命令行并写入剪贴板(build 模式无附加参数)', async () => {
    const result = await executeCopyBuildCommand(config, logger, detection, undefined, 'build', {
      clipboard: { writeText },
      notify: () => {},
    });

    // mock 路径无空格 → 不加引号,原样拼接
    expect(result).toBe(
      'D:/UE_5.4/Engine/Build/BatchFiles/RunUBT.bat ' +
        '-Target=MyGameEditor Win64 Development -Project=D:/My Game/MyGame.uproject',
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(result);
  });

  it('rebuild / clean 模式追加 -Rebuild / -Clean', async () => {
    const rebuild = await executeCopyBuildCommand(config, logger, detection, undefined, 'rebuild', {
      clipboard: { writeText },
      notify: () => {},
    });
    expect(rebuild).toContain('-Rebuild');

    const clean = await executeCopyBuildCommand(config, logger, detection, undefined, 'clean', {
      clipboard: { writeText },
      notify: () => {},
    });
    expect(clean).toContain('-Clean');
  });

  it('未选项目 → 返回 undefined 且不写剪贴板', async () => {
    mockResolveProjectOrPick.mockResolvedValue(undefined);

    const result = await executeCopyBuildCommand(config, logger, detection, undefined, 'build', {
      clipboard: { writeText },
      notify: () => {},
    });

    expect(result).toBeUndefined();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('未选引擎 → 返回 undefined 且不写剪贴板', async () => {
    mockResolveEngineOrPick.mockResolvedValue(undefined);

    const result = await executeCopyBuildCommand(config, logger, detection, undefined, 'build', {
      clipboard: { writeText },
      notify: () => {},
    });

    expect(result).toBeUndefined();
    expect(writeText).not.toHaveBeenCalled();
  });
});
