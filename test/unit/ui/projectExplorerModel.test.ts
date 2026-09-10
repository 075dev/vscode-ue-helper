import { describe, expect, it } from 'vitest';
import {
  isBuildablePlugin,
  isPluginDescriptor,
  sortExplorerEntries,
} from '@ui/projectExplorerModel';

describe('projectExplorerModel', () => {
  it('folders come before files and both groups are sorted by name', () => {
    const result = sortExplorerEntries([
      { name: 'z.cpp', kind: 'file' },
      { name: 'Source', kind: 'directory' },
      { name: 'Config', kind: 'directory' },
      { name: 'a.h', kind: 'file' },
    ]);

    expect(result.map((entry) => entry.name)).toEqual(['Config', 'Source', 'a.h', 'z.cpp']);
  });

  it('recognizes only a matching plugin descriptor under the plugin folder', () => {
    expect(isPluginDescriptor('MyPlugin', 'MyPlugin.uplugin')).toBe(true);
    expect(isPluginDescriptor('MyPlugin', 'Other.uplugin')).toBe(false);
  });

  it('marks a plugin buildable only when Source contains at least one entry', () => {
    expect(isBuildablePlugin(true, 1)).toBe(true);
    expect(isBuildablePlugin(true, 0)).toBe(false);
    expect(isBuildablePlugin(false, 1)).toBe(false);
  });
});
