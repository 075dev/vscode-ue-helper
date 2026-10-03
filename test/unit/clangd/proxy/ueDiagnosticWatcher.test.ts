/**
 * ueDiagnosticWatcher 测试 —— 验证 UBT 参数白名单校验（T5.2）
 *
 * buildTargetName 与 projectFile 在 runUbt() 中被拼入 `-Target=...` argv，传给 dotnet → UBT。
 * UBT 的 ParseCommandLine 会按空格分割含空格的 argv；如果 buildTargetName 含 shell
 * metacharacter 或控制字符，可能导致 UBT 解析错乱（即便 spawn 用 array 形式不让 shell 执行，
 * 仍会让 UBT 误读参数）。
 *
 * 白名单 `[\w./\\:-]` 确保：
 * - 只允许字母数字下划线（合法 UE target/project 名）
 * - 路径分隔符 `/`、`\`（uproject 路径）
 * - `:`（Windows 盘符）
 * - `.`（文件扩展符）
 *
 * + 回归测试 `dispose()` 杀掉 in-flight UBT 子进程 (P0 修复)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Logger } from '@core/logger';
import {
  UeDiagnosticWatcher,
  validateUbtArgs,
  UBTArgsValidationError,
} from '@clangd/proxy/ueDiagnosticWatcher';
import type { LspBridge } from '@clangd/proxy/bridge';

/**
 * 测试注入 private 字段 currentUbtChild 用的类型。
 * 避免 `as any` 触发 no-unsafe-member-access。
 */
type UbtChildInjection = { currentUbtChild: ChildProcessWithoutNullStreams | null };

/**
 * 跟踪 execFile 调用的 mock 实现。
 *
 * vi.mock 必须在文件顶层(import 之前)声明,vitest 才会把它 hoist 到所有 import 之上,
 * 让 ueDiagnosticWatcher 模块加载时拿到 mock 版本的 execFile。如果写在 describe 内
 * 块级作用域,vitest 不会 hoist,模块已经 import 完真实 execFile,mock 不生效。
 */
const execFileCalls: Array<{ cmd: string; args: readonly string[] }> = [];
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const { EventEmitter: EE } = await import('node:events');
  return {
    ...actual,
    // 3-arity (cmd, args, cb):必须如此,让 util.promisify 正确识别 callback。
    // 4-arity 会被 promisify 误判 cb === undefined,await 永不 resolve。
    execFile: (
      cmd: string,
      args: readonly string[],
      cb?: (err: Error | null) => void,
    ): import('node:child_process').ChildProcess => {
      execFileCalls.push({ cmd, args });
      const cp = new EE() as unknown as import('node:child_process').ChildProcess;
      if (cb) {
        void Promise.resolve().then(() => cb(null));
      }
      return cp;
    },
  };
});

describe('validateUbtArgs (T5.2)', () => {
  it('accepts plain UE target name', () => {
    expect(() => validateUbtArgs('MyProjectEditor', 'C:/path/to/MyProject.uproject')).not.toThrow();
  });

  it('accepts target with underscore and digits', () => {
    expect(() => validateUbtArgs('XianDreamwalking_Editor_v2', '/tmp/x.uproject')).not.toThrow();
  });

  it('accepts Windows path with drive letter', () => {
    expect(() => validateUbtArgs('Foo', 'D:\\GameProj\\Game.uproject')).not.toThrow();
  });

  it('rejects target with shell metacharacter &', () => {
    expect(() => validateUbtArgs('MyTarget&rm -rf /', 'C:/x.uproject')).toThrow(
      UBTArgsValidationError,
    );
  });

  it('rejects target with shell pipe |', () => {
    expect(() => validateUbtArgs('MyTarget|cat /etc/passwd', 'C:/x.uproject')).toThrow(
      UBTArgsValidationError,
    );
  });

  it('rejects target with command substitution $()', () => {
    expect(() => validateUbtArgs('MyTarget$(whoami)', 'C:/x.uproject')).toThrow(
      UBTArgsValidationError,
    );
  });

  it('rejects target with backticks (command substitution)', () => {
    expect(() => validateUbtArgs('MyTarget`whoami`', 'C:/x.uproject')).toThrow(
      UBTArgsValidationError,
    );
  });

  it('rejects target with newline (argv injection)', () => {
    expect(() => validateUbtArgs('MyTarget\n--injected-flag', 'C:/x.uproject')).toThrow(
      UBTArgsValidationError,
    );
  });

  it('rejects target with quote characters', () => {
    expect(() => validateUbtArgs('MyTarget"--inject', 'C:/x.uproject')).toThrow(
      UBTArgsValidationError,
    );
  });

  it('rejects projectFile with shell metacharacter', () => {
    expect(() => validateUbtArgs('Good', '/tmp/x.uproject;rm')).toThrow(UBTArgsValidationError);
  });

  it('rejects empty buildTargetName', () => {
    expect(() => validateUbtArgs('', 'C:/x.uproject')).toThrow(UBTArgsValidationError);
  });

  it('rejects empty projectFile', () => {
    expect(() => validateUbtArgs('Good', '')).toThrow(UBTArgsValidationError);
  });

  it('error message includes the offending field name', () => {
    try {
      validateUbtArgs('Bad&', 'C:/x.uproject');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UBTArgsValidationError);
      expect((err as UBTArgsValidationError).message).toMatch(/buildTargetName/);
    }
  });
});

/**
 * dispose 杀 UBT 子进程 (P0 修复回归)
 *
 ## 背景
 *
 - 之前 `ueDiagnosticWatcher.dispose()` 只 dispose chokidar watcher,**UBT 子进程漏到外部变孤儿**:
 *   VS Code 卸载/重载插件时,正在跑的 UBT 编译没人杀,残留到下次启动污染状态。
 * - 修复:`dispose()` 调本地 `killUbtTree()` 走 `taskkill /F /T /PID <pid>` 杀进程树。
 *
 ## 验证策略
 *
 - 用 fake `LspBridge` (只用作 type,本测试不调它的方法)
 * - 用 `Object.defineProperty` 注入 fake `currentUbtChild`(private 字段,模拟 runUbt 之后的状态)
 * - mock `node:child_process.execFile` 让 taskkill 不真起进程,记录调用
 * - 调 `dispose()`,验证 execFile 被调且参数是 `taskkill /F /T /PID <pid>`
 */
describe('UeDiagnosticWatcher.dispose() kills in-flight UBT child (P0 regression)', () => {
  beforeEach(() => {
    execFileCalls.length = 0;
  });

  function makeFakeBridge(): LspBridge {
    // 只用作 type,dispose 测试不调 bridge 方法
    return {} as LspBridge;
  }

  function makeWatcher(): UeDiagnosticWatcher {
    return new UeDiagnosticWatcher(makeFakeBridge(), new Logger('ue-dw-test'), {
      projectDir: 'D:/proj/MyGame',
      engineRoot: 'D:/UE_5.5',
      ubtPath: 'D:/UE_5.5/Engine/Build/BatchFiles/RunUBT.bat',
      buildTargetName: 'MyGameEditor',
    });
  }

  function makeFakeUbtChild(pid: number): ChildProcessWithoutNullStreams {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
      pid,
      stdout: emitter,
      stderr: emitter,
      stdio: [null, emitter, emitter, null] as const,
      killed: false,
      exitCode: null as number | null,
      kill: vi.fn().mockReturnValue(true),
    }) as unknown as ChildProcessWithoutNullStreams;
  }

  it('dispose() 在 currentUbtChild 非空时调 taskkill /F /T /PID', async () => {
    const watcher = makeWatcher();
    const fakeChild = makeFakeUbtChild(12345);

    // 注入 private 字段(模拟 runUbt() spawn 后赋值的状态)
    (watcher as unknown as UbtChildInjection).currentUbtChild = fakeChild;

    // 调 dispose (fire-and-forget: 内部 void killUbtTree().catch(...))
    watcher.dispose();

    // 等微任务让 killUbtTree 的 execFileAsync 跑完
    await new Promise((r) => setTimeout(r, 30));

    // 验证:execFile 被调,参数是 taskkill /F /T /PID <pid>
    const taskkillCalls = execFileCalls.filter((c) => c.cmd === 'taskkill');
    expect(taskkillCalls.length).toBeGreaterThanOrEqual(1);
    // 第一刀必须是优雅版本(走进程树 /T)
    const graceful = taskkillCalls.find(
      (c) => c.args[0] === '/F' && c.args[1] === '/T' && c.args[2] === '/PID',
    );
    expect(graceful).toBeDefined();
    expect(graceful?.args).toEqual(['/F', '/T', '/PID', '12345']);
  });

  it('dispose() 后 currentUbtChild 被清空(防止重复杀)', () => {
    const watcher = makeWatcher();
    const fakeChild = makeFakeUbtChild(99999);
    (watcher as unknown as UbtChildInjection).currentUbtChild = fakeChild;

    watcher.dispose();

    // 同步断言:dispose() 内部已把 currentUbtChild 置 null
    // (killUbtTree 异步,但字段同步清空)
    expect((watcher as unknown as UbtChildInjection).currentUbtChild).toBeNull();
  });

  it('dispose() 在 currentUbtChild 为 null 时不调 taskkill(无 child 不杀)', () => {
    const watcher = makeWatcher();
    // 不注入 currentUbtChild,默认就是 null
    watcher.dispose();

    // 验证:没有 taskkill 调用
    const taskkillCalls = execFileCalls.filter((c) => c.cmd === 'taskkill');
    expect(taskkillCalls.length).toBe(0);
  });

  it('dispose() 幂等:重复调用只杀一次', async () => {
    const watcher = makeWatcher();
    const fakeChild = makeFakeUbtChild(55555);
    (watcher as unknown as UbtChildInjection).currentUbtChild = fakeChild;

    watcher.dispose();
    // 第二次 dispose:currentUbtChild 已被同步清空,内部 if (this.currentUbtChild) 直接跳过
    watcher.dispose();

    await new Promise((r) => setTimeout(r, 30));

    // 验证:只杀一次(graceful taskkill 调用恰好 1 次)
    const graceful = execFileCalls.filter(
      (c) => c.cmd === 'taskkill' && c.args[0] === '/F' && c.args[1] === '/T',
    );
    expect(graceful.length).toBe(1);
  });
});
