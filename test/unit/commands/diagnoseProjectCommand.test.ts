/**
 * diagnoseProjectCommand.test.ts —— clangd 项目诊断命令接线测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import type { Logger } from '@core/logger';
import type { DetectionHandles } from '@detection';
import { executeDiagnoseProject } from '@commands/diagnoseProject';
import { activateCommands } from '@commands/index';
import type { Config } from '@core/config';
import type { ClangdHandles } from '@clangd';

const mockPickProject = vi.fn<
  [{ readonly path: string }[]],
  Promise<
    { readonly path: string; readonly name: string; readonly engineVersion: string } | undefined
  >
>();

vi.mock('@ui/quickPicks', () => ({
  pickProject: (projects: { readonly path: string }[]) => mockPickProject(projects),
}));

function createLoggerMock(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    show: vi.fn(),
  } as unknown as Logger;
}

function createDetectionMock(
  projectPath: string,
  overrides: { projects?: { path: string; name: string }[] } = {},
): DetectionHandles {
  return {
    scanner: {
      scan: vi
        .fn()
        .mockResolvedValue([{ path: projectPath, name: 'MyGame', engineVersion: '5.4' }]),
    },
    workspaceContext: {
      getSelectedProject: vi.fn().mockReturnValue(projectPath),
    },
    // [P0 fix] executeDiagnoseProject 现在消费 detection.ready,扫描器 + workspaceContext 不够。
    ready: Promise.resolve({
      projects: overrides.projects ?? [{ path: projectPath, name: 'MyGame' }],
      engines: [],
      workspaceFile: projectPath.replace(/\.uproject$/i, '.code-workspace'),
      workspaceRoot: projectPath.replace(/[\\/][^\\/]+\.uproject$/i, ''),
      workspaceFolders: [],
      projectFolder: null,
      engineFolder: null,
    }),
  } as unknown as DetectionHandles;
}

describe('executeDiagnoseProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Given 选中项目 When 执行诊断命令 Then 输出诊断报告并提示摘要', async () => {
    const logger = createLoggerMock();
    const projectPath = 'D:/Temp/Missing/MyGame.uproject';
    const detection = createDetectionMock(projectPath);

    const envelope = await executeDiagnoseProject(logger, detection);

    const loggerMock = logger as unknown as {
      readonly info: ReturnType<typeof vi.fn>;
      readonly show: ReturnType<typeof vi.fn>;
    };
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining('Clangd Project Diagnostic'),
    );
    expect(loggerMock.show).toHaveBeenCalledOnce();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('failed'),
      'Open Output',
    );
    // [契约对齐] 诊断执行成功即 ok;检查结果(overallStatus)属于 data
    expect(envelope.ok).toBe(true);
    expect(envelope.error).toBeUndefined();
    const data = envelope.data as { overallStatus: string };
    expect(['warning', 'error']).toContain(data.overallStatus);
  });

  it('Given 无项目可选 When 执行诊断命令 Then 返回 PROJECT_NOT_DETECTED envelope', async () => {
    mockPickProject.mockResolvedValue(undefined);
    const logger = createLoggerMock();
    const detection = createDetectionMock('D:/Temp/Empty/None.uproject', { projects: [] });

    const envelope = await executeDiagnoseProject(logger, detection);

    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('PROJECT_NOT_DETECTED');
    // warning 弹窗语义保持原样(_resolve 内部触发)
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });
});

describe('activateCommands diagnoseProject wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Given 命令激活 When 注册命令 Then 包含 vscodeUEHelper.diagnoseProject', () => {
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    const logger = createLoggerMock();
    const detection = createDetectionMock('D:/Temp/MyGame.uproject');

    activateCommands(context, {} as Config, logger, detection, {} as ClangdHandles);

    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'vscodeUEHelper.diagnoseProject',
      expect.any(Function),
    );
  });

  it('package.json manifest 包含 diagnoseProject 命令和命令面板入口', async () => {
    const pkg = (await import('../../../package.json')) as unknown as {
      readonly contributes: {
        readonly commands: readonly { readonly command: string }[];
        readonly menus: { readonly commandPalette: readonly { readonly command: string }[] };
      };
    };
    const commandIds = pkg.contributes.commands.map((command) => command.command);
    const paletteIds = pkg.contributes.menus.commandPalette.map((entry) => entry.command);

    expect(commandIds).toContain('vscodeUEHelper.diagnoseProject');
    expect(paletteIds).toContain('vscodeUEHelper.diagnoseProject');
  });
});
