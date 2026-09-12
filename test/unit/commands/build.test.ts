/**
 * build 命令测试 —— executeBuild 的取消 / 并发守卫分支
 *
 * [F2-1] 用户取消构建:runBuild 返回 cancelled=true 时,命令层只弹中性提示
 *         ("构建已取消"),不弹 "failed with exit code" 失败警告
 * [F2-2] 构建并发守卫:buildInFlight 非空时再次触发,提示"已有构建在运行"
 *         并直接返回(不排队),runBuild 只被调一次
 *
 * 依赖全部打桩:@build / @commands/_resolve / @ui/notifications 等,
 * 只验证 executeBuild 自身的编排分支。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import { executeBuild } from '@commands/build';
import { getLastBuildSnapshot, resetLastBuildSnapshot } from '@build/lastBuild';
import { initI18n, t } from '@i18n';

// executeBuild 会校验 Build.bat 是否存在;测试用假路径,mock 为存在
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

// ============ Mock 函数 (懒箭头引用,规避 vi.mock hoist 顺序问题) ============
const mockRunBuild = vi.fn<unknown[], Promise<unknown>>();
const mockBuildUBTCommand = vi.fn<unknown[], unknown>();
const mockResolveUBTPath = vi.fn<unknown[], unknown>();
const mockResolveUBTTarget = vi.fn<unknown[], unknown>();
const mockResolveProjectOrPick = vi.fn<unknown[], Promise<unknown>>();
const mockResolveEngineOrPick = vi.fn<unknown[], Promise<unknown>>();
const mockPersistSelection = vi.fn<unknown[], Promise<unknown>>();
const mockPushDiagnostics = vi.fn<unknown[], void>();
const mockClearDiagnostics = vi.fn<unknown[], void>();
const mockGetOutputChannel = vi.fn<unknown[], unknown>();
const mockWithProgress = vi.fn<unknown[], Promise<unknown>>();

vi.mock('@build', () => ({
  runBuild: (...args: unknown[]) => mockRunBuild(...args),
  buildUBTCommand: (...args: unknown[]) => mockBuildUBTCommand(...args),
  resolveUBTPath: (...args: unknown[]) => mockResolveUBTPath(...args),
  resolveUBTTarget: (...args: unknown[]) => mockResolveUBTTarget(...args),
}));

vi.mock('@commands/_resolve', () => ({
  resolveProjectOrPick: (...args: unknown[]) => mockResolveProjectOrPick(...args),
  resolveEngineOrPick: (...args: unknown[]) => mockResolveEngineOrPick(...args),
  persistSelection: (...args: unknown[]) => mockPersistSelection(...args),
}));

vi.mock('@ui/problemsPanel', () => ({
  pushDiagnostics: (...args: unknown[]) => mockPushDiagnostics(...args),
  clearDiagnostics: (...args: unknown[]) => mockClearDiagnostics(...args),
}));

vi.mock('@ui/outputChannel', () => ({
  getOutputChannel: (...args: unknown[]) => mockGetOutputChannel(...args),
}));

vi.mock('@ui/notifications', () => ({
  withProgress: (...args: unknown[]) => mockWithProgress(...args),
}));

// ============ 编辑器感知构建 + Live Coding 转发的 mock ============
// build.ts 新 import '@build/editorDetect'(避免测试环境真跑 tasklist)
// 与 './liveCoding'(避免加载真实 liveCoding.ts → 其 '@build' 具名导入触发 mock 缺导出错误)。
const mockIsUnrealEditorRunning = vi.fn<unknown[], Promise<boolean>>();
const mockExecuteLiveCoding = vi.fn<unknown[], Promise<void>>();

vi.mock('@build/editorDetect', () => ({
  isUnrealEditorRunning: (...args: unknown[]) => mockIsUnrealEditorRunning(...args),
  shouldSuggestLiveCoding: (mode: string, running: boolean) => mode === 'build' && running,
}));

vi.mock('@commands/liveCoding', () => ({
  executeLiveCoding: (...args: unknown[]) => mockExecuteLiveCoding(...args),
}));

// ============ 类型 / 辅助 ============

/** executeBuild 传给 withProgress 的 task 签名(参考 src/ui/notifications.ts) */
type ProgressTask = (
  report: (msg: string, increment?: number) => void,
  token: vscode.CancellationToken,
) => Promise<unknown>;

/** build.ts 只读 isCancellationRequested / onCancellationRequested 两个字段 */
function fakeToken(): vscode.CancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn(),
  } as unknown as vscode.CancellationToken;
}

function fakeChannel(): {
  clear: ReturnType<typeof vi.fn>;
  appendLine: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  append: ReturnType<typeof vi.fn>;
} {
  return {
    clear: vi.fn(),
    appendLine: vi.fn(),
    show: vi.fn(),
    append: vi.fn(),
  };
}

/** runBuild 成功返回体(带 cancelled 开关) */
function buildResult(exitCode: number, cancelled: boolean): unknown {
  return {
    ok: true,
    value: { exitCode, cancelled, durationMs: 100, output: [], diagnostics: [] },
  };
}

/** 让被 withProgress 异步触发的 task 链跑完(并发测试用) */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

// ============ 测试主体 ============

describe('executeBuild', () => {
  const config = {
    target: 'Editor',
    platform: 'Win64',
    configuration: 'Development',
  } as unknown as Config;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
  const detection = {} as unknown as DetectionHandles;

  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
    resetLastBuildSnapshot();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // 默认:编辑器未运行(编辑器感知分支不触发);编辑器相关测试内自行覆盖
    mockIsUnrealEditorRunning.mockResolvedValue(false);
    mockExecuteLiveCoding.mockResolvedValue(undefined);

    // 默认:withProgress 立即执行 task 并返回其结果
    (mockWithProgress as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_title: unknown, task: ProgressTask) => {
        return await task(vi.fn(), fakeToken());
      },
    );

    mockResolveProjectOrPick.mockResolvedValue({
      path: 'D:/fake/MyGame/MyGame.uproject',
      name: 'MyGame',
    });
    mockResolveEngineOrPick.mockResolvedValue({ path: 'D:/UE_5.2' });
    mockPersistSelection.mockResolvedValue(undefined);
    mockBuildUBTCommand.mockReturnValue({
      file: 'D:/UE_5.2/Engine/Build/BatchFiles/RunUBT.bat',
      args: ['-Target=MyGameEditor Win64 Development -Project=D:/fake/MyGame/MyGame.uproject'],
    });
    mockResolveUBTPath.mockReturnValue('D:/UE_5.2/Engine/Build/BatchFiles/RunUBT.bat');
    mockResolveUBTTarget.mockReturnValue('MyGameEditor');
    mockPushDiagnostics.mockImplementation(() => undefined);
    mockClearDiagnostics.mockImplementation(() => undefined);
    mockGetOutputChannel.mockReturnValue(fakeChannel());
  });

  it('成功构建弹成功提示 (exitCode 0)', async () => {
    mockRunBuild.mockResolvedValue(buildResult(0, false));

    await executeBuild('build', config, logger, detection);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('succeeded'),
    );
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('真实失败(非取消)仍弹失败警告 (F2-1 回归)', async () => {
    mockRunBuild.mockResolvedValue(buildResult(2, false));

    await executeBuild('build', config, logger, detection);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('failed with exit code 2'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('取消构建时只弹中性提示,不弹失败警告 (F2-1)', async () => {
    mockRunBuild.mockResolvedValue(buildResult(1, true));

    await executeBuild('build', config, logger, detection);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(t('cmd.buildCancelled'));
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('runBuild 返回错误时弹错误提示 (ok=false)', async () => {
    mockRunBuild.mockResolvedValue({ ok: false, error: new Error('spawn EINVAL') });

    await executeBuild('build', config, logger, detection);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('spawn EINVAL'),
    );
  });

  it('构建进行中再次触发只启动一次 (F2-2 并发守卫)', async () => {
    // 让 withProgress 的 Promise 悬起,保持第一次构建 in-flight
    let releaseProgress: (() => void) | undefined;
    (mockWithProgress as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_title: unknown, task: ProgressTask) => {
        // 立即启动 task(内部会调 runBuild),但 withProgress 不 resolve
        void Promise.resolve().then(() => task(vi.fn(), fakeToken()));
        return new Promise<void>((resolve) => {
          releaseProgress = resolve;
        });
      },
    );
    mockRunBuild.mockResolvedValue(buildResult(0, false));

    const p1 = executeBuild('build', config, logger, detection);
    try {
      // 第二次触发:应被守卫拦截,提示后直接返回
      await executeBuild('build', config, logger, detection);
      await flushMicrotasks();

      // [F2-2] 核心断言:runBuild 只被调一次,且提示"已有构建在运行"
      expect(mockRunBuild).toHaveBeenCalledTimes(1);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(t('cmd.buildInFlight'));
    } finally {
      // 无论断言是否通过都释放 in-flight,避免模块级守卫污染后续测试
      releaseProgress?.();
      await p1;
    }
    expect(mockRunBuild).toHaveBeenCalledTimes(1);
  });

  it('构建完成后守卫清空,可再次触发构建 (F2-2 回归)', async () => {
    mockRunBuild.mockResolvedValue(buildResult(0, false));

    await executeBuild('build', config, logger, detection);
    expect(mockRunBuild).toHaveBeenCalledTimes(1);

    // 第一次已完成(buildInFlight 已清空),第二次正常启动
    await executeBuild('build', config, logger, detection);
    expect(mockRunBuild).toHaveBeenCalledTimes(2);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('succeeded'),
    );
  });

  // ============ 编辑器感知构建(借鉴 engine-link "editor-aware build") ============

  /** editorAwareBuild 开启时的 config */
  const editorAwareConfig = {
    target: 'Editor',
    platform: 'Win64',
    configuration: 'Development',
    editorAwareBuild: true,
  } as unknown as Config;

  it('编辑器运行中 + 选 Live Coding → 转发 Live Coding,不跑构建', async () => {
    mockIsUnrealEditorRunning.mockResolvedValue(true);
    (vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      t('cmd.editorRunning.useLiveCoding'),
    );
    mockRunBuild.mockResolvedValue(buildResult(0, false));

    await executeBuild('build', editorAwareConfig, logger, detection, undefined, false);

    expect(mockIsUnrealEditorRunning).toHaveBeenCalledTimes(1);
    expect(mockExecuteLiveCoding).toHaveBeenCalledTimes(1);
    expect(mockRunBuild).not.toHaveBeenCalled();
  });

  it('编辑器运行中 + Esc 关闭弹窗 → 中止构建', async () => {
    mockIsUnrealEditorRunning.mockResolvedValue(true);
    (vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );

    await executeBuild('build', editorAwareConfig, logger, detection, undefined, false);

    expect(mockExecuteLiveCoding).not.toHaveBeenCalled();
    expect(mockRunBuild).not.toHaveBeenCalled();
  });

  it('editorAwareBuild=false 或 silent(MCP)时跳过检测,直接构建', async () => {
    mockIsUnrealEditorRunning.mockResolvedValue(true);
    mockRunBuild.mockResolvedValue(buildResult(0, false));

    // 关闭开关
    await executeBuild('build', config, logger, detection, undefined, false);
    // silent 路径(MCP 调用)
    await executeBuild('build', editorAwareConfig, logger, detection, undefined, true);

    expect(mockIsUnrealEditorRunning).not.toHaveBeenCalled();
    expect(mockRunBuild).toHaveBeenCalledTimes(2);
  });

  it('rebuild/clean 模式不做编辑器检测', async () => {
    mockIsUnrealEditorRunning.mockResolvedValue(true);
    mockRunBuild.mockResolvedValue(buildResult(0, false));

    await executeBuild('rebuild', editorAwareConfig, logger, detection, undefined, false);
    await executeBuild('clean', editorAwareConfig, logger, detection, undefined, false);

    expect(mockIsUnrealEditorRunning).not.toHaveBeenCalled();
    expect(mockRunBuild).toHaveBeenCalledTimes(2);
  });

  // ============ 最近构建快照(MCP ue_get_build_errors 数据源) ============

  it('构建结束后记录 LastBuildSnapshot 供 MCP 读取', async () => {
    mockRunBuild.mockResolvedValue(
      buildResultWithDiagnostics(2, false, [
        {
          file: 'a.cpp',
          line: 1,
          severity: 'error',
          code: 'C2065',
          message: 'undeclared',
          raw: '',
        },
      ]),
    );

    await executeBuild('build', config, logger, detection);

    const snap = getLastBuildSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.mode).toBe('build');
    expect(snap!.ok).toBe(false);
    expect(snap!.exitCode).toBe(2);
    expect(snap!.diagnostics).toHaveLength(1);
    expect(snap!.finishedAtIso).toBeTruthy();
  });

  it('UBT 脚本缺失时记录带 error 的失败快照', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await executeBuild('build', config, logger, detection);

    const snap = getLastBuildSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.ok).toBe(false);
    expect(snap!.exitCode).toBeNull();
    expect(snap!.error).toContain('UBT script not found');
  });
});

/** runBuild 成功返回体(可带诊断列表) */
function buildResultWithDiagnostics(
  exitCode: number,
  cancelled: boolean,
  diagnostics: unknown[],
): unknown {
  return {
    ok: true,
    value: { exitCode, cancelled, durationMs: 100, output: [], diagnostics },
  };
}
