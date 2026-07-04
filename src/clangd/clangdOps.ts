/**
 * clangdOps —— 统一 .clangd 操作 API（Phase 8 架构重构）
 *
 * 设计原则：
 * 1. 所有 .clangd 读写都通过 ClangdOps，禁止调用方直接 path.join + fs.writeFile
 * 2. 基于 WorkspaceState 的派生路径，调用方不传 projectPath
 * 3. 原子写入：temp + rename（per PATTERNS §3 第 280-285 行）
 * 4. mutate 模式：读 yaml → 应用 mutator → 写回，单事务
 *
 * API 分类：
 * - 读取：readConfig
 * - 全量：writeFull
 * - 部分修改：mutate, setAddFlag, removeAddFlag, replaceAddBlock, setIndexBackground
 * - 系统头文件：updateSystemIncludes（与 setSystemIncludes 命令配合）
 *
 * 缺失处理：所有方法检查 workspace.clangdConfigPath，缺失则由 WorkspaceState 弹错并返回失败。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { Logger } from '@core/logger';
import { WorkspaceState } from '@core/workspace';
import { ClangdConfig } from './types';
import { ClangdConfigOptions, defaultClangdConfig, renderClangdConfig, replaceSystemIncludeBlock } from './clangdConfig';

export interface ClangdOpsOptions {
  workspace: WorkspaceState;
  logger: Logger;
}

/** mutate 函数的 mutator 参数 */
export interface ClangdMutatorContext {
  config: ClangdConfig;
  /** 改完直接返回（不需手动赋值） */
}

/** mutate 操作结果 */
export type ClangdMutateResult =
  | { ok: true }
  | { ok: false; reason: 'no-config-path' | 'no-existing-config' | 'parse-failed' | 'write-failed'; error?: unknown };

export class ClangdOps {
  constructor(private readonly opts: ClangdOpsOptions) {}

  private get workspace(): WorkspaceState {
    return this.opts.workspace;
  }

  private get logger(): Logger {
    return this.opts.logger;
  }

  // ========== 读取 ==========

  /**
   * 读取当前 .clangd 解析为 ClangdConfig
   * @returns ClangdConfig 或 null（路径不存在 / YAML 解析失败）
   */
  async readConfig(): Promise<ClangdConfig | null> {
    const target = this.workspace.clangdConfigPath;
    if (!target) {return null;}
    try {
      const text = await fs.readFile(target, 'utf-8');
      const parsed = yaml.parse(text);
      if (!parsed || typeof parsed !== 'object') {return null;}
      return parsed as ClangdConfig;
    } catch (err) {
      this.logger.warn(`[clangdOps] readConfig failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * 检查 .clangd 是否存在
   */
  async exists(): Promise<boolean> {
    const target = this.workspace.clangdConfigPath;
    if (!target) {return false;}
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }

  // ========== 全量写入 ==========

  /**
   * 全量写入 .clangd（覆盖整个文件）
   *
   * 注意：这是 writeClangdConfig 的内部实现保留。调用方应优先使用 mutate 系列方法。
   */
  async writeFull(configOpts: ClangdConfigOptions): Promise<{ path: string } | null> {
    const target = this.workspace.clangdConfigPath;
    if (!target) {return null;}
    try {
      const text = renderClangdConfig(defaultClangdConfig(configOpts));
      await this._atomicWrite(target, text);
      this.logger.info(`[clangdOps] wrote full .clangd to ${target}`);
      return { path: target };
    } catch (err) {
      this.logger.error(`[clangdOps] writeFull failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // ========== 部分修改 ==========

  /**
   * 读 yaml → 应用 mutator → 原子写回（mutate-then-write 单事务）
   *
   * 如果 .clangd 不存在，会用 defaultClangdConfig 初始化后再 mutate。
   */
  async mutate(mutator: (ctx: ClangdMutatorContext) => void): Promise<ClangdMutateResult> {
    const target = this.workspace.clangdConfigPath;
    if (!target) {return { ok: false, reason: 'no-config-path' };}

    try {
      // 读取或初始化
      let text: string;
      try {
        text = await fs.readFile(target, 'utf-8');
      } catch {
        // 文件不存在 → 用 defaultClangdConfig 初始化
        text = renderClangdConfig(defaultClangdConfig({ projectPath: undefined }));
      }

      // 解析
      let parsed: unknown;
      try {
        parsed = yaml.parse(text);
      } catch (err) {
        this.logger.error(`[clangdOps] mutate parse failed: ${err instanceof Error ? err.message : String(err)}`);
        return { ok: false, reason: 'parse-failed', error: err };
      }

      const config = (parsed && typeof parsed === 'object' ? parsed : {}) as ClangdConfig;

      // 应用 mutator
      mutator({ config });

      // 写回
      const newText = renderClangdConfig(config);
      await this._atomicWrite(target, newText);
      this.logger.info('[clangdOps] mutate committed');
      return { ok: true };
    } catch (err) {
      this.logger.error(`[clangdOps] mutate failed: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: 'write-failed', error: err };
    }
  }

  /**
   * 在 CompileFlags.Add 中添加 flag（默认 prepend，可选 append）
   *
   * 自动去重：相同的 flag 不会重复添加。
   */
  async setAddFlag(flag: string, mode: 'prepend' | 'append' = 'prepend'): Promise<ClangdMutateResult> {
    return this.mutate(({ config }) => {
      const cf = this._ensureCompileFlags(config);
      const add = (cf.Add ??= []);
      // 去重
      if (!add.includes(flag)) {
        if (mode === 'prepend') {
          add.unshift(flag);
        } else {
          add.push(flag);
        }
      }
    });
  }

  /**
   * 从 CompileFlags.Add 中移除匹配 predicate 的 flag
   */
  async removeAddFlag(predicate: (flag: string) => boolean): Promise<ClangdMutateResult> {
    return this.mutate(({ config }) => {
      const cf = this._ensureCompileFlags(config);
      if (Array.isArray(cf.Add)) {
        cf.Add = cf.Add.filter((f) => !predicate(f));
      }
    });
  }

  /**
   * 替换 CompileFlags.Add 中匹配 predicate 的 flag 块（per replaceSystemIncludeBlock 模式）
   *
   * 适用场景：setSystemIncludes 等需要「保留某些 flag、替换某段」的逻辑。
   */
  async replaceAddBlock(
    predicate: (flag: string) => boolean,
    replacements: string[],
  ): Promise<ClangdMutateResult> {
    return this.mutate(({ config }) => {
      const cf = this._ensureCompileFlags(config);
      const oldAdd = Array.isArray(cf.Add) ? [...cf.Add] : [];
      const kept = oldAdd.filter((f) => !predicate(f));
      cf.Add = [...replacements, ...kept];
    });
  }

  /**
   * 设置 Index.Background 字段
   */
  async setIndexBackground(mode: 'Build' | 'Skip'): Promise<ClangdMutateResult> {
    return this.mutate(({ config }) => {
      config.Index = { Background: mode };
    });
  }

  /**
   * 替换系统头文件 flag 块（per setSystemIncludes 命令）
   *
   * 保留原 replaceSystemIncludeBlock 的行为：用 yaml 库解析 → 过滤旧系统 flag → 插入新 flag。
   */
  async updateSystemIncludes(newFlags: string[]): Promise<ClangdMutateResult> {
    const target = this.workspace.clangdConfigPath;
    if (!target) {return { ok: false, reason: 'no-config-path' };}

    try {
      const text = await fs.readFile(target, 'utf-8');
      const newText = replaceSystemIncludeBlock(text, newFlags);
      await this._atomicWrite(target, newText);
      this.logger.info('[clangdOps] system includes updated');
      return { ok: true };
    } catch (err) {
      this.logger.error(`[clangdOps] updateSystemIncludes failed: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: 'write-failed', error: err };
    }
  }

  // ========== 私有工具 ==========

  private _ensureCompileFlags(config: ClangdConfig): NonNullable<ClangdConfig['CompileFlags']> {
    if (!config.CompileFlags) {
      config.CompileFlags = { Add: [] } as unknown as NonNullable<ClangdConfig['CompileFlags']>;
    }
    return config.CompileFlags as NonNullable<ClangdConfig['CompileFlags']>;
  }

  /**
   * 原子写入：先写临时文件再 rename（per PATTERNS §3 第 280-285 行）
   */
  private async _atomicWrite(target: string, content: string): Promise<void> {
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}`);
    await fs.writeFile(tmp, content, 'utf-8');
    try {
      await fs.rename(tmp, target);
    } catch (err) {
      // rename 失败时清理 tmp
      try {
        await fs.unlink(tmp);
      } catch { /* ignore */ }
      throw err;
    }
  }
}