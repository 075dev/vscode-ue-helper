/**
 * task.test.ts —— UBT 参数构造 + Shell quoting 纯函数单测
 *
 * TDD: task 子模块拆出后立即补测试，验证拆分不破坏既有行为契约。
 *
 * 覆盖范围：
 *   - getShellQuoting: Windows Strong 引用（本插件仅支持 Windows）
 *   - buildNativeArgs: 返回 5 个固定参数（-projectfiles 路径）
 *   - buildNonNativeArgs: 完整参数序列（含 -NoExecCodeGenActions）
 *   - buildNonNativeArgs: Source 缺 Target.cs 抛错
 *   - buildNonNativeArgs: architecture / buildType / platform 可选字段传递
 *   - [F2-9] executeShellTask: abort 终止 UBT 任务 + 5 分钟超时兜底
 *
 * 显式跳过（依赖 child_process 或真实 Task system）：
 *   - findClangToolchain
 *   - isClangdAvailable
 *
 * Mock 策略：用 vi.mock 替换 ueHelpers.getBuildTargetNames（避免 fs 扫描），
 * 用文件级 vi.mock('vscode') 覆盖 tasks API（executeTask / onDidEndTaskProcess /
 * taskExecutions）用于 executeShellTask 的 abort / 超时路径测试。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 在 import 之前 mock: ueHelpers.getBuildTargetNames 改为可控 vi.fn
vi.mock('@clangd/ueHelpers', async () => {
  const actual = await vi.importActual<typeof import('@clangd/ueHelpers')>('@clangd/ueHelpers');
  return {
    ...actual,
    getBuildTargetNames: vi.fn(),
  };
});

// [F2-9] executeShellTask 测试用 vscode mock：
// 覆盖 workspace.getWorkspaceFolder / tasks.executeTask / tasks.onDidEndTaskProcess /
// tasks.taskExecutions / Task / ShellExecution / ShellQuoting / TaskGroup / Uri。
// 本文件级 mock 会覆盖 test/unit/setup.ts 的全局 vscode mock。
vi.mock('vscode', () => ({
  workspace: {
    getWorkspaceFolder: vi.fn(() => ({ name: 'proj', index: 0, uri: { fsPath: '/proj' } })),
  },
  tasks: {
    executeTask: vi.fn(),
    onDidEndTaskProcess: vi.fn(() => ({ dispose: vi.fn() })),
    // 可变的 execution 列表（abort 兜底路径扫描用）
    taskExecutions: [] as unknown[],
  },
  Task: class {},
  ShellExecution: class {},
  ShellQuoting: { Strong: 'strong', Weak: 'weak' },
  TaskGroup: { Build: 'build' },
  Uri: { file: (p: string) => ({ fsPath: p, path: p, scheme: 'file' }) },
}));

import * as vscode from 'vscode';
import {
  getShellQuoting,
  buildNativeArgs,
  buildNonNativeArgs,
  executeShellTask,
  type BuildArgsOptions,
} from '@clangd/compileCommands/task';
import { getBuildTargetNames } from '@clangd/ueHelpers';
import type { Logger } from '@core/logger';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeLogger(): Logger {
  const noop = (): void => {};
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
  } as unknown as Logger;
}

/** 反复 flush 微任务直到全部 settle（executeTask 的 .then 回调依赖微任务）。 */
async function flushMicrotasks(max = 20): Promise<void> {
  for (let i = 0; i < max; i++) {
    await Promise.resolve();
  }
}

describe('getShellQuoting (Shell quoting 规则)', () => {
  it('Windows: command 用 Strong 引用，所有 args 也用 Strong', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    try {
      const result = getShellQuoting('cmd.exe', ['arg with space', 'simple']);
      expect(result.command).toEqual({ value: 'cmd.exe', quoting: 'strong' });
      expect(result.args).toEqual([
        { value: 'arg with space', quoting: 'strong' },
        { value: 'simple', quoting: 'strong' },
      ]);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  // 注：原"Unix (Linux/Mac) Weak 引用"两条 case 已删除——本插件仅支持 Windows，
  //      getShellQuoting 永远走 Strong 引用路径。N2 死代码清理后失去意义。
});

describe('buildNativeArgs (Native -projectfiles 路径)', () => {
  it('返回固定 5 个参数', () => {
    const args = buildNativeArgs({ project: '/proj/MyProj.uproject' });
    expect(args).toEqual([
      '-projectfiles',
      '-project=/proj/MyProj.uproject',
      '-game',
      '-engine',
      '-dotnet',
    ]);
  });

  it('project 路径含空格原样保留（引号由调用方负责）', () => {
    const args = buildNativeArgs({ project: '/My Project/MyProj.uproject' });
    expect(args).toContain('-project=/My Project/MyProj.uproject');
  });
});

describe('buildNonNativeArgs (GenerateClangDatabase 路径)', () => {
  it('完整构造: target + platform + buildType + project + -Mode=GenerateClangDatabase + -NoExecCodeGenActions', async () => {
    vi.mocked(getBuildTargetNames).mockResolvedValue(['MyProjEditor']);
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    try {
      const args = await buildNonNativeArgs({
        project: 'C:/proj/MyProj.uproject',
        engineRoot: 'C:/UE',
      });

      expect(args).toEqual([
        'MyProjEditor',
        'Win64', // getUnrealPlatform('win32') = 'Win64'
        'Development',
        'C:/proj/MyProj.uproject',
        '-Mode=GenerateClangDatabase',
        '-NoExecCodeGenActions',
      ]);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('Source 缺 Target.cs 时抛明确错误', async () => {
    vi.mocked(getBuildTargetNames).mockResolvedValue([]);

    await expect(
      buildNonNativeArgs({
        project: 'C:/proj/MyProj.uproject',
        engineRoot: 'C:/UE',
      }),
    ).rejects.toThrow(/No \*\.Target\.cs files found/);
  });

  it('architecture 提供时附加 -architecture=<arch> (位置: 在 -Mode=GenerateClangDatabase 之后，在 -NoExecCodeGenActions 之前)', async () => {
    vi.mocked(getBuildTargetNames).mockResolvedValue(['T']);
    const args = await buildNonNativeArgs({
      project: 'C:/proj/MyProj.uproject',
      engineRoot: 'C:/UE',
      architecture: 'arm64',
    });

    expect(args).toContain('-architecture=arm64');
    const archIdx = args.indexOf('-architecture=arm64');
    const modeIdx = args.indexOf('-Mode=GenerateClangDatabase');
    const noExecIdx = args.indexOf('-NoExecCodeGenActions');
    // 原代码顺序为: target / platform / buildType / project / -Mode=... / -architecture=... / -NoExecCodeGenActions
    expect(modeIdx).toBeLessThan(archIdx);
    expect(archIdx).toBeLessThan(noExecIdx);
  });

  it('buildType 自定义能正确传递（联动 config.configuration）', async () => {
    vi.mocked(getBuildTargetNames).mockResolvedValue(['T']);
    const args = await buildNonNativeArgs({
      project: '/x/y.uproject',
      engineRoot: '/UE',
      buildType: 'DebugGame',
    });
    expect(args).toContain('DebugGame');
  });

  it('platform 自定义优先于 process.platform 检测', async () => {
    vi.mocked(getBuildTargetNames).mockResolvedValue(['T']);
    const args = await buildNonNativeArgs({
      project: '/x/y.uproject',
      engineRoot: '/UE',
      platform: 'Linux',
    });
    expect(args).toContain('Linux');
  });

  it('architecture 缺省时不附加 -architecture= 标志', async () => {
    vi.mocked(getBuildTargetNames).mockResolvedValue(['T']);
    const args = await buildNonNativeArgs({
      project: '/x/y.uproject',
      engineRoot: '/UE',
    });
    expect(args.find((a) => a.startsWith('-architecture='))).toBeUndefined();
  });
});

// 类型契约冒烟测试: 确保 BuildArgsOptions 接口包含全部可选字段
describe('BuildArgsOptions (类型契约)', () => {
  it('所有字段都可独立省略', () => {
    const opts: BuildArgsOptions = { project: '/x/y.uproject', engineRoot: '/UE' };
    expect(opts.architecture).toBeUndefined();
    expect(opts.platform).toBeUndefined();
    expect(opts.buildType).toBeUndefined();
    expect(opts.workspace).toBeUndefined();
  });
});

/* ── [F2-9] executeShellTask：abort 终止 + 超时兜底 ── */

describe('executeShellTask (F2-9)', () => {
  it('abort → 终止 UBT 任务并 reject Task cancelled', async () => {
    // Arrange：executeTask 解析出 execution（带 terminate spy）
    const terminate = vi.fn();
    vi.mocked(vscode.tasks.executeTask).mockResolvedValue({
      task: {},
      terminate,
    } as unknown as vscode.TaskExecution);

    const ac = new AbortController();
    const p = executeShellTask('cmd.exe', ['arg'], '/proj', makeLogger(), undefined, ac.signal);

    // executeTask 的 .then 回调（把 execution 加入内部集合）需要微任务 flush
    await flushMicrotasks();
    expect(vi.mocked(vscode.tasks.executeTask)).toHaveBeenCalledTimes(1);

    // Act：abort
    ac.abort();

    // Assert：reject Task cancelled,并且 UBT 任务被 terminate
    await expect(p).rejects.toThrow('Task cancelled');
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('signal 传入时已 aborted → 不启动任务,直接 reject', async () => {
    const ac = new AbortController();
    ac.abort();

    await expect(
      executeShellTask('cmd.exe', ['arg'], '/proj', makeLogger(), undefined, ac.signal),
    ).rejects.toThrow('Task cancelled');
    expect(vi.mocked(vscode.tasks.executeTask)).not.toHaveBeenCalled();
  });

  it('任务超时（5 分钟无结束事件）→ reject 超时错误并终止任务', async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    vi.mocked(vscode.tasks.executeTask).mockResolvedValue({
      task: {},
      terminate,
    } as unknown as vscode.TaskExecution);

    const p = executeShellTask('cmd.exe', ['arg'], '/proj', makeLogger());
    await flushMicrotasks(); // execution 加入内部集合

    // 先把 rejects 断言挂上（避免定时器触发 reject 时产生 unhandled rejection）
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    // 5 分钟超时兜底触发
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await assertion;
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('任务正常结束（exit code 0）→ resolve exit code 并清理监听器', async () => {
    const terminate = vi.fn();
    const mockExecution = { task: {}, terminate } as unknown as vscode.TaskExecution;
    vi.mocked(vscode.tasks.executeTask).mockResolvedValue(mockExecution);
    const endDispose = vi.fn();
    vi.mocked(vscode.tasks.onDidEndTaskProcess).mockReturnValue({
      dispose: endDispose,
    } as unknown as vscode.Disposable);

    const p = executeShellTask('cmd.exe', ['arg'], '/proj', makeLogger());
    await flushMicrotasks();

    // 触发 onDidEndTaskProcess（execution 需与 executeTask 返回的是同一对象引用,
    // executions 集合按引用匹配）
    const handler = vi.mocked(vscode.tasks.onDidEndTaskProcess).mock.calls[0]?.[0];
    expect(handler).toBeDefined();
    handler?.({
      execution: mockExecution,
      exitCode: 0,
    } as vscode.TaskProcessEndEvent);

    await expect(p).resolves.toBe(0);
    expect(endDispose).toHaveBeenCalled();
    // 正常结束后 abort 不再触发任何副作用（settled 守卫）
  });
});
