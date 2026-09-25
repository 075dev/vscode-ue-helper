/**
 * extension.test.ts —— 扩展激活入口的接线测试(bugfix-002 复现/回归)
 *
 * bug:extension.ts 激活流程从未调用 activateMCP(Phase 11 遗留 dead code,
 * src/mcp/index.ts 头注释自称"Plan 12 处理"但后续未落地)——MCP 服务器在
 * 任何宿主下都不会启动,AI agent 的 9 个 ue_* 工具全部不可用。
 *
 * 回归断言:activate() 必须接线 activateMCP(fire-and-forget,不阻塞激活),
 * 且 MCP 启动失败不影响主激活流程。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ============ mock 全部 activate 链路依赖(懒箭头,规避 hoist 顺序问题) ============

const mockActivateMCP = vi.fn<unknown[], Promise<unknown>>();
const mockActivateDetection = vi.fn<unknown[], unknown>();
const mockActivateBuild = vi.fn<unknown[], unknown>();
const mockActivateClangd = vi.fn<unknown[], unknown>();
const mockActivateUI = vi.fn<unknown[], unknown>();
const mockActivateCommands = vi.fn<unknown[], unknown>();
const mockRunFirstTimeInit = vi.fn<unknown[], Promise<unknown>>();
const mockShowProjectInfo = vi.fn<unknown[], Promise<unknown>>();

vi.mock('@mcp/index', () => ({
  activateMCP: (...args: unknown[]) => mockActivateMCP(...args),
}));
vi.mock('@detection', () => ({
  activateDetection: (...args: unknown[]) => mockActivateDetection(...args),
}));
vi.mock('@build', () => ({
  activateBuild: (...args: unknown[]) => mockActivateBuild(...args),
}));
vi.mock('@clangd', () => ({
  activateClangd: (...args: unknown[]) => mockActivateClangd(...args),
}));
vi.mock('@ui', () => ({
  activateUI: (...args: unknown[]) => mockActivateUI(...args),
}));
vi.mock('@commands', () => ({
  activateCommands: (...args: unknown[]) => mockActivateCommands(...args),
}));
vi.mock('@commands/firstRunInit', () => ({
  runFirstTimeInit: (...args: unknown[]) => mockRunFirstTimeInit(...args),
}));
vi.mock('@commands/showProjectInfo', () => ({
  showProjectInfo: (...args: unknown[]) => mockShowProjectInfo(...args),
}));
vi.mock('@clangd/perfLog', () => ({
  perfLog: { record: vi.fn(), setWorkspace: vi.fn() },
}));
vi.mock('@i18n', () => ({
  initI18n: vi.fn(),
  t: (_key: string) => _key,
}));
vi.mock('@core/logger', () => ({
  sharedLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    setLevel: vi.fn(),
  },
}));
vi.mock('@core/subprocessRegistry', () => ({
  sharedSubprocessRegistry: { dispose: vi.fn() },
}));
vi.mock('@core/config', () => ({
  Config: class {
    onDidChange = vi.fn(() => ({ dispose: vi.fn() }));
    useMCP = 'auto';
    lspLoggingLevel = 'info';
  },
}));
vi.mock('@core/workspace', () => ({
  WorkspaceState: class {
    dispose = vi.fn();
  },
}));
vi.mock('@clangd/clangdOps', () => ({
  ClangdOps: class {
    dispose = vi.fn();
  },
}));
vi.mock('@ui/controlPanel', () => ({
  ControlPanelProvider: { register: vi.fn() },
}));

// vscode 无 npm 包(运行时注入),不能 importOriginal —— 手写 extension.ts 需要的最小面
vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
}));

import * as vscode from 'vscode';
import { activate } from '@/extension';

function fakeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    globalState: {
      get: vi.fn(() => true),
      update: vi.fn(),
    },
  } as unknown as vscode.ExtensionContext;
}

describe('extension activate 的 MCP 接线(bugfix-002)', () => {
  const mockActivateMCPResolves = mockActivateMCP as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockActivateMCPResolves.mockResolvedValue({ server: {}, host: 'cursor' });
    mockActivateDetection.mockReturnValue({ workspaceContext: {} });
    mockActivateBuild.mockReturnValue({});
    mockActivateClangd.mockReturnValue({});
    mockActivateUI.mockReturnValue({ projectExplorer: {}, statusBar: {} });
    mockActivateCommands.mockReturnValue(undefined);
    mockRunFirstTimeInit.mockResolvedValue(undefined);
  });

  it('activate 应调用 activateMCP(fire-and-forget,不阻塞激活)', async () => {
    await activate(fakeContext());

    expect(mockActivateMCP).toHaveBeenCalledTimes(1);
    // (context, config, logger, detection, workspace, clangdOps)
    expect(mockActivateMCP).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('activateMCP 启动失败(reject)不影响主激活流程', async () => {
    mockActivateMCPResolves.mockRejectedValueOnce(new Error('stdio unavailable'));

    await expect(activate(fakeContext())).resolves.toBeUndefined();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('failed to activate'),
    );
  });
});
