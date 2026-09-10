import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { VscodeProjectExplorerFs } from '@ui/projectExplorerFs';

function uri(path: string): vscode.Uri {
  return vscode.Uri.file(path);
}

describe('VscodeProjectExplorerFs', () => {
  it('maps VS Code directory entries and sorts folders before files', async () => {
    const readDirectory = vi.fn().mockResolvedValue([
      ['z.cpp', vscode.FileType.File],
      ['Source', vscode.FileType.Directory],
      ['a.h', vscode.FileType.File],
    ]);
    const fs = new VscodeProjectExplorerFs({ readDirectory } as unknown as vscode.FileSystem);

    await expect(fs.readDirectory(uri('/project'))).resolves.toEqual([
      { name: 'Source', kind: 'directory' },
      { name: 'a.h', kind: 'file' },
      { name: 'z.cpp', kind: 'file' },
    ]);
  });

  it('returns undefined when a plugin descriptor contains invalid JSON', async () => {
    const readFile = vi.fn().mockResolvedValue(Buffer.from('{ invalid'));
    const fs = new VscodeProjectExplorerFs({ readFile } as unknown as vscode.FileSystem);

    await expect(fs.readPluginDescriptor(uri('/project/Test.uplugin'))).resolves.toBeUndefined();
  });

  it('reports whether a directory contains entries', async () => {
    const readDirectory = vi.fn().mockResolvedValue([['Module', vscode.FileType.Directory]]);
    const fs = new VscodeProjectExplorerFs({ readDirectory } as unknown as vscode.FileSystem);

    await expect(fs.hasEntries(uri('/project/Source'))).resolves.toBe(true);
  });
});
