/**
 * realClangdResolver.ts —— clangd proxy 的真实 clangd 路径解析器
 *
 * 职责：
 * - 在扩展端纯函数解析真实 clangd 可执行文件路径。
 * - 按配置覆盖项、插件 clangdPath、第三方 clangd.path 备份、PATH、默认 LLVM 目录排序。
 * - 明确排除本扩展 proxy launcher，避免递归把代理当成真实 clangd 启动。
 *
 * 设计原则：
 * - 不导入 vscode、proxy CLI 或 processBridge，便于单元测试和后续 T2 接线。
 * - 文件系统、环境变量、当前设置都由调用方注入，测试不依赖真实机器状态。
 * - 未找到 clangd 是预期业务结果，返回 typed notFound，不抛异常。
 */

import * as path from 'node:path';

/** clangd 路径来源，顺序即解析优先级。 */
export type RealClangdResolverSource =
  | 'proxyOverride'
  | 'configuredClangdPath'
  | 'currentClangdPath'
  | 'backupClangdPath'
  | 'pathEnv'
  | 'defaultLlvmPath';

/** 候选路径未被采用的原因。 */
export type RealClangdRejectReason = 'empty' | 'missing' | 'proxyLauncher';

/** 解析器检查过的候选路径。 */
export interface RealClangdCheckedCandidate {
  readonly path: string;
  readonly source: RealClangdResolverSource;
  readonly reason: RealClangdRejectReason;
}

/** 解析成功：返回可执行文件路径及其来源。 */
export interface RealClangdFoundResult {
  readonly kind: 'found';
  readonly path: string;
  readonly source: RealClangdResolverSource;
}

/** 解析失败：未找到真实 clangd，调用方应阻止写入 proxy 设置。 */
export interface RealClangdNotFoundResult {
  readonly kind: 'notFound';
  readonly checkedCandidates: readonly RealClangdCheckedCandidate[];
}

/** 真实 clangd 解析结果。 */
export type RealClangdResolverResult = RealClangdFoundResult | RealClangdNotFoundResult;

/** 真实 clangd 解析器输入，全部由扩展端调用者注入。 */
export interface RealClangdResolverInput {
  /** `vscodeUEHelper.clangdProxy.realClangdPath` 高级覆盖项。 */
  readonly proxyRealClangdPath?: string;
  /** `vscodeUEHelper.clangdPath` 插件既有 clangd 配置。 */
  readonly configuredClangdPath?: string;
  /** 当前第三方 clangd 扩展的 `clangd.path`。 */
  readonly currentClangdPath?: string;
  /** settingsManager 备份中的原始 `clangd.path`。 */
  readonly backupClangdPath?: string;
  /** 本扩展 proxy launcher 路径，必须从候选中排除。 */
  readonly launcherPath: string;
  /** 注入的 PATH 字符串，传 undefined 表示没有 PATH 候选。 */
  readonly envPath?: string;
  /** 注入的 PATH 分隔符，Windows 为 `;`，POSIX 为 `:`。 */
  readonly pathDelimiter: string;
  /** 默认 LLVM bin 目录列表，调用方按平台注入。 */
  readonly defaultSearchRoots: readonly string[];
  /** 注入的文件存在性判断，必须是同步纯查询。 */
  readonly fileExists: (candidate: string) => boolean;
}

interface RealClangdCandidate {
  readonly path: string;
  readonly source: RealClangdResolverSource;
}

/**
 * 按固定优先级解析真实 clangd 路径。
 *
 * 优先级：
 * 1. `clangdProxy.realClangdPath`
 * 2. `vscodeUEHelper.clangdPath`
 * 3. 当前第三方 `clangd.path`
 * 4. settingsManager 备份中的 `clangd.path`
 * 5. PATH 中的 `clangd(.exe)`
 * 6. 默认 LLVM 安装目录中的 `clangd(.exe)`
 */
export function resolveRealClangdPath(input: RealClangdResolverInput): RealClangdResolverResult {
  const rejected: RealClangdCheckedCandidate[] = [];

  for (const candidate of buildCandidates(input)) {
    const normalized = normalizeCandidate(candidate.path);
    if (!normalized) {
      rejected.push({ ...candidate, reason: 'empty' });
      continue;
    }

    if (isSamePath(normalized, input.launcherPath)) {
      rejected.push({ path: normalized, source: candidate.source, reason: 'proxyLauncher' });
      continue;
    }

    if (!input.fileExists(normalized)) {
      rejected.push({ path: normalized, source: candidate.source, reason: 'missing' });
      continue;
    }

    return {
      kind: 'found',
      path: normalized,
      source: candidate.source,
    };
  }

  return {
    kind: 'notFound',
    checkedCandidates: rejected,
  };
}

function buildCandidates(input: RealClangdResolverInput): readonly RealClangdCandidate[] {
  return [
    literalCandidate(input.proxyRealClangdPath, 'proxyOverride'),
    literalCandidate(input.configuredClangdPath, 'configuredClangdPath'),
    literalCandidate(input.currentClangdPath, 'currentClangdPath'),
    literalCandidate(input.backupClangdPath, 'backupClangdPath'),
    ...pathCandidates(input.envPath, input.pathDelimiter),
    ...defaultCandidates(input.defaultSearchRoots),
  ].filter(isCandidate);
}

function literalCandidate(
  candidatePath: string | undefined,
  source: RealClangdResolverSource,
): RealClangdCandidate | undefined {
  const normalized = normalizeCandidate(candidatePath ?? '');
  return normalized === undefined ? undefined : { path: normalized, source };
}

function pathCandidates(envPath: string | undefined, delimiter: string): readonly RealClangdCandidate[] {
  if (envPath === undefined || envPath.trim().length === 0) {
    return [];
  }

  return envPath
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => ({
      path: joinPath(entry, 'clangd.exe'),
      source: 'pathEnv' as const,
    }));
}

function defaultCandidates(roots: readonly string[]): readonly RealClangdCandidate[] {
  return roots
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => ({
      path: joinPath(entry, 'clangd.exe'),
      source: 'defaultLlvmPath' as const,
    }));
}

function isCandidate(candidate: RealClangdCandidate | undefined): candidate is RealClangdCandidate {
  return candidate !== undefined;
}

function normalizeCandidate(candidatePath: string): string | undefined {
  const trimmed = candidatePath.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function joinPath(root: string, executableName: string): string {
  return path.posix.join(root.replace(/\\/g, '/'), executableName);
}

function isSamePath(left: string, right: string): boolean {
  return normalizeComparablePath(left) === normalizeComparablePath(right);
}

function normalizeComparablePath(candidatePath: string): string {
  return path.normalize(candidatePath).replace(/\\/g, '/').toLowerCase();
}
