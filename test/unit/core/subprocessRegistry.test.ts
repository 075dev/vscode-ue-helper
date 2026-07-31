/**
 * subprocessRegistry.test.ts —— SubprocessRegistry 行为测试
 *
 * 覆盖：
 *   - register / unregister / size 行为
 *   - 重复 register 同一 child 是 no-op
 *   - child 自然 exit 后自动 unregister
 *   - dispose() 触发 taskkill 调用
 *   - dispose() 后 register 静默成功（不抛错）
 *   - dispose() 幂等
 *   - killAll 幂等
 *
 * 注意：subprocessRegistry 内部走 `taskkill /F /T /PID`,不实际起真实进程。
 * 用 fake child 模拟 spawn 后的 ChildProcess 对象（仅需要 pid / kill / once('exit')）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { SubprocessRegistry } from '@core/subprocessRegistry';

/**
 * 跟踪 execFile 调用的 mock 实现。
 *
 * 必须在 import SubprocessRegistry 之前 mock 掉 node:child_process,
 * 否则 registry 内部已经 import 完真实 execFile,vi.mock 不生效。
 *
 * mock 返回 ChildProcess-shaped 对象(空 EventEmitter),让 promisify(execFile)
 * 不会看到 promise 而是走 callback 路径;同步调 cb(null) 模拟 taskkill 成功。
 */
const execFileCalls: Array<{
  cmd: string;
  args: readonly string[];
}> = [];
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const { EventEmitter } = await import('node:events');
  return {
    ...actual,
    /**
     * Mock execFile:必须用 3-arity `(cmd, args, cb)`,让 `promisify` 正确识别 cb。
     *
     * 真实 `child_process.execFile` 是 `(file, args?, options?, callback?)` 多态,
     * registry 调 `execFileAsync('taskkill', [...])`(2 实参)时,promisify 注入
     * 第 3 个 cb 参数。如果 mock 写成 4-arity `(cmd, args, opts, cb)`,promisify
     * 会把注入的 cb 当作 opts 传入,cb === undefined,await 永远不 resolve。
     */
    execFile: (
      cmd: string,
      args: readonly string[],
      cb?: (err: Error | null) => void,
    ): import('node:child_process').ChildProcess => {
      execFileCalls.push({ cmd, args });
      const cp = new EventEmitter() as unknown as import('node:child_process').ChildProcess;
      if (cb) {
        // 用 microtask 异步触发 callback(避免 promisify 同步检测冲突)
        Promise.resolve().then(() => cb(null));
      }
      return cp;
    },
  };
});

/**
 * 构造 fake ChildProcess,模拟 spawn 后的最小可用对象。
 *
 * - pid: 必填(否则 register 直接 return)
 * - EventEmitter 模拟 stdin/stdout/stderr/once('exit')
 * - kill: spy,被调时记录信号名
 */
function fakeChild(pid: number): {
  child: ChildProcess;
  killSpy: ReturnType<typeof vi.fn<[], unknown>>;
  triggerExit: (code?: number) => void;
} {
  const emitter = new EventEmitter();
  const killSpy = vi.fn();
  const child = Object.assign(emitter, {
    pid,
    kill: killSpy,
    killed: false,
    exitCode: null as number | null,
  }) as unknown as ChildProcess;
  const triggerExit = (code: number | null = 0): void => {
    (child as unknown as { exitCode: number | null }).exitCode = code;
    emitter.emit('exit', code);
  };
  return { child, killSpy, triggerExit };
}

describe('SubprocessRegistry', () => {
  let registry: SubprocessRegistry;

  beforeEach(() => {
    registry = new SubprocessRegistry();
    execFileCalls.length = 0;
  });

  it('register 后 size === 1', () => {
    const { child } = fakeChild(1000);
    registry.register(child, 'UBT build');
    expect(registry.size).toBe(1);
  });

  it('重复 register 同一 child 是 no-op', () => {
    const { child } = fakeChild(1000);
    registry.register(child, 'UBT build');
    registry.register(child, 'UBT build again');
    expect(registry.size).toBe(1);
  });

  it('child 自然 exit 后自动 unregister', () => {
    const { child, triggerExit } = fakeChild(1000);
    registry.register(child, 'UBT build');
    expect(registry.size).toBe(1);
    triggerExit(0);
    expect(registry.size).toBe(0);
  });

  it('unregister 后 size === 0', () => {
    const { child } = fakeChild(1000);
    registry.register(child, 'UBT build');
    registry.unregister(child);
    expect(registry.size).toBe(0);
  });

  it('unregister 未注册的 child 是 no-op', () => {
    const { child } = fakeChild(1000);
    expect(() => registry.unregister(child)).not.toThrow();
    expect(registry.size).toBe(0);
  });

  it('dispose() 触发 taskkill 调用 taskkill /F /T /PID', async () => {
    const { child, triggerExit } = fakeChild(1000);
    registry.register(child, 'UBT build');
    // dispose 是 fire-and-forget,内部走 void killAll().catch(...)
    registry.dispose();
    // 触发 child exit,让 SIGKILL 升级路径走不到(因为 child 已退)
    triggerExit(0);
    // 等微任务队列把 taskkill promise 跑完
    await new Promise((r) => setTimeout(r, 30));
    // 至少有一次 execFile('taskkill', ['/F', '/T', '/PID', '1000'])
    const taskkillCall = execFileCalls.find(
      (c) => c.cmd === 'taskkill' && c.args[0] === '/F' && c.args[1] === '/T',
    );
    expect(taskkillCall).toBeDefined();
    expect(taskkillCall?.args).toEqual(['/F', '/T', '/PID', '1000']);
  });

  it('dispose() 幂等', () => {
    expect(() => {
      registry.dispose();
      registry.dispose();
      registry.dispose();
    }).not.toThrow();
  });

  it('dispose() 后 register 静默成功(不抛错)', () => {
    registry.dispose();
    const { child } = fakeChild(2000);
    expect(() => registry.register(child, 'after dispose')).not.toThrow();
    // dispose 后 register 是 no-op,size 仍是 0
    expect(registry.size).toBe(0);
  });

  it('killAll 幂等', async () => {
    const { child, triggerExit } = fakeChild(1000);
    registry.register(child, 'UBT build');
    // 关键:必须**在调用 killAll 之前**让 fake child 同步已"退出"，
    // 否则 killWithEscalation 会等 3s 升级 SIGKILL,测试超时。
    Object.defineProperty(child, 'exitCode', {
      value: 0,
      configurable: true,
    });
    // 第一次 killAll:走完所有 taskkill(hasExited 第一次检测就 return,不进入 3s 等)
    await registry.killAll();
    // 此时 child 已被杀,补触发 exit 事件让 registry 内部 unregister
    triggerExit(0);
    // 等 microtask 让 unregister listener 跑完
    await new Promise((r) => setImmediate(r));
    const callsAfterFirst = execFileCalls.length;
    // 第二次 killAll:幂等,无新增调用
    await registry.killAll();
    expect(execFileCalls.length).toBe(callsAfterFirst);
  });

  it('PID 缺失的 child 不被注册(罕见边界)', () => {
    const { child } = fakeChild(0);
    // fakeChild 用 0 模拟,但我们需要 undefined
    Object.defineProperty(child, 'pid', { value: undefined, configurable: true });
    registry.register(child, 'no-pid child');
    expect(registry.size).toBe(0);
  });
});
