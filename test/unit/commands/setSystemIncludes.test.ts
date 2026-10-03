/**
 * setSystemIncludes.test.ts —— executeSetSystemIncludes 命令单元测试(envelope 对齐)
 *
 * 说明:函数返回 Promise<Envelope<undefined>>(Wave3 类型收口后,骨架阶段的
 * Promise<void> 静态签名与 cast 桥接已删除),测试直接断言 envelope。
 *
 * 覆盖:
 *   - 成功:渲染 flags → applyAddFlags 写入 → ok envelope + userAddFlags 同步回设置
 *   - silent 且未检测到项目 → PROJECT_NOT_DETECTED(不弹 picker)
 *   - clangd 探测失败 → CLANGD_NOT_AVAILABLE(映射表直配)
 *   - MSVC/SDK 版本列表为空 → INTERNAL_ERROR(缺口登记:契约枚举无贴切码)
 *   - 用户取消 MSVC QuickPick → OPERATION_CANCELLED(映射表直配)
 *   - applyAddFlags 失败 → err envelope,且成功提示仍弹出(spec-as-is 现有控制流保持)
 *   - clangdOps 未注入 → INTERNAL_ERROR(原 throw 收口为 envelope)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import * as vscode from 'vscode';
import type { Logger } from '@core/logger';
import type { Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from '@clangd/clangdOps';
import type { SystemIncludeInfo } from '@clangd/windowsSdk';
import type { Envelope } from '@core/envelope';

// ---- Mock @clangd/windowsSdk(全量替换,不依赖真实 MSVC/SDK 探测) ----

const mockDiscover = vi.fn<unknown[], Promise<SystemIncludeInfo | null>>();
const mockListMsvc = vi.fn<unknown[], Promise<string[]>>();
const mockListSdk = vi.fn<unknown[], Promise<string[]>>();
const mockRenderFlags = vi.fn<unknown[], Promise<string[]>>();
const mockReadRecommended = vi.fn<unknown[], Promise<string | null>>();
const mockSelectSdk = vi.fn<unknown[], string>();

vi.mock('@clangd/windowsSdk', () => ({
  discoverSystemIncludes:
    (...args: unknown[]): Promise<SystemIncludeInfo | null> => mockDiscover(...args),
  listMsvcVersions: (...args: unknown[]): Promise<string[]> => mockListMsvc(...args),
  listSdkVersions: (...args: unknown[]): Promise<string[]> => mockListSdk(...args),
  renderClangdFlags: (...args: unknown[]): Promise<string[]> => mockRenderFlags(...args),
  readRecommendedSdkVersion:
    (...args: unknown[]): Promise<string | null> => mockReadRecommended(...args),
  selectSdkVersion: (...args: unknown[]): string => mockSelectSdk(...args),
}));

// ---- Mock @clangd/flagGlossary ----

const mockResolveFlags = vi.fn<unknown[], string[]>();
vi.mock('@clangd/flagGlossary', () => ({
  resolveFlags: (...args: unknown[]): string[] => mockResolveFlags(...args),
}));

// ---- Mock @ui/quickPicks(_resolve 的 picker fallback,本测试不应触达) ----

vi.mock('@ui/quickPicks', () => ({
  pickProject: vi.fn(() => Promise.resolve(undefined)),
  pickEngine: vi.fn(() => Promise.resolve(undefined)),
}));

// ---- 导入被测函数 ----

import { executeSetSystemIncludes } from '@commands/setSystemIncludes';

// ---- fixtures ----

const PROJECT = {
  path: 'C:\\UEProjects\\MyGame\\MyGame.uproject',
  name: 'MyGame',
  engineVersion: '5.4.0',
};

const DETECTED = {
  msvcRoot: 'C:\\VS\\MSVC\\14.38.33130',
  sdkRoot: 'C:\\Kits\\10\\Include\\10.0.22621.0',
  fmsCompatibilityVersion: '19.38.33130',
};

function createLoggerMock(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    show: vi.fn(),
    channel: {} as never,
    prefix: 'test',
    currentLevel: 'info' as const,
    setLevel: vi.fn(),
    log: vi.fn(),
    getLevel: vi.fn(),
    getOutputChannel: vi.fn(),
    dispose: vi.fn(),
  } as unknown as Logger;
}

function createConfigMock(): { config: Config; updateMock: Mock<[], Promise<void>> } {
  const updateMock = vi.fn(() => Promise.resolve());
  return {
    config: {
      clangdPath: 'C:\\LLVM\\bin\\clangd.exe',
      userAddFlags: undefined,
      update: updateMock,
    } as unknown as Config,
    updateMock,
  };
}

function createDetectionMock(projects: unknown[]): DetectionHandles {
  return {
    ready: Promise.resolve({ projects, engines: [] }),
    workspaceContext: {
      getSelectedProject: vi.fn(() => undefined),
      getSelectedEngine: vi.fn(() => undefined),
      setProject: vi.fn(() => Promise.resolve(undefined)),
      setEngine: vi.fn(() => Promise.resolve(undefined)),
    },
  } as unknown as DetectionHandles;
}

function createWorkspaceMock(resolved: unknown = PROJECT): WorkspaceState {
  return {
    resolveSelectedProject: vi.fn(() => resolved),
    setSelectedProject: vi.fn(() => Promise.resolve(undefined)),
    selectedEngine: null,
    resolveSelectedEngine: vi.fn(() => undefined),
    setSelectedEngine: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as WorkspaceState;
}

function createClangdOpsMock(applyResult?: {
  ok: boolean;
  reason?: string;
}): { ops: ClangdOps; applyAddFlagsMock: Mock<[], Promise<{ ok: boolean; reason?: string }>> } {
  const applyAddFlagsMock: Mock<[], Promise<{ ok: boolean; reason?: string }>> = vi.fn(() =>
    Promise.resolve(applyResult ?? { ok: true }),
  );
  return {
    ops: {
      exists: vi.fn(() => Promise.resolve(true)),
      writeFull: vi.fn(() => Promise.resolve(undefined)),
      applyAddFlags: applyAddFlagsMock,
    } as unknown as ClangdOps,
    applyAddFlagsMock,
  };
}

/** executeSetSystemIncludes 已返回 Promise<Envelope<undefined>>(Wave3 类型收口),直接断言 */
async function invoke(opts: {
  config: Config;
  logger: Logger;
  detection: DetectionHandles;
  workspace?: WorkspaceState;
  clangdOps?: ClangdOps;
  silent?: boolean;
}): Promise<Envelope> {
  const result = await executeSetSystemIncludes(
    opts.config,
    opts.logger,
    opts.detection,
    opts.workspace,
    opts.clangdOps,
    opts.silent,
  );
  return result;
}

describe('executeSetSystemIncludes(envelope 对齐)', () => {
  let logger: Logger;
  let config: Config;
  let updateMock: Mock<[], Promise<void>>;
  let detection: DetectionHandles;
  let workspace: WorkspaceState;
  let clangdOps: ClangdOps;
  let applyAddFlagsMock: Mock<[], Promise<{ ok: boolean; reason?: string }>>;
  let showQuickPickMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = createLoggerMock();
    ({ config, updateMock } = createConfigMock());
    detection = createDetectionMock([PROJECT]);
    workspace = createWorkspaceMock();
    ({ ops: clangdOps, applyAddFlagsMock } = createClangdOpsMock());

    mockDiscover.mockReset().mockResolvedValue(DETECTED);
    mockListMsvc.mockReset().mockResolvedValue(['14.36.32532', '14.38.33130']);
    mockListSdk.mockReset().mockResolvedValue(['10.0.19041.0', '10.0.22621.0']);
    mockSelectSdk.mockReset().mockReturnValue('10.0.22621.0');
    mockRenderFlags.mockReset().mockResolvedValue(['-fms-compatibility-version=19.38.33130']);
    mockResolveFlags.mockReset().mockReturnValue(['FLAG_A']);

    showQuickPickMock = vscode.window.showQuickPick as unknown as ReturnType<typeof vi.fn>;
    showQuickPickMock
      .mockReset()
      .mockResolvedValueOnce({ label: '14.38.33130' })
      .mockResolvedValueOnce({ label: '10.0.22621.0' });
  });

  it('成功:渲染 flags 经 applyAddFlags 写入,userAddFlags 同步回设置,返回 ok envelope', async () => {
    const env = await invoke({ config, logger, detection, workspace, clangdOps });

    expect(mockDiscover).toHaveBeenCalledWith(config.clangdPath, logger);
    expect(applyAddFlagsMock).toHaveBeenCalledWith(['FLAG_A']);
    expect(updateMock).toHaveBeenCalledWith('clangd.userAddFlags', [
      'system-include-windows',
    ]);
    expect(
      vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith(expect.stringContaining('System includes set'));
    // [envelope 对齐] 成功 → ok envelope,摘要复用现有提示文案语义
    expect(env.ok).toBe(true);
    expect(env.error).toBeUndefined();
    expect(env.summary).toBe('System includes set: MSVC 14.38.33130, SDK 10.0.22621.0');
  });

  it('silent 且未检测到项目 → PROJECT_NOT_DETECTED,不触发探测、不弹 picker', async () => {
    const emptyDetection = createDetectionMock([]);
    // 传 null(而非 undefined):默认参数会对 undefined 回落为 PROJECT,null 才表示"解析为空"
    const noProjectWs = createWorkspaceMock(null);

    const env = await invoke({
      config,
      logger,
      detection: emptyDetection,
      workspace: noProjectWs,
      clangdOps,
      silent: true,
    });

    expect(
      vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith(expect.stringContaining('.uproject'));
    expect(mockDiscover).not.toHaveBeenCalled();
    expect(showQuickPickMock).not.toHaveBeenCalled();
    // [envelope 对齐] 未检测到 .uproject → PROJECT_NOT_DETECTED(映射表直配)
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('PROJECT_NOT_DETECTED');
  });

  it('clangd 探测失败 → CLANGD_NOT_AVAILABLE,弹错误提示(现有 modal 行为保持)', async () => {
    mockDiscover.mockReset().mockResolvedValue(null);

    const env = await invoke({ config, logger, detection, workspace, clangdOps });

    expect(
      vscode.window.showErrorMessage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalled();
    // [envelope 对齐] clangd/clang 可执行文件不可用 → CLANGD_NOT_AVAILABLE(映射表直配)
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('CLANGD_NOT_AVAILABLE');
  });

  it('MSVC/SDK 版本列表为空 → INTERNAL_ERROR(缺口登记),弹错误提示', async () => {
    mockListMsvc.mockReset().mockResolvedValue([]);

    const env = await invoke({ config, logger, detection, workspace, clangdOps });

    expect(
      vscode.window.showErrorMessage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith('No MSVC or Windows SDK versions found under the detected paths.');
    // [错误码缺口登记] 探测到 clangd 但版本目录为空,枚举无贴切码 → 兜底 INTERNAL_ERROR
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INTERNAL_ERROR');
    expect(applyAddFlagsMock).not.toHaveBeenCalled();
  });

  it('用户取消 MSVC QuickPick → OPERATION_CANCELLED', async () => {
    showQuickPickMock.mockReset().mockResolvedValueOnce(undefined);

    const env = await invoke({ config, logger, detection, workspace, clangdOps });

    // [envelope 对齐] 用户取消 QuickPick → OPERATION_CANCELLED(映射表直配;现有静默返回行为保持)
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('OPERATION_CANCELLED');
    expect(applyAddFlagsMock).not.toHaveBeenCalled();
  });

  it('applyAddFlags 失败 → err envelope,且成功提示仍弹出(spec-asis 现有控制流保持)', async () => {
    const { ops: failingOps } = createClangdOpsMock({ ok: false, reason: 'boom' });

    const env = await invoke({ config, logger, detection, workspace, clangdOps: failingOps });

    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INTERNAL_ERROR');
    expect(env.error?.message).toContain('boom');
    // 现有行为保持:applyAddFlags 失败历史上不阻断"System includes set"提示
    expect(
      vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith(expect.stringContaining('System includes set'));
  });

  it('clangdOps 未注入 → 原 throw 收口为 INTERNAL_ERROR envelope', async () => {
    const env = await invoke({ config, logger, detection, workspace, clangdOps: undefined });

    // [envelope 对齐] 出口 catch:架构性未注入错误不再向上抛,统一收口为 INTERNAL_ERROR
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INTERNAL_ERROR');
    expect(env.error?.message).toContain('ClangdOps is required');
  });
});
