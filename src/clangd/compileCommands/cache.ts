/**
 * cache —— compileCommands 缓存编排子模块（per Phase 3.2）
 *
 * 抽取 `generateCompileCommands` 中三段内联缓存编排：
 *   - 入口 fingerprint + CompileCommandsCache.tryRead + ccPath 访问性判定（fast-path）
 *   - UBT 成功命中 candidate 后写入正常缓存
 *   - fallback DB 写入
 *
 * 不变量：
 *   - 不依赖 `vscode` / 主文件，单向依赖 `@clangd/fingerprint` / `@clangd/compileCommandsCache` / `@clangd/types` / `@core/logger`
 *   - 5MB 软上限 + 原子 rename 写入复用既有 `CompileCommandsCache`（**不复制**安全限制）
 *   - 异常不抛给主流程：fast-path 任意失败 → 返回 `error` 字段供主入口降级到 UBT
 *   - [W10/F2-4] 引擎根等共享 DB 记录内容哈希并在命中时校验（防多项目串味）
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from '@core/logger';
import { computeFingerprint } from '@clangd/fingerprint';
import { CompileCommandsCache } from '@clangd/compileCommandsCache';
import type { CachedCompileCommands } from '@clangd/types';

/** fast-path 命中时返回的 ccPath 与计算指纹 */
export interface FastPathHit {
  hit: true;
  ccPath: string;
  fingerprint: string;
  elapsedMs: number;
}

/** fast-path 未命中时返回的事实数据（fingerprint 已算好 / cache 是否存在） */
export interface FastPathMiss {
  hit: false;
  fingerprint: string;
  hadCache: boolean;
  /** cache 存在时携带其历史 ccPath（主文件用于判别是否需要重写缓存） */
  cachedCcPath?: string;
  elapsedMs: number;
}

/** fast-path 异常时携带错误信息（主入口继续走 UBT 路径） */
export interface FastPathError {
  hit: false;
  error: string;
}

export type FastPathResult = FastPathHit | FastPathMiss | FastPathError;

/**
 * 尝试 compile_commands.json 快速路径：
 *   - 计算 fingerprint
 *   - 读取 CompileCommandsCache
 *   - 满足「cache 存在 + fingerprint 一致 + 非 fallback + ccPath 可访问」→ 命中
 *   - [W10/F2-4] 共享 DB（引擎根等 projectDir 之外位置）额外校验内容哈希：
 *     与写缓存时记录不一致（被其他项目覆盖）→ 视为 miss 重新生成
 *   - 任意步骤异常 → 返回 { hit: false, error } 而不是抛错（per T-7-04 防御原则）
 *
 * 主文件保留所有 perfLog 埋点（例如 cacheHit / cacheMiss / fastPathError），
 * 子模块只交付事实数据与 elapsedMs。
 *
 * @param projectDir .uproject 所在目录（缓存按项目隔离存储）
 * @param logger 可选日志
 * @param engineRoot [W11/F2-5] 可选引擎根：用于把 Build.version 纳入 fingerprint，
 *   并用于判定 ccPath 是否位于引擎根（共享 DB）
 */
export async function tryCompileCommandsFastPath(
  projectDir: string,
  logger?: Logger,
  engineRoot?: string,
): Promise<FastPathResult> {
  const cache = new CompileCommandsCache({ logger });
  const fpStart = performance.now();
  try {
    const fp = await computeFingerprint(projectDir, engineRoot);
    const cachedEntry = await cache.tryRead(projectDir);
    const elapsedMs = performance.now() - fpStart;

    // 命中条件：cache 存在 + fingerprint 一致 + 非 fallback + ccPath 可访问
    // P1-3: fallback 条目不走快路径（下次仍重试 UBT，避免永久降级）
    if (cachedEntry && cachedEntry.fingerprint === fp.fingerprint && !cachedEntry.fallback) {
      const ccExists = await fs
        .access(cachedEntry.ccPath)
        .then(() => true)
        .catch(() => false);
      if (ccExists) {
        // [W10/F2-4] 共享 DB 内容校验：被其他项目覆盖后必须 miss 重新生成。
        // 只校验记录了 ccContentHash 的条目（写缓存时对引擎根等共享位置记录），
        // 项目本地 DB 无跨项目共享风险，不增加 IO。
        if (cachedEntry.ccContentHash) {
          const currentHash = await hashFileContent(cachedEntry.ccPath);
          if (currentHash === undefined || currentHash !== cachedEntry.ccContentHash) {
            // 内容读失败或哈希不一致 → 保守视为 miss（避免命中错误/陈旧 DB）
            logger?.warn(
              `[compileCommands/cache] 共享 DB 内容哈希不匹配（可能被其他项目覆盖），视为 miss 重新生成: ${cachedEntry.ccPath}`,
            );
            return {
              hit: false,
              fingerprint: fp.fingerprint,
              hadCache: true,
              cachedCcPath: cachedEntry.ccPath,
              elapsedMs,
            };
          }
        }
        return { hit: true, ccPath: cachedEntry.ccPath, fingerprint: fp.fingerprint, elapsedMs };
      }
    }
    return {
      hit: false,
      fingerprint: fp.fingerprint,
      hadCache: !!cachedEntry,
      cachedCcPath: cachedEntry?.ccPath,
      elapsedMs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { hit: false, error: msg };
  }
}

/**
 * 写入 compile_commands.json 缓存：
 *   - 正常路径：fileCount = 0（UBT 自身生成的完整表，无需补全）
 *   - fallback 路径：fileCount = fallback.entryCount, fallback = true（下次仍重试 UBT）
 *   - [W10/F2-4] ccPath 位于引擎根等共享位置时记录 DB 内容哈希（供命中时校验串味）
 *
 * 失败不抛：异常被 caller 自动降级（仅日志告警），主流程不受影响。
 */
export async function writeCompileCommandsCache(
  projectDir: string,
  ccPath: string,
  opts: { fallback?: boolean; fileCount?: number; logger?: Logger; engineRoot?: string },
): Promise<void> {
  const cache = new CompileCommandsCache({ logger: opts.logger });
  const fp = await computeFingerprint(projectDir, opts.engineRoot);
  const entry: CachedCompileCommands = {
    fingerprint: fp.fingerprint,
    ccPath,
    linkTarget: ccPath,
    savedAt: new Date().toISOString(),
    fileCount: opts.fileCount ?? 0,
    fallback: opts.fallback === true,
  };
  // [W10/F2-4] 共享 DB（引擎根等 projectDir 之外）记录写入时内容哈希。
  // 快路径命中时比对当前内容：被其他项目覆盖 → miss，避免缓存串味。
  // 读失败不阻断缓存写入（T-7-04 防御原则：仅缺失该校验字段）。
  if (isSharedDbPath(projectDir, ccPath)) {
    entry.ccContentHash = await hashFileContent(ccPath);
  }
  await cache.write(projectDir, entry);
}

/* ------------------------------------------------------------------ */
/*  内部辅助                                                            */
/* ------------------------------------------------------------------ */

/**
 * [W10/F2-4] 判断 ccPath 是否位于 projectDir 之外（共享 DB，典型为引擎根
 * <EngineRoot>/compile_commands.json）。
 *
 * 选择理由（内容哈希方案 vs 缓存 key 加引擎维度）：
 *   - 缓存文件本身按 projectDir 隔离存储（{projectDir}/.vscode/clangd-perf-cache/），
 *     引擎维度进 key 并不能阻止两个项目共享同一引擎根 DB 文件时的互相覆盖——
 *     key 仍指向同一个共享文件，旧项目命中后拿到的还是被覆盖的内容；
 *   - 内容哈希直接以 DB 实际内容为准：无论哪个项目/哪次 UBT 覆盖了共享文件，
 *     只要内容与写缓存时不一致就 miss 重新生成，语义最贴近问题本身；
 *   - 项目本地 DB（.vscode 内）无跨项目共享风险，不做内容校验，避免命中时
 *     多一次整文件 IO（compile_commands.json 可达数 MB）。
 */
function isSharedDbPath(projectDir: string, ccPath: string): boolean {
  const normProject = path.resolve(projectDir);
  const normCc = path.resolve(ccPath);
  // Windows-only 仓库：路径比较统一小写避免盘符/大小写不一致误判
  const projectKey = process.platform === 'win32' ? normProject.toLowerCase() : normProject;
  const ccKey = process.platform === 'win32' ? normCc.toLowerCase() : normCc;
  return ccKey !== projectKey && !ccKey.startsWith(`${projectKey}${path.sep}`);
}

/** 计算文件内容 SHA256 hex；读失败返回 undefined（不抛错，T-7-04 防御原则） */
async function hashFileContent(filePath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return undefined;
  }
}
