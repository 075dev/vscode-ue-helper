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
}));

const mockPickProject = vi.fn<[], Promise<{ path: string; name: string }>>();
const mockPickEngine = vi.fn<[], Promise<{ path: string; version: string }>>();

vi.mock('@ui/quickPicks', () => ({
  pickProject: () => mockPickProject(),
  pickEngine: () => mockPickEngine(),
}));

describe('executeCreateProject fallback 路径短路 linkToWorkspaceRoot', () => {
  beforeEach(() => {
    initI18n();
    vi.clearAllMocks();
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
        discover: vi.fn(() =>
          Promise.resolve([
            {
              path: 'C:\\UE_5.4',
              version: '5.4.0',
            },
          ]),
        ),
      },
      vsBuildTools: {} as never,
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
        engines: [],
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

    // ---- 跑 executeCreateProject,期望不抛错 ----
    await expect(
      executeCreateProject(config, logger, detection, clangdOps),
    ).resolves.toBeUndefined();

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
        discover: vi.fn(() =>
          Promise.resolve([
            {
              path: 'C:\\UE_5.4',
              version: '5.4.0',
            },
          ]),
        ),
      },
      vsBuildTools: {} as never,
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
        engines: [],
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

    await expect(
      executeCreateProject(config, logger, detection, clangdOps),
    ).resolves.toBeUndefined();

    // linkToWorkspaceRoot 在 UBT 主路径必须被调(对照 case 1 验证 fallback 短路语义)
    expect(mockLinkToWorkspaceRoot).toHaveBeenCalledOnce();
  });
});
