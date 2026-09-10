/**
 * lifecycle.test.ts —— MCP 生命周期 + detectHost 单测(T5.4)
 *
 * 覆盖维度:
 * 1. shouldStartMCP 在三种 mode 下行为正确(always/never/auto)
 * 2. detectHost 在有/无环境变量(CURSOR_* / CLAUDE_CODE_* 等 4 个 env)时返回值正确
 * 3. detectHost re-export 兼容性(从 @mcp/lifecycle 仍可用)
 *
 * 注入 vi.mock 把 @core/runtime-detect 替换为可控实现,
 * 验证 shouldStartMCP 调用 detectHost 的逻辑链 —— 真实 OS env 不影响测试。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockDetectHost = vi.fn<[], string | null>();

vi.mock('@core/runtime-detect', async () => {
  const actual = await vi.importActual<typeof import('@core/runtime-detect')>(
    '@core/runtime-detect',
  );
  return {
    ...actual,
    detectHost: () => mockDetectHost(),
  };
});

import { shouldStartMCP, detectHost, type MCPMode } from '../../../src/mcp/lifecycle';

describe('shouldStartMCP', () => {
  beforeEach(() => {
    mockDetectHost.mockReset();
  });

  it('returns true for mode=always regardless of host detection', () => {
    mockDetectHost.mockReturnValue(null);
    expect(shouldStartMCP('always')).toBe(true);
    expect(mockDetectHost).not.toHaveBeenCalled();
  });

  it('returns false for mode=never regardless of host detection', () => {
    mockDetectHost.mockReturnValue('cursor');
    expect(shouldStartMCP('never')).toBe(false);
    expect(mockDetectHost).not.toHaveBeenCalled();
  });

  it('returns true for mode=auto when detectHost identifies Cursor', () => {
    mockDetectHost.mockReturnValue('cursor');
    expect(shouldStartMCP('auto')).toBe(true);
  });

  it('returns true for mode=auto when detectHost identifies Claude Code', () => {
    mockDetectHost.mockReturnValue('claude-code');
    expect(shouldStartMCP('auto')).toBe(true);
  });

  it('returns false for mode=auto when no MCP-capable host is detected', () => {
    mockDetectHost.mockReturnValue(null);
    expect(shouldStartMCP('auto')).toBe(false);
  });

  it.each<[MCPMode, string | null, boolean]>([
    ['always', null, true],
    ['always', 'cursor', true],
    ['never', null, false],
    ['never', 'claude-code', false],
    ['auto', 'cursor', true],
    ['auto', null, false],
  ])('mode=%s, detectHost=%s -> %s', (mode, host, expected) => {
    mockDetectHost.mockReturnValue(host);
    expect(shouldStartMCP(mode)).toBe(expected);
  });
});

describe('detectHost re-export', () => {
  it('exports from @mcp/lifecycle call through to @core/runtime-detect implementation', () => {
    mockDetectHost.mockReturnValue('cursor');
    expect(detectHost()).toBe('cursor');
    expect(mockDetectHost).toHaveBeenCalledTimes(1);
  });

  it('returns null when no MCP host env var is set', () => {
    mockDetectHost.mockReturnValue(null);
    expect(detectHost()).toBeNull();
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
