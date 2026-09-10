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

    executeOpenProjectExplorerFile(uri);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.open', uri);
  });

  it('does nothing when the uri is missing and logs a warning', () => {
    const logger = createLogger();
    const execute = vscode.commands.executeCommand;

    executeOpenProjectExplorerFile(undefined, logger);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const warn = logger.warn as unknown as { mock: { calls: unknown[] } };
    expect(warn.mock.calls).toHaveLength(1);
    const spy = execute as unknown as {
      mock: { calls: unknown[] };
    };
    expect(spy.mock.calls).toHaveLength(0);
  });
});
