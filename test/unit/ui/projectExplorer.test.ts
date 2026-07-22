import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import { ProjectExplorerProvider, type ProjectExplorerNode } from '@ui/projectExplorer';
import type { ProjectExplorerFs, JsonValue } from '@ui/projectExplorerFs';

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function createWorkspace(projectDir: string | null = '/project'): WorkspaceState {
  return {
    projectDir,
    projectFile: projectDir ? `${projectDir}/Sample.uproject` : null,
    projectName: projectDir ? 'Sample' : null,
  } as unknown as WorkspaceState;
}

function createFs(
  entries: Record<string, readonly { name: string; kind: 'directory' | 'file' }[]>,
): ProjectExplorerFs {
  return {
    readDirectory: (uri: vscode.Uri) => Promise.resolve(entries[uri.fsPath] ?? []),
    readPluginDescriptor: () => Promise.resolve<JsonValue | undefined>({}),
    hasEntries: (uri: vscode.Uri) => Promise.resolve((entries[uri.fsPath]?.length ?? 0) > 0),
    exists: (uri: vscode.Uri) =>
      Promise.resolve(uri.fsPath in entries || uri.fsPath.endsWith('.uproject')),
  };
}

function rootChildren(provider: ProjectExplorerProvider): Promise<ProjectExplorerNode[]> {
  return provider.getChildren();
}

describe('ProjectExplorerProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing UE root entries in the fixed project order', async () => {
    const fs = createFs({
      '/project/Source': [],
      '/project/Content': [],
      '/project/Config': [],
      '/project/Plugins': [],
    });
    const provider = new ProjectExplorerProvider(createWorkspace(), fs, createLogger());

    expect((await rootChildren(provider)).map((item) => item.label)).toEqual([
      'Source',
      'Content',
      'Config',
      'Plugins',
      'Sample.uproject',
    ]);
  });

  it('returns no children when the workspace has no project', async () => {
    const provider = new ProjectExplorerProvider(
      createWorkspace(null),
      createFs({}),
      createLogger(),
    );

    expect(await rootChildren(provider)).toEqual([]);
  });

  it('reads ordinary directories lazily and keeps folders before files', async () => {
    const fs = createFs({
      '/project/Source': [
        { name: 'Z.cpp', kind: 'file' },
        { name: 'Module', kind: 'directory' },
        { name: 'A.h', kind: 'file' },
      ],
    });
    const provider = new ProjectExplorerProvider(createWorkspace(), fs, createLogger());
    const source = (await rootChildren(provider)).find((node) => node.label === 'Source');

    expect(source).toBeDefined();
    expect((await provider.getChildren(source)).map((item) => item.label)).toEqual([
      'Module',
      'A.h',
      'Z.cpp',
    ]);
  });

  it('recognizes plugin folders and marks a non-empty Source plugin buildable', async () => {
    const fs = createFs({
      '/project/Plugins': [{ name: 'GoodPlugin', kind: 'directory' }],
      '/project/Plugins/GoodPlugin': [
        { name: 'GoodPlugin.uplugin', kind: 'file' },
        { name: 'Source', kind: 'directory' },
        { name: 'Content', kind: 'directory' },
      ],
      '/project/Plugins/GoodPlugin/Source': [{ name: 'Module', kind: 'directory' }],
    });
    const provider = new ProjectExplorerProvider(createWorkspace(), fs, createLogger());
    const plugins = (await rootChildren(provider)).find((node) => node.label === 'Plugins');
    const plugin = (await provider.getChildren(plugins))[0];

    expect(plugin).toMatchObject({
      label: 'GoodPlugin',
      kind: 'plugin',
      contextValue: 'buildablePlugin',
    });
    expect((await provider.getChildren(plugin)).map((item) => item.label)).toEqual([
      'GoodPlugin.uplugin',
      'Source',
      'Content',
    ]);
  });

  it('fires one tree change event when refreshed and stops after dispose', () => {
    const provider = new ProjectExplorerProvider(createWorkspace(), createFs({}), createLogger());
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);

    provider.refresh();
    provider.dispose();
    provider.refresh();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('opens files through the project explorer open command', () => {
    const provider = new ProjectExplorerProvider(createWorkspace(), createFs({}), createLogger());
    const node: ProjectExplorerNode = {
      uri: vscode.Uri.file('/project/Source/Test.cpp'),
      label: 'Test.cpp',
      kind: 'file',
      contextValue: 'file',
    };

    expect(provider.getTreeItem(node).command).toEqual({
      command: 'vscodeUEHelper.openProjectExplorerFile',
      title: 'Open File',
      arguments: [node.uri],
    });
  });

  it('returns no root children when the project root is missing', async () => {
    const existsMock = vi.fn((uri: vscode.Uri) =>
      Promise.resolve(uri.fsPath === '/project/Sample.uproject'),
    );
    const fs: ProjectExplorerFs = {
      readDirectory: () => Promise.resolve([]),
      readPluginDescriptor: () => Promise.resolve(undefined),
      hasEntries: () => Promise.resolve(false),
      exists: existsMock,
    };
    const workspace = {
      projectDir: null,
      projectFile: null,
      projectName: null,
    } as unknown as WorkspaceState;
    const provider = new ProjectExplorerProvider(workspace, fs, createLogger());

    expect(await rootChildren(provider)).toEqual([]);
    expect(existsMock).not.toHaveBeenCalled();
  });

  it('keeps the tree usable when a subdirectory read fails', async () => {
    const fs: ProjectExplorerFs = {
      readDirectory: (uri: vscode.Uri) =>
        uri.fsPath === '/project/Source' ? Promise.reject(new Error('boom')) : Promise.resolve([]),
      readPluginDescriptor: () => Promise.resolve(undefined),
      hasEntries: () => Promise.resolve(false),
      exists: (uri: vscode.Uri) =>
        Promise.resolve(['/project/Source', '/project/Sample.uproject'].includes(uri.fsPath)),
    };
    const provider = new ProjectExplorerProvider(createWorkspace(), fs, createLogger());
    const source = (await rootChildren(provider)).find((node) => node.label === 'Source');

    expect(source).toBeDefined();
    expect(await provider.getChildren(source)).toEqual([]);
  });
});
