/**
 * keepalive.test.ts — didClose 保活状态机测试
 *
 * 测试策略：
 * - 所有测试使用 vi.useFakeTimers()，无真实等待
 * - 每个测试前后重置 fake timers
 * - 验证返回的 action 类型和内容，确保转发消息正确
 * - 覆盖：基本保活、didOpen→didChange、LRU 淘汰、TTL 过期、flush、边界条件
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { Keepalive } from '@clangd/proxy/keepalive';
import type { KeepaliveAction } from '@clangd/proxy/keepalive';

/** 辅助：从 action 中提取 params 并转为 any 便于断言 */
function actionParams(action: KeepaliveAction): Record<string, unknown> {
  return action.params as Record<string, unknown>;
}

/** 辅助：类型安全地断言值已定义，消除非空断言 */
function assertDefined<T>(value: T | undefined): asserts value is T {
  if (value === undefined) {
    throw new Error('Expected value to be defined');
  }
}

/** 辅助：创建 didClose params */
function didCloseParams(uri: string): unknown {
  return { textDocument: { uri } };
}

/** 辅助：创建 didOpen params（含 text/version） */
function didOpenParams(uri: string, text: string, version = 1): unknown {
  return {
    textDocument: {
      uri,
      languageId: 'cpp',
      version,
      text,
    },
  };
}

/** 辅助：创建 didOpen params（缺少 text） */
function didOpenParamsNoText(uri: string, version = 1): unknown {
  return {
    textDocument: {
      uri,
      languageId: 'cpp',
      version,
      // 故意省略 text
    },
  };
}

/** 辅助：创建 didOpen params（缺少 version） */
function didOpenParamsNoVersion(uri: string, text = 'content'): unknown {
  return {
    textDocument: {
      uri,
      languageId: 'cpp',
      // 故意省略 version
      text,
    },
  };
}

describe('Keepalive — didClose 保活状态机', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── 基本保活 ───────────────────────────────────────────────

  it('didClose 进入保活，不立即转发', () => {
    const ka = new Keepalive();
    const actions = ka.handleDidClose('file:///foo.cpp', didCloseParams('file:///foo.cpp'));
    expect(actions).toHaveLength(0);
    expect(ka.size).toBe(1);
  });

  it('didOpen 命中保活 URI 时发出 didChange（含全量文本）', () => {
    const ka = new Keepalive();
    ka.handleDidClose('file:///foo.cpp', didCloseParams('file:///foo.cpp'));

    const params = didOpenParams('file:///foo.cpp', 'int main() { return 0; }', 2);
    const actions = ka.handleDidOpen('file:///foo.cpp', params);

    expect(actions).toHaveLength(1);
    const action = actions[0];
    assertDefined(action);
    expect(action.type).toBe('forwardDidChange');
    expect(action.uri).toBe('file:///foo.cpp');

    const p = actionParams(action);
    expect(p.textDocument).toBeDefined();
    const td = p.textDocument as Record<string, unknown>;
    expect(td.uri).toBe('file:///foo.cpp');
    expect(td.version).toBe(2);

    expect(p.contentChanges).toBeDefined();
    const changes = p.contentChanges as Array<Record<string, unknown>>;
    expect(changes).toHaveLength(1);
    expect(changes[0]!.text).toBe('int main() { return 0; }');

    // 保活条目已被移除
    expect(ka.size).toBe(0);
  });

  // ─── LRU 淘汰 ──────────────────────────────────────────────

  it('超过 keepaliveMax 时淘汰最旧条目（LRU）', () => {
    const ka = new Keepalive({ max: 2 });

    ka.handleDidClose('file:///a.cpp', didCloseParams('file:///a.cpp'));
    ka.handleDidClose('file:///b.cpp', didCloseParams('file:///b.cpp'));

    // 添加第三个，应淘汰 a.cpp
    const actions = ka.handleDidClose('file:///c.cpp', didCloseParams('file:///c.cpp'));

    expect(actions).toHaveLength(1);
    expect(actions[0]!.type).toBe('forwardDidClose');
    expect(actions[0]!.uri).toBe('file:///a.cpp');
    expect(ka.size).toBe(2);
  });

  it('keepaliveMax+1 时最旧条目恰好被淘汰一次', () => {
    const ka = new Keepalive({ max: 3 });

    ka.handleDidClose('file:///1.cpp', didCloseParams('file:///1.cpp'));
    ka.handleDidClose('file:///2.cpp', didCloseParams('file:///2.cpp'));
    ka.handleDidClose('file:///3.cpp', didCloseParams('file:///3.cpp'));

    // 第 4 个，淘汰 1.cpp
    const actions = ka.handleDidClose('file:///4.cpp', didCloseParams('file:///4.cpp'));

    expect(actions).toHaveLength(1);
    expect(actions[0]!.uri).toBe('file:///1.cpp');

    // 第 5 个，淘汰 2.cpp
    const actions2 = ka.handleDidClose('file:///5.cpp', didCloseParams('file:///5.cpp'));
    expect(actions2).toHaveLength(1);
    expect(actions2[0]!.uri).toBe('file:///2.cpp');
  });

  it('LRU 顺序在 didOpen 命中后更新', () => {
    const ka = new Keepalive({ max: 2 });

    ka.handleDidClose('file:///a.cpp', didCloseParams('file:///a.cpp'));
    ka.handleDidClose('file:///b.cpp', didCloseParams('file:///b.cpp'));

    // 命中 b.cpp → 从保活中移除
    ka.handleDidOpen('file:///b.cpp', didOpenParams('file:///b.cpp', 'x', 1));

    // 现在只有 a.cpp 在保活中
    ka.handleDidClose('file:///c.cpp', didCloseParams('file:///c.cpp'));

    // 添加 d.cpp → 应淘汰 a.cpp（最旧）
    const actions = ka.handleDidClose('file:///d.cpp', didCloseParams('file:///d.cpp'));
    expect(actions).toHaveLength(1);
    expect(actions[0]!.uri).toBe('file:///a.cpp');
  });

  it('使用默认 max=20', () => {
    const ka = new Keepalive();

    // 添加 20 个条目
    for (let i = 0; i < 20; i++) {
      const uri = 'file:///' + i + '.cpp';
      ka.handleDidClose(uri, didCloseParams(uri));
    }
    expect(ka.size).toBe(20);

    // 第 21 个，淘汰 0.cpp
    const actions = ka.handleDidClose('file:///20.cpp', didCloseParams('file:///20.cpp'));
    expect(actions).toHaveLength(1);
    expect(actions[0]!.uri).toBe('file:///0.cpp');
    expect(ka.size).toBe(20);
  });

  // ─── TTL 过期 ──────────────────────────────────────────────

  it('TTL 到期前 tick 不返回过期条目', () => {
    const ka = new Keepalive({ ttlSec: 900 });

    ka.handleDidClose('file:///foo.cpp', didCloseParams('file:///foo.cpp'));

    // 前进到 900s - 1ms
    vi.advanceTimersByTime(900_000 - 1);
    const actions = ka.tick();
    expect(actions).toHaveLength(0);
    expect(ka.size).toBe(1);
  });

  it('TTL 在 900s+1ms 后过期并转发 didClose', () => {
    const ka = new Keepalive({ ttlSec: 900 });

    ka.handleDidClose('file:///foo.cpp', didCloseParams('file:///foo.cpp'));

    // 前进到刚好超过 TTL
    vi.advanceTimersByTime(900_000 + 1);
    const actions = ka.tick();

    expect(actions).toHaveLength(1);
    expect(actions[0]!.type).toBe('forwardDidClose');
    expect(actions[0]!.uri).toBe('file:///foo.cpp');
    expect(ka.size).toBe(0);
  });

  it('TTL 只过期超时的条目，保留未超时的', () => {
    const ka = new Keepalive({ ttlSec: 100 });

    ka.handleDidClose('file:///old.cpp', didCloseParams('file:///old.cpp'));

    vi.advanceTimersByTime(50_000); // 50s

    ka.handleDidClose('file:///new.cpp', didCloseParams('file:///new.cpp'));

    vi.advanceTimersByTime(60_000); // 现在 old 110s, new 60s

    const actions = ka.tick();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.uri).toBe('file:///old.cpp');
    expect(ka.size).toBe(1); // new.cpp 仍在保活中
  });

  // ─── 缺少 text/version 的 didOpen ──────────────────────────

  it('缺少 text 的 didOpen 先 flush didClose 再转发 didOpen', () => {
    const ka = new Keepalive();
    ka.handleDidClose('file:///foo.cpp', didCloseParams('file:///foo.cpp'));

    const actions = ka.handleDidOpen('file:///foo.cpp', didOpenParamsNoText('file:///foo.cpp', 1));

    expect(actions).toHaveLength(2);
    expect(actions[0]!.type).toBe('forwardDidClose');
    expect(actions[0]!.uri).toBe('file:///foo.cpp');
    expect(actions[1]!.type).toBe('forwardDidOpen');
    expect(actions[1]!.uri).toBe('file:///foo.cpp');
    expect(ka.size).toBe(0);
  });

  it('缺少 version 的 didOpen 先 flush didClose 再转发 didOpen', () => {
    const ka = new Keepalive();
    ka.handleDidClose('file:///foo.cpp', didCloseParams('file:///foo.cpp'));

    const actions = ka.handleDidOpen(
      'file:///foo.cpp',
      didOpenParamsNoVersion('file:///foo.cpp', 'content'),
    );

    expect(actions).toHaveLength(2);
    expect(actions[0]!.type).toBe('forwardDidClose');
    expect(actions[0]!.uri).toBe('file:///foo.cpp');
    expect(actions[1]!.type).toBe('forwardDidOpen');
    expect(actions[1]!.uri).toBe('file:///foo.cpp');
    expect(ka.size).toBe(0);
  });

  // ─── 未保活的 didOpen ──────────────────────────────────────

  it('didOpen 对应 URI 不在保活中时直接转发 didOpen', () => {
    const ka = new Keepalive();

    const params = didOpenParams('file:///new.cpp', 'new file', 1);
    const actions = ka.handleDidOpen('file:///new.cpp', params);

    expect(actions).toHaveLength(1);
    expect(actions[0]!.type).toBe('forwardDidOpen');
    expect(actions[0]!.uri).toBe('file:///new.cpp');
  });

  // ─── shutdown flush ────────────────────────────────────────

  it('flush 返回所有待处理的 didClose，按插入顺序', () => {
    const ka = new Keepalive({ max: 10 });

    ka.handleDidClose('file:///a.cpp', didCloseParams('file:///a.cpp'));
    ka.handleDidClose('file:///b.cpp', didCloseParams('file:///b.cpp'));
    ka.handleDidClose('file:///c.cpp', didCloseParams('file:///c.cpp'));

    const actions = ka.flush();

    expect(actions).toHaveLength(3);
    expect(actions.map((a) => a.uri)).toEqual(['file:///a.cpp', 'file:///b.cpp', 'file:///c.cpp']);
    expect(ka.size).toBe(0);
  });

  it('flush 后保活列表为空', () => {
    const ka = new Keepalive();
    ka.handleDidClose('file:///x.cpp', didCloseParams('file:///x.cpp'));
    ka.flush();
    expect(ka.size).toBe(0);
  });

  it('flush 在部分淘汰后返回剩余条目', () => {
    const ka = new Keepalive({ max: 3 });

    ka.handleDidClose('file:///a.cpp', didCloseParams('file:///a.cpp'));
    ka.handleDidClose('file:///b.cpp', didCloseParams('file:///b.cpp'));
    ka.handleDidClose('file:///c.cpp', didCloseParams('file:///c.cpp'));

    // 淘汰 a.cpp
    ka.handleDidClose('file:///d.cpp', didCloseParams('file:///d.cpp'));

    const actions = ka.flush();
    expect(actions).toHaveLength(3);
    expect(actions.map((a) => a.uri)).toEqual(['file:///b.cpp', 'file:///c.cpp', 'file:///d.cpp']);
  });

  // ─── 边界条件 ──────────────────────────────────────────────

  it('空保活列表的 flush 返回空数组', () => {
    const ka = new Keepalive();
    const actions = ka.flush();
    expect(actions).toHaveLength(0);
  });

  it('空保活列表的 tick 返回空数组', () => {
    const ka = new Keepalive();
    vi.advanceTimersByTime(1_000_000);
    const actions = ka.tick();
    expect(actions).toHaveLength(0);
  });

  it('max=0 时每次 didClose 立即淘汰（无保活）', () => {
    const ka = new Keepalive({ max: 0 });

    const actions = ka.handleDidClose('file:///foo.cpp', didCloseParams('file:///foo.cpp'));
    // max=0，无法保活任何条目，添加后 while 循环立即淘汰并返回 forwardDidClose
    expect(actions).toHaveLength(1);
    const action = actions[0];
    assertDefined(action);
    expect(action.type).toBe('forwardDidClose');
    expect(action.uri).toBe('file:///foo.cpp');
    expect(ka.size).toBe(0);
  });

  it('不跨进程持久化保活缓存', () => {
    // 验证 Keepalive 实例不依赖外部存储
    const ka1 = new Keepalive();
    ka1.handleDidClose('file:///a.cpp', didCloseParams('file:///a.cpp'));
    expect(ka1.size).toBe(1);

    // 新实例应该为空
    const ka2 = new Keepalive();
    expect(ka2.size).toBe(0);
  });
});
