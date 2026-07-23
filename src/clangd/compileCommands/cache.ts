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
 */

import * as fs from 'node:fs/promises';
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
 *   - 任意步骤异常 → 返回 { hit: false, error } 而不是抛错（per T-7-04 防御原则）
 *
 * 主文件保留所有 perfLog 埋点（例如 cacheHit / cacheMiss / fastPathError），
 * 子模块只交付事实数据与 elapsedMs。
 */
export async function tryCompileCommandsFastPath(
  projectDir: string,
  logger?: Logger,
): Promise<FastPathResult> {
  const cache = new CompileCommandsCache({ logger });
  const fpStart = performance.now();
  try {
    const fp = await computeFingerprint(projectDir);
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
 *
 * 失败不抛：异常被 caller 自动降级（仅日志告警），主流程不受影响。
 */
export async function writeCompileCommandsCache(
  projectDir: string,
  ccPath: string,
  opts: { fallback?: boolean; fileCount?: number; logger?: Logger },
): Promise<void> {
  const cache = new CompileCommandsCache({ logger: opts.logger });
  const fp = await computeFingerprint(projectDir);
  await cache.write(projectDir, {
    fingerprint: fp.fingerprint,
    ccPath,
    linkTarget: ccPath,
    savedAt: new Date().toISOString(),
    fileCount: opts.fileCount ?? 0,
    fallback: opts.fallback === true,
  } satisfies CachedCompileCommands);
}
