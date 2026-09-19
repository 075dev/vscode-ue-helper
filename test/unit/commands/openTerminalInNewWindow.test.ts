/**
 * openTerminalInNewWindow.test.ts —— 在独立 OS 窗口打开终端命令单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { executeOpenTerminalInNewWindow } from '@commands/openTerminalInNewWindow';
import type { Logger } from '@core/logger';

// mock node:fs/promises，避免单元测试依赖真实文件系统
vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
}));

const MOVE_INTO_NEW_WINDOW_COMMAND = 'workbench.action.terminal.moveIntoNewWindow';

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('executeOpenTerminalInNewWindow', () => {
  const createTerminalMock = vi.fn().mockReturnValue({ show: vi.fn() });

  beforeEach(() => {
    // setup.ts 的 vscode mock 没有 createTerminal，这里补上
    (vscode.window as { createTerminal: unknown }).createTerminal = createTerminalMock;
    createTerminalMock.mockClear();
    vi.mocked(fs.stat).mockReset();
  });

  it('给定目录 Uri 时以该目录为 cwd 打开终端并移到新窗口', async () => {
    const uri = vscode.Uri.file('D:/Project/Source');
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as never);

    const envelope = await executeOpenTerminalInNewWindow(uri);

    expect(createTerminalMock).toHaveBeenCalledWith({ name: 'Source', cwd: 'D:/Project/Source' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(MOVE_INTO_NEW_WINDOW_COMMAND);
    // [契约对齐] 纯 UI 命令成功 → ok envelope
    expect(envelope.ok).toBe(true);
    expect(envelope.error).toBeUndefined();
  });

  it('给定 { uri } 包装形态（Project Explorer view/item/context 传 tree item）时兼容解包', async () => {
    // Given: view/item/context 菜单按 VS Code 约定传 tree item（element，无 fsPath），
    // 形如 ProjectExplorerNode 的 `{ uri, label, kind, contextValue }`。
    const uri = vscode.Uri.file('D:/Project/Content');
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as never);

    // When
    await executeOpenTerminalInNewWindow({ uri });

    // Then: 取到包装里的 uri.fsPath 作为 cwd
    expect(createTerminalMock).toHaveBeenCalledWith({
      name: 'Content',
      cwd: 'D:/Project/Content',
    });
    expect(
      vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();
  });

  it('{ uri } 包装里 uri 缺失时提示无效路径并跳过', async () => {
    const showWarning = vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>;
    showWarning.mockReset();

    const envelope = await executeOpenTerminalInNewWindow({ uri: undefined }, createLogger());

    expect(showWarning).toHaveBeenCalled();
    expect(createTerminalMock).not.toHaveBeenCalled();
    // [契约对齐] 无效入参 → 兜底 INTERNAL_ERROR envelope
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('INTERNAL_ERROR');
  });

  it('无参数时提示无效路径并跳过', async () => {
    const showWarning = vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>;
    showWarning.mockReset();

    const envelope = await executeOpenTerminalInNewWindow(undefined, createLogger());

    expect(showWarning).toHaveBeenCalled();
    expect(createTerminalMock).not.toHaveBeenCalled();
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('INTERNAL_ERROR');
  });

  it('moveIntoNewWindow 失败(旧版 VS Code)→ warning + INTERNAL_ERROR envelope', async () => {
    const uri = vscode.Uri.file('D:/Project/Source');
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as never);
    (vscode.commands.executeCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('command not found'),
    );

    const envelope = await executeOpenTerminalInNewWindow(uri, createLogger());

    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('INTERNAL_ERROR');
  });
});
