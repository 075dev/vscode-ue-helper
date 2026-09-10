/**
 * ueLinkManager.test.ts —— ueLinkManager 状态机 + 反射宏预过滤 + 5s 节流测试
 *
 * 覆盖：
 *   (a) 同一文件再次保存（mtime 相同）→ 不走 mtime 跳过,节流后重跑 UHT
 *   (b) 保存 .h → 内容含反射宏 → 走 UHT codegen
 *   (c) 保存 .h → 不含反射宏 → 0ms 跳过 UHT
 *   (d) 5s 内多次保存 → 合并成 1 次 UHT
 *   (e) UHT 成功 → triggerReparse 写 trigger 文件
 *   (f) UHT 失败 → state=error，不弹错误通知
 *   (g) 非 .h 文件 → 0ms 跳过
 *   (h) 路径在 projectDir 外 → 0ms 跳过
 *   (k) reset() 清掉 pending 补跑标记与节流状态
 *   (l) UHT 运行中保存 → 不并发启动,完成后补跑一次（W18 running-uht 守卫）
 *
 * Mock 策略：
 *   - vi.mock('vscode')：控制 workspace API（stat/readFile/onDidSave/createStatusBarItem）
 *   - vi.mock('@clangd/uhtGeneration')：runUhtCodegen 返回固定结果
 *   - vi.mock('@clangd/proxy/generatedHeaderWatcher')：triggerReparse 记录调用
 *   - vi.useFakeTimers()：控制 200ms debounce + 5s throttle
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';

// 必须先 mock vscode（ueLinkManager import 链上有用到）
vi.mock('vscode', () => {
  return {
    window: {
      createStatusBarItem: vi.fn(() => ({
        text: '',
        tooltip: '',
        command: undefined,
        name: '',
        show: vi.fn(),
        dispose: vi.fn(),
      })),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    },
    workspace: {
      onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
      fs: {
        stat: vi.fn(),
        readFile: vi.fn(),
      },
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ThemeColor: class {},
    Uri: {
      file: (p: string) => ({ fsPath: p, path: p, scheme: 'file' }),
    },
  };
});

// Mock uhtGeneration：返回固定 UhtResult
// 注意：vi.mock 工厂会被 hoist 到顶部，工厂内不能引用外层 const。
// 所以工厂内用 `vi.fn()`，然后用 `vi.mocked()` 重新拿到引用供后续设置返回值。
const { mockRunUhtCodegen, mockTriggerReparse } = vi.hoisted(() => {
  return {
    mockRunUhtCodegen: vi.fn(),
    mockTriggerReparse: vi.fn(),
  };
});

vi.mock('@clangd/uhtGeneration', () => ({
  runUhtCodegen: (...args: unknown[]): unknown => mockRunUhtCodegen(...args),
}));

vi.mock('@clangd/proxy/generatedHeaderWatcher', () => ({
  triggerReparse: (...args: unknown[]): unknown => mockTriggerReparse(...args),
}));

import * as vscode from 'vscode';
import { UeLinkManager } from '@clangd/ueLinkManager';
import type { Config } from '@core/config';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';

/* ─── 测试辅助 ─── */

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

function makeConfig(): Config {
  return {
    configuration: 'Development',
  } as unknown as Config;
}

function makeWorkspace(overrides: Partial<{
  projectDir: string | null;
  selectedProject: string | null;
  selectedEngine: string | null;
}> = {}): WorkspaceState {
  return {
    projectDir: overrides.projectDir ?? PROJECT_DIR,
    selectedProject: overrides.selectedProject ?? path.join(PROJECT_DIR, 'MyProj.uproject'),
    selectedEngine: overrides.selectedEngine ?? (process.platform === 'win32' ? 'C:\\UE' : '/tmp/UE'),
  } as unknown as WorkspaceState;
}

// 测试路径用 native sep（Windows 上 path.relative / path.join 都用 \）。
// PROJECT_DIR 必须是已 resolved 的盘符绝对路径 —— 不能用 path.resolve('C:/proj')
// （在 Windows 上 path.resolve 会把它当 cwd-relative，丢 C: 前缀）
const PROJECT_DIR = process.platform === 'win32'
  ? 'C:\\proj'
  : '/tmp/proj';
const FILE_UNDER_SOURCE = path.join(PROJECT_DIR, 'Source', 'MyProj', 'MyActor.h');
const FILE_OUTSIDE = process.platform === 'win32'
  ? 'C:\\other\\MyActor.h'
  : '/tmp/other/MyActor.h';
const FILE_UNDER_PLUGIN = path.join(PROJECT_DIR, 'Plugins', 'MyPlugin', 'Source', 'MyActor.h');

const SAMPLE_HEADER_WITH_REFLECTION = `
#pragma once
#include "CoreMinimal.h"
#include "MyActor.generated.h"

UCLASS()
class MYPROJECT_API AMyActor : public AActor {
  GENERATED_BODY()
public:
  UPROPERTY(EditAnywhere)
  int32 Health;
};
`;

const SAMPLE_HEADER_WITHOUT_REFLECTION = `
#pragma once
#include "CoreMinimal.h"

class FMyHelper {
public:
  int32 DoSomething();
};
`;

function mockStatReturning(mtimeMs: number): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock accessor
  const statMock = vi.mocked(vscode.workspace.fs.stat);
  statMock.mockResolvedValue({
    mtime: mtimeMs,
    ctime: mtimeMs,
    size: 100,
    type: 1,
  } as unknown as vscode.FileStat);
}

function mockReadFileReturning(content: string): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock accessor
  const readFileMock = vi.mocked(vscode.workspace.fs.readFile);
  const bytes = new TextEncoder().encode(content);
  readFileMock.mockResolvedValue(bytes as unknown as Uint8Array);
}

function setupHappyUht(): void {
  mockRunUhtCodegen.mockResolvedValue({
    ran: true,
    exitCode: 0,
    generatedHeaderCount: 1,
    generatedHeaderPaths: ['C:/proj/Intermediate/.../MyActor.generated.h'],
    errorMessage: undefined,
  });
  mockTriggerReparse.mockResolvedValue(undefined);
}

function makeManager(opts: {
  workspace?: WorkspaceState;
} = {}): UeLinkManager {
  return new UeLinkManager({
    config: makeConfig(),
    logger: makeLogger(),
    workspace: opts.workspace ?? makeWorkspace(),
  });
}

/** 反复 flush 微任务直到全部 settle（vi.useFakeTimers 不会自动 await Promise）。 */
async function flushMicrotasks(max = 20): Promise<void> {
  for (let i = 0; i < max; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // 捕获 onDidSave 回调（暂未使用，但保留以备 e2e 测试）
  vi.mocked(vscode.workspace.onDidSaveTextDocument).mockImplementation((handler) => {
    void handler; // suppress unused
    return { dispose: vi.fn() };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/* ─── 测试 ─── */

describe('UeLinkManager', () => {
  it('(a) 同一文件再次保存（mtime 相同）→ 不走 mtime 跳过,节流后重跑 UHT', async () => {
    // S3：mtime 层已删除——VS Code 每次保存都重写文件,mtime 恒变,
    // 原"Ctrl+S 无变化→0ms 跳过"承诺不成立。相同 mtime 也走内容预过滤 + 节流。
    setupHappyUht();
    mockStatReturning(5000);
    mockReadFileReturning(SAMPLE_HEADER_WITH_REFLECTION);
    const mgr = makeManager();

    // 第一次保存 → UHT codegen
    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();
    expect(mockRunUhtCodegen).toHaveBeenCalledTimes(1);
    expect(mgr.snapshot().lastGeneratedCount).toBe(1);

    // Act：第二次保存，mtime 还是 5000（内容仍含反射宏）
    mockStatReturning(5000);
    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();

    // Assert：mtime 不再跳过——距上次完成 < 5s → 进 throttled,5s 后重跑
    expect(mgr.snapshot().state).toBe('throttled');
    await vi.advanceTimersByTimeAsync(5000);
    await vi.runAllTimersAsync(); await flushMicrotasks();
    expect(mockRunUhtCodegen).toHaveBeenCalledTimes(2);
  });

  it('(b) 保存含反射宏的 .h → 走 UHT codegen', async () => {
    setupHappyUht();
    mockStatReturning(1000);
    mockReadFileReturning(SAMPLE_HEADER_WITH_REFLECTION);
    const mgr = makeManager();

    // 提取到 const 避开 unbound-method + 顺手把诊断用 console.log 替换为正经断言
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock accessor
    const readFileMock = vi.mocked(vscode.workspace.fs.readFile);
    expect(readFileMock).not.toHaveBeenCalled();
    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();
    // S3：mtime 层已删除,不再走 stat 快速路径;内容预过滤只读 readFile
    expect(readFileMock).toHaveBeenCalled();
    expect(mockRunUhtCodegen.mock.calls.length).toBeGreaterThanOrEqual(1);

    expect(mockRunUhtCodegen).toHaveBeenCalledTimes(1);
    expect(mgr.snapshot().state).toBe('notify');
    expect(mgr.snapshot().lastGeneratedCount).toBe(1);
    // 1s 后回到 idle
    await vi.advanceTimersByTimeAsync(1100);
    expect(mgr.snapshot().state).toBe('idle');
  });

  it('(c) 保存不含反射宏的 .h → 0ms 跳过 UHT', async () => {
    mockStatReturning(1000);
    mockReadFileReturning(SAMPLE_HEADER_WITHOUT_REFLECTION);
    const mgr = makeManager();

    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync(); await flushMicrotasks();

    expect(mockRunUhtCodegen).not.toHaveBeenCalled();
    // state 应保持 idle（debounding 完成后无后续动作）
    expect(mgr.snapshot().state).toBe('idle');
  });

  it('(d) 5s 内多次保存 → 合并成 1 次 UHT', async () => {
    setupHappyUht();
    mockStatReturning(1000);
    mockReadFileReturning(SAMPLE_HEADER_WITH_REFLECTION);
    const mgr = makeManager();

    // 第一次保存
    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync(); await flushMicrotasks();
    expect(mockRunUhtCodegen).toHaveBeenCalledTimes(1);

    // 第二次保存（500ms 后）— 应被节流
    await vi.advanceTimersByTimeAsync(500);
    mockStatReturning(2000);
    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    expect(mgr.snapshot().state).toBe('throttled');
    // 等到 throttle 结束（5s 减去已经过的 500ms = 4500ms）
    await vi.advanceTimersByTimeAsync(4500);
    await vi.runAllTimersAsync(); await flushMicrotasks();

    // UHT 第二次调用——节流后再次跑（throttledMergedCount=1）
    expect(mockRunUhtCodegen).toHaveBeenCalledTimes(2);
    expect(mgr.snapshot().throttledMergedCount).toBeGreaterThanOrEqual(1);
  });

  it('(e) UHT 成功 → triggerReparse 被调用', async () => {
    setupHappyUht();
    mockStatReturning(1000);
    mockReadFileReturning(SAMPLE_HEADER_WITH_REFLECTION);
    const mgr = makeManager();

    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync(); await flushMicrotasks();

    expect(mockTriggerReparse).toHaveBeenCalledTimes(1);
    // projectDir 取的是 path.dirname(projectPath), Windows 上是反斜杠
    expect(mockTriggerReparse).toHaveBeenCalledWith(
      path.dirname(path.join(PROJECT_DIR, 'MyProj.uproject')),
      ['C:/proj/Intermediate/.../MyActor.generated.h'],
    );
  });

  it('(f) UHT 失败 → state=error，不调 triggerReparse', async () => {
    mockRunUhtCodegen.mockResolvedValue({
      ran: false,
      exitCode: null,
      generatedHeaderCount: 0,
      generatedHeaderPaths: [],
      errorMessage: 'bundled dotnet not found',
    });
    mockStatReturning(1000);
    mockReadFileReturning(SAMPLE_HEADER_WITH_REFLECTION);
    const mgr = makeManager();

    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync(); await flushMicrotasks();

    expect(mockTriggerReparse).not.toHaveBeenCalled();
    expect(mgr.snapshot().state).toBe('error');
  });

  it('(g) 非 .h 文件 → 0ms 跳过', async () => {
    const mgr = makeManager();
    await mgr.onDidSaveForTest('C:/proj/Source/MyProj/MyActor.cpp', 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync(); await flushMicrotasks();

    expect(mockRunUhtCodegen).not.toHaveBeenCalled();
    // stat 不该被调（白名单先挡掉）
    // eslint-disable-next-line @typescript-eslint/unbound-method -- test-only mock check
    expect(vscode.workspace.fs.stat).not.toHaveBeenCalled();
  });

  it('(h) 路径在 projectDir 外 → 0ms 跳过', async () => {
    const mgr = makeManager();
    await mgr.onDidSaveForTest(FILE_OUTSIDE, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync(); await flushMicrotasks();

    expect(mockRunUhtCodegen).not.toHaveBeenCalled();
  });

  it('(i) Plugins/.../Source/ 路径 → 接受', async () => {
    setupHappyUht();
    mockStatReturning(1000);
    mockReadFileReturning(SAMPLE_HEADER_WITH_REFLECTION);
    const mgr = makeManager();

    await mgr.onDidSaveForTest(FILE_UNDER_PLUGIN, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync(); await flushMicrotasks();

    expect(mockRunUhtCodegen).toHaveBeenCalledTimes(1);
  });

  it('(j) project/engine 未选 → 跳过 + log warn', async () => {
    setupHappyUht();
    mockStatReturning(1000);
    mockReadFileReturning(SAMPLE_HEADER_WITH_REFLECTION);
    // makeWorkspace 的 ?? 默认值会兜底, 这里直接构造带 null 字段的 workspace
    const nullWorkspace = {
      projectDir: PROJECT_DIR,
      selectedProject: null,
      selectedEngine: null,
    } as unknown as WorkspaceState;
    const mgr = makeManager({ workspace: nullWorkspace });

    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync(); await flushMicrotasks();

    // UHT 没跑（无 project/engine 路径）
    expect(mockRunUhtCodegen).not.toHaveBeenCalled();
  });

  it('(k) reset() 清掉 pending 补跑标记 → UHT 完成后不再补跑', async () => {
    // 第一次 UHT 用 deferred 挂起（保持在 running-uht 状态）
    let resolveFirst!: (v: unknown) => void;
    mockRunUhtCodegen.mockImplementationOnce(
      () => new Promise((res) => { resolveFirst = res; }),
    );
    mockStatReturning(5000);
    mockReadFileReturning(SAMPLE_HEADER_WITH_REFLECTION);
    const mgr = makeManager();

    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();
    expect(mgr.snapshot().state).toBe('running-uht');

    // 运行中再保存 → 挂 pending
    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    await flushMicrotasks();

    // reset() → pending 清掉,回到 idle
    mgr.reset();
    expect(mgr.snapshot().state).toBe('idle');

    // 当前 UHT 完成 → pending 已清,不再补跑
    resolveFirst({
      ran: true,
      exitCode: 0,
      generatedHeaderCount: 1,
      generatedHeaderPaths: ['C:/proj/Intermediate/.../MyActor.generated.h'],
      errorMessage: undefined,
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5200);
    await vi.runAllTimersAsync(); await flushMicrotasks();

    expect(mockRunUhtCodegen).toHaveBeenCalledTimes(1);
  });

  it('(l) UHT 运行中保存 → 不并发启动,完成后补跑一次（W18 running-uht 守卫）', async () => {
    // 第一次 UHT deferred 挂起,模拟 UHT 长时间运行
    let resolveFirst!: (v: unknown) => void;
    mockRunUhtCodegen.mockImplementationOnce(
      () => new Promise((res) => { resolveFirst = res; }),
    );
    // 补跑那次用默认 happy 返回值
    setupHappyUht();

    mockStatReturning(1000);
    mockReadFileReturning(SAMPLE_HEADER_WITH_REFLECTION);
    const mgr = makeManager();

    // 第一次保存 → debounce 200ms → 进入 running-uht
    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();
    expect(mockRunUhtCodegen).toHaveBeenCalledTimes(1);
    expect(mgr.snapshot().state).toBe('running-uht');

    // UHT 运行中再次保存 → 挂 pending,不并发启动第二个 UHT
    mockStatReturning(2000);
    await mgr.onDidSaveForTest(FILE_UNDER_SOURCE, 'cpp');
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();
    expect(mockRunUhtCodegen).toHaveBeenCalledTimes(1);
    expect(mgr.snapshot().state).toBe('running-uht');

    // 当前 UHT 完成 → 补跑一次（pending 触发,走 5s 节流）
    resolveFirst({
      ran: true,
      exitCode: 0,
      generatedHeaderCount: 1,
      generatedHeaderPaths: ['C:/proj/Intermediate/.../MyActor.generated.h'],
      errorMessage: undefined,
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5200);
    await vi.runAllTimersAsync(); await flushMicrotasks();

    expect(mockRunUhtCodegen).toHaveBeenCalledTimes(2);
    expect(mgr.snapshot().state).toBe('idle');
  });
});
