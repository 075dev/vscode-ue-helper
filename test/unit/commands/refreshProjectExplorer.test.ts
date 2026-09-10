import { describe, expect, it, vi } from 'vitest';
import { executeRefreshProjectExplorer } from '@commands/refreshProjectExplorer';
import type { ProjectExplorerProvider } from '@ui/projectExplorer';

describe('executeRefreshProjectExplorer', () => {
  it('invokes provider.refresh() exactly once', () => {
    const refresh = vi.fn();
    const provider = { refresh } as unknown as ProjectExplorerProvider;

    executeRefreshProjectExplorer(provider);

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
