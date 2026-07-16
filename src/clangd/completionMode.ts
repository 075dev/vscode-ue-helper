/**
 * completionMode —— 把当前 `userAddFlags` 渲染后写入 .clangd
 *
 * Plan B 重构后 fast/slow 模式已合并（内部统一走 slow 路径，因为 slow 已包含
 * fast 的全部内容）。此模块保留 `CompletionModeController` 类仅为承载
 * `applyUserAddFlags()` 与 `rewriteClangd()` 工具方法（用于激活、配置变化时调），
 * 不再拥有状态栏按钮、toggle 命令或 show/hide 渲染入口。
 *
 * Plan Add 收束（per Plan B.3）：
 *   - rewriteClangd 是「把 `Config.userAddFlags` 通过 flagGlossary.resolveFlags 渲染为
 *     字面串后整体 force-write 到 .clangd」的统一入口。
 *   - 不再依赖 defaultClangdConfig 的 opts 注入 Add；所有 Add 由 flagGlossary 控制。
 *
 * 兼容性策略：
 *   - `setClangdOps / setProjectContext / setProjectPath / refresh / dispose` 接口保留
 *     以兼容现有调用点（`src/clangd/index.ts`、测试）。
 *   - `setConfig` 新增 —— 注入 Config 以读 userAddFlags（Phase 8 完整流程必须注入）。
 *   - `toggle()` 方法已删除。
 *   - `ToggleResult` 类型已删除。
 */

import type { Config } from '@core/config';
import type { CompletionMode as Mode } from './types';
import type { ClangdOps } from './clangdOps';
import { resolveFlags } from './flagGlossary';
import { getPrepareIncludesList } from './preparseIncludes';

export interface RewriteResult {
  /** 是否真实写入 .clangd */
  written: boolean;
  /** 未写入时的原因 */
  warning?: RewriteWarning;
}

export interface CompletionModeProjectContext {
  /** .uproject 文件绝对路径 */
  projectPath: string;
  /** UE 引擎根目录；缺失时会过滤 $(EngineRoot) preparse header */
  engineRoot?: string;
}

export type RewriteWarning = 'missingProjectPath' | 'no-clangdOps' | 'no-config' | 'writeFailed';

export class CompletionModeController {
  private projectContext: CompletionModeProjectContext | null = null;
  private clangdOps: ClangdOps | null = null;
  /** [Plan D] 注入 Config（用于读 userAddFlags） */
  private config: Config | null = null;

  // 保留 constructor 兼容旧调用点
  constructor(_config: Config) {}

  /** [Plan D] 注入 Config。后续 rewriteClangd 通过它读 userAddFlags。 */
  setConfig(config: Config): void {
    this.config = config;
  }

  /** [Phase 8] 注入 ClangdOps（推荐路径）。 */
  setClangdOps(ops: ClangdOps): void {
    this.clangdOps = ops;
  }

  /** 设置项目上下文。 */
  setProjectContext(context: CompletionModeProjectContext): void {
    this.projectContext = context;
  }

  /** 兼容旧调用点 */
  setProjectPath(projectPath: string): void {
    this.setProjectContext({ projectPath });
  }

  /**
   * 把当前 `Config.userAddFlags` 通过 flagGlossary.resolveFlags 渲染后写入 .clangd。
   *
   * @returns RewriteResult: written=false 表示缺少项目路径/ClangdOps/Config 或写入失败
   */
  async rewriteClangd(_mode?: Mode): Promise<RewriteResult> {
    void _mode; // Plan B: 模式参数忽略，统一 slow

    if (!this.clangdOps) {
      return { written: false, warning: 'no-clangdOps' };
    }
    if (!this.config) {
      return { written: false, warning: 'no-config' };
    }

    const projectPath = this.projectContext?.projectPath;
    if (!projectPath) {
      return { written: false, warning: 'missingProjectPath' };
    }

    const preparseHeaders = await getPrepareIncludesList('slow', projectPath);
    const ws = this.clangdOps.workspace;
    const compatHeaderPath = ws.ueClangdCompatPath ?? undefined;
    const macroHelperPath = ws.macroHelperPath ?? undefined;

    const userAdd = this.config.userAddFlags;
    const addFlags = resolveFlags(userAdd, {
      ...(compatHeaderPath ? { compatHeaderPath } : {}),
      ...(macroHelperPath ? { macroHelperPath } : {}),
      preparseHeaders,
    });

    const result = await this.clangdOps.applyAddFlags(addFlags);
    if (result.ok) {
      return { written: true };
    }
    return { written: false, warning: 'writeFailed' };
  }

  /** @deprecated 状态栏按钮已删除；保留为空实现以兼容可能引用此方法的旧调用点。 */
  refresh(): void {}

  /** @deprecated 状态栏按钮已删除；保留为空实现以兼容可能引用此方法的旧调用点。 */
  dispose(): void {}
}
