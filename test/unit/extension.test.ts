/**
 * extension.test.ts —— 扩展激活入口的 MCP provider 接线测试
 *
 * MCP Provider 必须在扩展激活时注册，并注入当前工作区运行时上下文。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MCPProviderDeps } from '@mcp/provider';

// ============ mock 全部 activate 链路依赖(懒箭头,规避 hoist 顺序问题) ============

const mockRegisterMCPProvider = vi.fn<[MCPProviderDeps], void>();
const mockActivateDetection = vi.fn<unknown[], unknown>();
const mockActivateBuild = vi.fn<unknown[], unknown>();
const mockActivateClangd = vi.fn<unknown[], unknown>();
const mockActivateUI = vi.fn<unknown[], unknown>();
const mockActivateCommands = vi.fn<unknown[], unknown>();
const mockRunFirstTimeInit = vi.fn<unknown[], Promise<unknown>>();
const mockShowProjectInfo = vi.fn<unknown[], Promise<unknown>>();

vi.mock('@mcp/provider', () => ({
  registerMCPProvider: (deps: MCPProviderDeps) => mockRegisterMCPProvider(deps),
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockActivateDetection.mockReturnValue({ workspaceContext: {} });
    mockActivateBuild.mockReturnValue({});
    mockActivateClangd.mockReturnValue({});
    mockActivateUI.mockReturnValue({ projectExplorer: {}, statusBar: {} });
    mockActivateCommands.mockReturnValue(undefined);
    mockRunFirstTimeInit.mockResolvedValue(undefined);
  });

  it('activate 应注册 VS Code MCP provider 并注入运行时上下文', async () => {
    await activate(fakeContext());

    expect(mockRegisterMCPProvider).toHaveBeenCalledTimes(1);
    const deps = mockRegisterMCPProvider.mock.calls[0]?.[0];
    if (!deps) {
      throw new Error('MCP provider was not registered');
    }
    expect(deps.context).toBeDefined();
    expect(deps.config).toBeDefined();
    expect(deps.logger).toBeDefined();
    expect(deps.mcpContext.config).toBeDefined();
    expect(deps.mcpContext.logger).toBeDefined();
    expect(deps.mcpContext.detection).toBeDefined();
    expect(deps.mcpContext.workspace).toBeDefined();
    expect(deps.mcpContext.clangdOps).toBeDefined();
  });

  it('MCP provider 注册不影响扩展主激活流程', async () => {
    await expect(activate(fakeContext())).resolves.toBeUndefined();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('failed to activate'),
    );
  });
});
