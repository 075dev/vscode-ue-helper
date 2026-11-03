/**
 * generateCompileCommands.test.ts —— executeGenerateCompileCommands 命令单元测试
 *
 * TDD: 红测阶段，先写断言再实现。
 * 覆盖 addCompletionHelperToCompileCommands 被调用时 linkPath 作为第二个参数传入。
 *
 * Bug 背景：executeGenerateCompileCommands 在 Step 2 通过 linkToWorkspaceRoot
 * 获取了 linkPath（实际的 .vscode/vscodeuehelper/compile_commands.json 路径），
 * 但在 Step 4 调用 addCompletionHelperToCompileCommands 时只传了 project.path，
 * 没有传 linkPath，导致 helper entry 写入默认的 projectDir/compile_commands.json
 * 而非正确的数据库路径。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import * as vscode from 'vscode';
import type { Logger } from '@core/logger';
import type { Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import {
  createCompletionFiles as realCreateCompletionFiles,
  getCompletionHelperPath,
} from '@clangd/completionFiles';
import type { CompileCommandEntry } from '@clangd/compileCommands/dbFile';

// ---- Mock @clangd 模块（barrel export） ----

const mockGenerateCompileCommands = vi.fn<[], Promise<string>>();
const mockLinkToWorkspaceRoot = vi.fn<[], Promise<string>>();
const mockCreateCompletionFiles = vi.fn<[projectPath: string], Promise<readonly unknown[]>>();
const mockStartModifyRsp = vi.fn<
  [projectPath: string, logger?: Logger],
  Promise<{ replaced: number; unchanged: number }>
>();
// [D14] 管线改成「先算好，最后统一原子写一次」——读 / 算 / 写三段各自可 mock
const mockReadCompileCommands = vi.fn<
  [jsonPath: string],
  Promise<CompileCommandEntry[] | undefined>
>();
const mockComputeMissingEntries = vi.fn<
  [entries: CompileCommandEntry[], projectPath: string, logger?: Logger],
  Promise<{ result: { added: string[]; missing: string[]; scanned: number; roots: string[] }; entries: CompileCommandEntry[] }>
>();
const mockBuildHelperEntry = vi.fn<
  [entries: CompileCommandEntry[], helperPath: string],
  CompileCommandEntry[]
>();
const mockWriteCompileCommandsAtomic = vi.fn<
  [jsonPath: string, entries: readonly CompileCommandEntry[]],
  Promise<void>
>();

vi.mock('@clangd', () => ({
  generateCompileCommands: () => mockGenerateCompileCommands(),
  linkToWorkspaceRoot: () => mockLinkToWorkspaceRoot(),
  createCompletionFiles: (projectPath: string) => mockCreateCompletionFiles(projectPath),
  startModifyResponseFiles: (projectPath: string, logger?: Logger) =>
    mockStartModifyRsp(projectPath, logger),
  readCompileCommands: (jsonPath: string) => mockReadCompileCommands(jsonPath),
  computeMissingEntries: (
    entries: CompileCommandEntry[],
    projectPath: string,
    logger?: Logger,
  ) => mockComputeMissingEntries(entries, projectPath, logger),
  buildCompletionHelperEntry: (entries: CompileCommandEntry[], helperPath: string) =>
    mockBuildHelperEntry(entries, helperPath),
  writeCompileCommandsAtomic: (jsonPath: string, entries: readonly CompileCommandEntry[]) =>
    mockWriteCompileCommandsAtomic(jsonPath, entries),
  // [MAJOR-2] 写入目标解析 —— 用真实文件系统语义（符号链接 → 它指向的文件）
  resolveCompileCommandsWriteTarget: async (linkPath: string) => {
    const stat = await fs.lstat(linkPath).catch(() => null);
    if (stat?.isSymbolicLink()) {
      const raw = await fs.readlink(linkPath);
      return path.isAbsolute(raw) ? raw : path.resolve(path.dirname(linkPath), raw);
    }
    return linkPath;
  },
  getCompletionHelperPath: (projectPath: string) =>
    `C:\\UEProjects\\MyGame\\.vscode\\vscodeuehelper\\completionHelper.cpp`.replace(
      'C:\\UEProjects\\MyGame',
      projectPath.replace(/\.uproject$/, ''),
    ),
}));

// ---- Mock @ui/quickPicks 模块 ----

const mockPickProject = vi.fn<[], Promise<{ path: string; name: string; engineVersion: string }>>();
const mockPickEngine = vi.fn<[], Promise<{ path: string; version: string }>>();

vi.mock('@ui/quickPicks', () => ({
  pickProject: () => mockPickProject(),
  pickEngine: () => mockPickEngine(),
}));

// ---- 导入被测函数 ----

import { executeGenerateCompileCommands } from '@commands/generateCompileCommands';

describe('executeGenerateCompileCommands (linkPath 传递)', () => {
  /** 模拟的 .uproject 路径 */
  const PROJECT_PATH = 'C:\\UEProjects\\MyGame\\MyGame.uproject';
  /** 模拟的 compile_commands.json 原始生成路径（UBT 输出） */
  const JSON_PATH = 'C:\\UEProjects\\MyGame\\.vscode\\compile_commands.json';
  /** 模拟的 linkPath —— linkToWorkspaceRoot 返回的目标路径 */
  const LINK_PATH = 'C:\\UEProjects\\MyGame\\.vscode\\vscodeuehelper\\compile_commands.json';
  /** 模拟的引擎路径 */
  const ENGINE_PATH = 'C:\\UE_5.4';

  let logger: Logger;
  let config: Config;
  let detection: DetectionHandles;

  beforeEach(() => {
    // 重置所有 mock
    vi.clearAllMocks();

    // ---- 构造 Config mock（P1-1: buildType 联动 config.configuration）----
    config = { configuration: 'Development' } as unknown as Config;

    // ---- 构造 Logger mock ----
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    // ---- 构造 DetectionHandles mock ----
    detection = {
      scanner: {
        scan: vi
          .fn()
          .mockResolvedValue([{ path: PROJECT_PATH, name: 'MyGame', engineVersion: '5.4' }]),
        findSingle: vi.fn().mockResolvedValue({
          path: PROJECT_PATH,
          name: 'MyGame',
          engineVersion: '5.4',
        }),
      },
      discovery: {
        discover: vi.fn().mockResolvedValue([{ path: ENGINE_PATH, version: '5.4' }]),
      },
      workspaceContext: {
        getSelectedProject: vi.fn().mockReturnValue(PROJECT_PATH),
        getSelectedEngine: vi.fn().mockReturnValue(ENGINE_PATH),
        setProject: vi.fn(),
        setEngine: vi.fn(),
      },
      // [P0 fix] executeGenerateCompileCommands 现在消费 detection.ready
      ready: Promise.resolve({
        projects: [{ path: PROJECT_PATH, name: 'MyGame' }],
        engines: [{ path: ENGINE_PATH, version: '5.4' }],
        workspaceFile: 'C:\\UEProjects\\MyGame\\MyGame.code-workspace',
        workspaceRoot: 'C:\\UEProjects\\MyGame',
        workspaceFolders: [],
        projectFolder: null,
        engineFolder: null,
      }),
    } as unknown as DetectionHandles;

    // ---- 配置 mock 行为 ----
    mockGenerateCompileCommands.mockResolvedValue(JSON_PATH);
    mockLinkToWorkspaceRoot.mockResolvedValue(LINK_PATH);
    mockCreateCompletionFiles.mockResolvedValue([]);
    mockStartModifyRsp.mockResolvedValue({ replaced: 0, unchanged: 0 });
    // [D14] 默认：DB 有一条已有条目，补齐不新增，helper 条目追加
    mockReadCompileCommands.mockResolvedValue([
      { directory: 'C:\\UEProjects\\MyGame', file: 'C:\\UEProjects\\MyGame\\Source\\A.cpp' },
    ]);
    mockComputeMissingEntries.mockImplementation((entries) =>
      Promise.resolve({
        result: { added: [], missing: [], scanned: 0, roots: [] },
        entries,
      }),
    );
    mockBuildHelperEntry.mockImplementation((entries) => [
      ...entries,
      { directory: 'C:\\UEProjects\\MyGame', file: 'C:\\helper\\completionHelper.cpp' },
    ]);
    mockWriteCompileCommandsAtomic.mockResolvedValue(undefined);

    // QuickPick 默认返回第一条（不弹窗）
    mockPickProject.mockResolvedValue({
      path: PROJECT_PATH,
      name: 'MyGame',
      engineVersion: '5.4',
    });
    mockPickEngine.mockResolvedValue({
      path: ENGINE_PATH,
      version: '5.4',
    });
  });

  /* ================================================================ */
  /*  [D14] 补齐缺失条目 + 注入 completionHelper 合并成一次原子写        */
  /* ================================================================ */
  it('[D14][MAJOR-2] 读的是 linkPath,写的是解析出的真实目标,且只写一次', async () => {
    await executeGenerateCompileCommands(config, logger, detection);

    // 读：linkPath（clangd 的 CompilationDatabase 实际位置）
    expect(mockReadCompileCommands).toHaveBeenCalledWith(LINK_PATH);
    // 写：**解析出的真实目标** —— linkPath 是符号链接时写它指向的文件，
    // 是独立副本（symlink 失败后的 copy 回退）时写它自己。
    // 两种形态下 clangd 读到的都是最新内容（此前固定写 jsonPath，
    // 在 copy 退化场景下 clangd 读到的仍是旧内容，且无任何报错）。
    expect(mockWriteCompileCommandsAtomic).toHaveBeenCalledTimes(1);
    expect(mockWriteCompileCommandsAtomic.mock.calls[0]?.[0]).toBe(LINK_PATH);
  });

  /* ================================================================ */
  /*  绿测：helper 条目与补齐条目合并进同一次写                            */
  /* ================================================================ */
  it('[D14] helper 条目与补齐后的条目合并进同一次写', async () => {
    await executeGenerateCompileCommands(config, logger, detection);

    expect(mockComputeMissingEntries).toHaveBeenCalledTimes(1);
    expect(mockBuildHelperEntry).toHaveBeenCalledTimes(1);
    // 写盘拿到的就是 buildCompletionHelperEntry 的返回值
    const written = mockWriteCompileCommandsAtomic.mock.calls[0]?.[1];
    expect(written).toHaveLength(2);
    expect(written?.[1]?.file).toContain('completionHelper.cpp');
  });

  /* ================================================================ */
  /*  绿测：linkToWorkspaceRoot 的返回值被用于读取 DB                     */
  /* ================================================================ */
  it('linkToWorkspaceRoot 的返回值被用于读取 compile_commands.json', async () => {
    const customLinkPath = 'C:\\UEProjects\\MyGame\\custom\\compile_commands.json';
    mockLinkToWorkspaceRoot.mockResolvedValue(customLinkPath);

    await executeGenerateCompileCommands(config, logger, detection);

    expect(mockReadCompileCommands).toHaveBeenCalledWith(customLinkPath);
  });

  it('实际更新项目本地副本 compile_commands.json 且不新建项目根 compile_commands', async () => {
    // Given: 只有 linkPath 指向的 compile_commands 存在，项目根 compile_commands.json 不存在。
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'generate-cc-command-'));
    const projectPath = path.join(tempDir, 'MyGame.uproject');
    const linkedCompileCommandsPath = path.join(
      tempDir,
      '.vscode',
      'vscodeuehelper',
      'compile_commands.json',
    );
    /** [D4] 项目本地副本 —— 管线最终写这里 */
    const localCopyPath = path.join(tempDir, 'compile_commands.json');

    try {
      await fs.writeFile(projectPath, '{}', 'utf-8');
      await fs.mkdir(path.dirname(linkedCompileCommandsPath), { recursive: true });
      const sourceFile = path.join(tempDir, 'Source', 'MyGame', 'Private', 'MyActor.cpp');
      await fs.mkdir(path.dirname(sourceFile), { recursive: true });
      await fs.writeFile(sourceFile, '// Given: template source file', 'utf-8');
      const existingEntry = {
        directory: tempDir,
        file: sourceFile,
        command: `clang-cl.exe /c ${sourceFile}`,
      };
      await fs.writeFile(linkedCompileCommandsPath, JSON.stringify([existingEntry]), 'utf-8');
      await realCreateCompletionFiles(projectPath);

      mockGenerateCompileCommands.mockResolvedValue(localCopyPath);
      mockLinkToWorkspaceRoot.mockResolvedValue(linkedCompileCommandsPath);
      // [D14] 用真实实现读 + 算 + 写
      mockReadCompileCommands.mockImplementation(async (p: string) => {
        const text = await fs.readFile(p, 'utf-8');
        return JSON.parse(text) as CompileCommandEntry[];
      });
      mockComputeMissingEntries.mockImplementation((entries) =>
        Promise.resolve({
          result: { added: [], missing: [], scanned: 1, roots: [] },
          entries,
        }),
      );
      mockBuildHelperEntry.mockImplementation((entries) => [
        ...entries,
        {
          directory: tempDir,
          file: getCompletionHelperPath(projectPath),
          command: `clang-cl.exe /c ${getCompletionHelperPath(projectPath)}`,
        },
      ]);
      mockWriteCompileCommandsAtomic.mockImplementation(
        async (p: string, entries: readonly CompileCommandEntry[]) => {
          await fs.writeFile(p, JSON.stringify(entries), 'utf-8');
        },
      );
      mockCreateCompletionFiles.mockImplementation(async () =>
        realCreateCompletionFiles(projectPath),
      );

      detection = {
        scanner: {
          scan: vi
            .fn()
            .mockResolvedValue([{ path: projectPath, name: 'MyGame', engineVersion: '5.4' }]),
          findSingle: vi.fn().mockResolvedValue({
            path: projectPath,
            name: 'MyGame',
            engineVersion: '5.4',
          }),
        },
        discovery: {
          discover: vi.fn().mockResolvedValue([{ path: ENGINE_PATH, version: '5.4' }]),
        },
        workspaceContext: {
          getSelectedProject: vi.fn().mockReturnValue(projectPath),
          getSelectedEngine: vi.fn().mockReturnValue(ENGINE_PATH),
          setProject: vi.fn(),
          setEngine: vi.fn(),
        },
        // [P0 fix] 同上 beforeEach 内的 ready mock,这里用 tempDir 派生的 projectPath
        ready: Promise.resolve({
          projects: [{ path: projectPath, name: 'MyGame' }],
          engines: [{ path: ENGINE_PATH, version: '5.4' }],
          workspaceFile: path.join(tempDir, 'MyGame.code-workspace'),
          workspaceRoot: tempDir,
          workspaceFolders: [],
          projectFolder: null,
          engineFolder: null,
        }),
      } as unknown as DetectionHandles;
      mockPickProject.mockResolvedValue({
        path: projectPath,
        name: 'MyGame',
        engineVersion: '5.4',
      });

      // When: 执行命令管线。
      await executeGenerateCompileCommands(config, logger, detection);

      // Then: helper entry 落在 **clangd 实际读取的那份**（linkPath）。
      //
      // [MAJOR-2] 旧实现固定写「项目本地副本」，在 symlink→copy 退化（Windows 默认）
      // 时 clangd 读到的是 helper 目录里的独立副本 → 补齐的条目对它完全不可见，
      // 且全程无报错。现在写入目标解析到真实文件，这里 linkPath 是普通文件 →
      // 写的就是它自己。
      const linkedText = await fs.readFile(linkedCompileCommandsPath, 'utf-8');
      const linkedEntries = JSON.parse(linkedText) as readonly { readonly file: string }[];
      const helperPath = getCompletionHelperPath(projectPath);
      expect(linkedEntries.some((entry) => entry.file === helperPath)).toBe(true);

      // 写入只发生一次，且目标就是 clangd 读的那份（不再单独写项目本地副本）
      expect(mockWriteCompileCommandsAtomic).toHaveBeenCalledTimes(1);
      expect(mockWriteCompileCommandsAtomic.mock.calls[0]![0]).toBe(linkedCompileCommandsPath);

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        `compile_commands.json updated at ${linkedCompileCommandsPath}`,
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('写盘失败时显示错误而不报告 compile_commands 更新成功', async () => {
    mockWriteCompileCommandsAtomic.mockRejectedValue(new Error('disk full'));

    const env = await executeGenerateCompileCommands(config, logger, detection);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to generate compile_commands.json'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalledWith(
      `compile_commands.json updated at ${LINK_PATH}`,
    );
    // [Wave2] 管线失败 → ok:false + BUILD_FAILED
    expect(env).toMatchObject({ ok: false, error: { code: 'BUILD_FAILED' } });
  });

  // [Wave2 envelope 对齐] 成功路径 → ok:true + data.linkPath
  it('成功完成 → ok:true + data.linkPath(envelope 对齐)', async () => {
    const env = await executeGenerateCompileCommands(config, logger, detection);

    expect(env).toMatchObject({ ok: true, data: { linkPath: LINK_PATH } });
    expect(env.error).toBeUndefined();
  });

  // [add-004 / D9] quiet 形态:后台自动重建——隐含 silent,全程无弹窗,envelope 语义不变
  describe('quiet 形态(add-004 / D9 自动重建)', () => {
    it('quiet=true → 跳过 picker、无任何弹窗、管线照常执行、ok:true + linkPath', async () => {
      const env = await executeGenerateCompileCommands(config, logger, detection, undefined, false, {
        quiet: true,
      });

      // 隐含 silent:无 picker
      expect(mockPickProject).not.toHaveBeenCalled();
      expect(mockPickEngine).not.toHaveBeenCalled();
      // 管线照常执行
      expect(mockGenerateCompileCommands).toHaveBeenCalledTimes(1);
      expect(mockWriteCompileCommandsAtomic).toHaveBeenCalledTimes(1);
      // 全程无 UI 弹窗(成功提示 / 重启询问 / 警告 / 错误)
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      // envelope 语义不变
      expect(env).toMatchObject({ ok: true, data: { linkPath: LINK_PATH } });
    });

    it('quiet=true 管线失败 → 无错误弹窗但落失败日志,ok:false + BUILD_FAILED', async () => {
      mockGenerateCompileCommands.mockRejectedValue(new Error('UBT exploded'));

      const env = await executeGenerateCompileCommands(config, logger, detection, undefined, false, {
        quiet: true,
      });

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      // 评审 F-1:无人值守失败必须落日志可排障
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock accessor
      expect(logger.error).toHaveBeenCalledWith(
        '[generateCompileCommands] quiet pipeline failed: UBT exploded',
      );
      expect(env).toMatchObject({ ok: false, error: { code: 'BUILD_FAILED' } });
    });

    it('quiet=true 无项目 → 无警告弹窗,ok:false + PROJECT_NOT_DETECTED', async () => {
      detection = {
        ...detection,
        ready: Promise.resolve({
          projects: [],
          engines: [{ path: ENGINE_PATH, version: '5.4' }],
          workspaceFile: undefined,
          workspaceRoot: 'C:\\UEProjects',
          workspaceFolders: [],
          projectFolder: null,
          engineFolder: null,
        }),
      } as unknown as DetectionHandles;

      const env = await executeGenerateCompileCommands(config, logger, detection, undefined, false, {
        quiet: true,
      });

      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(env).toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_DETECTED' } });
    });
  });

  /* ================================================================ */
  /*  绿测：[D14] 补齐条目也基于 linkPath 读到的内容                       */
  /* ================================================================ */
  it('[D14] 补齐缺失条目基于 linkPath 读到的内容计算', async () => {
    await executeGenerateCompileCommands(config, logger, detection);

    expect(mockReadCompileCommands).toHaveBeenCalledWith(LINK_PATH);
    expect(mockComputeMissingEntries).toHaveBeenCalledTimes(1);
    expect(mockComputeMissingEntries.mock.calls[0]?.[1]).toBe(PROJECT_PATH);
  });

  // [F2-18/E5] 多项目时取消 QuickPick → 直接返回,不再静默落到 projects[0] 执行
  it('多项目时取消 QuickPick 直接返回,不执行任何后续流程(F2-18/E5)', async () => {
    mockPickProject.mockResolvedValue(undefined as never);
    detection = {
      ...detection,
      ready: Promise.resolve({
        projects: [
          { path: PROJECT_PATH, name: 'MyGame' },
          { path: 'C:\\UEProjects\\Other\\Other.uproject', name: 'Other' },
        ],
        engines: [{ path: ENGINE_PATH, version: '5.4' }],
        workspaceFile: 'C:\\UEProjects\\MyGame\\MyGame.code-workspace',
        workspaceRoot: 'C:\\UEProjects\\MyGame',
        workspaceFolders: [],
        projectFolder: null,
        engineFolder: null,
      }),
    } as unknown as DetectionHandles;

    const env = await executeGenerateCompileCommands(config, logger, detection);

    expect(mockGenerateCompileCommands).not.toHaveBeenCalled();
    expect(mockLinkToWorkspaceRoot).not.toHaveBeenCalled();
    expect(mockWriteCompileCommandsAtomic).not.toHaveBeenCalled();
    // [Wave2] 多项目 + 用户取消 QuickPick → OPERATION_CANCELLED
    expect(env).toMatchObject({ ok: false, error: { code: 'OPERATION_CANCELLED' } });
  });

  // [F2-18/E5] 单项目时取消 QuickPick 自动选中唯一项目继续执行
  it('单项目时取消 QuickPick 自动选中唯一项目(F2-18/E5)', async () => {
    mockPickProject.mockResolvedValue(undefined as never);
    // 默认 beforeEach 的 detection.ready 只有 1 个项目
    await executeGenerateCompileCommands(config, logger, detection);

    expect(mockGenerateCompileCommands).toHaveBeenCalled();
    expect(mockWriteCompileCommandsAtomic).toHaveBeenCalled();
  });

  // [Wave2 envelope 对齐] 检测不到任何项目 → PROJECT_NOT_DETECTED
  it('无项目可检 → ok:false + PROJECT_NOT_DETECTED(Wave2)', async () => {
    mockPickProject.mockResolvedValue(undefined as never);
    detection = {
      ...detection,
      ready: Promise.resolve({
        projects: [],
        engines: [{ path: ENGINE_PATH, version: '5.4' }],
        workspaceFile: undefined,
        workspaceRoot: 'C:\\UEProjects',
        workspaceFolders: [],
        projectFolder: null,
        engineFolder: null,
      }),
    } as unknown as DetectionHandles;

    const env = await executeGenerateCompileCommands(config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_DETECTED' } });
    expect(mockGenerateCompileCommands).not.toHaveBeenCalled();
  });

  // [Wave2 envelope 对齐] 无引擎可用 → UBT_NOT_FOUND
  it('无引擎可检 → ok:false + UBT_NOT_FOUND(Wave2)', async () => {
    // 引擎列表为空时,pickEngine 取消/无选项 → undefined
    mockPickEngine.mockResolvedValue(undefined as never);
    detection = {
      ...detection,
      ready: Promise.resolve({
        projects: [{ path: PROJECT_PATH, name: 'MyGame' }],
        engines: [],
        workspaceFile: undefined,
        workspaceRoot: 'C:\\UEProjects\\MyGame',
        workspaceFolders: [],
        projectFolder: null,
        engineFolder: null,
      }),
    } as unknown as DetectionHandles;

    const env = await executeGenerateCompileCommands(config, logger, detection);

    expect(env).toMatchObject({ ok: false, error: { code: 'UBT_NOT_FOUND' } });
    expect(mockGenerateCompileCommands).not.toHaveBeenCalled();
  });
});
