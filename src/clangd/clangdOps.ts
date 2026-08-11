/**
 * clangdOps —— 统一 .clangd 操作 API（Phase 8 架构重构）
 *
 * 设计原则（最小化 API）：
 * 1. 所有 .clangd 读写都通过 ClangdOps，禁止调用方直接 path.join + fs.writeFile
 * 2. 基于 WorkspaceState 的派生路径，调用方不传 projectPath
 * 3. 原子写入：temp + rename（per PATTERNS §3 第 280-285 行）
 * 4. mutate 模式：读 yaml → 应用 mutator → 写回，单事务
 *
 * 4 个核心 API：
 * - readConfig  —— 读取 + YAML 解析
 * - exists      —— 检查 .clangd 存在性
 * - writeFull   —— 全量重写（用 defaultClangdConfig 重建）
 * - mutate      —— 事务性 read-modify-write（调用方用闭包表达任意修改）
 *
 * ❌ 不提供 setAddFlag / removeAddFlag / replaceAddBlock / setIndexBackground /
 *    updateSystemIncludes 之类的细粒度 setter——它们只是 mutate 闭包的固化，
 *    对调用方没价值（增加 API 表面 + 难扩展 + 难组合）。
 *
 * 缺失处理：所有方法检查 workspace.clangdConfigPath，缺失则由 WorkspaceState
 * 弹错并返回失败。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as yaml from 'yaml';
import type * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type WorkspaceState } from '@core/workspace';
import { type ClangdConfig } from './types';
// [Phase 9 SSoT] clangdOps 内部使用 clangdConfig（仅 defaultClangdConfig + renderClangdConfig——fs 写由本类 _atomicWrite 单一处理）
// eslint-disable-next-line no-restricted-imports
import { type ClangdConfigOptions, defaultClangdConfig, renderClangdConfig } from './clangdConfig';

export interface ClangdOpsOptions {
  workspace: WorkspaceState;
  logger: Logger;
}

/** mutate 函数的 mutator 参数 */
export interface ClangdMutatorContext {
  config: ClangdConfig;
}

/** mutate 操作结果 */
export type ClangdMutateResult =
  | { ok: true }
  | { ok: false; reason: 'no-config-path' | 'parse-failed' | 'write-failed'; error?: unknown };

export class ClangdOps implements vscode.Disposable {
  constructor(private readonly opts: ClangdOpsOptions) {}

  /** 是否已 dispose（幂等标记，ClangdOps 自身无内部资源） */
  private _disposed = false;

  /** 暴露 WorkspaceState 给调用方用于派生路径访问 */
  get workspace(): WorkspaceState {
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
    if (!target) {
      return null;
    }
    const text = await this.readText();
    if (text === null) {
      return null;
    }
    try {
      const parsed: unknown = yaml.parse(text);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return parsed as ClangdConfig;
    } catch (err) {
      this.logger.warn(
        `[clangdOps] readConfig failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * [Phase 9 SSoT 收尾] 读取 .clangd 原始文本（无 YAML 解析）
   *
   * 这是诊断 / 第三方解析等"我需要原始文本"场景的统一入口。统一从 WorkspaceState 派生路径，
   * 禁止调用方直接 `path.join(...) + fs.readFile`。
   *
   * @param overridePath - 可选；不传则走 WorkspaceState.clangdConfigPath
   * @returns 原始文本；路径不存在 / 读失败返回 null
   */
  async readText(overridePath?: string): Promise<string | null> {
    const target = overridePath ?? this.workspace.clangdConfigPath;
    if (!target) {
      return null;
    }
    try {
      return await fs.readFile(target, 'utf-8');
    } catch (err) {
      this.logger.warn(
        `[clangdOps] readText failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * 检查 .clangd 是否存在
   */
  async exists(): Promise<boolean> {
    const target = this.workspace.clangdConfigPath;
    if (!target) {
      return false;
    }
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
   * 用 defaultClangdConfig 重建完整配置，调用方传 options。
   * 适用场景：createProject 初始化、completionMode 切换 fast/slow。
   */
  async writeFull(configOpts: ClangdConfigOptions): Promise<{ path: string } | null> {
    const target = this.workspace.clangdConfigPath;
    if (!target) {
      return null;
    }
    try {
      const text = renderClangdConfig(defaultClangdConfig(configOpts));
      await this._atomicWrite(target, text);
      this.logger.info(`[clangdOps] wrote full .clangd to ${target}`);
      return { path: target };
    } catch (err) {
      this.logger.error(
        `[clangdOps] writeFull failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // ========== 事务性修改 ==========

  /**
   * 读 yaml → 应用 mutator → 原子写回（mutate-then-write 单事务）
   *
   * 调用方在 mutator 闭包内任意修改 config 字段，ClangdOps 负责事务。
   * 如果 .clangd 不存在，会用 defaultClangdConfig 初始化后再 mutate。
   *
   * 示例（替换系统头文件块）：
   * ```ts
   * await clangdOps.mutate(({ config }) => {
   *   const add = config.CompileFlags?.Add ?? [];
   *   const SYSTEM_PREFIXES = ['/X', '/imsvc', '-fms-compatibility-version=', '/std:'];
   *   const kept = add.filter(f => !SYSTEM_PREFIXES.some(p => f.startsWith(p)));
   *   config.CompileFlags = { ...config.CompileFlags, Add: [...newFlags, ...kept] };
   * });
   * ```
   */
  async mutate(mutator: (ctx: ClangdMutatorContext) => void): Promise<ClangdMutateResult> {
    const target = this.workspace.clangdConfigPath;
    if (!target) {
      return { ok: false, reason: 'no-config-path' };
    }

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
        this.logger.error(
          `[clangdOps] mutate parse failed: ${err instanceof Error ? err.message : String(err)}`,
        );
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
      this.logger.error(
        `[clangdOps] mutate failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, reason: 'write-failed', error: err };
    }
  }

  // ========== 私有工具 ==========

  /**
   * 原子写入：先写临时文件再 rename（per PATTERNS §3 第 280-285 行）
   */
  private async _atomicWrite(target: string, content: string): Promise<void> {
    const tmp = path.join(
      path.dirname(target),
      `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}`,
    );
    await fs.writeFile(tmp, content, 'utf-8');
    try {
      await fs.rename(tmp, target);
    } catch (err) {
      // rename 失败时清理 tmp
      try {
        await fs.unlink(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  // ========== 收束后的语义化 Add 操作 ==========

  /**
   * 用给定的 flag 字面串**整体替换** .clangd 的 CompileFlags.Add。
   *
   * 这是 Add 操作的统一入口（per Plan B.1）：
   *   - 不做"过滤前缀 + 保留 + 合并"的脆弱拼接；
   *   - 不调用方传 projectPath（路径已通过 WorkspaceState 派生）；
   *   - 由 activation / setSystemIncludes / completionMode / createProject / 控制面板共享。
   *
   * 内部走 `mutate` 事务：read file → replace Add → atomic write。
   *
   * @param flags - 完整 Add 字面串数组。空数组 = 清空 Add 字段。
   */
  async applyAddFlags(flags: readonly string[]): Promise<ClangdMutateResult> {
    return this.mutate(({ config }) => {
      const next: typeof config.CompileFlags = {
        ...(config.CompileFlags ?? {}),
        Add: [...flags],
      };
      config.CompileFlags = next as typeof config.CompileFlags;
    });
  }

  // ========== Disposable ==========

  /**
   * 释放资源：ClangdOps 本身不持有 emitter / watcher / file handle 等内部资源，
   * 仅持有 workspace + logger 引用（这两者由 extension.ts 单独 dispose）。
   *
   * 这里只做幂等标记 + 日志，方便后续排查重复 dispose。
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    this.logger.info('[clangdOps] disposed');
  }

  /** 测试辅助：是否已 dispose */
  get isDisposed(): boolean {
    return this._disposed;
  }
}
