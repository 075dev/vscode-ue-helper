/** 目录面板使用的文件系统条目类型。 */
export type ExplorerEntryKind = 'directory' | 'file';

/** 目录面板的最小文件系统条目模型。 */
export interface ExplorerFsEntry {
  readonly name: string;
  readonly kind: ExplorerEntryKind;
}

/** 文件夹优先，并在同类条目中按名称排序。 */
export function sortExplorerEntries(entries: readonly ExplorerFsEntry[]): ExplorerFsEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/** 判断插件目录中的描述文件是否为同名 .uplugin。 */
export function isPluginDescriptor(pluginName: string, fileName: string): boolean {
  return fileName === `${pluginName}.uplugin`;
}

/** 只有存在且非空的 Source 目录才标记为可构建插件。 */
export function isBuildablePlugin(hasSourceDirectory: boolean, sourceEntryCount: number): boolean {
  return hasSourceDirectory && sourceEntryCount > 0;
}
