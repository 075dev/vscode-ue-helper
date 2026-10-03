/**
 * projectExplorer —— UE 项目目录 TreeDataProvider。
 */

import * as vscode from 'vscode';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import type { ProjectExplorerFs } from './projectExplorerFs';
import { isBuildablePlugin, isPluginDescriptor, sortExplorerEntries } from './projectExplorerModel';

export type ProjectExplorerNodeKind = 'directory' | 'file' | 'plugin';
export type ProjectExplorerContextValue =
  | 'folder'
  | 'file'
  | 'uprojectFile'
  | 'upluginFile'
  | 'plugin'
  | 'buildablePlugin';

export interface ProjectExplorerNode {
  readonly uri: vscode.Uri;
  readonly label: string;
  readonly kind: ProjectExplorerNodeKind;
  readonly contextValue: ProjectExplorerContextValue;
  readonly pluginName?: string;
  readonly isPluginsRoot?: boolean;
}

const ROOT_DIRECTORY_NAMES = ['Source', 'Content', 'Config', 'Plugins'] as const;
const PLUGIN_CHILD_NAMES = ['Source', 'Content', 'Config'] as const;

export class ProjectExplorerProvider
  implements vscode.TreeDataProvider<ProjectExplorerNode>, vscode.Disposable
{
  static readonly viewType = 'vscodeUEHelper.projectExplorer';

  private readonly changeEmitter = new vscode.EventEmitter<
    ProjectExplorerNode | undefined | null | void
  >();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private disposed = false;

  constructor(
    private readonly workspace: WorkspaceState,
    private readonly fs: ProjectExplorerFs,
    private readonly logger: Logger,
  ) {}

  refresh(): void {
    if (!this.disposed) {
      this.changeEmitter.fire();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.changeEmitter.dispose();
  }

  getTreeItem(element: ProjectExplorerNode): vscode.TreeItem {
    const collapsibleState =
      element.kind === 'file'
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed;
    const item = new vscode.TreeItem(element.label, collapsibleState);
    item.resourceUri = element.uri;
    item.contextValue = element.contextValue;
    item.tooltip = element.uri.fsPath;
    item.iconPath = this.iconFor(element);
    if (element.kind === 'file') {
      item.command = {
        command: 'vscodeUEHelper.openProjectExplorerFile',
        title: 'Open File',
        arguments: [element.uri],
      };
    }
    return item;
  }

  async getChildren(element?: ProjectExplorerNode): Promise<ProjectExplorerNode[]> {
    if (!element) {
      return this.getProjectRootChildren();
    }
    if (element.kind === 'file') {
      return [];
    }
    if (element.isPluginsRoot) {
      return this.getPluginNodes(element.uri);
    }
    if (element.kind === 'plugin') {
      return this.getPluginChildren(element);
    }
    return this.getDirectoryChildren(element.uri);
  }

  private async getProjectRootChildren(): Promise<ProjectExplorerNode[]> {
    const projectDir = this.workspace.projectDir;
    const projectFile = this.workspace.projectFile;
    if (!projectDir || !projectFile) {
      return [];
    }

    const rootUri = vscode.Uri.file(projectDir);
    const nodes: ProjectExplorerNode[] = [];
    for (const name of ROOT_DIRECTORY_NAMES) {
      const uri = vscode.Uri.joinPath(rootUri, name);
      if (await this.fs.exists(uri)) {
        nodes.push({
          uri,
          label: name,
          kind: 'directory',
          contextValue: 'folder',
          isPluginsRoot: name === 'Plugins',
        });
      }
    }

    const projectUri = vscode.Uri.file(projectFile);
    if (await this.fs.exists(projectUri)) {
      nodes.push({
        uri: projectUri,
        label: this.basename(projectFile),
        kind: 'file',
        contextValue: 'uprojectFile',
      });
    }
    return nodes;
  }

  private async getDirectoryChildren(uri: vscode.Uri): Promise<ProjectExplorerNode[]> {
    const entries = await this.safeReadDirectory(uri);
    return sortExplorerEntries(entries).map((entry) => {
      const childUri = vscode.Uri.joinPath(uri, entry.name);
      const isDirectory = entry.kind === 'directory';
      return {
        uri: childUri,
        label: entry.name,
        kind: isDirectory ? 'directory' : 'file',
        contextValue: isDirectory ? 'folder' : this.fileContext(entry.name),
      } satisfies ProjectExplorerNode;
    });
  }

  private async getPluginNodes(pluginsUri: vscode.Uri): Promise<ProjectExplorerNode[]> {
    const entries = await this.safeReadDirectory(pluginsUri);
    const nodes: ProjectExplorerNode[] = [];
    for (const entry of entries) {
      if (entry.kind !== 'directory') {
        continue;
      }
      const pluginUri = vscode.Uri.joinPath(pluginsUri, entry.name);
      const pluginEntries = await this.safeReadDirectory(pluginUri);
      const descriptor = pluginEntries.find((candidate) =>
        isPluginDescriptor(entry.name, candidate.name),
      );
      if (!descriptor || descriptor.kind !== 'file') {
        continue;
      }
      const descriptorUri = vscode.Uri.joinPath(pluginUri, descriptor.name);
      await this.fs.readPluginDescriptor(descriptorUri);
      const source = pluginEntries.find(
        (candidate) => candidate.name === 'Source' && candidate.kind === 'directory',
      );
      const sourceEntries = source
        ? await this.safeReadDirectory(vscode.Uri.joinPath(pluginUri, 'Source'))
        : [];
      const buildable = isBuildablePlugin(source !== undefined, sourceEntries.length);
      nodes.push({
        uri: pluginUri,
        label: entry.name,
        kind: 'plugin',
        contextValue: buildable ? 'buildablePlugin' : 'plugin',
        pluginName: entry.name,
      });
    }
    return nodes.sort((a, b) => a.label.localeCompare(b.label));
  }

  private async getPluginChildren(plugin: ProjectExplorerNode): Promise<ProjectExplorerNode[]> {
    const pluginName = plugin.pluginName ?? plugin.label;
    const entries = await this.safeReadDirectory(plugin.uri);
    const nodes: ProjectExplorerNode[] = [];
    const descriptorName = `${pluginName}.uplugin`;
    const descriptor = entries.find(
      (entry) => entry.kind === 'file' && entry.name === descriptorName,
    );
    if (descriptor) {
      nodes.push({
        uri: vscode.Uri.joinPath(plugin.uri, descriptorName),
        label: descriptorName,
        kind: 'file',
        contextValue: 'upluginFile',
      });
    }
    for (const name of PLUGIN_CHILD_NAMES) {
      const directory = entries.find((entry) => entry.kind === 'directory' && entry.name === name);
      if (directory) {
        nodes.push({
          uri: vscode.Uri.joinPath(plugin.uri, name),
          label: name,
          kind: 'directory',
          contextValue: 'folder',
        });
      }
    }
    return nodes;
  }

  private async safeReadDirectory(
    uri: vscode.Uri,
  ): Promise<readonly { name: string; kind: 'directory' | 'file' }[]> {
    try {
      return await this.fs.readDirectory(uri);
    } catch (error) {
      this.logger.warn(`[projectExplorer] 无法读取目录 ${uri.fsPath}: ${String(error)}`);
      return [];
    }
  }

  private fileContext(fileName: string): ProjectExplorerContextValue {
    if (fileName.endsWith('.uproject')) {
      return 'uprojectFile';
    }
    if (fileName.endsWith('.uplugin')) {
      return 'upluginFile';
    }
    return 'file';
  }

  private iconFor(element: ProjectExplorerNode): vscode.ThemeIcon {
    if (element.kind === 'directory') {
      return new vscode.ThemeIcon('folder');
    }
    if (element.kind === 'plugin' || element.contextValue === 'uprojectFile') {
      return new vscode.ThemeIcon('game');
    }
    const extension = element.label.slice(element.label.lastIndexOf('.')).toLowerCase();
    const icon =
      extension === '.h'
        ? 'symbol-class'
        : extension === '.cpp'
          ? 'symbol-method'
          : extension === '.cs'
            ? 'symbol-keyword'
            : extension === '.uasset'
              ? 'symbol-property'
              : 'file';
    return new vscode.ThemeIcon(icon);
  }

  private basename(filePath: string): string {
    return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
  }
}
