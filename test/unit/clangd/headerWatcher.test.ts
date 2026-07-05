/**
 * headerWatcher.test.ts —— HeaderWatcher 模块单元测试
 *
 * Phase 8 行为合约测试 —— D-02/D-03/D-04/D-05/D-12/D-15
 *
 * 测试范围：
 *   - D-02 严格触发：.h + UE_MACRO_RE（含 .cpp / 无宏 / .generated.h early-out）
 *   - D-03 projectDir 内外
 *   - D-04 1500ms debounce coalescing（3 快速保存 = 1 触发）
 *   - D-05 clangdHeaderWatcherEnabled=false → 立即短路（无 IO、无调用）
 *   - D-12/D-13 cancelHeaderWatcherTrigger 从外部取消 pending debounce
 *   - D-15 pre-detection.ready 门控（projectFolder null → 跳过 + 日志）
 *
 * Mock 策略：
 *   - vi.mock '@clangd/compileCommands'（generateCompileCommands 桩）
 *   - vi.mock '@i18n'（t() 返回 literal key）
 *   - vi.mock 'node:fs/promises'（readFile 桩，控制内容）
 *   - vscode.workspace.onDidSaveTextDocument 在 per-test 通过 mockImplementation 捕获 listener
 *
 * 使用 vi.useFakeTimers() + vi.advanceTimersByTime(1500) 推进 debounce（per RESEARCH.md Recommended Approach #7）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============== Mocks（顶层 vi.mock，避免 hoisting 问题） ==============

// 用 vi.hoisted 把 mock 状态提升到文件顶部，让 vi.mock 工厂和测试体共享
const mocks = vi.hoisted(() => {
  return {
    /** 共享的 generateCompileCommands vi.fn —— 模拟模块导出 */
    gcc: vi.fn(() => Promise.resolve({ compileCommandsPath: '/fake/cc.json', cacheHit: false, fingerprint: 'fp-test' })),
    /** 共享的 readFileMock vi.fn —— 模拟 fs.promises.readFile */
    readFileMock: vi.fn(),
  };
});

vi.mock('@clangd/compileCommands', () => ({
  generateCompileCommands: mocks.gcc,
}));

vi.mock('@i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFileMock,
}));

// 本地别名，让测试体 gherkin 生成更清晰
const generateCompileCommands = mocks.gcc;
const readFileMock = mocks.readFileMock;

// ============== Test code ==============

import { startHeaderWatcher, cancelHeaderWatcherTrigger } from '@clangd/headerWatcher';

// ============== Helpers ==============

/** 部分 WorkspaceState stub（仅 watcher 读取的字段） */
function makeWorkspace(options: {
  projectFolder?: { name: string; path: string; role: 'project' | 'engine' | 'unknown'; absPath: string } | null;
  engineFolder?: { name: string; path: string; role: 'project' | 'engine' | 'unknown'; absPath: string } | null;
  projectDir?: string | null;
  project?: { path: string } | null;
  engine?: { path: string } | null;
} = {}): any {
  const projectDir = options.projectDir ?? '/proj';
  const project = options.project ?? { path: '/proj/MyProj.uproject' };
  const engine = options.engine ?? { path: '/eng' };
  return {
    projectDir,
    project,
    engine,
  };
}

/** 部分 Config stub（watcher 仅读取 clangdHeaderWatcherEnabled） */
function makeConfig({ enabled = true } = {}): any {
  return { clangdHeaderWatcherEnabled: enabled };
}

/** Logger stub（info / warn 为 vi.fn 以便断言） */
function makeLogger(): any {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

/** 捕获 vscode Disposable 构造的 mock */
function makeFakeExtensionContext(): any {
  return {
    subscriptions: [],
  };
}

describe('HeaderWatcher (Phase 8 / per D-02/D-03/D-04/D-05/D-12/D-15)', () => {
  let saveListener: ((doc: { uri: { fsPath: string } }) => void) | undefined;

  beforeEach(async () => {
    // Mock timers
    vi.useFakeTimers();

    // Reset readFile default to content WITH UCLASS
    readFileMock.mockReset();
    readFileMock.mockImplementation(async (_p: string, _enc: string) => '// UCLASS()\nclass A {};');

    // Reset generateCompileCommands mock
    generateCompileCommands.mockReset();
    generateCompileCommands.mockResolvedValue({
      compileCommandsPath: '/fake/cc.json',
      cacheHit: false,
      fingerprint: '',
    } as never);

    // Capture listener via per-test mockImplementation
    const vscode = await import('vscode');
    saveListener = undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(vscode.workspace.onDidSaveTextDocument) as any).mockImplementation(
      (listener: (doc: { uri: { fsPath: string } }) => void) => {
        saveListener = listener;
        return { dispose: vi.fn() };
      },
    );

    // setup.ts 未提供 setStatusBarMessage mock —— 补上
    if (typeof vscode.window.setStatusBarMessage !== 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (vscode.window as any).setStatusBarMessage = vi.fn();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 辅助：快速完成等待，让 async runUbtRegen 中的 microtasks/fake-timer 队列排空 */
  async function flush(): Promise<void> {
    // 先把 fake timers 队列里的 setTimeout 跑掉
    await vi.advanceTimersToNextTimerAsync();
    // 再等微任务链
    await Promise.resolve();
    await Promise.resolve();
  }

  /**
   * D-02/D-04/D-07：.h + 反射宏 → 经过 1500ms debounce 后触发一次 generateCompileCommands
   */
  it('triggers UBT regen on .h save containing UCLASS macro (D-02/D-04/D-07)', async () => {
    const workspace = makeWorkspace();
    const config = makeConfig();
    const logger = makeLogger();
    const ctx = makeFakeExtensionContext();

    startHeaderWatcher(ctx, config, logger, workspace);

    // 模拟保存 MyActor.h（含 UCLASS）
    saveListener!({ uri: { fsPath: '/proj/Source/MyActor.h' } });

    // debounce 期间的 1499ms 内不应触发
    await vi.advanceTimersByTimeAsync(1499);
    expect(generateCompileCommands).not.toHaveBeenCalled();

    // 再推进 1ms（刚好 1500ms）→ 触发
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(generateCompileCommands).toHaveBeenCalledTimes(1);
    expect(generateCompileCommands).toHaveBeenCalledWith(
      expect.objectContaining({
        project: '/proj/MyProj.uproject',
        engineRoot: '/eng',
        logger,
        workspace,
      }),
    );
  });

  /**
   * D-02：.cpp 文件 → 不触发（early-out on extension check，readFile 也不调用）
   */
  it('skips .cpp save — early-out, no readFile (D-02)', async () => {
    const config = makeConfig();
    const logger = makeLogger();
    const ctx = makeFakeExtensionContext();

    startHeaderWatcher(ctx, config, logger, makeWorkspace());

    saveListener!({ uri: { fsPath: '/proj/Source/MyActor.cpp' } });

    await vi.advanceTimersByTimeAsync(1500);
    await flush();

    expect(readFileMock).not.toHaveBeenCalled();
    expect(generateCompileCommands).not.toHaveBeenCalled();
  });

  /**
   * D-02：.h 文件但内容不含反射宏 → 不触发（通过 regex 过滤）
   */
  it('skips .h save without reflection macro (D-02)', async () => {
    // 定制 readFile 返回无宏内容
    readFileMock.mockReset();
    readFileMock.mockResolvedValue('// plain header\nclass F {};');

    const config = makeConfig();
    const logger = makeLogger();
    const ctx = makeFakeExtensionContext();

    startHeaderWatcher(ctx, config, logger, makeWorkspace());

    saveListener!({ uri: { fsPath: '/proj/Source/PlainHeader.h' } });

    await vi.advanceTimersByTimeAsync(1500);
    await flush();

    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(generateCompileCommands).not.toHaveBeenCalled();
  });

  /**
   * D-02 + RESEARCH.md Pitfall 5：.generated.h 重入保护 — 不调用 readFile / generateCompileCommands
   */
  it('skips .generated.h save — re-entry guard (D-02/Pitfall 5)', async () => {
    const config = makeConfig();
    const logger = makeLogger();
    const ctx = makeFakeExtensionContext();

    startHeaderWatcher(ctx, config, logger, makeWorkspace());

    saveListener!({ uri: { fsPath: '/proj/Source/Foo.generated.h' } });

    await vi.advanceTimersByTimeAsync(1500);
    await flush();

    expect(readFileMock).not.toHaveBeenCalled();
    expect(generateCompileCommands).not.toHaveBeenCalled();
  });

  /**
   * D-04：快速连续 3 次 .h 保存 → debounce 合并，仅一次 generateCompileCommands
   */
  it('debounces 3 rapid .h saves into 1 UBT trigger (D-04)', async () => {
    const config = makeConfig();
    const logger = makeLogger();
    const ctx = makeFakeExtensionContext();

    startHeaderWatcher(ctx, config, logger, makeWorkspace());

    // 快速保存 3 个不同 .h（每次推进 100ms，模拟真实打字）
    saveListener!({ uri: { fsPath: '/proj/Source/A.h' } });
    await vi.advanceTimersByTimeAsync(100);
    saveListener!({ uri: { fsPath: '/proj/Source/B.h' } });
    await vi.advanceTimersByTimeAsync(100);
    saveListener!({ uri: { fsPath: '/proj/Source/C.h' } });

    // 推进 debounce 窗口
    await vi.advanceTimersByTimeAsync(1500);
    await flush();

    expect(generateCompileCommands).toHaveBeenCalledTimes(1);
  });

  /**
   * D-12/D-13：cancelHeaderWatcherTrigger 从外部取消 pending debounce（双跑防护）
   */
  it('cancelHeaderWatcherTrigger cancels pending debounce (D-12/D-13)', async () => {
    const config = makeConfig();
    const logger = makeLogger();
    const ctx = makeFakeExtensionContext();
    const workspace = makeWorkspace();

    startHeaderWatcher(ctx, config, logger, workspace);

    saveListener!({ uri: { fsPath: '/proj/Source/MyActor.h' } });

    // 推进到 800ms（debounce 未到期）
    await vi.advanceTimersByTimeAsync(800);
    expect(generateCompileCommands).not.toHaveBeenCalled();

    // 手动命令调用 cancel
    cancelHeaderWatcherTrigger();

    // 再推进 800ms（debounce 应该不会触发了）
    await vi.advanceTimersByTimeAsync(800);
    await flush();

    expect(generateCompileCommands).not.toHaveBeenCalled();
    // logger 应该记录了 cancelled 日志
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('pending trigger cancelled'),
    );
  });

  /**
   * D-15：projectDir 未 ready（detection 未完成）→ 不触发 + logger 记录跳过
   */
  it('skips when projectDir not ready — logs [headerWatcher] (D-15)', async () => {
    const config = makeConfig();
    const logger = makeLogger();
    const ctx = makeFakeExtensionContext();
    // D-15: 模拟 detection 尚未完成 → projectDir/project/engine 全部 null
    const workspace = makeWorkspace();
    (workspace as any).projectDir = null;
    (workspace as any).project = null;
    (workspace as any).engine = null;

    startHeaderWatcher(ctx, config, logger, workspace);

    saveListener!({ uri: { fsPath: '/proj/Source/MyActor.h' } });

    await vi.advanceTimersByTimeAsync(1500);
    await flush();

    expect(generateCompileCommands).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('skipped'),
    );
  });

  /**
   * D-05：vscodeUEHelper.clangdHeaderWatcherEnabled=false → 立即短路，不 IO，不触发
   */
  it('short-circuits when setting disabled — no IO, no trigger (D-05)', async () => {
    const disabledConfig = makeConfig({ enabled: false });
    const logger = makeLogger();
    const ctx = makeFakeExtensionContext();

    startHeaderWatcher(ctx, disabledConfig, logger, makeWorkspace());

    saveListener!({ uri: { fsPath: '/proj/Source/MyActor.h' } });

    await vi.advanceTimersByTimeAsync(1500);
    await flush();

    expect(readFileMock).not.toHaveBeenCalled();
    expect(generateCompileCommands).not.toHaveBeenCalled();
  });
});
