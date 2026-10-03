/**
 * clangdLocator.ts —— clangd 路径统一解析服务（add-003 / 决策 D8）
 *
 * 职责：
 * - 收敛此前两条独立链路的候选源：插件 `vscodeUEHelper.clangdPath`、第三方 `clangd.path`
 *   当前值与 settingsManager 备份值、`where clangd`、PATH 遍历、默认 LLVM 目录——src 下
 *   仅此一份定义，proxyManager 与 windowsSdk 均消费本模块。
 * - `ClangdLocator` 类：懒探测 + 缓存 + 失效。创建实例零 IO（不 spawn、不访问文件系统），
 *   首次调用任一视图才探测；`invalidate()` 供配置变更监听与 proxy enable/disable 后调用。
 * - 两个视图（语义见 decisions.md D8）：
 *   - `resolveRealClangd()`：排除本扩展 proxy launcher，供 clangd 代理链路（proxyManager）；
 *   - `locateClangDriver()`：clangd + 由 `clangd --version` 的 InstalledDir 推导 clang
 *     驱动器（clang++.exe / clang.exe，含 sibling fallback），供 MSVC/SDK 探测链路。
 * - `findClangdShared()`：windowsSdk 用的无状态模块级查找（插件配置 → where → PATH →
 *   默认目录，不排除 launcher、不缓存），语义与原 windowsSdk.findClangdExecutable 一致。
 *
 * 设计原则：
 * - 解析内核复用 `proxy/realClangdResolver.ts` 纯函数（候选检查、launcher 排除、
 *   checkedCandidates 诊断结构单点在彼处）；本模块只负责 where 执行、候选输入收集、
 *   缓存与 InstalledDir 推导。
 * - 全部 IO（execFile、文件存在性、PATH、默认目录）可注入，测试不依赖真实机器状态。
 * - 子进程均为 `await + close` 的短探测（where 5s、clangd --version 5s），不接入
 *   SubprocessRegistry（同 windowsSdk.ts 头注释的决策：生命周期被 Promise 严格框定）。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { type Logger } from '@core/logger';
import {
  resolveRealClangdPath,
  type RealClangdResolverResult,
  type RealClangdResolverSource,
} from '../proxy/realClangdResolver';

const execFileAsync = promisify(execFile);

/** clangd 驱动器定位结果：clangd 路径 + 可运行的 clang 驱动器路径。 */
export interface ClangDriverLocation {
  readonly clangdPath: string;
  readonly source: RealClangdResolverSource;
  readonly driverPath: string;
}

/** locator 的 IO 依赖，全部可注入；缺省值读取真实机器状态。 */
export interface ClangdLocatorIo {
  /** 执行 where / clangd --version 的子进程函数。 */
  readonly execFile: (
    file: string,
    args: readonly string[],
    opts: { windowsHide: boolean; timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  /** 同步文件存在性检查（解析内核要求同步纯查询）。 */
  readonly fileExists: (candidate: string) => boolean;
  /** PATH 环境变量；undefined 表示没有 PATH 候选。 */
  readonly envPath: string | undefined;
  /** PATH 分隔符（Windows `;`，POSIX `:`）。 */
  readonly pathDelimiter: string;
  /** 默认 LLVM bin 目录列表（惰性求值，不驻留模块顶层的环境变量快照）。 */
  readonly defaultSearchRoots: () => readonly string[];
}

function defaultIo(): ClangdLocatorIo {
  return {
    execFile: (file, args, opts) => execFileAsync(file, args, opts),
    fileExists: (candidate) => fs.existsSync(candidate),
    envPath: process.env.PATH,
    pathDelimiter: path.delimiter,
    defaultSearchRoots: DEFAULT_LLVM_SEARCH_ROOTS,
  };
}

function resolveIo(partial?: Partial<ClangdLocatorIo>): ClangdLocatorIo {
  const base = defaultIo();
  if (!partial) {
    return base;
  }
  // 显式传入 undefined 的字段视为"未覆盖"（调用方常以 `io: { fileExists: deps.fileExists }`
  // 透传可空依赖），避免 spread 把缺省实现覆盖成 undefined。
  const merged = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged as unknown as ClangdLocatorIo;
}

/**
 * 默认 clangd 搜索根（VS/LLVM 标准安装路径）。
 *
 * [add-003] 唯一一份：此前 proxyManager.buildDefaultClangdSearchRoots 与
 * windowsSdk.findClangdExecutable 各硬编码一份，已实际漂移。
 */
export function DEFAULT_LLVM_SEARCH_ROOTS(): readonly string[] {
  return [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'LLVM', 'bin'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'LLVM', 'bin'),
    path.join(process.env.LocalAppData ?? '', 'Programs', 'LLVM', 'bin'),
  ];
}

/**
 * 执行 `where clangd`（5s 超时），返回第一条存在的路径。
 *
 * `where` 不可用（如 POSIX）或无匹配时返回 null——调用方据此在候选链中
 * 跳过 whereCommand 级。子进程为 ms 级短探测，生命周期被 await 框定。
 */
export async function whereClangd(
  io: ClangdLocatorIo,
  logger?: Logger,
): Promise<string | null> {
  try {
    const { stdout } = await io.execFile('where', ['clangd'], {
      windowsHide: true,
      timeout: 5_000,
    });
    const first = stdout.split(/\r?\n/)[0]?.trim();
    if (first && io.fileExists(first)) {
      logger?.debug(`[clangdLocator] \`where clangd\` resolved: ${first}`);
      return first;
    }
  } catch {
    /* `where` unavailable or no match */
  }
  return null;
}

/**
 * 运行 `clangd --version` 并解析 `InstalledDir:` 行（5s 超时）。
 *
 * 示例输出：
 *   clangd version 19.1.0
 *   InstalledDir: C:\Program Files\LLVM\bin
 *
 * [add-003] 自 windowsSdk.readInstalledDir 迁移，逻辑不变。
 */
export async function readInstalledDir(
  clangdExe: string,
  io?: Partial<ClangdLocatorIo>,
  logger?: Logger,
): Promise<string | null> {
  const resolvedIo = resolveIo(io);
  try {
    const { stdout, stderr } = await resolvedIo.execFile(clangdExe, ['--version'], {
      windowsHide: true,
      timeout: 5_000,
    });
    const output = `${stdout}\n${stderr}`;
    const m = output.match(/^InstalledDir:\s*(.+)\s*$/m);
    if (m) {
      logger?.debug(`[clangdLocator] raw clangd --version output: ${output.replace(/\n/g, ' | ')}`);
    } else {
      logger?.warn(
        `[clangdLocator] \`${clangdExe} --version\` did not include an InstalledDir line — output:\n${output}`,
      );
    }
    return m ? (m[1]?.trim() ?? null) : null;
  } catch (err) {
    logger?.warn(
      `[clangdLocator] \`${clangdExe} --version\` failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * 从一个已定位的 clangd 推导可运行的 clang 驱动器：
 * 1. `clangd --version` 读 InstalledDir（权威 LLVM bin 目录），优先 clang++.exe、回落 clang.exe；
 * 2. InstalledDir 缺失（旧版构建）时在 clangd 自身目录 sibling 扫描（slim LLVM 常见布局）。
 *
 * 返回 null 表示推导不出驱动器。
 *
 * [add-003] 自 windowsSdk.resolveClangExecutable Step 2/3 迁移，逻辑不变。
 */
export async function locateClangDriverFrom(
  clangdExe: string,
  io?: Partial<ClangdLocatorIo>,
  logger?: Logger,
): Promise<string | null> {
  const resolvedIo = resolveIo(io);
  const installedDir = await readInstalledDir(clangdExe, io, logger);
  if (installedDir) {
    logger?.info(`[clangdLocator] clangd --version reports InstalledDir: ${installedDir}`);
    for (const name of ['clang++.exe', 'clang.exe']) {
      const candidate = path.join(installedDir, name);
      if (resolvedIo.fileExists(candidate)) {
        logger?.info(`[clangdLocator] resolved clang driver (from InstalledDir): ${candidate}`);
        return candidate;
      }
    }
    logger?.warn(
      `[clangdLocator] InstalledDir=${installedDir} has no clang++.exe / clang.exe — falling back to sibling scan`,
    );
  }

  // Fallback: clangd's own directory might still have clang++.exe alongside.
  const dir = path.dirname(clangdExe);
  for (const name of ['clang++.exe', 'clang.exe', 'clangd.exe']) {
    const candidate = path.join(dir, name);
    if (resolvedIo.fileExists(candidate)) {
      logger?.info(`[clangdLocator] resolved clang driver (sibling fallback): ${candidate}`);
      return candidate;
    }
  }

  return null;
}

/** `findClangdShared` 的输入。 */
export interface FindClangdSharedOptions {
  /** 插件 `vscodeUEHelper.clangdPath` 显式配置。 */
  readonly configuredPath?: string;
  readonly logger?: Logger;
  /** IO 注入（测试用）；缺省读真实机器状态。 */
  readonly io?: Partial<ClangdLocatorIo>;
}

/**
 * 无状态 clangd 查找（windowsSdk/SDK 探测链路专用）：插件配置 → where → PATH →
 * 默认 LLVM 目录。不读第三方 clangd.path 当前值/备份、不排除 launcher、不缓存。
 *
 * [add-003] 取代 windowsSdk.findClangdExecutable——候选检查逻辑收敛到
 * realClangdResolver 纯函数，默认目录列表唯一份。
 */
export async function findClangdShared(
  options: FindClangdSharedOptions,
): Promise<{ path: string; source: RealClangdResolverSource } | null> {
  const io = resolveIo(options.io);

  // 显式配置命中直接短路（与原 windowsSdk.findClangdExecutable 行为一致：零子进程）。
  const configured = options.configuredPath?.trim();
  if (configured && io.fileExists(configured)) {
    return { path: configured, source: 'configuredClangdPath' };
  }

  const wherePath = await whereClangd(io, options.logger);
  const result = resolveRealClangdPath({
    configuredClangdPath: options.configuredPath,
    whereClangdPath: wherePath ?? undefined,
    envPath: io.envPath,
    pathDelimiter: io.pathDelimiter,
    defaultSearchRoots: io.defaultSearchRoots(),
    fileExists: io.fileExists,
  });
  return result.kind === 'found' ? { path: result.path, source: result.source } : null;
}

/** ClangdLocator 的候选源 getter，全部惰性调用（每次探测现读，配置变更即时生效）。 */
export interface ClangdLocatorDeps {
  /** `vscodeUEHelper.clangdProxy.realClangdPath` 高级覆盖项。 */
  readonly getProxyOverridePath?: () => string | undefined;
  /** `vscodeUEHelper.clangdPath` 插件配置。 */
  readonly getConfiguredClangdPath?: () => string | undefined;
  /** 第三方 clangd 扩展的 `clangd.path` 当前值。 */
  readonly getCurrentClangdExtensionPath?: () => string | undefined;
  /** settingsManager 备份中的原始 `clangd.path`。 */
  readonly getBackupClangdPath?: () => string | undefined;
  /** 本扩展 proxy launcher 路径；提供时从候选中排除（防递归自启）。 */
  readonly launcherPath?: string;
  readonly logger?: Logger;
  /** IO 注入（测试用）；缺省读真实机器状态。 */
  readonly io?: Partial<ClangdLocatorIo>;
}

/**
 * clangd 路径统一解析服务（懒探测 + 缓存 + 失效）。
 *
 * 创建实例零 IO；首次调用 `resolveRealClangd()` / `locateClangDriver()` 才探测，
 * 并发调用共享同一次探测（缓存探测 promise 而非结果，避免重复 spawn）。
 * 输入源变更（配置、备份、launcher）后调 `invalidate()` 丢弃缓存。
 */
export class ClangdLocator {
  private readonly deps: ClangdLocatorDeps;
  private readonly io: ClangdLocatorIo;

  private probePromise: Promise<RealClangdResolverResult> | null = null;
  private driverPromise: Promise<ClangDriverLocation | null> | null = null;

  constructor(deps: ClangdLocatorDeps) {
    this.deps = deps;
    this.io = resolveIo(deps.io);
  }

  /**
   * 视图一：真实 clangd 路径（排除 launcher）。
   *
   * 供 clangd 代理链路：found 返回 { path, source }；notFound 返回 checkedCandidates，
   * 调用方（proxyManager）据此阻断写入 proxy 设置。
   */
  async resolveRealClangd(): Promise<RealClangdResolverResult> {
    if (!this.probePromise) {
      this.probePromise = this.probe();
    }
    return this.probePromise;
  }

  /**
   * 视图二：clangd + clang 驱动器。
   *
   * 供 MSVC/SDK 探测链路：共享 clangd 探测缓存，再跑 `clangd --version` 推导
   * 驱动器；clangd 未找到或推导失败返回 null。
   */
  async locateClangDriver(): Promise<ClangDriverLocation | null> {
    if (!this.driverPromise) {
      this.driverPromise = (async () => {
        const found = await this.resolveRealClangd();
        if (found.kind !== 'found') {
          return null;
        }
        const driverPath = await locateClangDriverFrom(found.path, this.io, this.deps.logger);
        if (!driverPath) {
          return null;
        }
        return { clangdPath: found.path, source: found.source, driverPath };
      })();
    }
    return this.driverPromise;
  }

  /** 丢弃全部缓存；下次调用任一视图时重新探测。 */
  invalidate(): void {
    this.probePromise = null;
    this.driverPromise = null;
  }

  private async probe(): Promise<RealClangdResolverResult> {
    // where 是候选链中唯一的子进程探测，先行执行后作为注入候选参与纯函数解析。
    const wherePath = await whereClangd(this.io, this.deps.logger);
    return resolveRealClangdPath({
      proxyRealClangdPath: this.deps.getProxyOverridePath?.(),
      configuredClangdPath: this.deps.getConfiguredClangdPath?.(),
      currentClangdPath: this.deps.getCurrentClangdExtensionPath?.(),
      backupClangdPath: this.deps.getBackupClangdPath?.(),
      whereClangdPath: wherePath ?? undefined,
      launcherPath: this.deps.launcherPath,
      envPath: this.io.envPath,
      pathDelimiter: this.io.pathDelimiter,
      defaultSearchRoots: this.io.defaultSearchRoots(),
      fileExists: this.io.fileExists,
    });
  }
}
