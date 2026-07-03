/**
 * Config —— 对 `vscode.workspace.getConfiguration('vscodeUEHelper')` 的强类型封装
 *
 * ## 设计动机
 *
 * VS Code 配置 API 是字符串键访问,直接用
 *   vscode.workspace.getConfiguration('vscodeUEHelper').get<T>(...)
 * 又丑又容易拼错。集中到一个类里:
 *
 *   const config = new Config();
 *   const cfg = config.configuration;        // 'Development' | 'DebugGame' | ...
 *   const target = config.target;            // 'Editor' | 'Game' | ...
 *
 * 每个 getter 都有默认值 —— 配置缺失也不会崩。
 *
 * ## 设计来源
 *
 * 镜像自 engine-link 的 `src/config/Settings.ts`：一个类管一个 namespace，强类型。
 *
 * ## 持久化
 *
 * `update(key, value, target=Workspace)` 调用 `vscode.workspace.getConfiguration().update()`。
 * 默认写到 workspace 级别（不污染全局设置）—— UE 项目通常是单 repo 工作区。
 *
 * ## 监听变化
 *
 * `onDidChange(listener)` 返回一个 disposable，listener 只在配置实际变化时触发。
 * 用法：
 *
 * ```ts
 * context.subscriptions.push(config.onDidChange((e) => {
 *   if (e.affectsConfiguration('vscodeUEHelper.completionMode')) {
 *     // 重新渲染状态栏等
 *   }
 * }));
 * ```
 */

import * as vscode from 'vscode';

// ===== 类型定义（与 package.json 的 enum 严格对应） =====

/** UE 构建配置 */
export type BuildConfiguration = 'Debug' | 'DebugGame' | 'Development' | 'Shipping' | 'Test';
/** UE Target 类型。注意：这是抽象类型，不是 UBT 期望的实际 target 名。
 *  实际名字是 `<ProjectName>Editor` 这种，由 `src/build/ubt.ts:resolveUBTTarget` 转换 */
export type BuildTarget = 'Editor' | 'Game' | 'Server' | 'Client';
/** 目标平台 */
export type BuildPlatform = 'Win64' | 'Mac' | 'Linux';
/** clangd 补全模式：fast = 精选头文件，slow = 几乎所有宏 */
export type CompletionMode = 'fast' | 'slow';
/** MCP 服务器模式：auto = 仅在 Cursor/Claude Code 启用，always = 总是，never = 不启用 */
export type MCPMode = 'auto' | 'always' | 'never';




/** Clangd Proxy 本地化模式：append = 追加到 clangd 输出，zh-only = 仅中文替换 */
export type ClangdProxyLocalizationMode = "append" | "zh-only";

/** Clangd Proxy keepaliveMax 安全默认值 */
const DEFAULT_KEEPALIVE_MAX = 20;
/** Clangd Proxy keepaliveTtlSec 安全默认值 */
const DEFAULT_KEEPALIVE_TTL_SEC = 900;
export class Config {
  /** 底层 VS Code 配置对象，构造时一次性获取，VS Code 会自动跟踪变化 */
  private readonly root: vscode.WorkspaceConfiguration;

  constructor() {
    // 这里的 'vscodeUEHelper' 必须和 package.json 里 contributes.configuration.title 对应
    this.root = vscode.workspace.getConfiguration('vscodeUEHelper');
  }

  // ===== Getters（每个对应 package.json 里的一个设置） =====

  /** 首选 UE 版本号（如 '5.4'），空字符串 = 自动检测最新 */
  get ueVersion(): string | undefined {
    const v = this.root.get<string>('ueVersion');
    // 空字符串视同未设置，返回 undefined
    return v && v.length > 0 ? v : undefined;
  }

  /** 当前构建配置，默认 Development */
  get configuration(): BuildConfiguration {
    return this.root.get<BuildConfiguration>('configuration') ?? 'Development';
  }

  /** 当前 Target 类型，默认 Editor。注意：传给 UBT 时要用 resolveUBTTarget 转 */
  get target(): BuildTarget {
    return this.root.get<BuildTarget>('target') ?? 'Editor';
  }

  /** 目标平台，默认 Win64 */
  get platform(): BuildPlatform {
    return this.root.get<BuildPlatform>('platform') ?? 'Win64';
  }

  /** clangd.exe 完整路径。空 = 自动检测（PATH / 默认 LLVM 路径） */
  get clangdPath(): string | undefined {
    const v = this.root.get<string>('clangdPath');
    return v && v.length > 0 ? v : undefined;
  }

  /** 补全模式，默认 fast（精选头文件 ~20 个，启动快） */
  get completionMode(): CompletionMode {
    return this.root.get<CompletionMode>('completionMode') ?? 'fast';
  }

  /** 是否自动备份 .code-workspace 防止 UBT 刷新覆盖，默认 true */
  get autoBackupWorkspace(): boolean {
    return this.root.get<boolean>('autoBackupWorkspace') ?? true;
  }

  /** MCP 服务器模式，默认 auto（仅 AI 工具中启用） */
  get useMCP(): MCPMode {
    return this.root.get<MCPMode>('useMCP') ?? 'auto';
  }

  /** 日志详细级别，默认 info */
  get lspLoggingLevel(): 'error' | 'warn' | 'info' | 'debug' {
    return this.root.get<'error' | 'warn' | 'info' | 'debug'>('lspLoggingLevel') ?? 'info';
  }

  /** Phase 0 占位符 —— 当前不暴露给用户 */
  get showWelcomeOnActivation(): boolean {
    return false;
  }

  
  // ===== Clangd Proxy 配置 =====

  /** 是否启用 clangd LSP Proxy，默认 false */
  get clangdProxyEnabled(): boolean {
    return this.root.get<boolean>("clangdProxy.enabled") ?? false;
  }

  /** clangd Proxy 最大 keepalive 连接数，无效值（<=0 / 非数值）clamp 到 20 */
  get clangdProxyKeepaliveMax(): number {
    const raw = this.root.get<unknown>("clangdProxy.keepaliveMax");
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return raw;
    }
    return DEFAULT_KEEPALIVE_MAX;
  }

  /** clangd Proxy keepalive TTL（秒），无效值（<=0 / 非数值）clamp 到 900 */
  get clangdProxyKeepaliveTtlSec(): number {
    const raw = this.root.get<unknown>("clangdProxy.keepaliveTtlSec");
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return raw;
    }
    return DEFAULT_KEEPALIVE_TTL_SEC;
  }

  /** 真实 clangd 二进制路径，空字符串 = 自动检测 */
  get clangdProxyRealClangdPath(): string | undefined {
    const v = this.root.get<string>("clangdProxy.realClangdPath");
    return v && v.length > 0 ? v : undefined;
  }

  /** clangd Proxy 日志文件路径，空字符串 = 不输出日志文件 */
  get clangdProxyLogPath(): string | undefined {
    const v = this.root.get<string>("clangdProxy.logPath");
    return v && v.length > 0 ? v : undefined;
  }

  /** 是否启用 clangd Proxy 本地化支持，默认 false */
  get clangdProxyLocalizationEnabled(): boolean {
    return this.root.get<boolean>("clangdProxy.localization.enabled") ?? false;
  }

  /** clangd Proxy 本地化模式，默认 append（追加到 clangd 输出） */
  get clangdProxyLocalizationMode(): ClangdProxyLocalizationMode {
    const raw = this.root.get<string>("clangdProxy.localization.mode");
    if (raw === "override") { return "zh-only"; }
    return (raw as ClangdProxyLocalizationMode) ?? "append";
  }

  /** UE 文档词典 JSON 路径 */
  get clangdProxyDictionaryPath(): string | undefined {
    const v = this.root.get<string>("clangdProxy.dictionaryPath");
    return v && v.length > 0 ? v : undefined;
  }

// ===== 写入 / 监听 =====

  /**
   * 写入一个配置项。
   *
   * @param key 配置键名（不带 'vscodeUEHelper.' 前缀）
   * @param value 新值（类型应该匹配 package.json 里定义的 schema）
   * @param target 写入目标，默认 Workspace（写到当前工作区的 settings.json）
   *               也可以选 Global（写到全局用户设置）或 WorkspaceFolder
   *
   * 返回 Promise，等待 VS Code 持久化完成
   */
  async update(
    key: string,
    value: unknown,
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace,
  ): Promise<void> {
    await this.root.update(key, value, target);
  }

  /**
   * 监听 'vscodeUEHelper' 命名空间下的任何配置变化。
   *
   * @param listener 变化回调。参数是 ConfigurationChangeEvent，可以用
   *                 `e.affectsConfiguration('vscodeUEHelper.x')` 过滤具体配置项
   * @returns Disposable，调用方需要 push 到 context.subscriptions
   *
   * 注意：listener 只在 'vscodeUEHelper.*' 变化时触发，其他 namespace 的
   * 配置变化会被过滤掉，避免不必要的回调。
   */
  onDidChange(listener: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      // affectsConfiguration 检查给定 section 是否受变化影响
      // 注意只过滤 vscodeUEHelper 开头，避免收到无关配置变化
      if (e.affectsConfiguration('vscodeUEHelper')) {listener(e);}
    });
  }
}

