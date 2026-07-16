/**
 * firstRunInit.test.ts —— 首次初始化编排器单元测试
 *
 * 覆盖 AC-9：
 * 1. .code-workspace 解析与 initialized 字段检测
 * 2. markInitializedInWorkspace 写回 + 原子性
 * 3. 串行编排器在第一步/第二步失败时的 short-circuit 行为
 * 4. 全 happy path：执行两步 + 写标记 + reload window
 * 5. 跳过分支：project null / workspaceFile null / 已初始化
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import type { ClangdHandles } from '@clangd';
import type { DetectionHandles, ProjectInfo } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import {
  runFirstTimeInit,
  isFirstRunVscodeWorkspace,
  markInitializedInWorkspace,
} from '@commands/firstRunInit';
import { executeCreateProject } from '@commands/createProject';
import { executeEnableClangdProxy } from '@commands/enableClangdProxy';
// 仅用于配合 vi.mock 工厂副作用,实际通过 mock 函数调用
void executeCreateProject;
void executeEnableClangdProxy;
import { initI18n } from '@i18n';

// .code-workspace JSON 形状的类型描述,用于解析写入内容时绕过 @typescript-eslint/no-unsafe-*
type WorkspaceJson = {
  folders?: unknown[];
  settings?: {
    vscodeUEHelper?: { initialized?: boolean; [k: string]: unknown };
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

// 用 vi.hoisted 让 mock 函数在 import 时即可被引用
const {
  executeCreateProjectMock,
  executeEnableClangdProxyMock,
  accessMock,
  readFileMock,
  writeFileMock,
  renameMock,
} = vi.hoisted(() => {
  return {
    executeCreateProjectMock: vi.fn(),
    executeEnableClangdProxyMock: vi.fn(),
    accessMock: vi.fn(),
    readFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    renameMock: vi.fn(),
  };
});

vi.mock('@commands/createProject', () => ({
  executeCreateProject: executeCreateProjectMock,
}));

vi.mock('@commands/enableClangdProxy', () => ({
  executeEnableClangdProxy: executeEnableClangdProxyMock,
}));

// node:fs/promises 的导出是 read-only 属性，必须用 vi.mock 整体替换
vi.mock('node:fs/promises', () => ({
  access: accessMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
  rename: renameMock,
  default: {
    access: accessMock,
    readFile: readFileMock,
    writeFile: writeFileMock,
    rename: renameMock,
  },
}));

// 默认 fs mock 行为：access 抛 ENOENT（文件不存在）
accessMock.mockImplementation(() => {
  const err = new Error('ENOENT') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return Promise.reject(err);
});
readFileMock.mockResolvedValue('');
writeFileMock.mockResolvedValue(undefined);
renameMock.mockResolvedValue(undefined);

// ============ Mock 辅助函数 ============

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

function createConfigMock(): Config {
  return {
    get clangdProxyEnabled() {
      return false;
    },
    clangdProxyKeepaliveMax: 20,
    clangdProxyKeepaliveTtlSec: 900,
    clangdProxyRealClangdPath: undefined,
    clangdProxyLogPath: undefined,
    update: vi.fn(() => Promise.resolve()),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as Config;
}

function createClangdHandlesMock(): ClangdHandles {
  return {
    completionMode: {} as never,
    backup: {} as never,
    proxyManager: {
      enabled: false,
      isActive: false,
      hasBackup: false,
      launcherPath: '/fake/extension/out/launcher/proxy-launcher.bat',
      logPath: '',
      enable: vi.fn(() => Promise.resolve()),
      disable: vi.fn(() => Promise.resolve()),
      reapply: vi.fn(() => Promise.resolve()),
      getStatus: vi.fn(),
    } as never,
  };
}

function createProjectInfo(name = 'MyProject'): ProjectInfo {
  return {
    name,
    path: `/fake/proj/${name}/${name}.uproject`,
    directory: `/fake/proj/${name}`,
    modules: [],
    enginePath: '/fake/UE5',
    engineVersion: '5.4.0',
  } as unknown as ProjectInfo;
}

function createDetectionHandlesMock(opts?: {
  workspaceFile?: string;
  projectInfo?: ProjectInfo | null;
}): DetectionHandles {
  const projectInfo = opts?.projectInfo === undefined ? createProjectInfo() : opts.projectInfo;
  const workspaceFile = opts?.workspaceFile ?? '/fake/proj/MyProject.code-workspace';
  return {
    scanner: { scan: vi.fn(() => Promise.resolve(projectInfo ? [projectInfo] : [])) } as never,
    discovery: {} as never,
    vsBuildTools: {} as never,
    workspaceContext: {
      getSelectedProject: vi.fn(() => undefined),
      setProject: vi.fn(() => Promise.resolve()),
    } as never,
    ready: Promise.resolve({
      projects: projectInfo ? [projectInfo] : [],
      engines: [],
      workspaceFile,
      workspaceRoot: '/fake/proj',
      workspaceFolders: [],
      projectFolder: projectInfo
        ? { name: 'MyProject', path: '.', role: 'project', absPath: '/fake/proj' }
        : null,
      engineFolder: null,
    }),
  };
}

function createWorkspaceMock(opts?: {
  project?: ProjectInfo | null;
  workspaceFile?: string | null;
}): WorkspaceState {
  const project = opts?.project === undefined ? createProjectInfo() : opts.project;
  const workspaceFile = opts?.workspaceFile === undefined ? '/fake/proj/MyProject.code-workspace' : opts.workspaceFile;
  const state = {
    get isInjected() {
      return true;
    },
    get workspaceFile() {
      return workspaceFile;
    },
    get project() {
      return project;
    },
    get engine() {
      return null;
    },
    get projectFolder() {
      return null;
    },
    get engineFolder() {
      return null;
    },
    get workspaceFolders() {
      return [];
    },
    get workspaceRoot() {
      return workspaceFile ? '/fake/proj' : null;
    },
  };
  return state as unknown as WorkspaceState;
}

function createContextMock(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState: {} as never,
    globalState: {} as never,
    extensionUri: {} as never,
    extensionPath: '',
    storagePath: undefined,
    globalStoragePath: '',
    logPath: '',
    asAbsolutePath: (p: string) => p,
    storageUri: undefined,
    globalStorageUri: undefined,
    logUri: undefined,
    extensionMode: 1,
    secrets: {} as never,
    environmentVariableCollection: {} as never,
    extension: {} as never,
    languageModelAccessInformation: {} as never,
  } as unknown as vscode.ExtensionContext;
}

// ============ 测试组 1：isFirstRunVscodeWorkspace 探测函数 ============
describe('isFirstRunVscodeWorkspace', () => {
  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
    // 恢复默认 fs mock 行为（access ENOENT）
    accessMock.mockImplementation(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      return Promise.reject(err);
    });
    readFileMock.mockResolvedValue('');
    writeFileMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
  });

  it('returns true when file does not exist', async () => {
    // 默认行为：access 抛 ENOENT

    const result = await isFirstRunVscodeWorkspace('/fake/missing.code-workspace');

    expect(result).toBe(true);
    expect(accessMock).toHaveBeenCalledWith('/fake/missing.code-workspace');
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('returns true when JSON is corrupted', async () => {
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue('{ this is not valid JSON');

    const result = await isFirstRunVscodeWorkspace('/fake/corrupt.code-workspace');

    expect(result).toBe(true);
  });

  it('returns true when JSON is valid but missing initialized field', async () => {
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(
      JSON.stringify({ folders: [], settings: { 'editor.fontSize': 14 } }),
    );

    const result = await isFirstRunVscodeWorkspace('/fake/no-flag.code-workspace');

    expect(result).toBe(true);
  });

  it('returns false when settings.vscodeUEHelper.initialized === true', async () => {
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(
      JSON.stringify({
        folders: [],
        settings: { vscodeUEHelper: { initialized: true } },
      }),
    );

    const result = await isFirstRunVscodeWorkspace('/fake/initialized.code-workspace');

    expect(result).toBe(false);
  });

  it('returns true when settings.vscodeUEHelper.initialized === false', async () => {
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(
      JSON.stringify({
        folders: [],
        settings: { vscodeUEHelper: { initialized: false } },
      }),
    );

    const result = await isFirstRunVscodeWorkspace('/fake/explicit-false.code-workspace');

    expect(result).toBe(true);
  });
});

// 测试组 2：markInitializedInWorkspace 写回验证
describe('markInitializedInWorkspace', () => {
  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
  });

  it('writes settings.vscodeUEHelper.initialized = true and preserves other keys', async () => {
    const originalJson = JSON.stringify({
      folders: [{ path: '.' }],
      settings: {
        'editor.fontSize': 14,
        vscodeUEHelper: { someOtherKey: 'keep-me' },
      },
    });
    let writtenContent: string | undefined;
    readFileMock.mockResolvedValue(originalJson);
    writeFileMock.mockImplementation((_path: string, data: string | NodeJS.ArrayBufferView) => {
      writtenContent = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
      return Promise.resolve(undefined);
    });
    renameMock.mockResolvedValue(undefined);

    await markInitializedInWorkspace('/fake/proj/MyProject.code-workspace');

    expect(writtenContent).toBeDefined();
    const parsed = JSON.parse(writtenContent ?? '{}') as WorkspaceJson;
    expect(parsed.settings?.vscodeUEHelper?.initialized).toBe(true);
    expect(parsed.settings?.['editor.fontSize']).toBe(14);
    expect(parsed.settings?.vscodeUEHelper?.someOtherKey).toBe('keep-me');
    expect(parsed.folders).toEqual([{ path: '.' }]);
  });

  it('creates settings.vscodeUEHelper namespace if missing', async () => {
    const originalJson = JSON.stringify({ folders: [] });
    let writtenContent: string | undefined;
    readFileMock.mockResolvedValue(originalJson);
    writeFileMock.mockImplementation((_path: string, data: string | NodeJS.ArrayBufferView) => {
      writtenContent = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
      return Promise.resolve(undefined);
    });
    renameMock.mockResolvedValue(undefined);

    await markInitializedInWorkspace('/fake/proj/NewProject.code-workspace');

    const parsed = JSON.parse(writtenContent ?? '{}') as WorkspaceJson;
    expect(parsed.settings).toBeDefined();
    expect(parsed.settings?.vscodeUEHelper?.initialized).toBe(true);
  });

  it('throws when write fails (not swallowed)', async () => {
    readFileMock.mockResolvedValue('{}');
    writeFileMock.mockRejectedValue(new Error('EACCES: permission denied'));

    await expect(markInitializedInWorkspace('/fake/proj/LockedProject.code-workspace')).rejects.toThrow(
      /EACCES|permission/i,
    );
  });
});

// 测试组 3：编排器短路（核心）
describe('runFirstTimeInit failure semantics', () => {
  let logger: Logger;
  let config: Config;
  let detection: DetectionHandles;
  let clangd: ClangdHandles;
  let workspace: WorkspaceState;

  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
    logger = createLoggerMock();
    config = createConfigMock();
    detection = createDetectionHandlesMock();
    clangd = createClangdHandlesMock();
    workspace = createWorkspaceMock();

    // 默认展示信息 + 用户点 Initialize
    (vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('Initialize');
  });

  it('does not call executeEnableClangdProxy when executeCreateProject throws', async () => {
    executeCreateProjectMock.mockRejectedValue(new Error('mock createProject failure'));
    executeEnableClangdProxyMock.mockResolvedValue(undefined);

    const result = await runFirstTimeInit(
      { context: createContextMock(), config, logger, detection, clangd, workspace },
      createContextMock(),
    );

    expect(result).toBe('fail');
    expect(executeCreateProjectMock).toHaveBeenCalledOnce();
    expect(executeEnableClangdProxyMock).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('workbench.action.reloadWindow');
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('mock createProject failure'),
    );
  });

  it('does not call workbench.action.reloadWindow when executeEnableClangdProxy throws', async () => {
    executeCreateProjectMock.mockResolvedValue(undefined);
    executeEnableClangdProxyMock.mockRejectedValue(new Error('mock proxy failure'));

    const result = await runFirstTimeInit(
      { context: createContextMock(), config, logger, detection, clangd, workspace },
      createContextMock(),
    );

    expect(result).toBe('fail');
    expect(executeCreateProjectMock).toHaveBeenCalledOnce();
    expect(executeEnableClangdProxyMock).toHaveBeenCalledOnce();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('workbench.action.reloadWindow');
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('mock proxy failure'),
    );
  });
});

// 测试组 4：全 happy path
describe('runFirstTimeInit happy path', () => {
  let logger: Logger;
  let config: Config;
  let detection: DetectionHandles;
  let clangd: ClangdHandles;
  let workspace: WorkspaceState;

  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
    logger = createLoggerMock();
    config = createConfigMock();
    detection = createDetectionHandlesMock();
    clangd = createClangdHandlesMock();
    workspace = createWorkspaceMock();

    (vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('Initialize');
  });

  it('runs both steps, writes marker, then reloads window', async () => {
    executeCreateProjectMock.mockResolvedValue(undefined);
    executeEnableClangdProxyMock.mockResolvedValue(undefined);

    // mock fs：让 markInitializedInWorkspace 走通
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(JSON.stringify({ folders: [] }));
    writeFileMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);

    const result = await runFirstTimeInit(
      { context: createContextMock(), config, logger, detection, clangd, workspace },
      createContextMock(),
    );

    expect(result).toBe('init');
    expect(executeCreateProjectMock).toHaveBeenCalledOnce();
    expect(executeEnableClangdProxyMock).toHaveBeenCalledOnce();
    expect(renameMock).toHaveBeenCalledOnce();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.reloadWindow');
  });

  // 防回归：enableClangdProxy 内部若自行触发 reload，firstRunInit 内的
  // markInitializedInWorkspace 还没执行 → reload 后 .code-workspace 没标记 →
  // 重新激活再次提示未初始化（双 reload 时序 bug）。
  it('passes suppressReloadPrompt: true to executeEnableClangdProxy', async () => {
    executeCreateProjectMock.mockResolvedValue(undefined);
    executeEnableClangdProxyMock.mockResolvedValue(undefined);

    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(JSON.stringify({ folders: [] }));
    writeFileMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);

    const result = await runFirstTimeInit(
      { context: createContextMock(), config, logger, detection, clangd, workspace },
      createContextMock(),
    );

    expect(result).toBe('init');
    expect(executeEnableClangdProxyMock).toHaveBeenCalledWith(
      config,
      logger,
      clangd,
      { suppressReloadPrompt: true },
    );
  });
});

// 测试组 5：跳过分支
describe('runFirstTimeInit skip branches', () => {
  let logger: Logger;
  let config: Config;
  let detection: DetectionHandles;
  let clangd: ClangdHandles;

  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
    logger = createLoggerMock();
    config = createConfigMock();
    detection = createDetectionHandlesMock();
    clangd = createClangdHandlesMock();
  });

  it('skips when workspace.project is null', async () => {
    const workspace = createWorkspaceMock({ project: null });

    const result = await runFirstTimeInit(
      { context: createContextMock(), config, logger, detection, clangd, workspace },
      createContextMock(),
    );

    expect(result).toBe('skip');
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(executeCreateProjectMock).not.toHaveBeenCalled();
    expect(executeEnableClangdProxyMock).not.toHaveBeenCalled();
  });

  it('skips when workspace.workspaceFile is null', async () => {
    const workspace = createWorkspaceMock({ workspaceFile: null });

    const result = await runFirstTimeInit(
      { context: createContextMock(), config, logger, detection, clangd, workspace },
      createContextMock(),
    );

    expect(result).toBe('skip');
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(executeCreateProjectMock).not.toHaveBeenCalled();
  });

  it('skips when initialized === true in .code-workspace', async () => {
    const workspace = createWorkspaceMock({ workspaceFile: '/fake/proj/Init.code-workspace' });

    // isFirstRunVscodeWorkspace 探测到 initialized=true → 直接返回 skip
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(
      JSON.stringify({ folders: [], settings: { vscodeUEHelper: { initialized: true } } }),
    );

    const result = await runFirstTimeInit(
      { context: createContextMock(), config, logger, detection, clangd, workspace },
      createContextMock(),
    );

    expect(result).toBe('skip');
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(executeCreateProjectMock).not.toHaveBeenCalled();
    expect(executeEnableClangdProxyMock).not.toHaveBeenCalled();
  });
});
