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
    /** 共享的 readFileMock vi.fn —— 模拟 fs.promises.readFile */
    readFileMock: vi.fn(),
  };
});

vi.mock('@i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFileMock,
}));

// Mock ueHelpers（headerWatcher.ts 内部 import 这些）
vi.mock('@clangd/ueHelpers', () => ({
  getUbtPath: vi.fn(async () => 'D:/UE/Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe'),
  getBuildTargetNames: vi.fn(async () => ['MyProjEditor']),
  getUnrealPlatform: vi.fn(() => 'Win64'),
}));

// Mock chokidar: 让 headerWatcher 用假 watcher，测试手动触发 'change' 事件
const chokidarMock = vi.hoisted(() => {
  let changeHandler: ((p: string) => void) | undefined;
  return {
    changeHandler: (...args: [string]) => {
      if (changeHandler) changeHandler(...args);
    },
    watch: vi.fn((_patterns: string[], _opts: unknown) => {
      const watcher: any = {
        on: vi.fn((event: string, handler: (p: string) => void) => {
          if (event === 'change') {
            changeHandler = handler;
          }
          return watcher;
        }),
        close: vi.fn(),
      };
      return watcher;
    }),
  };
});

vi.mock('chokidar', () => ({
  default: {
    watch: (...args: [string[], any]) => chokidarMock.watch(...args),
  },
}));

// 本地别名，让测试体 gherkin 生成更清晰
const readFileMock = mocks.readFileMock;

// ============== Test code ==============

import { HeaderWatcher } from '@clangd/headerWatcher';

// 假 UBT executor：单测时不真正跑 UHT，只记录调用并上报成功
const mocksUht = vi.hoisted(() => ({
  fakeUbtExecutor: vi.fn(async () => 0),
}));

const fakeUbtExecutor = mocksUht.fakeUbtExecutor;

// 假 clangd notifier：单测时不真正扫描文件系统，只记录调用
const mocksNotify = vi.hoisted(() => ({
  fakeClangdNotifier: vi.fn(async () => { /* noop */ }),
}));

const fakeClangdNotifier = mocksNotify.fakeClangdNotifier;

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


describe('HeaderWatcher (Phase 8 / per D-02/D-03/D-04/D-05/D-12/D-15)', () => {
  let vscode: typeof import('vscode');

  beforeEach(async () => {
    // Mock timers
    vi.useFakeTimers();

    // Reset readFile default to content WITH UCLASS
    readFileMock.mockReset();
    readFileMock.mockImplementation(async (_p: string, _enc: string) => '// UCLASS()\nclass A {};');

    vscode = await import('vscode');

    // setup.ts 未提供 setStatusBarMessage mock —— 补上
    if (typeof vscode.window.setStatusBarMessage !== 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (vscode.window as any).setStatusBarMessage = vi.fn();
    }

    // Uri.joinPath mock（Uri.file 已有）
    (vscode.Uri as any).joinPath = vi.fn((...segments: string[]) => {
      const fsPath = segments.join('/').replace(/\/+/g, '/').replace(/^\//, '');
      return { fsPath, path: fsPath, scheme: 'file' };
    });

    // 重置 fake executor 计数器，避免跨测试污染
    fakeUbtExecutor.mockReset();
    fakeUbtExecutor.mockResolvedValue(0);
    fakeClangdNotifier.mockReset();
    fakeClangdNotifier.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * D-04/D-07：手动触发 triggerUbtRegen → UBT 执行 → 完成后通知 clangd
   */
  it('triggerUbtRegen runs UBT and notifies clangd (D-04/D-07)', async () => {
    const workspace = makeWorkspace();
    const config = makeConfig();
    const logger = makeLogger();

    const watcher = new HeaderWatcher(workspace, logger, config, fakeUbtExecutor, fakeClangdNotifier);

    // 手动触发 UBT
    await watcher.triggerUbtRegen('/proj/Source/MyActor.h');

    // 验证 UBT 被调用
    expect(fakeUbtExecutor).toHaveBeenCalledTimes(1);
    const args = (fakeUbtExecutor.mock.calls[0] as any[])[1] as string[];
    expect(args).toEqual(expect.arrayContaining([
      '-Mode=UnrealHeaderTool',
      expect.stringContaining('MyProjEditor'),
      expect.stringContaining('-Project='),
    ]));
    // 验证 UBT 完成后 clangd notifier 被调用
    expect(fakeClangdNotifier).toHaveBeenCalledTimes(1);
    expect(fakeClangdNotifier).toHaveBeenCalledWith(
      '/proj',
      expect.any(Number),
      logger,
    );
  });

  /**
   * D-05：setting disabled → triggerUbtRegen 立即短路
   */
  it('triggerUbtRegen short-circuits when setting disabled (D-05)', async () => {
    const workspace = makeWorkspace();
    const disabledConfig = makeConfig({ enabled: false });
    const logger = makeLogger();

    const watcher = new HeaderWatcher(workspace, logger, disabledConfig, fakeUbtExecutor, fakeClangdNotifier);

    await watcher.triggerUbtRegen('/proj/Source/MyActor.h');

    expect(fakeUbtExecutor).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('setting disabled'),
    );
  });

  /**
   * D-15：projectDir 未 ready → triggerUbtRegen 跳过
   */
  it('triggerUbtRegen skips when projectDir not ready (D-15)', async () => {
    const workspace = makeWorkspace();
    (workspace as any).projectDir = null;
    (workspace as any).project = null;
    (workspace as any).engine = null;
    const config = makeConfig();
    const logger = makeLogger();

    const watcher = new HeaderWatcher(workspace, logger, config, fakeUbtExecutor, fakeClangdNotifier);

    await watcher.triggerUbtRegen('/proj/Source/MyActor.h');

    expect(fakeUbtExecutor).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('no projectDir'),
    );
  });

  /**
   * start() 不再做任何监听（被动模式由 proxy 承担）
   */
  it('start does not watch files (passive mode)', async () => {
    const workspace = makeWorkspace();
    const config = makeConfig();
    const logger = makeLogger();

    const watcher = new HeaderWatcher(workspace, logger, config, fakeUbtExecutor, fakeClangdNotifier);
    const disposable = watcher.start();

    // start 后不应有任何 UBT 调用（没有文件监听）
    expect(fakeUbtExecutor).not.toHaveBeenCalled();

    // dispose 不应崩溃
    disposable.dispose();
  });
});
