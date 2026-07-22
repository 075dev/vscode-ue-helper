/**
 * projectExplorerFs —— 项目目录面板的 VS Code 文件系统适配器。
 */

import * as vscode from 'vscode';
import { sortExplorerEntries, type ExplorerFsEntry } from './projectExplorerModel';

export interface ProjectExplorerFs {
  readDirectory(uri: vscode.Uri): Promise<readonly ExplorerFsEntry[]>;
  readPluginDescriptor(uri: vscode.Uri): Promise<JsonValue | undefined>;
  hasEntries(uri: vscode.Uri): Promise<boolean>;
  exists(uri: vscode.Uri): Promise<boolean>;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export class VscodeProjectExplorerFs implements ProjectExplorerFs {
  constructor(private readonly fs: vscode.FileSystem = vscode.workspace.fs) {}

  async readDirectory(uri: vscode.Uri): Promise<readonly ExplorerFsEntry[]> {
    const entries = await this.fs.readDirectory(uri);
    return sortExplorerEntries(
      entries.map(([name, fileType]) => ({
        name,
        kind: (fileType & vscode.FileType.Directory) !== 0 ? 'directory' : 'file',
      })),
    );
  }

  async readPluginDescriptor(uri: vscode.Uri): Promise<JsonValue | undefined> {
    try {
      const bytes = await this.fs.readFile(uri);
      const text = new TextDecoder().decode(bytes);
      return JSON.parse(text) as JsonValue;
    } catch {
      return undefined;
    }
  }

  async hasEntries(uri: vscode.Uri): Promise<boolean> {
    try {
      return (await this.fs.readDirectory(uri)).length > 0;
    } catch {
      return false;
    }
  }

  async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await this.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }
}
