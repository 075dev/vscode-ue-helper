import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { executeOpenProjectExplorerFile } from '@commands/openProjectExplorerFile';
import type { Logger } from '@core/logger';

function createLogger(): Logger {
  const warn = vi.fn();
  const error = vi.fn();
  return {
    info: vi.fn(),
    warn,
    error,
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('executeOpenProjectExplorerFile', () => {
  beforeEach(() => {
    const spy = vscode.commands.executeCommand as unknown as {
      mockReset: () => void;
    };
    spy.mockReset();
  });

  it('delegates to vscode.open with the provided uri', () => {
    const uri = vscode.Uri.file('/project/Source/Test.cpp');

    const envelope = executeOpenProjectExplorerFile(uri);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.open', uri);
    // [契约对齐] 纯 UI 命令成功 → ok envelope
    expect(envelope.ok).toBe(true);
    expect(envelope.error).toBeUndefined();
  });

  it('does nothing when the uri is missing and logs a warning', () => {
    const logger = createLogger();
    const execute = vscode.commands.executeCommand;

    const envelope = executeOpenProjectExplorerFile(undefined, logger);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const warn = logger.warn as unknown as { mock: { calls: unknown[] } };
    expect(warn.mock.calls).toHaveLength(1);
    const spy = execute as unknown as {
      mock: { calls: unknown[] };
    };
    expect(spy.mock.calls).toHaveLength(0);
    // [契约对齐] 空 uri 属调用异常 → 兜底 INTERNAL_ERROR envelope
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('INTERNAL_ERROR');
  });
});
