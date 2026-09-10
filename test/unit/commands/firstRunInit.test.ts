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
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
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
import json5 from 'json5';

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
  const workspaceFile =
    opts?.workspaceFile === undefined ? '/fake/proj/MyProject.code-workspace' : opts.workspaceFile;
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

  // [bug-fix] settings.vscodeUEHelper 是数组(非对象形态)时,json5 会把数组
  // 作为 vscodeUEHelper 的值,但里面没有 initialized → 视为未初始化(主路径)。
  it('returns true when settings.vscodeUEHelper is array (non-object shape)', async () => {
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(
      JSON.stringify({
        folders: [],
        settings: { vscodeUEHelper: [1, 2, 3] },
      }),
    );

    const result = await isFirstRunVscodeWorkspace('/fake/vuh-array.code-workspace');
    expect(result).toBe(true);
  });

  // [bug-fix] 顶层存在 vscodeUEHelper.initialized === true(用户手编到 settings 外)。
  // 主路径只看 settings,会漏判;兜底深度扫描应识别任意嵌套位置。
  it('returns false when vscodeUEHelper.initialized === true at top level', async () => {
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(
      JSON.stringify({
        folders: [],
        vscodeUEHelper: { initialized: true },
        settings: { 'editor.fontSize': 14 },
      }),
    );

    const result = await isFirstRunVscodeWorkspace('/fake/vuh-top-level.code-workspace');
    expect(result).toBe(false);
  });

  // [bug-fix] 兜底深度扫描:vscodeUEHelper.initialized 任意嵌套位置命中即视为已初始化。
  // 例如用户把 vscodeUEHelper 嵌套在 settings.extensions.recommendations 风格
  // 的结构里(虽然不常见),或本仓库内部插件选项面板在 settings 下另开子节。
  // 模拟:settings.EditorConfig.x.vscodeUEHelper.initialized === true。
  it('returns false when vscodeUEHelper.initialized === true in any nested position', async () => {
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(
      JSON.stringify({
        folders: [],
        settings: {
          editor: {
            'editor.fontSize': 14,
            userData: { vscodeUEHelper: { initialized: true } },
          },
        },
      }),
    );

    const result = await isFirstRunVscodeWorkspace('/fake/nested-vuh.code-workspace');
    expect(result).toBe(false);
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
      writtenContent =
        typeof data === 'string'
          ? data
          : Buffer.isBuffer(data)
            ? data.toString('utf-8')
            : String(data);
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
      writtenContent =
        typeof data === 'string'
          ? data
          : Buffer.isBuffer(data)
            ? data.toString('utf-8')
            : String(data);
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

    await expect(
      markInitializedInWorkspace('/fake/proj/LockedProject.code-workspace'),
    ).rejects.toThrow(/EACCES|permission/i);
  });

  // [F2-20/§8.9] 定点修改保留 JSONC 注释/尾逗号,不再 JSON.stringify 整体重写(会毁注释)
  it('保留 JSONC 注释与尾逗号(F2-20)', async () => {
    const originalJson = [
      '{',
      '  // 项目根文件夹',
      '  "folders": [',
      '    { "path": "." },',
      '  ],',
      '  "settings": {',
      '    "editor.fontSize": 14,',
      '    "vscodeUEHelper": {',
      '      // 用户注释要保留',
      '      "someOtherKey": "keep-me",',
      '    },',
      '  },',
      '}',
    ].join('\n');
    let writtenContent: string | undefined;
    readFileMock.mockResolvedValue(originalJson);
    writeFileMock.mockImplementation((_path: string, data: string | NodeJS.ArrayBufferView) => {
      writtenContent = typeof data === 'string' ? data : String(data);
      return Promise.resolve(undefined);
    });
    renameMock.mockResolvedValue(undefined);

    await markInitializedInWorkspace('/fake/proj/MyProject.code-workspace');

    expect(writtenContent).toBeDefined();
    // 注释与尾逗号保留
    expect(writtenContent).toContain('// 项目根文件夹');
    expect(writtenContent).toContain('// 用户注释要保留');
    // 其他键保留
    expect(writtenContent).toContain('"someOtherKey": "keep-me"');
    expect(writtenContent).toContain('"editor.fontSize": 14');
    // 新标记写入且文档仍可解析(含注释/尾逗号,用 json5 解析)
    const parsed: WorkspaceJson = json5.parse(writtenContent ?? '{}');
    expect(parsed.settings?.vscodeUEHelper?.initialized).toBe(true);
    expect(parsed.settings?.vscodeUEHelper?.someOtherKey).toBe('keep-me');
    expect(parsed.folders).toEqual([{ path: '.' }]);
  });

  // [F2-20/§8.9] 已存在 initialized 键(如 false)时定点替换值,不重复插入键
  it('已存在 initialized 键时替换值而非重复插入(F2-20)', async () => {
    const originalJson = [
      '{',
      '  "settings": {',
      '    "vscodeUEHelper": {',
      '      "initialized": false,',
      '    },',
      '  },',
      '}',
    ].join('\n');
    let writtenContent: string | undefined;
    readFileMock.mockResolvedValue(originalJson);
    writeFileMock.mockImplementation((_path: string, data: string | NodeJS.ArrayBufferView) => {
      writtenContent = typeof data === 'string' ? data : String(data);
      return Promise.resolve(undefined);
    });
    renameMock.mockResolvedValue(undefined);

    await markInitializedInWorkspace('/fake/proj/MyProject.code-workspace');

    expect(writtenContent).toBeDefined();
    // 含尾逗号的 JSONC,用 json5 解析
    const parsed: WorkspaceJson = json5.parse(writtenContent ?? '{}');
    expect(parsed.settings?.vscodeUEHelper?.initialized).toBe(true);
    // 只允许一个 initialized 键
    expect((writtenContent ?? '').match(/"initialized"/g)).toHaveLength(1);
  });

  // [bug-fix] 真实场景:历史版本/手编把 settings.vscodeUEHelper 写成数组形态,
  // 不剔除则新写入会被旧值"压住"(json5 取最后同名 key),后续仍反复弹初始化。
  it('purges non-object vscodeUEHelper before injecting initialized=true', async () => {
    const originalJson = JSON.stringify({
      folders: [],
      settings: { vscodeUEHelper: [1, 2, 3] },
    });
    let writtenContent: string | undefined;
    readFileMock.mockResolvedValue(originalJson);
    writeFileMock.mockImplementation((_path: string, data: string | NodeJS.ArrayBufferView) => {
      writtenContent = typeof data === 'string' ? data : String(data);
      return Promise.resolve(undefined);
    });
    renameMock.mockResolvedValue(undefined);

    await markInitializedInWorkspace('/fake/proj/ArrayPollution.code-workspace');

    expect(writtenContent).toBeDefined();
    const parsed: WorkspaceJson = json5.parse(writtenContent ?? '{}');
    expect(parsed.settings?.vscodeUEHelper?.initialized).toBe(true);
    // 数组形态已被剔除,文件里只剩一个新的对象形态
    expect(parsed.settings?.vscodeUEHelper).not.toEqual([1, 2, 3]);
  });

  // [bug-fix] 用户把 vscodeUEHelper 手编到顶层 settings 外。先抹除顶层形态,
  // 再走正常路径把带 initialized 的对象形态插入 settings。
  it('purges top-level vscodeUEHelper before injecting initialized=true', async () => {
    const originalJson = JSON.stringify({
      folders: [],
      vscodeUEHelper: { initialized: false, legacy: true },
      settings: { 'editor.fontSize': 14 },
    });
    let writtenContent: string | undefined;
    readFileMock.mockResolvedValue(originalJson);
    writeFileMock.mockImplementation((_path: string, data: string | NodeJS.ArrayBufferView) => {
      writtenContent = typeof data === 'string' ? data : String(data);
      return Promise.resolve(undefined);
    });
    renameMock.mockResolvedValue(undefined);

    await markInitializedInWorkspace('/fake/proj/TopLevelVuh.code-workspace');

    expect(writtenContent).toBeDefined();
    const parsed: WorkspaceJson & { vscodeUEHelper?: unknown } = json5.parse(
      writtenContent ?? '{}',
    );
    // 顶层 vscodeUEHelper 应被剔除
    expect(parsed.vscodeUEHelper).toBeUndefined();
    // settings 内 vscodeUEHelper.initialized 应被正确写入
    expect(parsed.settings?.vscodeUEHelper?.initialized).toBe(true);
  });

  // 对象形态的 vscodeUEHelper 内部字段不应被破坏(回归:删过头会丢用户键)。
  it('preserves other keys inside object-form vscodeUEHelper', async () => {
    const originalJson = JSON.stringify({
      folders: [],
      settings: {
        'editor.fontSize': 14,
        vscodeUEHelper: { userNote: 'keep me', version: '0.1.0' },
      },
    });
    let writtenContent: string | undefined;
    readFileMock.mockResolvedValue(originalJson);
    writeFileMock.mockImplementation((_path: string, data: string | NodeJS.ArrayBufferView) => {
      writtenContent = typeof data === 'string' ? data : String(data);
      return Promise.resolve(undefined);
    });
    renameMock.mockResolvedValue(undefined);

    await markInitializedInWorkspace('/fake/proj/ObjectPreserve.code-workspace');

    expect(writtenContent).toBeDefined();
    const parsed: WorkspaceJson = json5.parse(writtenContent ?? '{}');
    expect(parsed.settings?.vscodeUEHelper?.initialized).toBe(true);
    expect(parsed.settings?.vscodeUEHelper?.userNote).toBe('keep me');
    expect(parsed.settings?.vscodeUEHelper?.version).toBe('0.1.0');
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
    (vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      'Initialize',
    );
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
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'workbench.action.reloadWindow',
    );
    // [bug-fix] 失败消息包含 workspaceFile 路径 + 错误内容(reportInitFailure)
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    const calls = (vscode.window.showErrorMessage as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    const matched = calls.find(
      ([msg]: [string, ...unknown[]]) =>
        typeof msg === 'string' &&
        msg.includes('mock createProject failure') &&
        msg.includes('/fake/proj/MyProject.code-workspace'),
    );
    expect(matched).toBeDefined();
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
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'workbench.action.reloadWindow',
    );
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    const calls = (vscode.window.showErrorMessage as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    const matched = calls.find(
      ([msg]: [string, ...unknown[]]) =>
        typeof msg === 'string' &&
        msg.includes('mock proxy failure') &&
        msg.includes('/fake/proj/MyProject.code-workspace'),
    );
    expect(matched).toBeDefined();
  });

  // [F2-20] 标记写入失败时不 reload,返回 fail(与文件头设计原则 3 一致:
  // 任一步骤失败 → 弹错误信息、不重启窗口,下次启动再次提示)
  it('markInitializedInWorkspace 失败时不 reload,返回 fail', async () => {
    executeCreateProjectMock.mockResolvedValue(undefined);
    executeEnableClangdProxyMock.mockResolvedValue(undefined);
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(JSON.stringify({ folders: [] }));
    writeFileMock.mockRejectedValue(new Error('EACCES: permission denied'));

    const result = await runFirstTimeInit(
      { context: createContextMock(), config, logger, detection, clangd, workspace },
      createContextMock(),
    );

    expect(result).toBe('fail');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'workbench.action.reloadWindow',
    );
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    const calls = (vscode.window.showErrorMessage as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    const matched = calls.find(
      ([msg]: [string, ...unknown[]]) =>
        typeof msg === 'string' &&
        msg.includes('EACCES') &&
        msg.includes('/fake/proj/MyProject.code-workspace'),
    );
    expect(matched).toBeDefined();
  });

  // [bug-fix] createProject 失败时:错误消息必须带上 workspaceFile 路径,
  // 且弹窗必须提供 View Log + Retry + Dismiss 三个动作。
  // 之前:一闪而过的 showErrorMessage → 用户没重试入口 → 永远卡在未初始化循环。
  it('createProject 失败时,错误信息附 workspaceFile 路径并暴露重试入口', async () => {
    executeCreateProjectMock.mockRejectedValue(
      new Error('mock createProject failure'),
    );
    executeEnableClangdProxyMock.mockResolvedValue(undefined);
    // reportInitFailure 内部 await vscode.window.showErrorMessage 拿选择,默认未 mock
    // → 返回 undefined = Dismiss 分支,不影响主流程

    const result = await runFirstTimeInit(
      { context: createContextMock(), config, logger, detection, clangd, workspace },
      createContextMock(),
    );

    expect(result).toBe('fail');
    const calls = (vscode.window.showErrorMessage as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    // 找出最后的错误弹窗调用(createProject 失败的)
    const errCall = calls.find(
      ([msg]: [string, ...unknown[]]) =>
        typeof msg === 'string' && msg.includes('mock createProject failure'),
    );
    expect(errCall).toBeDefined();
    const [msg, ...buttons] = errCall as [string, ...string[]];
    // workspaceFile 路径必须附在消息里
    expect(msg).toContain('/fake/proj/MyProject.code-workspace');
    // 提供 View Log / Retry / Dismiss 三个动作(语言无关——只断言 3 个非空项)
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => typeof b === 'string' && b.length > 0)).toBe(true);
    // 错误栈写到 logger(error 调用:消息 + stack)
    // 解构出 error spy,避免 unbound-method 警告
    const { error: errorFn } = logger as unknown as {
      error: ReturnType<typeof vi.fn>;
    };
    expect(errorFn).toBeDefined();
    const errorCalls = errorFn.mock.calls;
    const errMatch = errorCalls.find(
      ([msg]: [string, ...unknown[]]) =>
        typeof msg === 'string' && msg.includes('createProject failed'),
    );
    expect(errMatch).toBeDefined();
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

    (vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      'Initialize',
    );
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
    expect(executeEnableClangdProxyMock).toHaveBeenCalledWith(config, logger, clangd, {
      suppressReloadPrompt: true,
    });
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
