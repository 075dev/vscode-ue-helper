/**
 * buildRunner 测试 —— SubprocessRegistry 兜底路径 (P1 集成测试)
 *
 * ## 背景
 *
 * `buildRunner.runBuild()` 启动 UBT 编译时,有两种"取消"路径:
 *   1. **主路径**:调用方传 `AbortSignal`,buildRunner 监听 abort 调 `killTree(child)`。
 *   2. **兜底路径**:调用方没传 signal(例如某个命令层忘了传),插件 deactivate 时
 *      `sharedSubprocessRegistry.killAll()` 会兜底杀掉所有已注册的 child。
 *
 * 注册代码在 `src/build/buildRunner.ts:71` —— `spawn` 后立刻
 * `registry.register(child, 'UBT build')`。
 *
 * 本测试覆盖 **兜底路径**:
 *   - 注入 fresh `SubprocessRegistry`(避免与 `subprocessRegistry.test.ts` 共享单例状态)
 *   - 调用方不传 signal(`options.signal === undefined`)
 *   - `runBuild` 跑出 fake child
 *   - 验证 fresh registry 拿到这个 child
 *   - 调 `killAll()` 验证 fake child 被杀(走 taskkill /F /T)
 *
 * 关键:必须用 `vi.mock('node:child_process', ...)` 顶层 hoist,这样 `buildRunner`
 * 内部 import 到的就是 mock spawn。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { runBuild } from '@build/buildRunner';
import { SubprocessRegistry } from '@core/subprocessRegistry';

const spawnCalls: Array<{
  cmd: string;
  args: readonly string[];
  opts?: Record<string, unknown>;
}> = [];
// [F2-1/F2-3] 记录 mock spawn 返回的 child,便于测试手动 emit 'close' 模拟进程退出
const spawnedChildren: ChildProcessWithoutNullStreams[] = [];
const execFileCalls: Array<{ cmd: string; args: readonly string[] }> = [];

vi.mock('node:child_process', async () => {
  const actual =
    await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const { EventEmitter: EE } = await import('node:events');
  return {
    ...actual,
    spawn: (
      cmd: string,
      args: readonly string[],
      opts?: unknown,
    ): ChildProcessWithoutNullStreams => {
      spawnCalls.push({ cmd, args, opts: opts as Record<string, unknown> | undefined });
      const emitter = new EE() as unknown as ChildProcessWithoutNullStreams;
      spawnedChildren.push(emitter);
      // 模拟 spawn 后立刻有 PID
      Object.defineProperty(emitter, 'pid', { value: 54321, configurable: true });
      Object.defineProperty(emitter, 'stdout', { value: emitter, configurable: true });
      Object.defineProperty(emitter, 'stderr', { value: emitter, configurable: true });
      Object.defineProperty(emitter, 'stdio', {
        value: [null, emitter, emitter, null],
        configurable: true,
      });
      Object.defineProperty(emitter, 'exitCode', { value: null, configurable: true });
      Object.defineProperty(emitter, 'killed', { value: false, configurable: true });
      Object.defineProperty(emitter, 'kill', {
        value: vi.fn().mockReturnValue(true),
        configurable: true,
      });
      return emitter;
    },
    execFile: (
      cmd: string,
      args: readonly string[],
      cb?: (err: Error | null) => void,
    ): import('node:child_process').ChildProcess => {
      execFileCalls.push({ cmd, args });
      const cp = new EE() as unknown as import('node:child_process').ChildProcess;
      if (cb) {
        // 用 microtask 异步触发 callback;void 标记有意忽略返回的 Promise
        void Promise.resolve().then(() => cb(null));
      }
      return cp;
    },
  };
});

describe('buildRunner SubprocessRegistry 兜底 (P1 集成)', () => {
  let registry: SubprocessRegistry;

  beforeEach(() => {
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    execFileCalls.length = 0;
    // 用 fresh registry 避免与 subprocessRegistry.test.ts 共享单例状态
    registry = new SubprocessRegistry();
  });

  afterEach(async () => {
    // 清理:让所有残留 child "exit" 触发 unregister
    if (registry.size > 0) {
      await registry.killAll();
    }
  });

  it('调用方不传 signal 时,子进程被注册到传入的 registry (兜底路径)', async () => {
    // race 防止 buildRunner 的 Promise 挂死 (fake child 永远不会自然 close)
    const resultPromise = runBuild(
      {
        file: 'D:/fake/RunUBT.bat',
        args: ['-Target=MyGame Win64 Development -Project=D:/fake/MyGame.uproject'],
      },
      // 不传 signal —— 兜底路径的入口条件
      {},
      registry,
    );

    // 等 microtask 让 spawn + register 跑完
    await new Promise((r) => setTimeout(r, 5));

    // 关键断言 1:spawn 已被调
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0]?.cmd).toBe('cmd.exe'); // .bat 包装成 cmd.exe /c

    // 关键断言 2:registry 拿到了这个 child (size === 1)
    // —— 这是兜底路径的核心证据:AbortSignal 没传也注册到 registry
    expect(registry.size).toBe(1);

    // 不 await resultPromise —— fake child 永远不会 close,race 后让 test 继续
    void Promise.race([
      resultPromise,
      new Promise((r) => setTimeout(r, 10)),
    ]);
  });

  it('引擎与项目路径均含空格时,cmd /s /c 单引号包裹整条命令并开 windowsVerbatimArguments (F1-1)', async () => {
    // 引擎路径与项目路径都含空格是 UE 最常见布局,F1-1 回归用例
    const resultPromise = runBuild(
      {
        file: 'D:/Epic Games/UE_5.2/Engine/Build/BatchFiles/RunUBT.bat',
        args: [
          'Win64 Development',
          '-Project="D:/My Game Project/MyGame.uproject"',
        ],
      },
      {},
      registry,
    );

    await new Promise((r) => setTimeout(r, 5));

    // 断言 spawn 包装形态:cmd.exe + ['/d','/s','/c','"<完整命令>"']
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0]?.cmd).toBe('cmd.exe');
    expect(spawnCalls[0]?.args).toEqual([
      '/d',
      '/s',
      '/c',
      '""D:/Epic Games/UE_5.2/Engine/Build/BatchFiles/RunUBT.bat" Win64 Development -Project="D:/My Game Project/MyGame.uproject""',
    ]);
    // shell 脚本路径必须开 windowsVerbatimArguments,禁止 Node 二次加引号
    expect(spawnCalls[0]?.opts?.windowsVerbatimArguments).toBe(true);

    void Promise.race([
      resultPromise,
      new Promise((r) => setTimeout(r, 10)),
    ]);
  });

  it('调 registry.killAll() 会杀已注册的 UBT child (兜底生效)', async () => {
    const resultPromise = runBuild(
      {
        file: 'D:/fake/RunUBT.bat',
        args: ['-Target=MyGame Win64 Development -Project=D:/fake/MyGame.uproject'],
      },
      {},
      registry,
    );

    await new Promise((r) => setTimeout(r, 5));
    expect(registry.size).toBe(1);

    // 模拟 deactivate 场景:调 killAll 兜底杀
    // fake child 的 exitCode 已被 mock 为 null,所以会走完整升级流程
    // (taskkill /F /T → 3s → taskkill /F,但我们不会真等 3s,只验证第一刀被调)
    const killPromise = registry.killAll();
    // 让第一刀 taskkill 跑完
    await new Promise((r) => setTimeout(r, 10));

    // 关键断言:taskkill 已被调 (兜底路径触发了真实的杀进程命令)
    const taskkillCalls = execFileCalls.filter(
      (c) => c.cmd === 'taskkill' && c.args[0] === '/F' && c.args[1] === '/T',
    );
    expect(taskkillCalls.length).toBeGreaterThanOrEqual(1);
    // PID 54321 是我们 mock spawn 时 hardcode 的 pid
    const matchingCall = taskkillCalls.find((c) => c.args[3] === '54321');
    expect(matchingCall).toBeDefined();

    // killAll 是 fire-and-forget 的 killWithEscalation 在等 3s 升级,我们不等
    // 让 buildRunner 的 Promise 别挂死
    void resultPromise;
    void killPromise;
  });

  it('AbortSignal 路径与 registry 路径同时生效 (signal abort + registry 双保险)', async () => {
    // 传 AbortSignal:这是主路径,registry 是双保险
    const ac = new AbortController();
    const resultPromise = runBuild(
      {
        file: 'D:/fake/RunUBT.bat',
        args: ['-Target=MyGame Win64 Development -Project=D:/fake/MyGame.uproject'],
      },
      { signal: ac.signal },
      registry,
    );

    await new Promise((r) => setTimeout(r, 5));
    expect(registry.size).toBe(1);

    // 调 AbortSignal.abort():buildRunner 内部 onAbort 调 killTree(child)
    ac.abort();

    // 让 microtask 跑完
    await new Promise((r) => setTimeout(r, 30));

    // 关键断言:taskkill 已被调 (主路径)
    const taskkillCalls = execFileCalls.filter(
      (c) => c.cmd === 'taskkill' && c.args[0] === '/F' && c.args[1] === '/T',
    );
    expect(taskkillCalls.length).toBeGreaterThanOrEqual(1);

    void resultPromise;
  });

  it('abort 后 close 结果标记 cancelled=true,不再被误报为构建失败 (F2-1)', async () => {
    const ac = new AbortController();
    const resultPromise = runBuild(
      {
        file: 'D:/fake/RunUBT.bat',
        args: ['-Target=MyGame Win64 Development -Project=D:/fake/MyGame.uproject'],
      },
      { signal: ac.signal },
      registry,
    );

    await new Promise((r) => setTimeout(r, 5));
    expect(spawnCalls.length).toBe(1);

    // 用户取消:onAbort → killTree (taskkill /F /T)
    ac.abort();
    await new Promise((r) => setTimeout(r, 10));

    // taskkill 杀树后 child 退出,close 到达 (模拟非 0 exitCode)
    const child = spawnedChildren[0];
    if (!child) {
      throw new Error('fake child not spawned');
    }
    child.emit('close', 1);

    const result = await resultPromise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      // [F2-1] 核心断言:取消路径必须带 cancelled=true
      expect(result.value.cancelled).toBe(true);
      expect(result.value.exitCode).toBe(1);
    }
  });

  it('close 后 abort 监听器被移除,再 abort 不再触发 taskkill (F2-3 防泄漏)', async () => {
    const ac = new AbortController();
    const resultPromise = runBuild(
      {
        file: 'D:/fake/RunUBT.bat',
        args: ['-Target=MyGame Win64 Development -Project=D:/fake/MyGame.uproject'],
      },
      { signal: ac.signal },
      registry,
    );

    await new Promise((r) => setTimeout(r, 5));
    expect(spawnCalls.length).toBe(1);

    // 进程正常结束 (exitCode 0,未 abort)
    const child = spawnedChildren[0];
    if (!child) {
      throw new Error('fake child not spawned');
    }
    child.emit('close', 0);

    const result = await resultPromise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cancelled).toBe(false);
      expect(result.value.exitCode).toBe(0);
    }

    // [F2-3] close 后 abort 监听器已被 removeEventListener:
    // 记录当前 taskkill 次数,再 abort,次数不应增加
    const before = execFileCalls.filter((c) => c.cmd === 'taskkill').length;
    ac.abort();
    await new Promise((r) => setTimeout(r, 10));
    const after = execFileCalls.filter((c) => c.cmd === 'taskkill').length;
    expect(after).toBe(before);
  });

  it('重复 runBuild 调用各自注册到同一 registry (multi-build 场景)', async () => {
    // 启动两个"并发"编译,都注册到同一 registry
    const p1 = runBuild(
      {
        file: 'D:/fake/RunUBT.bat',
        args: ['-Target=MyGame1 Win64 Development -Project=D:/fake/M1.uproject'],
      },
      {},
      registry,
    );
    const p2 = runBuild(
      {
        file: 'D:/fake/RunUBT.bat',
        args: ['-Target=MyGame2 Win64 Development -Project=D:/fake/M2.uproject'],
      },
      {},
      registry,
    );

    await new Promise((r) => setTimeout(r, 5));

    // 两个 child 都被注册
    expect(registry.size).toBe(2);
    expect(spawnCalls.length).toBe(2);

    // killAll 会同时杀两个
    const killPromise = registry.killAll();
    await new Promise((r) => setTimeout(r, 10));

    const taskkillPids = execFileCalls
      .filter((c) => c.cmd === 'taskkill' && c.args[0] === '/F' && c.args[1] === '/T')
      .map((c) => c.args[3]);
    // 我们 mock spawn 都返回 pid 54321,所以两次杀都是 54321
    // 关键是 taskkill 至少被调了 1 次 (multi-build 时至少 1 个)
    expect(taskkillPids.length).toBeGreaterThanOrEqual(1);

    void p1;
    void p2;
    void killPromise;
  });
});
