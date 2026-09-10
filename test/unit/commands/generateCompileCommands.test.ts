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
  addCompletionHelperToCompileCommands as realAddCompletionHelperToCompileCommands,
  createCompletionFiles as realCreateCompletionFiles,
  getCompletionHelperPath,
} from '@clangd/completionFiles';

// ---- Mock @clangd 模块（barrel export） ----

const mockAddCompletionHelper = vi.fn<
  [projectPath: string, ccJsonPath: string | undefined],
  Promise<boolean>
>();
const mockGenerateCompileCommands = vi.fn<[], Promise<string>>();
const mockLinkToWorkspaceRoot = vi.fn<[], Promise<string>>();
const mockFillMissing = vi.fn<
  [jsonPath: string, projectPath: string, logger?: Logger],
  Promise<undefined>
>();
const mockCreateCompletionFiles = vi.fn<[projectPath: string], Promise<readonly unknown[]>>();
const mockStartModifyRsp = vi.fn<
  [projectPath: string, logger?: Logger],
  Promise<{ replaced: number; unchanged: number }>
>();

vi.mock('@clangd', () => ({
  generateCompileCommands: () => mockGenerateCompileCommands(),
  linkToWorkspaceRoot: () => mockLinkToWorkspaceRoot(),
  addCompletionHelperToCompileCommands: (projectPath: string, ccJsonPath?: string) =>
    mockAddCompletionHelper(projectPath, ccJsonPath),
  createCompletionFiles: (projectPath: string) => mockCreateCompletionFiles(projectPath),
  fillMissingCompileCommands: (jsonPath: string, projectPath: string, logger?: Logger) =>
    mockFillMissing(jsonPath, projectPath, logger),
  startModifyResponseFiles: (projectPath: string, logger?: Logger) =>
    mockStartModifyRsp(projectPath, logger),
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
    mockAddCompletionHelper.mockResolvedValue(true);
    mockFillMissing.mockResolvedValue(undefined);
    mockCreateCompletionFiles.mockResolvedValue([]);
    mockStartModifyRsp.mockResolvedValue({ replaced: 0, unchanged: 0 });

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
  /*  红测：当前代码调用 addCompletionHelperToCompileCommands 未传 linkPath */
  /* ================================================================ */
  it('RED: addCompletionHelperToCompileCommands 未被传入 linkPath 作为第二个参数（测试应失败直到修复）', async () => {
    await executeGenerateCompileCommands(config, logger, detection);

    // 断言 addCompletionHelperToCompileCommands 被调用
    expect(mockAddCompletionHelper).toHaveBeenCalled();

    // 断言调用参数：应该有 2 个参数 (project.path, linkPath)
    const firstCall = mockAddCompletionHelper.mock.calls[0];
    expect(firstCall).toStrictEqual([PROJECT_PATH, LINK_PATH]);
  });

  /* ================================================================ */
  /*  绿测：addCompletionHelperToCompileCommands 正确收到 linkPath         */
  /* ================================================================ */
  it('addCompletionHelperToCompileCommands 收到 project.path 和 linkPath 两个参数', async () => {
    await executeGenerateCompileCommands(config, logger, detection);

    expect(mockAddCompletionHelper).toHaveBeenCalledTimes(1);
    expect(mockAddCompletionHelper).toHaveBeenCalledWith(PROJECT_PATH, LINK_PATH);
  });

  /* ================================================================ */
  /*  绿测：linkToWorkspaceRoot 返回值被正确传递给 helper 函数              */
  /* ================================================================ */
  it('linkToWorkspaceRoot 的返回值被用于 addCompletionHelperToCompileCommands', async () => {
    const customLinkPath = 'C:\\UEProjects\\MyGame\\custom\\compile_commands.json';
    mockLinkToWorkspaceRoot.mockResolvedValue(customLinkPath);

    await executeGenerateCompileCommands(config, logger, detection);

    expect(mockAddCompletionHelper).toHaveBeenCalledWith(PROJECT_PATH, customLinkPath);
  });

  it('实际更新 .vscode/vscodeuehelper/compile_commands.json 并把缺失 root compile_commands 报为失败', async () => {
    // Given: 只有 linkPath 指向的 compile_commands 存在，项目根 compile_commands.json 不存在。
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'generate-cc-command-'));
    const projectPath = path.join(tempDir, 'MyGame.uproject');
    const linkedCompileCommandsPath = path.join(
      tempDir,
      '.vscode',
      'vscodeuehelper',
      'compile_commands.json',
    );

    try {
      await fs.writeFile(projectPath, '{}', 'utf-8');
      await fs.mkdir(path.dirname(linkedCompileCommandsPath), { recursive: true });
      const sourceFile = path.join(tempDir, 'Source', 'MyGame', 'Private', 'MyActor.cpp');
      await fs.mkdir(path.dirname(sourceFile), { recursive: true });
      await fs.writeFile(sourceFile, '// Given: template source file', 'utf-8');
      await fs.writeFile(
        linkedCompileCommandsPath,
        JSON.stringify(
          [
            {
              directory: tempDir,
              file: sourceFile,
              command: `clang-cl.exe /c ${sourceFile}`,
            },
          ],
          null,
          2,
        ),
        'utf-8',
      );
      await realCreateCompletionFiles(projectPath);

      mockGenerateCompileCommands.mockResolvedValue(
        path.join(tempDir, 'Engine', 'compile_commands.json'),
      );
      mockLinkToWorkspaceRoot.mockResolvedValue(linkedCompileCommandsPath);
      mockAddCompletionHelper.mockImplementation(realAddCompletionHelperToCompileCommands);
      mockFillMissing.mockResolvedValue(undefined);
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

      // Then: helper entry 写入 linked compile_commands，而不是缺失的项目根文件。
      const linkedText = await fs.readFile(linkedCompileCommandsPath, 'utf-8');
      const linkedEntries = JSON.parse(linkedText) as readonly { readonly file: string }[];
      const helperPath = getCompletionHelperPath(projectPath);
      expect(linkedEntries.some((entry) => entry.file === helperPath)).toBe(true);

      const rootCompileCommandsPath = path.join(tempDir, 'compile_commands.json');
      const rootExists = await fs.access(rootCompileCommandsPath).then(
        () => true,
        () => false,
      );
      expect(rootExists).toBe(false);
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        `compile_commands.json updated at ${linkedCompileCommandsPath}`,
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('helper 写入失败时显示错误而不报告 compile_commands 更新成功', async () => {
    mockAddCompletionHelper.mockResolvedValue(false);

    await executeGenerateCompileCommands(config, logger, detection);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed to generate compile_commands.json: Unable to add completion helper entry to ${LINK_PATH}`,
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalledWith(
      `compile_commands.json updated at ${LINK_PATH}`,
    );
  });

  /* ================================================================ */
  /*  绿测：fillMissingCompileCommands 也使用 linkPath（保持现有行为）       */
  /* ================================================================ */
  it('fillMissingCompileCommands 也接收 linkPath（确保 fill 不受影响）', async () => {
    await executeGenerateCompileCommands(config, logger, detection);

    // fillMissingCompileCommands 应被调用且第一个参数为 linkPath
    expect(mockFillMissing).toHaveBeenCalled();
    expect(mockFillMissing.mock.calls[0]?.[0]).toBe(LINK_PATH);
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

    await executeGenerateCompileCommands(config, logger, detection);

    expect(mockGenerateCompileCommands).not.toHaveBeenCalled();
    expect(mockLinkToWorkspaceRoot).not.toHaveBeenCalled();
    expect(mockAddCompletionHelper).not.toHaveBeenCalled();
  });

  // [F2-18/E5] 单项目时取消 QuickPick 自动选中唯一项目继续执行
  it('单项目时取消 QuickPick 自动选中唯一项目(F2-18/E5)', async () => {
    mockPickProject.mockResolvedValue(undefined as never);
    // 默认 beforeEach 的 detection.ready 只有 1 个项目
    await executeGenerateCompileCommands(config, logger, detection);

    expect(mockGenerateCompileCommands).toHaveBeenCalled();
    expect(mockAddCompletionHelper).toHaveBeenCalled();
  });
});
