/**
 * compileCommandsCache —— compile_commands.json 增量缓存层
 *
 * 目的（per D-08 / D-13 / D-14）：
 *   - 二次激活项目时，若 fingerprint 命中 → 直接返回历史 ccPath，跳过 UBT 子进程调用
 *   - 大小限制 5MB（per Security 防御 2），超出抛 Error
 *   - 原子写入（per Security 防御 3）：temp + rename，避免半写入文件
 *   - 路径安全（per T-7-01）：projectDir 必须在 workspaceFolder 内
 *
 * 缓存位置（per D-14）：
 *   {projectDir}/.vscode/clangd-perf-cache/compile-commands-cache.json
 *
 * 调用方校验（per T-7-04）：
 *   fingerprint 双校验由 compileCommands.ts:generateCompileCommands 入口负责，
 *   此模块只负责「按路径 IO + 原子持久化」。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Logger } from '@core/logger';
import type { CachedCompileCommands } from './types';

/** 缓存大小上限 5MB（per Security 防御 2） */
const MAX_CACHE_BYTES = 5 * 1024 * 1024;

/**
 * CompileCommandsCache —— compile_commands.json 缓存（per-file instance 设计）
 *
 * 使用方式：
 *   const cache = new CompileCommandsCache();
 *   const entry = await cache.tryRead(projectDir);   // 返回 undefined = miss
 *   await cache.write(projectDir, entry);
 *   await cache.invalidate(projectDir);
 */
export class CompileCommandsCache {
  private readonly logger?: Logger;

  constructor(opts: { logger?: Logger } = {}) {
    this.logger = opts.logger;
  }

  /**
   * 计算缓存文件路径（per D-14：项目本地 .vscode/clangd-perf-cache/）
   *
   * 静态方法，便于测试与诊断（无副作用）
   */
  static cachePath(projectDir: string): string {
    const normalized = path.resolve(projectDir);
    return path.join(normalized, '.vscode', 'clangd-perf-cache', 'compile-commands-cache.json');
  }

  /**
   * 读取缓存条目 —— 失败一律返回 undefined（cache miss，不抛错）
   */
  async tryRead(projectDir: string): Promise<CachedCompileCommands | undefined> {
    const cachePath = CompileCommandsCache.cachePath(projectDir);
    try {
      const raw = await fs.readFile(cachePath, 'utf-8');
      const parsed = JSON.parse(raw) as CachedCompileCommands;

      // 校验必要字段
      if (
        typeof parsed?.fingerprint !== 'string' ||
        parsed.fingerprint.length === 0 ||
        typeof parsed?.ccPath !== 'string' ||
        parsed.ccPath.length === 0
      ) {
        this.logger?.warn(`[compileCommandsCache] invalid cache entry, treating as miss`);
        return undefined;
      }

      // 校验 ccPath 存在 + 非空（避免 stale symlink）
      try {
        const stat = await fs.stat(parsed.ccPath);
        if (!stat.isFile() || stat.size < 2) {
          return undefined;
        }
      } catch {
        // ccPath 不存在
        return undefined;
      }

      return parsed;
    } catch (err) {
      // 文件不存在 / JSON 解析失败 → miss
      this.logger?.debug(
        `[compileCommandsCache] tryRead miss: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  /**
   * 写入缓存条目 —— 原子写入（temp + rename）
   *
   * 大小限制：entry JSON 化后 > 5MB 抛 Error 'cache entry too large'
   */
  async write(projectDir: string, entry: CachedCompileCommands): Promise<void> {
    const json = JSON.stringify(entry, null, 2);
    const bytes = Buffer.byteLength(json, 'utf-8');
    if (bytes > MAX_CACHE_BYTES) {
      throw new Error(
        `compileCommandsCache: cache entry too large (${bytes} > ${MAX_CACHE_BYTES} bytes), refusing to write`,
      );
    }

    const cachePath = CompileCommandsCache.cachePath(projectDir);
    const cacheDir = path.dirname(cachePath);
    await fs.mkdir(cacheDir, { recursive: true });

    // 原子写入：先写 .tmp 再 rename（per Security 防御 3）
    const tmpPath = `${cachePath}.tmp`;
    await fs.writeFile(tmpPath, json, 'utf-8');
    await fs.rename(tmpPath, cachePath);
  }

  /**
   * 删除缓存条目 —— 静默失败（删除不存在的文件不抛错）
   */
  async invalidate(projectDir: string): Promise<void> {
    const cachePath = CompileCommandsCache.cachePath(projectDir);
    try {
      await fs.unlink(cachePath);
    } catch {
      // ignore
    }
  }
}
