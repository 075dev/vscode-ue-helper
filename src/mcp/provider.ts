import * as vscode from 'vscode';
import type { Config } from '@core/config';
import type { Logger } from '@core/logger';
import { MCP_TOOLS, setMCPContext } from './tools';
import type { MCPContext } from './tools';
import { MCPBridgeServer } from './bridge';

export const MCP_PROVIDER_ID = 'vscode-ue-helper.mcp';

export interface MCPProviderDeps {
  context: vscode.ExtensionContext;
  config: Config;
  logger: Logger;
  mcpContext: MCPContext;
}

class UEHelperMCPProvider implements vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> {
  private readonly definitionChanged = new vscode.EventEmitter<void>();
  private readonly bridges = new Set<MCPBridgeServer>();
  // [bugfix-005] 单例 bridge:VS Code 可能多次 provide/resolve(定义变更、会话重启),
  // 每次新建管道服务器会泄漏句柄并表现为"重新呼出新进程"。
  private bridge: MCPBridgeServer | undefined;

  readonly onDidChangeMcpServerDefinitions = this.definitionChanged.event;

  constructor(private readonly deps: MCPProviderDeps) {}

  /**
   * [bugfix-005] 取(或懒建)单例 bridge。
   * 必须在 provide 阶段就注入 pipe/token:VS Code 存在不调用 resolve 的启动路径
   * (后台转发到 Copilot 会话、definition 缓存重启),definition 若在 provide 时
   * 不自足,spawn 出的 mcpServer.js 会因缺 env 立即退出,代理侧表现为"无法启动"。
   */
  private async ensureBridge(): Promise<MCPBridgeServer> {
    if (!this.bridge) {
      const created = new MCPBridgeServer(this.deps.logger);
      await created.start();
      this.bridge = created;
      this.bridges.add(created);
      this.deps.context.subscriptions.push(created);
    }
    return this.bridge;
  }

  async provideMcpServerDefinitions(
    token: vscode.CancellationToken,
  ): Promise<vscode.McpStdioServerDefinition[]> {
    const mode = this.deps.config.useMCP;
    const isVSCode = (vscode.env.appName ?? '').toLowerCase().includes('visual studio code');
    if (token.isCancellationRequested || mode === 'never' || (mode === 'auto' && !isVSCode)) {
      return [];
    }

    const { context } = this.deps;
    const script = vscode.Uri.joinPath(context.extensionUri, 'out', 'mcpServer.js').fsPath;
    const tools = JSON.stringify(MCP_TOOLS);
    const extensionPackage: unknown = context.extension.packageJSON;
    const version =
      typeof extensionPackage === 'object' &&
      extensionPackage !== null &&
      'version' in extensionPackage &&
      typeof extensionPackage.version === 'string'
        ? extensionPackage.version
        : '0.0.0';
    const bridge = await this.ensureBridge();
    return [
      new vscode.McpStdioServerDefinition(
        'VSCode UE Helper',
        process.execPath,
        [script],
        {
          ELECTRON_RUN_AS_NODE: '1',
          ...bridge.environment,
          VSCODE_UE_HELPER_MCP_TOOLS: tools,
        },
        version,
      ),
    ];
  }

  async resolveMcpServerDefinition(
    server: vscode.McpStdioServerDefinition,
    token: vscode.CancellationToken,
  ): Promise<vscode.McpStdioServerDefinition | undefined> {
    if (token.isCancellationRequested || this.deps.config.useMCP === 'never') {
      return undefined;
    }

    // [bugfix-005] 复用单例 bridge —— resolve 阶段只做 env 幂等补齐(正常启动路径
    // 已在 provide 时带齐,这里覆盖同值,保证任何入口拿到的 env 一致)。
    const bridge = await this.ensureBridge();
    server.env = { ...server.env, ...bridge.environment };
    return server;
  }

  notifyDefinitionsChanged(): void {
    this.definitionChanged.fire();
  }

  dispose(): void {
    this.definitionChanged.dispose();
    for (const bridge of this.bridges) {
      bridge.dispose();
    }
    this.bridges.clear();
  }
}

export function registerMCPProvider(deps: MCPProviderDeps): vscode.Disposable | undefined {
  const { context, config, logger } = deps;
  setMCPContext(deps.mcpContext);

  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== 'function') {
    logger.warn(
      '[mcp] VS Code MCP provider API is unavailable; update VS Code to a version with MCP extension support',
    );
    return undefined;
  }

  const provider = new UEHelperMCPProvider(deps);
  const registration = vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, provider);
  const configListener = config.onDidChange((event) => {
    if (event.affectsConfiguration('vscodeUEHelper.useMCP')) {
      provider.notifyDefinitionsChanged();
    }
  });
  const disposable = {
    dispose: () => {
      configListener.dispose();
      registration.dispose();
      provider.dispose();
      setMCPContext(null);
    },
  };
  context.subscriptions.push(disposable);
  logger.info('[mcp] VS Code MCP provider registered');
  return disposable;
}
