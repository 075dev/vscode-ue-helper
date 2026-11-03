/**
 * launchEditor 测试 —— [D13] 去掉 cmd /c start 的 cmd 元字符截断
 *
 * ## 背景
 *
 * 旧实现:`spawn('cmd', ['/c','start','""', editorPath, ...args])`。
 * Node 只对**含空格**的参数加引号,其余原样交给 cmd.exe 解析 —— 路径里的
 * `&` `|` `^` `%` 会被 cmd 当作命令分隔符/元字符:
 *
 *   D:\R&D\My.uproject   → cmd 只看到 "D:\R",后面被当成新命令
 *   D:\a|b\My.uproject   → 同理被截断
 *   D:\R&D Folder\...    → 含空格反而被 Node 加了引号,安全
 *
 * 研发目录(如 D:\R&D)很常见,这条路径下编辑器永远起不来,而且旧实现是
 * fire-and-forget,spawn 失败被静默吞掉,用户只看到 "launched" 成功提示。
 *
 * 覆盖:
 *   - 直接 spawn .exe,不经过 cmd.exe
 *   - 含空格 / 含 & / 含 | 的工程路径原样传递
 *   - spawn 'error' 事件 → Promise reject(不再静默吞掉)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

const spawnCalls: Array<{
  cmd: string;
  args: readonly string[];
  opts?: Record<string, unknown>;
}> = [];
/** mock spawn 返回的子进程句柄,供用例手动 emit 'error' */
const spawnedChildren: EventEmitter[] = [];

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: (
      cmd: string,
      args: readonly string[],
      opts?: unknown,
    ): import('node:child_process').ChildProcess => {
      spawnCalls.push({ cmd, args, opts: opts as Record<string, unknown> | undefined });
      const emitter = new EventEmitter() as unknown as import('node:child_process').ChildProcess;
      spawnedChildren.push(emitter);
      Object.defineProperty(emitter, 'pid', { value: 4242, configurable: true });
      Object.defineProperty(emitter, 'unref', {
        value: vi.fn(),
        configurable: true,
      });
      return emitter;
    },
  };
});

import { launchEditor } from '@build/launchEditor';

describe('launchEditor —— [D13] 不经 cmd.exe 启动', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const engineRoot = 'E:\\UE_5.3';
  const expectedEditor = path.join(engineRoot, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');

  it('直接 spawn UnrealEditor.exe,不经过 cmd.exe', async () => {
    const promise = launchEditor({
      engineRoot,
      platform: 'Win64',
      projectPath: 'D:\\MyGame\\MyGame.uproject',
    });
    await vi.advanceTimersByTimeAsync(600);
    await promise;

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.cmd).toBe(expectedEditor);
    // 关键:命令不是 cmd.exe
    expect(spawnCalls[0]!.cmd).not.toBe('cmd');
    expect(spawnCalls[0]!.cmd).not.toContain('cmd.exe');
  });

  it('工程路径含 & 时原样传递,不被拆词', async () => {
    const projectPath = 'D:\\R&D\\MyGame.uproject';
    const promise = launchEditor({ engineRoot, platform: 'Win64', projectPath });
    await vi.advanceTimersByTimeAsync(600);
    await promise;

    expect(spawnCalls[0]!.args).toEqual([projectPath]);
    expect(spawnCalls[0]!.args[0]).toBe('D:\\R&D\\MyGame.uproject');
  });

  it('工程路径含空格时原样传递', async () => {
    const projectPath = 'D:\\R&D Folder\\MyGame.uproject';
    const promise = launchEditor({ engineRoot, platform: 'Win64', projectPath });
    await vi.advanceTimersByTimeAsync(600);
    await promise;

    expect(spawnCalls[0]!.args).toEqual([projectPath]);
  });

  it('工程路径含 | 时原样传递', async () => {
    const projectPath = 'D:\\a|b\\MyGame.uproject';
    const promise = launchEditor({ engineRoot, platform: 'Win64', projectPath });
    await vi.advanceTimersByTimeAsync(600);
    await promise;

    expect(spawnCalls[0]!.args).toEqual([projectPath]);
  });

  it('extraArgs 追加在工程路径之后', async () => {
    const promise = launchEditor({
      engineRoot,
      platform: 'Win64',
      projectPath: 'D:\\MyGame\\MyGame.uproject',
      extraArgs: ['-game'],
    });
    await vi.advanceTimersByTimeAsync(600);
    await promise;

    expect(spawnCalls[0]!.args).toEqual(['D:\\MyGame\\MyGame.uproject', '-game']);
  });

  it('spawn 失败(error 事件)→ Promise reject,不再静默吞掉', async () => {
    const promise = launchEditor({
      engineRoot,
      platform: 'Win64',
      projectPath: 'D:\\MyGame\\MyGame.uproject',
    });
    // 模拟 OS 拒绝执行(路径不存在 / 权限不足)
    spawnedChildren[0]!.emit('error', new Error('ENOENT: UnrealEditor.exe not found'));

    await expect(promise).rejects.toThrow(/ENOENT/);
  });

  it('spawn 失败时不会 resolve —— 调用方能拿到失败而不是假成功', async () => {
    let settled = 'pending';
    const promise = launchEditor({
      engineRoot,
      platform: 'Win64',
      projectPath: 'D:\\MyGame\\MyGame.uproject',
    }).then(
      () => {
        settled = 'resolved';
      },
      () => {
        settled = 'rejected';
      },
    );
    spawnedChildren[0]!.emit('error', new Error('EACCES'));
    await vi.advanceTimersByTimeAsync(600);
    await promise;

    expect(settled).toBe('rejected');
  });
});
