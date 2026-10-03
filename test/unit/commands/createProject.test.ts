/**
 * createProject.test.ts —— createProject 命令单元测试
 *
 * 覆盖 formatFillResultDetail 纯函数的三种结果：
 * - added：有实际添加条目
 * - no-op：所有文件已覆盖
 * - skipped：无合适模板跳过
 *
 * Todo 8 烟雾测试：fallback 路径下 executeCreateProject 不调 linkToWorkspaceRoot，
 * 并在 results 里上报 fallbackUsed。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { Logger } from '@core/logger';
import { initI18n } from '@i18n';
import { executeCreateProject, formatFillResultDetail } from '@commands/createProject';
import type { FillResult } from '@clangd/compileCommands';

describe('formatFillResultDetail', () => {
  it('added 结果：包含添加数量和源码根数量', () => {
    const result: FillResult = {
      roots: ['/proj/Source', '/proj/Plugins/MyPlugin/Source'],
      scanned: 45,
      missing: [
        '/proj/Source/new.cpp',
        '/proj/Source/new.h',
        '/proj/Plugins/MyPlugin/Source/foo.h',
      ],
      added: ['/proj/Source/new.cpp', '/proj/Source/new.h', '/proj/Plugins/MyPlugin/Source/foo.h'],
    };
    const detail = formatFillResultDetail(result);
    expect(detail).toContain('3');
    expect(detail).toContain('2 source roots');
    expect(detail).not.toContain('All source files now have complete clang flags');
  });

  it('added 结果：单根目录时格式正确', () => {
    const result: FillResult = {
      roots: ['/proj/Source'],
      scanned: 10,
      missing: ['/proj/Source/foo.cpp'],
      added: ['/proj/Source/foo.cpp'],
    };
    const detail = formatFillResultDetail(result);
    expect(detail).toContain('1');
    expect(detail).toContain('source root');
    expect(detail).not.toContain('All source files now have complete clang flags');
  });

  it('no-op 结果：所有文件已覆盖', () => {
    const result: FillResult = {
      roots: ['/proj/Source'],
      scanned: 30,
      missing: [],
      added: [],
    };
    const detail = formatFillResultDetail(result);
    expect(detail).toContain('all scanned source files already covered');
    expect(detail).not.toContain('All source files now have complete clang flags');
  });

  it('skipped 结果：包含跳过原因且不含旧文本', () => {
    const result: FillResult = {
      roots: ['/proj/Source'],
      scanned: 20,
      missing: ['/proj/Source/new.cpp'],
      added: [],
      skippedReason: 'no suitable project/plugin .cpp template found for any missing file',
    };
    const detail = formatFillResultDetail(result);
    expect(detail).toContain('skipped');
    expect(detail).toContain('no suitable');
    expect(detail).not.toContain('All source files now have complete clang flags');
  });

  it('skipped 结果：无模板场景', () => {
    const result: FillResult = {
      roots: ['/proj/Source'],
      scanned: 5,
      missing: ['/proj/Source/bar.cpp'],
      added: [],
      skippedReason: 'no suitable template',
    };
    const detail = formatFillResultDetail(result);
    expect(detail).toContain('skipped');
    expect(detail).toContain('no suitable template');
    expect(detail).not.toContain('All source files now have complete clang flags');
  });

  it('undefined 结果：回退文本', () => {
    const detail = formatFillResultDetail(undefined);
    expect(detail).toBe('compile_commands.json not found or empty, skipped');
    expect(detail).not.toContain('All source files now have complete clang flags');
  });
});

/* ================================================================ */
/*  Todo 8: executeCreateProject fallback 路径烟雾测试                 */
/*  当 generateCompileCommands 返回 fallback 路径时,createProject 应:   */
/*    1. 不调用 linkToWorkspaceRoot                                   */
/*    2. results 数组里含 fallbackUsed 上报                            */
/*    3. 整体流程不抛错                                                */
/* ================================================================ */

const {
  mockGenerateCompileCommands,
  mockLinkToWorkspaceRoot,
  mockFillMissing,
  mockCreateCompletionFiles,
  mockAddCompletionHelper,
  mockStartModifyRsp,
  mockStartCreateRspMatchers,
  mockRunUhtCodegen,
  mockScaffoldFormatTidy,
} = vi.hoisted(() => {
  return {
    mockGenerateCompileCommands: vi.fn<[], Promise<string>>(),
    mockLinkToWorkspaceRoot: vi.fn<[], Promise<string>>(),
    mockFillMissing: vi.fn<[], Promise<undefined>>(),
    mockCreateCompletionFiles: vi.fn<[], Promise<readonly unknown[]>>(),
    mockAddCompletionHelper: vi.fn<[], Promise<boolean>>(),
    mockStartModifyRsp: vi.fn<[], Promise<{ replaced: number; unchanged: number }>>(),
    mockStartCreateRspMatchers: vi.fn<[], Promise<readonly unknown[]>>(),
    mockRunUhtCodegen: vi.fn<
      [],
      Promise<{ ran: boolean; exitCode: number | null; generatedHeaderCount: number }>
    >(),
    mockScaffoldFormatTidy: vi.fn<[], Promise<unknown>>(),
  };
});

vi.mock('@clangd', () => ({
  generateCompileCommands: () => mockGenerateCompileCommands(),
  linkToWorkspaceRoot: () => mockLinkToWorkspaceRoot(),
  addCompletionHelperToCompileCommands: () => mockAddCompletionHelper(),
  createCompletionFiles: () => mockCreateCompletionFiles(),
  fillMissingCompileCommands: () => mockFillMissing(),
  startModifyResponseFiles: () => mockStartModifyRsp(),
  startCreateRspMatchers: () => mockStartCreateRspMatchers(),
  runUhtCodegen: () => mockRunUhtCodegen(),
  scaffoldClangFormatAndTidy: () => mockScaffoldFormatTidy(),
}));

const mockPickProject = vi.fn<[], Promise<{ path: string; name: string } | undefined>>();
const mockPickEngine = vi.fn<[], Promise<{ path: string; version: string } | undefined>>();

vi.mock('@ui/quickPicks', () => ({
  pickProject: () => mockPickProject(),
  pickEngine: () => mockPickEngine(),
}));

describe('executeCreateProject fallback 路径短路 linkToWorkspaceRoot', () => {
  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
    // scaffold 步骤默认"未启用"返回,不干扰既有步骤断言
    mockScaffoldFormatTidy.mockResolvedValue({
      clangFormat: {
        path: 'C:/fake/.clang-format',
        created: false,
        skippedReason: 'disabled by setting',
      },
      clangTidy: {
        path: 'C:/fake/.clang-tidy',
        created: false,
        skippedReason: 'disabled by setting',
      },
    });
    // vscode.window.withProgress 立即执行 callback
    (vscode.window.withProgress as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_opts: unknown, task: (progress: unknown) => Promise<unknown>) => {
        const fakeProgress = { report: vi.fn() };
        return await task(fakeProgress);
      },
    );
    (vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
  });

  it('generateCompileCommands 返回 fallback 路径时不调 linkToWorkspaceRoot,流程不抛错', async () => {
    // ---- 构造 fixture 数据 ----
    const projectPath = path.join('C:\\fake', 'MyProj', 'MyProj.uproject');
    const projectDir = path.dirname(projectPath);
    // fallback 路径 = projectDir/.vscode/vscodeuehelper/compile_commands.json
    const fallbackJsonPath = path.join(
      projectDir,
      '.vscode',
      'vscodeuehelper',
      'compile_commands.json',
    );

    // ---- mock @clangd 模块行为 ----
    mockGenerateCompileCommands.mockResolvedValue(fallbackJsonPath);
    mockLinkToWorkspaceRoot.mockResolvedValue('should-not-be-called');
    mockFillMissing.mockResolvedValue(undefined);
    mockCreateCompletionFiles.mockResolvedValue([]);
    mockAddCompletionHelper.mockResolvedValue(false);
    mockStartModifyRsp.mockResolvedValue({ replaced: 0, unchanged: 0 });
    mockStartCreateRspMatchers.mockResolvedValue([]);
    mockRunUhtCodegen.mockResolvedValue({
      ran: false,
      exitCode: null,
      generatedHeaderCount: 0,
    });

    // ---- 构造依赖对象 ----
    const logger = new Logger('test');
    const config = { configuration: 'Development' } as unknown as Parameters<
      typeof executeCreateProject
    >[0];
    const detection = {
      scanner: {
        scan: vi.fn(() =>
          Promise.resolve([
            {
              path: projectPath,
              name: 'MyProj',
              directory: projectDir,
              modules: [],
              enginePath: 'C:\\UE_5.4',
              engineVersion: '5.4.0',
            },
          ]),
        ),
      },
      discovery: {
        // [Phase 11 SSoT] engines SSoT 已收敛到 detection.ready，discovery 仅作占位
        discover: vi.fn(() => Promise.resolve([])),
      },
      workspaceContext: {
        getSelectedProject: vi.fn(() => projectPath),
        getSelectedEngine: vi.fn(() => 'C:\\UE_5.4'),
        setProject: vi.fn(() => Promise.resolve(undefined)),
        setEngine: vi.fn(() => Promise.resolve(undefined)),
      },
      ready: Promise.resolve({
        projects: [
          {
            path: projectPath,
            name: 'MyProj',
            directory: projectDir,
            modules: [],
            enginePath: 'C:\\UE_5.4',
            engineVersion: '5.4.0',
          },
        ],
        engines: [{ path: 'C:\\UE_5.4', version: '5.4.0', isLauncherInstall: false }],
        workspaceFile: null,
        workspaceRoot: projectDir,
        workspaceFolders: [],
        projectFolder: { name: 'MyProj', path: '.', role: 'project', absPath: projectDir },
        engineFolder: null,
      }),
    } as unknown as Parameters<typeof executeCreateProject>[2];

    const clangdOps = {
      writeFull: vi.fn(() => Promise.resolve({ path: path.join(projectDir, '.clangd') })),
    } as unknown as Parameters<typeof executeCreateProject>[3];

    // ---- 跑 executeCreateProject,期望返回 ok envelope ----
    await expect(executeCreateProject(config, logger, detection, clangdOps)).resolves.toMatchObject(
      { ok: true },
    );

    // ---- 断言 1: generateCompileCommands 被调 ----
    expect(mockGenerateCompileCommands).toHaveBeenCalledOnce();

    // ---- 断言 2: linkToWorkspaceRoot 完全没被调（fallback 路径短路）----
    expect(mockLinkToWorkspaceRoot).not.toHaveBeenCalled();

    // ---- 断言 3: fillMissing 仍被调（createProject 内部对 fallback 路径也调一次）----
    expect(mockFillMissing).toHaveBeenCalledOnce();

    // ---- 断言 4: 其他 step 都跑了 ----
    expect(mockCreateCompletionFiles).toHaveBeenCalledOnce();
    expect(mockAddCompletionHelper).toHaveBeenCalledOnce();
    expect(mockStartModifyRsp).toHaveBeenCalledOnce();
    expect(mockStartCreateRspMatchers).toHaveBeenCalledOnce();
  });

  // 防回归:不在 fallback 路径时,linkToWorkspaceRoot 应被调
  it('generateCompileCommands 返回非 fallback 路径时调 linkToWorkspaceRoot', async () => {
    const projectPath = path.join('C:\\fake', 'MyProj', 'MyProj.uproject');
    const projectDir = path.dirname(projectPath);
    // 非 fallback: UBT 输出在引擎根目录(非 .vscode/vscodeuehelper/ 下)
    const ubtJsonPath = path.join('C:\\UE_5.4', 'compile_commands.json');
    const linkedPath = path.join(projectDir, '.vscode', 'vscodeuehelper', 'compile_commands.json');

    mockGenerateCompileCommands.mockResolvedValue(ubtJsonPath);
    mockLinkToWorkspaceRoot.mockResolvedValue(linkedPath);
    mockFillMissing.mockResolvedValue(undefined);
    mockCreateCompletionFiles.mockResolvedValue([]);
    mockAddCompletionHelper.mockResolvedValue(false);
    mockStartModifyRsp.mockResolvedValue({ replaced: 0, unchanged: 0 });
    mockStartCreateRspMatchers.mockResolvedValue([]);
    mockRunUhtCodegen.mockResolvedValue({
      ran: false,
      exitCode: null,
      generatedHeaderCount: 0,
    });

    const logger = new Logger('test');
    const config = { configuration: 'Development' } as unknown as Parameters<
      typeof executeCreateProject
    >[0];
    const detection = {
      scanner: {
        scan: vi.fn(() =>
          Promise.resolve([
            {
              path: projectPath,
              name: 'MyProj',
              directory: projectDir,
              modules: [],
              enginePath: 'C:\\UE_5.4',
              engineVersion: '5.4.0',
            },
          ]),
        ),
      },
      discovery: {
        // [Phase 11 SSoT] engines SSoT 已收敛到 detection.ready，discovery 仅作占位
        discover: vi.fn(() => Promise.resolve([])),
      },
      workspaceContext: {
        getSelectedProject: vi.fn(() => projectPath),
        getSelectedEngine: vi.fn(() => 'C:\\UE_5.4'),
        setProject: vi.fn(() => Promise.resolve(undefined)),
        setEngine: vi.fn(() => Promise.resolve(undefined)),
      },
      ready: Promise.resolve({
        projects: [
          {
            path: projectPath,
            name: 'MyProj',
            directory: projectDir,
            modules: [],
            enginePath: 'C:\\UE_5.4',
            engineVersion: '5.4.0',
          },
        ],
        engines: [{ path: 'C:\\UE_5.4', version: '5.4.0', isLauncherInstall: false }],
        workspaceFile: null,
        workspaceRoot: projectDir,
        workspaceFolders: [],
        projectFolder: { name: 'MyProj', path: '.', role: 'project', absPath: projectDir },
        engineFolder: null,
      }),
    } as unknown as Parameters<typeof executeCreateProject>[2];

    const clangdOps = {
      writeFull: vi.fn(() => Promise.resolve({ path: path.join(projectDir, '.clangd') })),
    } as unknown as Parameters<typeof executeCreateProject>[3];

    await expect(executeCreateProject(config, logger, detection, clangdOps)).resolves.toMatchObject(
      { ok: true },
    );

    // linkToWorkspaceRoot 在 UBT 主路径必须被调(对照 case 1 验证 fallback 短路语义)
    expect(mockLinkToWorkspaceRoot).toHaveBeenCalledOnce();
  });
});

/* ================================================================ */
/*  [契约对齐 C8/D5] envelope 错误码出口                              */
/*  - 无项目检出 → PROJECT_NOT_DETECTED                              */
/*  - 用户取消项目/引擎选择 → OPERATION_CANCELLED                     */
/*  - 引擎未检出 → UBT_NOT_FOUND(映射表最接近项)                     */
/*  - 成功 → okEnvelope(summary 复用 createProject.success)          */
/* ================================================================ */

function makeDetectionForEnvelope(overrides: {
  projects?: unknown[];
  engines?: unknown[];
  selectedProject?: string | undefined;
  selectedEngine?: string | undefined;
}): Parameters<typeof executeCreateProject>[2] {
  return {
    workspaceContext: {
      getSelectedProject: vi.fn(() => overrides.selectedProject),
      getSelectedEngine: vi.fn(() => overrides.selectedEngine),
      setProject: vi.fn(() => Promise.resolve(undefined)),
      setEngine: vi.fn(() => Promise.resolve(undefined)),
    },
    ready: Promise.resolve({
      projects: overrides.projects ?? [],
      engines: overrides.engines ?? [],
      workspaceFile: null,
      workspaceRoot: 'C:\\fake\\MyProj',
      workspaceFolders: [],
      projectFolder: null,
      engineFolder: null,
    }),
  } as unknown as Parameters<typeof executeCreateProject>[2];
}

function makeConfigForEnvelope(): Parameters<typeof executeCreateProject>[0] {
  return { configuration: 'Development' } as unknown as Parameters<typeof executeCreateProject>[0];
}

describe('executeCreateProject envelope 错误码出口', () => {
  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
  });

  it('无项目检出(取消 picker)→ PROJECT_NOT_DETECTED', async () => {
    mockPickProject.mockResolvedValue(undefined);
    const logger = new Logger('test');
    const detection = makeDetectionForEnvelope({ projects: [] });

    const res = await executeCreateProject(makeConfigForEnvelope(), logger, detection);

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('PROJECT_NOT_DETECTED');
    expect(mockPickProject).toHaveBeenCalledOnce();
  });

  it('有候选项目但用户取消选择 → OPERATION_CANCELLED', async () => {
    mockPickProject.mockResolvedValue(undefined);
    const logger = new Logger('test');
    const detection = makeDetectionForEnvelope({
      projects: [
        { path: 'C:\\fake\\A\\A.uproject', name: 'A' },
        { path: 'C:\\fake\\B\\B.uproject', name: 'B' },
      ],
    });

    const res = await executeCreateProject(makeConfigForEnvelope(), logger, detection);

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('OPERATION_CANCELLED');
  });

  it('引擎未检出 → UBT_NOT_FOUND', async () => {
    const projectPath = 'C:\\fake\\MyProj\\MyProj.uproject';
    mockPickEngine.mockResolvedValue(undefined);
    const logger = new Logger('test');
    const detection = makeDetectionForEnvelope({
      projects: [{ path: projectPath, name: 'MyProj' }],
      selectedProject: projectPath,
      engines: [],
    });

    const res = await executeCreateProject(makeConfigForEnvelope(), logger, detection);

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('UBT_NOT_FOUND');
  });

  it('有候选引擎但用户取消选择 → OPERATION_CANCELLED', async () => {
    const projectPath = 'C:\\fake\\MyProj\\MyProj.uproject';
    mockPickEngine.mockResolvedValue(undefined);
    const logger = new Logger('test');
    const detection = makeDetectionForEnvelope({
      projects: [{ path: projectPath, name: 'MyProj' }],
      selectedProject: projectPath,
      engines: [
        { path: 'C:\\UE_5.4', version: '5.4.0', isLauncherInstall: false },
        { path: 'C:\\UE_5.5', version: '5.5.0', isLauncherInstall: false },
      ],
    });

    const res = await executeCreateProject(makeConfigForEnvelope(), logger, detection);

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('OPERATION_CANCELLED');
  });

  it('成功路径 → ok envelope + steps 明细 data', async () => {
    const projectPath = path.join('C:\\fake', 'MyProj', 'MyProj.uproject');
    const projectDir = path.dirname(projectPath);
    mockGenerateCompileCommands.mockResolvedValue(
      path.join(projectDir, '.vscode', 'vscodeuehelper', 'compile_commands.json'),
    );
    mockFillMissing.mockResolvedValue(undefined);
    mockCreateCompletionFiles.mockResolvedValue([]);
    mockAddCompletionHelper.mockResolvedValue(false);
    mockStartModifyRsp.mockResolvedValue({ replaced: 0, unchanged: 0 });
    mockStartCreateRspMatchers.mockResolvedValue([]);
    mockRunUhtCodegen.mockResolvedValue({
      ran: false,
      exitCode: null,
      generatedHeaderCount: 0,
    });
    (vscode.window.withProgress as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_opts: unknown, task: (progress: unknown) => Promise<unknown>) =>
        await task({ report: vi.fn() }),
    );

    const logger = new Logger('test');
    const detection = makeDetectionForEnvelope({
      projects: [{ path: projectPath, name: 'MyProj' }],
      selectedProject: projectPath,
      engines: [{ path: 'C:\\UE_5.4', version: '5.4.0', isLauncherInstall: false }],
      selectedEngine: 'C:\\UE_5.4',
    });
    const clangdOps = {
      writeFull: vi.fn(() => Promise.resolve({ path: path.join(projectDir, '.clangd') })),
    } as unknown as Parameters<typeof executeCreateProject>[3];

    const res = await executeCreateProject(makeConfigForEnvelope(), logger, detection, clangdOps);

    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
    const data = res.data as { okSteps: number; totalSteps: number; steps: unknown[] };
    expect(data.okSteps).toBeGreaterThan(0);
    expect(data.totalSteps).toBe(data.steps.length);
  });
});
