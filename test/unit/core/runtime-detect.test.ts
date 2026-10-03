import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectHost, type RuntimeHost } from '@core/runtime-detect';

/**
 * 覆盖 detectHost() 的 5 个分支:
 *   1. CURSOR_TRACE_ID 存在         → 'cursor'
 *   2. CURSOR_USER_DATA_DIR 存在    → 'cursor'
 *   3. CLAUDE_CODE_ENTRYPOINT 存在  → 'claude-code'
 *   4. CLAUDE_CODE_SSE_PORT 存在    → 'claude-code'
 *   5. 都不存在                     → null (普通 VS Code / 其他宿主)
 *
 * 用 vi.stubEnv / vi.unstubAllEnvs 把 process.env 隔离在每个用例内,
 * 避免互相污染。
 */
describe('detectHost', () => {
  // 四个信号 env var —— 每个用例清零后只设自己关心的那个
  const CURSOR_VARS = ['CURSOR_TRACE_ID', 'CURSOR_USER_DATA_DIR'] as const;
  const CLAUDE_VARS = ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT'] as const;
  const ALL_VARS = [...CURSOR_VARS, ...CLAUDE_VARS] as const;

  beforeEach(() => {
    // 确保每个用例从一个干净的环境开始
    for (const key of ALL_VARS) {
      vi.stubEnv(key, '');
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns "cursor" when CURSOR_TRACE_ID is set', () => {
    vi.stubEnv('CURSOR_TRACE_ID', 'some-trace-id');
    expect(detectHost()).toBe<RuntimeHost>('cursor');
  });

  it('returns "cursor" when CURSOR_USER_DATA_DIR is set', () => {
    vi.stubEnv('CURSOR_USER_DATA_DIR', '/path/to/cursor/data');
    expect(detectHost()).toBe<RuntimeHost>('cursor');
  });

  it('returns "cursor" when both Cursor vars are set (still cursor)', () => {
    vi.stubEnv('CURSOR_TRACE_ID', 'trace');
    vi.stubEnv('CURSOR_USER_DATA_DIR', '/dir');
    expect(detectHost()).toBe<RuntimeHost>('cursor');
  });

  it('returns "claude-code" when CLAUDE_CODE_ENTRYPOINT is set', () => {
    vi.stubEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    expect(detectHost()).toBe<RuntimeHost>('claude-code');
  });

  it('returns "claude-code" when CLAUDE_CODE_SSE_PORT is set', () => {
    vi.stubEnv('CLAUDE_CODE_SSE_PORT', '8080');
    expect(detectHost()).toBe<RuntimeHost>('claude-code');
  });

  it('returns "claude-code" when both Claude vars are set', () => {
    vi.stubEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    vi.stubEnv('CLAUDE_CODE_SSE_PORT', '8080');
    expect(detectHost()).toBe<RuntimeHost>('claude-code');
  });

  it('returns null when no host env vars are set', () => {
    // 所有 4 个 env var 都被 beforeEach 清空(空字符串),应当走到 null 分支
    expect(detectHost()).toBeNull();
  });

  it('Cursor signal takes precedence over Claude signal', () => {
    // 两个信号都设了 —— 应当先命中 cursor 分支
    vi.stubEnv('CURSOR_TRACE_ID', 'trace');
    vi.stubEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    expect(detectHost()).toBe<RuntimeHost>('cursor');
  });
});
