/**
 * openWorkspaceFile.test.ts —— 打开 .code-workspace 命令单元测试
 *
 * 覆盖(envelope 契约对齐):
 *  - folders 为空 → warning + PROJECT_NOT_DETECTED envelope
 *  - 找到 .code-workspace → vscode.open + ok envelope
 *  - 未找到 .code-workspace → info + PROJECT_NOT_DETECTED envelope
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { executeOpenWorkspaceFile } from '@commands/openWorkspaceFile';
import type { WorkspaceState } from '@core/workspace';

// mock node:fs/promises,避免单元测试依赖真实文件系统
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
}));

function makeWorkspace(folders: { name: string; absPath: string; role: string }[]): WorkspaceState {
  return {
    workspaceFolders: folders,
  } as unknown as WorkspaceState;
}

describe('executeOpenWorkspaceFile', () => {
  beforeEach(() => {
    vi.mocked(fs.readdir).mockReset();
    (vscode.commands.executeCommand as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it('workspace folders 为空 → warning + PROJECT_NOT_DETECTED envelope', async () => {
    const envelope = await executeOpenWorkspaceFile(makeWorkspace([]));

    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('PROJECT_NOT_DETECTED');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('找到 .code-workspace → vscode.open + ok envelope', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      '.vscode',
      'MyGame.code-workspace',
      'README.md',
    ] as never);

    const envelope = await executeOpenWorkspaceFile(
      makeWorkspace([{ name: 'MyGame', absPath: 'D:/proj/MyGame', role: 'project' }]),
    );

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      expect.objectContaining<Record<string, unknown>>({
        fsPath: expect.stringContaining('MyGame.code-workspace'),
      }),
    );
    expect(envelope.ok).toBe(true);
    expect(envelope.error).toBeUndefined();
    expect(envelope.summary).toBeDefined();
  });

  it('目录扫描失败被跳过 → 未找到 + PROJECT_NOT_DETECTED envelope', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error('boom'));

    const envelope = await executeOpenWorkspaceFile(
      makeWorkspace([{ name: 'MyGame', absPath: 'D:/proj/MyGame', role: 'project' }]),
    );

    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('PROJECT_NOT_DETECTED');
  });
});
