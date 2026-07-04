/**
 * headerCache —— UE 头文件 SHA256 + mtime 增量缓存
 *
 * 目的（per D-12 / D-13）：
 *   - 按 (header path + mtimeMs) 增量缓存头文件 SHA256，避免每次启动重新算
 *   - 仅当 compile_commands 缓存命中（fingerprint 一致）时此缓存生效（per T-7-04 协同点）
 *
 * 缓存位置（per D-14）：
 *   {projectDir}/.vscode/clangd-perf-cache/headers/<ueVersion>/<sha256Key>.json
 *
 * 使用方式：
 *   const cache = new HeaderCache({ ueVersion: '5.4' });
 *   const entry = await cache.getCachedHeader(sha256Key);  // miss → undefined
 *   await cache.recordHeader(entry);
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { HeaderCacheEntry } from './types';

/**
 * HeaderCache —— 单 instance per (projectDir, ueVersion)
 */
export class HeaderCache {
  private readonly baseDir: string;

  constructor(opts: { projectDir: string; ueVersion: string }) {
    // {projectDir}/.vscode/clangd-perf-cache/headers/<ueVersion>/
    this.baseDir = path.join(
      path.resolve(opts.projectDir),
      '.vscode',
      'clangd-perf-cache',
      'headers',
      opts.ueVersion,
    );
  }

  /**
   * 读取缓存条目
   *
   * @param sha256Key 头文件的轻量级 key（建议使用 path + mtimeMs 的轻量指纹）
   * @returns 命中返回 entry；miss / 异常返回 undefined（不抛错）
   */
  async getCachedHeader(sha256Key: string): Promise<HeaderCacheEntry | undefined> {
    const cacheFile = this.entryPath(sha256Key);
    try {
      const raw = await fs.readFile(cacheFile, 'utf-8');
      const parsed = JSON.parse(raw) as HeaderCacheEntry;
      // 校验必要字段
      if (
        typeof parsed?.headerPath !== 'string' ||
        typeof parsed?.sha256 !== 'string' ||
        typeof parsed?.mtimeMs !== 'number'
      ) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  /**
   * 写入缓存条目
   *
   * 原子写入：先写 .tmp 再 rename
   */
  async recordHeader(entry: HeaderCacheEntry): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const cacheFile = this.entryPath(entry.sha256);
    const tmpPath = `${cacheFile}.tmp`;
    const json = JSON.stringify(entry, null, 2);
    await fs.writeFile(tmpPath, json, 'utf-8');
    await fs.rename(tmpPath, cacheFile);
  }

  /**
   * mtime 增量判断 —— 调用方可基于此决定是否重新计算 SHA256
   *
   * @param cachedMtimeMs 缓存记录中的 mtimeMs
   * @param currentMtimeMs 当前文件的 mtimeMs
   * @returns true 表示文件未变（可复用缓存），false 表示已变需重新计算
   */
  static isMtimeUnchanged(cachedMtimeMs: number, currentMtimeMs: number): boolean {
    // 容差 1ms（不同文件系统 mtime 精度可能不同）
    return Math.abs(cachedMtimeMs - currentMtimeMs) < 1;
  }

  private entryPath(key: string): string {
    // 使用 sha256Key 作为文件名（替换 / 等不安全字符）
    const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(this.baseDir, `${safeKey}.json`);
  }
}
