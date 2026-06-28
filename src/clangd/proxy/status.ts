/**
 * status.ts —— Clangd LSP Proxy 可序列化状态模型
 *
 * 职责：
 * - 定义 ClangdProxyStatus 接口，包含所有代理状态字段
 * - 提供 buildStatus() 工厂函数，从 Config + 扩展侧信息构建状态
 * - 不依赖 vscode，纯数据模型
 *
 * 设计原则：
 * - 所有字段可 JSON 序列化（无函数、无 class 实例）
 * - 不查询运行中的代理进程——v1 只读配置和备份状态
 * - lastKnownProblem 为可选字段，记录最近一次已知问题
 */

// ---------------------------------------------------------------------------
// 可序列化状态模型
// ---------------------------------------------------------------------------

/** Clangd LSP Proxy 可序列化状态 */
export interface ClangdProxyStatus {
  /** 配置中是否启用了 proxy */
  enabled: boolean;
  /** launcher 脚本的完整路径 */
  launcherPath: string;
  /** 真实 clangd 二进制路径（配置中指定，undefined = 自动检测） */
  realClangdPath: string | undefined;
  /** 最大保活条目数 */
  keepaliveMax: number;
  /** TTL 秒数 */
  keepaliveTtlSec: number;
  /** 是否启用本地化 */
  localizationEnabled: boolean;
  /** 本地化模式：append 或 override */
  localizationMode: string;
  /** 本地化目标列表 */
  localizationTargets: readonly string[];
  /** 日志文件路径（配置中指定，undefined = 未设置） */
  logPath: string | undefined;
  /** 是否有 clangd 设置备份存在 */
  backupExists: boolean;
  /** 最近一次已知问题（可选，v1 中可能为 undefined） */
  lastKnownProblem: string | undefined;
}

// ---------------------------------------------------------------------------
// 状态构建接口（扩展侧注入依赖）
// ---------------------------------------------------------------------------

/** 构建状态所需的依赖 */
export interface StatusDependencies {
  /** 配置中是否启用了 proxy */
  enabled: boolean;
  /** launcher 路径 */
  launcherPath: string;
  /** 真实 clangd 路径 */
  realClangdPath: string | undefined;
  /** keepalive max */
  keepaliveMax: number;
  /** keepalive TTL 秒 */
  keepaliveTtlSec: number;
  /** 本地化启用 */
  localizationEnabled: boolean;
  /** 本地化模式 */
  localizationMode: string;
  /** 本地化目标 */
  localizationTargets: readonly string[];
  /** 日志路径 */
  logPath: string | undefined;
  /** 是否有备份 */
  hasBackup: boolean;
  /** 最近一次已知问题 */
  lastKnownProblem?: string;
}

// ---------------------------------------------------------------------------
// buildStatus —— 工厂函数
// ---------------------------------------------------------------------------

/**
 * 从依赖构建 ClangdProxyStatus。
 *
 * 纯函数，不依赖 I/O，不抛出异常。
 * 所有字段从 StatusDependencies 映射，不查询运行中的代理进程。
 *
 * @param deps - 状态依赖
 * @returns 可序列化的状态对象
 */
export function buildStatus(deps: StatusDependencies): ClangdProxyStatus {
  return {
    enabled: deps.enabled,
    launcherPath: deps.launcherPath,
    realClangdPath: deps.realClangdPath,
    keepaliveMax: deps.keepaliveMax,
    keepaliveTtlSec: deps.keepaliveTtlSec,
    localizationEnabled: deps.localizationEnabled,
    localizationMode: deps.localizationMode,
    localizationTargets: deps.localizationTargets,
    logPath: deps.logPath,
    backupExists: deps.hasBackup,
    lastKnownProblem: deps.lastKnownProblem,
  };
}
