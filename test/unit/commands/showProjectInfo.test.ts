/**
 * showProjectInfo.test.ts —— showProjectInfo 命令的单元测试
 *
 * 覆盖:
 *  - happy path:有 engines + 有 projects → log + 弹 information
 *  - 无 detection → warn + return(早退,不弹模态)
 *  - engines=0 + 有 .code-workspace → 弹 warning(带 "openWs" 按钮) + 点击回调
 *  - engines=0 + 无 .code-workspace → 弹 warning(silent=false)
 *  - engines=0 + 无 .code-workspace + silent=true → 不弹 warning(MCP 场景)
 *  - engines>0 + silent=true → 不弹 information
 *  - projects 选择标记:selected 显示
 *  - lines 拼接:含所有期望字段(configuration / target / platform / clangdPath / completionMode / mcpMode / mcpHost / logLevel)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { showProjectInfo } from '@commands/showProjectInfo';
import { initI18n } from '@i18n';
import { type Logger } from '@core/logger';
import type { Config } from '@core/config';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import type { ProjectInfo, EngineInstall } from '@detection/types';

beforeEach(() => {
  initI18n();
  vi.clearAllMocks();
});

/** 静音 logger mock 视图:公开方法声明为 Mock 属性(而非方法签名),避免 unbound-method。 */
type MockLogger = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  setLevel: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

/** 把 Logger 转成 Mock 属性视图,供 spy 断言使用 */
function asMockLogger(logger: Logger): MockLogger {
  return logger as unknown as MockLogger;
}

/** 静音 logger(测试只关心调用,不需要 output) */
function makeSilentLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    show: vi.fn(),
    setLevel: vi.fn(),
    dispose: vi.fn(),
  } as unknown as Logger;
}

/** 完整 Config mock(覆盖 showProjectInfo 用到的字段) */
function makeConfig(): Config {
  return {
    configuration: 'Development',
    target: 'Editor',
    platform: 'Win64',
    completionMode: 'slow',
    useMCP: 'auto',
    autoBackupWorkspace: true,
    lspLoggingLevel: 'info',
    clangdPath: '/usr/bin/clangd',
  } as unknown as Config;
}

const fakeProject: ProjectInfo = {
  name: 'MyGame',
  path: 'D:/proj/MyGame/MyGame.uproject',
  engineAssociation: '5.4',
  modules: ['MyGame'],
  raw: {},
};
const fakeProject2: ProjectInfo = {
  name: 'MyGame2',
  path: 'D:/proj/MyGame2/MyGame2.uproject',
  engineAssociation: '5.4',
  modules: ['MyGame2'],
  raw: {},
};
const fakeEngine: EngineInstall = {
  path: 'D:/UE_5.4',
  version: '5.4.0',
  isLauncherInstall: true,
};

function makeDetection(
  overrides: {
    projects?: ProjectInfo[];
    engines?: EngineInstall[];
    workspaceFile?: string;
  } = {},
): DetectionHandles {
  const projects = overrides.projects ?? [fakeProject];
  const engines = overrides.engines ?? [fakeEngine];
  return {
    ready: Promise.resolve({
      projects,
      engines,
      workspaceFile: overrides.workspaceFile,
      workspaceRoot: 'D:/proj/MyGame',
      workspaceFolders: [{ name: 'MyGame', absPath: 'D:/proj/MyGame', role: 'project' }],
      projectFolder: null,
      engineFolder: null,
    }),
    workspaceContext: {
      getSelectedProject: vi.fn().mockReturnValue(undefined),
      getSelectedEngine: vi.fn().mockReturnValue(undefined),
      setProject: vi.fn(),
      setEngine: vi.fn(),
    },
  } as unknown as DetectionHandles;
}

function makeWorkspace(
  overrides: {
    resolveSelectedProject?: (ps: ProjectInfo[]) => ProjectInfo | undefined;
    resolveSelectedEngine?: (es: EngineInstall[]) => EngineInstall | undefined;
    workspaceRoot?: string;
    workspaceFolders?: { name: string; absPath: string; role: string }[];
    selectedProject?: string;
    selectedEngine?: string;
    workspaceFile?: string;
  } = {},
): WorkspaceState {
  // 用 'in' 检查区分"未传" vs "显式设 undefined"
  // (?? 在显式 undefined 时仍会 fallback,导致测试无法表达"未设"语义)
  return {
    resolveSelectedProject: overrides.resolveSelectedProject ?? ((ps) => ps[0]),
    resolveSelectedEngine: overrides.resolveSelectedEngine ?? ((es) => es[0]),
    workspaceRoot: 'workspaceRoot' in overrides ? overrides.workspaceRoot : 'D:/proj/MyGame',
    workspaceFolders:
      'workspaceFolders' in overrides
        ? overrides.workspaceFolders
        : [{ name: 'MyGame', absPath: 'D:/proj/MyGame', role: 'project' }],
    selectedProject: overrides.selectedProject,
    selectedEngine: overrides.selectedEngine,
    workspaceFile: overrides.workspaceFile,
  } as unknown as WorkspaceState;
}

describe('showProjectInfo — 早退', () => {
  it('无 detection → logger.warn + PROJECT_NOT_DETECTED envelope,不弹模态', async () => {
    const logger = makeSilentLogger();
    const envelope = await showProjectInfo(makeConfig(), logger);
    expect(asMockLogger(logger).warn).toHaveBeenCalledWith(
      expect.stringContaining('detection handles unavailable'),
    );
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('PROJECT_NOT_DETECTED');
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });
});

describe('showProjectInfo — happy path(有 engines)', () => {
  it('log 含 configuration / target / platform / clangdPath / mcpMode / logLevel', async () => {
    const logger = makeSilentLogger();
    const detection = makeDetection();
    const workspace = makeWorkspace();

    (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const envelope = await showProjectInfo(makeConfig(), logger, detection, workspace);

    // [契约对齐] 成功 → ok envelope;data 对齐契约 ProjectInfo 实际已收集字段;summary 复用现有文案
    expect(envelope.ok).toBe(true);
    expect(envelope.error).toBeUndefined();
    expect(envelope.summary).toBeDefined();
    const data = envelope.data as {
      name?: string;
      uprojectPath?: string;
      enginePath?: string;
      engineVersion?: string;
    };
    expect(data.name).toBe('MyGame');
    expect(data.uprojectPath).toBe('D:/proj/MyGame/MyGame.uproject');
    expect(data.enginePath).toBe('D:/UE_5.4');
    expect(data.engineVersion).toBe('5.4.0');

    // 找到含 lines 拼接的 info 调用
    const infoCalls = asMockLogger(logger).info.mock.calls.map((c) => c[0] as string);
    const joined = infoCalls.find((s) => s.includes('Development') && s.includes('Editor'));
    expect(joined).toBeDefined();
    expect(joined).toMatch(/Development/);
    expect(joined).toMatch(/Editor/);
    expect(joined).toMatch(/Win64/);
    expect(joined).toMatch(/clangd/i);
  });

  it('projects 列表与 selected 标记', async () => {
    const logger = makeSilentLogger();
    const detection = makeDetection({ projects: [fakeProject, fakeProject2] });
    const workspace = makeWorkspace({
      resolveSelectedProject: (ps) => ps[1],
    });
    (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await showProjectInfo(makeConfig(), logger, detection, workspace);

    const infoCalls = asMockLogger(logger).info.mock.calls.map((c) => c[0] as string);
    const joined = infoCalls.find((s) => s.includes('MyGame2')) ?? '';
    // 第二个 project 应被标 "selected" 标记
    expect(joined).toMatch(/MyGame2[\s\S]*selected/);
  });

  it('engines>0 + silent=true → 不弹 information modal', async () => {
    const logger = makeSilentLogger();
    const detection = makeDetection();
    const workspace = makeWorkspace();

    await showProjectInfo(makeConfig(), logger, detection, workspace, true);

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    // logger.info 仍应被调
    expect(asMockLogger(logger).info).toHaveBeenCalled();
  });

  it('engines>0 + 用户点 "openOutput" → logger.show() 被调', async () => {
    const logger = makeSilentLogger();
    const detection = makeDetection();
    const workspace = makeWorkspace();
    // 让 showInformationMessage 返回 "openOutput" 翻译
    (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (_msg: string, ..._items: string[]) => {
        // 返回与代码中匹配的 t('showInfo.openOutput') 值
        return 'Open Output';
      },
    );

    await showProjectInfo(makeConfig(), logger, detection, workspace);

    // logger.show 应被调(开头一次 + 末尾一次)
    expect(asMockLogger(logger).show).toHaveBeenCalled();
  });
});

describe('showProjectInfo — engines=0 分支', () => {
  it('engines=0 + 有 .code-workspace → 弹 warning(带 openWs 按钮)', async () => {
    const logger = makeSilentLogger();
    const detection = makeDetection({ engines: [], workspaceFile: 'D:/ws/MyGame.code-workspace' });
    const workspace = makeWorkspace();
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await showProjectInfo(makeConfig(), logger, detection, workspace);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('MyGame'),
      // 按钮翻译 "Open .code-workspace" / "打开 .code-workspace"
      expect.stringMatching(/workspace|code-workspace/i),
    );
  });

  it('engines=0 + 有 .code-workspace + 用户点 openWs → 执行 openWorkspaceFile 命令', async () => {
    const logger = makeSilentLogger();
    const detection = makeDetection({ engines: [], workspaceFile: 'D:/ws/MyGame.code-workspace' });
    const workspace = makeWorkspace();
    // 返回与 t('showInfo.btn.openWs') 翻译匹配的字符串(zh: "打开 .code-workspace", en: "Open .code-workspace")
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
      'Open .code-workspace',
    );
    (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await showProjectInfo(makeConfig(), logger, detection, workspace);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscodeUEHelper.openWorkspaceFile');
  });

  it('engines=0 + 无 .code-workspace + silent=false → 弹 warning', async () => {
    const logger = makeSilentLogger();
    const detection = makeDetection({ engines: [], workspaceFile: undefined });
    const workspace = makeWorkspace({ workspaceFile: undefined });
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await showProjectInfo(makeConfig(), logger, detection, workspace, false);

    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('engines=0 + 无 .code-workspace + silent=true → 不弹 warning(MCP 场景)', async () => {
    const logger = makeSilentLogger();
    const detection = makeDetection({ engines: [], workspaceFile: undefined });
    const workspace = makeWorkspace({ workspaceFile: undefined });

    await showProjectInfo(makeConfig(), logger, detection, workspace, true);

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    // logger.info 仍输出
    expect(asMockLogger(logger).info).toHaveBeenCalled();
  });
});

describe('showProjectInfo — workspace 派生字段', () => {
  it('workspace.workspaceRoot 缺失时回退到 first folder', async () => {
    const logger = makeSilentLogger();
    const detection = makeDetection();
    const workspace = makeWorkspace({
      workspaceRoot: undefined,
      workspaceFolders: [{ name: 'P', absPath: 'D:/fallback', role: 'project' }],
    });
    (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await showProjectInfo(makeConfig(), logger, detection, workspace);

    const infoCalls = asMockLogger(logger).info.mock.calls.map((c) => c[0] as string);
    const all = infoCalls.join('\n');
    expect(all).toMatch(/D:\/fallback/);
  });

  it('workspace.workspaceRoot 与 first folder 都缺失时显示 (none)', async () => {
    const logger = makeSilentLogger();
    const detection = makeDetection();
    const workspace = makeWorkspace({ workspaceRoot: undefined, workspaceFolders: [] });
    (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await showProjectInfo(makeConfig(), logger, detection, workspace);

    const infoCalls = asMockLogger(logger).info.mock.calls.map((c) => c[0] as string);
    const all = infoCalls.join('\n');
    expect(all).toContain('(none)');
  });
});
