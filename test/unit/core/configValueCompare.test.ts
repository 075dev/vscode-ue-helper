/**
 * configValueCompare.test.ts —— [D19] Config.update 的写盘结果校验用值比较
 *
 * ## 背景
 *
 * `Config.update()` 写盘后会调 `root.inspect(key)` 读回解析后的值,
 * 与调用方传入的值比对,不一致就打一条 console warning。
 *
 * 旧实现用的是**引用比较**（`resolvedAfter !== value`）。对数组/对象而言
 * 这永远成立 —— VS Code 返回的是它自己内部的对象,与调用方传进去的数组
 * 不是同一个引用。结果:每次写数组(比如 setSystemIncludes 写
 * `clangd.userAddFlags`)都往控制台扔一条
 *
 *   [Config.update] After update('clangd.userAddFlags', ...) ... Possible causes:
 *   target scope mismatch, no folder focused, or workspace state not initialized.
 *
 * 而写入其实完全成功。这条告警的措辞会把人引向完全错误的排查方向。
 *
 * 覆盖:
 *   - 写数组:内容相同但引用不同 → 不再告警
 *   - 写对象:同上 → 不再告警
 *   - 写标量:值确实不一致 → 仍然告警(保留原有的排查价值)
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

const mockGet = vi.fn((_key: string, def?: unknown) => def);
const mockUpdate = vi.fn<[string, unknown, unknown], Promise<void>>();
const mockInspect = vi.fn<[string], unknown>();

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: mockGet,
      update: mockUpdate,
      inspect: mockInspect,
    })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
}));

import { Config } from '@core/config';

describe('Config.update —— [D19] 值比较而非引用比较', () => {
  let warnSpy: MockInstance<[message?: unknown, ...optionalParams: unknown[]], void>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('写数组:inspect 返回内容相同但引用不同的数组 → 不告警', async () => {
    // 模拟 VS Code:inspect 返回它自己内部持有的数组
    mockInspect.mockReturnValue({
      workspaceFolderValue: undefined,
      workspaceValue: ['std-cxx20', 'system-include-windows'],
      globalValue: undefined,
      defaultValue: undefined,
    });

    const cfg = new Config();
    await cfg.update('clangd.userAddFlags', ['std-cxx20', 'system-include-windows']);

    expect(mockUpdate).toHaveBeenCalledWith(
      'clangd.userAddFlags',
      ['std-cxx20', 'system-include-windows'],
      2,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('写对象:内容相同但引用不同 → 不告警', async () => {
    mockInspect.mockReturnValue({
      workspaceFolderValue: undefined,
      workspaceValue: { a: 1, b: 2 },
      globalValue: undefined,
      defaultValue: undefined,
    });

    const cfg = new Config();
    await cfg.update('someObject', { a: 1, b: 2 });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('写标量:值确实不一致 → 仍然告警(保留排查价值)', async () => {
    mockInspect.mockReturnValue({
      workspaceFolderValue: undefined,
      workspaceValue: 'Development',
      globalValue: undefined,
      defaultValue: undefined,
    });

    const cfg = new Config();
    await cfg.update('configuration', 'Shipping');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('configuration');
  });

  it('写标量:值一致 → 不告警', async () => {
    mockInspect.mockReturnValue({
      workspaceFolderValue: undefined,
      workspaceValue: 'Shipping',
      globalValue: undefined,
      defaultValue: undefined,
    });

    const cfg = new Config();
    await cfg.update('configuration', 'Shipping');

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
