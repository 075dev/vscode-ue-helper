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

  it('[契约对齐] 返回 ok envelope(纯 UI 命令,summary 复用刷新语义)', () => {
    const provider = { refresh: vi.fn() } as unknown as ProjectExplorerProvider;

    const envelope = executeRefreshProjectExplorer(provider);

    expect(envelope.ok).toBe(true);
    expect(envelope.error).toBeUndefined();
    expect(envelope.summary).toBeDefined();
  });
});
