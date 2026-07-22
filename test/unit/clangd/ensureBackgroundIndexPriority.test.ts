/**
 * ensureBackgroundIndexPriority 单元测试（P1-2）
 *
 * 验证 proxyManager.enable/reapply 注入 --background-index-priority=normal 的逻辑：
 *   - 用户未显式设置任何 --background-index-priority 时追加 =normal
 *   - 已设置（=xxx 或空格分隔）时尊重用户配置，原样返回
 *   - 不误匹配 --background-index（无 -priority 后缀）
 */
import { describe, it, expect } from 'vitest';
import { ensureBackgroundIndexPriority } from '@clangd/proxyManager';

describe('ensureBackgroundIndexPriority (P1-2)', () => {
  it('空参数列表追加 --background-index-priority=normal', () => {
    expect(ensureBackgroundIndexPriority([])).toEqual(['--background-index-priority=normal']);
  });

  it('未设置 priority 时保留原有参数并追加 normal', () => {
    const args = ['--background-index', '--log=verbose'];
    expect(ensureBackgroundIndexPriority(args)).toEqual([
      '--background-index',
      '--log=verbose',
      '--background-index-priority=normal',
    ]);
  });

  it('已设置 --background-index-priority=low 时原样返回（尊重用户）', () => {
    const args = ['--background-index', '--background-index-priority=low'];
    expect(ensureBackgroundIndexPriority(args)).toBe(args);
  });

  it('已设置 --background-index-priority normal（空格分隔两 arg）时原样返回', () => {
    const args = ['--background-index-priority', 'background'];
    expect(ensureBackgroundIndexPriority(args)).toBe(args);
  });

  it('不误匹配 --background-index（无 -priority 后缀），仍追加 normal', () => {
    const args = ['--background-index'];
    expect(ensureBackgroundIndexPriority(args)).toEqual([
      '--background-index',
      '--background-index-priority=normal',
    ]);
  });
});
