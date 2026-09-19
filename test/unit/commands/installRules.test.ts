/**
 * installRules.test.ts —— executeInstallRules 命令单元测试(envelope 对齐)
 *
 * 覆盖:
 *   - 成功:写入 .cursor/rules/unreal-cpp.mdc 与 .github/copilot-instructions.md
 *     → ok envelope(摘要复用现有安装成功文案)
 *   - 无 workspace.projectDir → PROJECT_NOT_DETECTED err envelope
 *     (缺口登记:严格语义为"无工作区项目目录",取映射表最接近码)
 *   - 文件写入失败 → INTERNAL_ERROR err envelope
 *     (缺口登记:契约 9 项枚举无文件 IO 错误码,按兜底规则取)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

import { executeInstallRules } from '@commands/installRules';

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

function createWorkspaceMock(projectDir: string | null): WorkspaceState {
  return { projectDir } as unknown as WorkspaceState;
}

describe('executeInstallRules', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createLoggerMock();
    vi.clearAllMocks();
  });

  it('成功:写入两个规则文件并返回 ok envelope(摘要复用现有文案)', async () => {
    const env = await executeInstallRules(logger, createWorkspaceMock('C:\\UEProjects\\MyGame'));

    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('.cursor'), {
      recursive: true,
    });
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('unreal-cpp.mdc'),
      expect.any(String),
      'utf-8',
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('copilot-instructions.md'),
      expect.any(String),
      'utf-8',
    );
    // [envelope 对齐] 成功路径 → ok envelope,摘要含规则文件路径(复用 installRules.installed)
    expect(env.ok).toBe(true);
    expect(env.error).toBeUndefined();
    expect(env.summary).toEqual(expect.stringContaining('unreal-cpp.mdc'));
    expect(
      vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalled();
  });

  it('无 workspace.projectDir → PROJECT_NOT_DETECTED err envelope', async () => {
    const env = await executeInstallRules(logger, createWorkspaceMock(null));

    expect(
      vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalled();
    // [envelope 对齐] 缺口登记:无项目目录映射 PROJECT_NOT_DETECTED(最接近码)
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('PROJECT_NOT_DETECTED');
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('文件写入失败 → INTERNAL_ERROR err envelope(缺口登记)', async () => {
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error('EACCES: permission denied'));

    const env = await executeInstallRules(logger, createWorkspaceMock('C:\\UEProjects\\MyGame'));

    // [envelope 对齐] 文件 IO 失败无贴切码 → 兜底 INTERNAL_ERROR(登记见报告)
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INTERNAL_ERROR');
    expect(
      vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();
  });
});
