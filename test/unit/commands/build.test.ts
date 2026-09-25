/**
 * build 命令测试 —— executeBuild 的取消 / 并发守卫分支 + Wave2 envelope 对齐
 *
 * [F2-1] 用户取消构建:runBuild 返回 cancelled=true 时,命令层只弹中性提示
 *         ("构建已取消"),不弹 "failed with exit code" 失败警告
 * [F2-2] 构建并发守卫:buildInFlight 非空时再次触发,提示"已有构建在运行"
 *         并直接返回(不排队),runBuild 只被调一次
 * [Wave2] envelope 对齐(决策 D5/C8):成功 → okEnvelope(data: BuildResult);
 *         取消 → OPERATION_CANCELLED;UBT 缺失 → UBT_NOT_FOUND;
 *         spawn 失败 → BUILD_FAILED;exitCode≠0 仍 ok:true 如实上报
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
  const actual = await vi.importActual<typeof fs>('node:fs');
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
const mockExecuteLiveCoding = vi.fn<unknown[], Promise<unknown>>();

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

    const env = await executeBuild('build', config, logger, detection);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('succeeded'),
    );
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    // [Wave2] envelope 对齐:data 对齐契约 BuildResult
    expect(env).toMatchObject({
      ok: true,
      data: { mode: 'build', exitCode: 0, durationMs: 100 },
    });
    expect(env.error).toBeUndefined();
  });

  it('真实失败(非取消)仍弹失败警告 (F2-1 回归)', async () => {
    mockRunBuild.mockResolvedValue(buildResult(2, false));

    await executeBuild('build', config, logger, detection);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('failed with exit code 2'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('UBT 退出码非 0 仍返回 ok:true + data.exitCode 如实上报 (契约 BuildDone 语义)', async () => {
    mockRunBuild.mockResolvedValue(buildResult(2, false));

    const env = await executeBuild('build', config, logger, detection);

    expect(env).toMatchObject({ ok: true, data: { mode: 'build', exitCode: 2 } });
    expect(env.error).toBeUndefined();
  });

  it('取消构建时只弹中性提示,不弹失败警告 (F2-1)', async () => {
    mockRunBuild.mockResolvedValue(buildResult(1, true));

    const env = await executeBuild('build', config, logger, detection);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(t('cmd.buildCancelled'));
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    // [Wave2] 用户取消 → OPERATION_CANCELLED
    expect(env).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_CANCELLED' },
    });
  });

  it('runBuild 返回错误时弹错误提示 (ok=false)', async () => {
    mockRunBuild.mockResolvedValue({ ok: false, error: new Error('spawn EINVAL') });

    const env = await executeBuild('build', config, logger, detection);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('spawn EINVAL'),
    );
    // [Wave2] 进程级启动失败/无法执行 → BUILD_FAILED
    expect(env).toMatchObject({ ok: false, error: { code: 'BUILD_FAILED' } });
  });

  it('[Wave2] 未选项目 → ok:false + PROJECT_NOT_DETECTED', async () => {
    mockResolveProjectOrPick.mockResolvedValue(undefined);

    const env = await executeBuild('build', config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_DETECTED' } });
    expect(mockRunBuild).not.toHaveBeenCalled();
  });

  it('[Wave2] 未选引擎 → ok:false + UBT_NOT_FOUND', async () => {
    mockResolveEngineOrPick.mockResolvedValue(undefined);

    const env = await executeBuild('build', config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'UBT_NOT_FOUND' } });
    expect(mockRunBuild).not.toHaveBeenCalled();
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
      const env2 = await executeBuild('build', config, logger, detection);
      await flushMicrotasks();

      // [F2-2] 核心断言:runBuild 只被调一次,且提示"已有构建在运行"
      expect(mockRunBuild).toHaveBeenCalledTimes(1);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(t('cmd.buildInFlight'));
      // [Wave2] 守卫拦截 → ok:false + OPERATION_CANCELLED
      expect(env2).toMatchObject({ ok: false, error: { code: 'OPERATION_CANCELLED' } });
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
    // [Wave2] Live Coding 的 envelope 原样透传
    mockExecuteLiveCoding.mockResolvedValue({ ok: true, marker: 'liveCoding' });

    const env = await executeBuild('build', editorAwareConfig, logger, detection, undefined, false);

    expect(mockIsUnrealEditorRunning).toHaveBeenCalledTimes(1);
    expect(mockExecuteLiveCoding).toHaveBeenCalledTimes(1);
    expect(mockRunBuild).not.toHaveBeenCalled();
    expect(env).toEqual({ ok: true, marker: 'liveCoding' });
  });

  it('编辑器运行中 + Esc 关闭弹窗 → 中止构建', async () => {
    mockIsUnrealEditorRunning.mockResolvedValue(true);
    (vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );

    const env = await executeBuild('build', editorAwareConfig, logger, detection, undefined, false);

    expect(mockExecuteLiveCoding).not.toHaveBeenCalled();
    expect(mockRunBuild).not.toHaveBeenCalled();
    // [Wave2] 用户关闭弹窗放弃构建 → OPERATION_CANCELLED
    expect(env).toMatchObject({ ok: false, error: { code: 'OPERATION_CANCELLED' } });
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

    const env = await executeBuild('build', config, logger, detection);

    const snap = getLastBuildSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.ok).toBe(false);
    expect(snap!.exitCode).toBeNull();
    expect(snap!.error).toContain('UBT script not found');
    // [Wave2] UBT/引擎路径不可用 → UBT_NOT_FOUND
    expect(env).toMatchObject({ ok: false, error: { code: 'UBT_NOT_FOUND' } });
    expect((env.error as { message?: string }).message).toContain('UBT script not found');
  });

  // ============ [add-002] 单模块编译(module 参数贯穿) ============

  it('[add-002] 带 module:透传 buildUBTCommand,envelope/快照/通知均带模块名', async () => {
    mockRunBuild.mockResolvedValue(buildResult(0, false));

    const env = await executeBuild(
      'build',
      config,
      logger,
      detection,
      undefined,
      false,
      undefined,
      'Foo',
    );

    // UBTArgs 透传 module
    expect(mockBuildUBTCommand).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'Foo' }),
    );
    // envelope data 对齐契约 BuildResult.module
    expect(env).toMatchObject({ ok: true, data: { mode: 'build', module: 'Foo', exitCode: 0 } });
    // 成功通知注明模块名,避免与全量构建提示混淆
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Module build (Foo)'),
    );
    // 快照记录 module,供 ue_get_build_errors 回读
    const snap = getLastBuildSnapshot();
    expect(snap?.module).toBe('Foo');
  });

  it('[add-002] 带 module 且构建失败:失败快照同样记录 module', async () => {
    mockRunBuild.mockResolvedValue(buildResult(2, false));

    await executeBuild('build', config, logger, detection, undefined, false, undefined, 'Foo');

    const snap = getLastBuildSnapshot();
    expect(snap?.module).toBe('Foo');
    expect(snap?.ok).toBe(false);
  });

  it('[add-002] 不带 module:全链路与现状一致(UbtArgs/data/快照均无 module 键)', async () => {
    mockRunBuild.mockResolvedValue(buildResult(0, false));

    const env = await executeBuild('build', config, logger, detection);

    // buildUBTCommand 收到的对象精确无 module 键(toStrictEqual 严格比较)
    expect(mockBuildUBTCommand).toHaveBeenCalledWith({
      project: 'D:/fake/MyGame/MyGame.uproject',
      target: 'MyGameEditor',
      platform: 'Win64',
      configuration: 'Development',
      ubtPath: 'D:/UE_5.2/Engine/Build/BatchFiles/RunUBT.bat',
    });
    expect(env.data).toBeDefined();
    expect('module' in env.data!).toBe(false);
    const snap = getLastBuildSnapshot();
    expect(snap).not.toBeNull();
    expect('module' in snap!).toBe(false);
    // 通知文案不出现模块名前缀
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/^Building UE project succeeded/),
    );
  });

  it('[评审 minor] rebuild 直调携带 module:函数层防线丢弃,UBTArgs 无 module 键', async () => {
    mockRunBuild.mockResolvedValue(buildResult(0, false));

    const env = await executeBuild(
      'rebuild',
      config,
      logger,
      detection,
      undefined,
      false,
      undefined,
      'Foo',
    );

    // module 被函数层丢弃:不带 -Module,快照/envelope 亦无 module 键
    const ubtArgs = mockBuildUBTCommand.mock.calls[0]?.[0] as { module?: string } | undefined;
    expect(ubtArgs?.module).toBeUndefined();
    expect('module' in env.data!).toBe(false);
    expect('module' in getLastBuildSnapshot()!).toBe(false);
  });

  it('[评审 minor] withProgress 异常中断:catch 路径快照同样带 module', async () => {
    (mockWithProgress as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    );

    const env = await executeBuild(
      'build',
      config,
      logger,
      detection,
      undefined,
      false,
      undefined,
      'Foo',
    );

    // 异常经外层包装为 INTERNAL_ERROR
    expect(env).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    const snap = getLastBuildSnapshot();
    expect(snap?.module).toBe('Foo');
    expect(snap?.error).toBe('boom');
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
