/**
 * completionMode —— 把当前 `userAddFlags` 渲染后写入 .clangd
 *
 * T2.1 / H4-B 之后：fast/slow 模式已彻底合并（内部统一走 slow 路径）。
 * 此模块保留 `CompletionModeController` 类仅为承载
 * `rewriteClangd()` 工具方法（用于激活、配置变化时调），
 * 不再拥有状态栏按钮、toggle 命令或 show/hide 渲染入口。
 *
 * Plan Add 收束（per Plan B.3）：
 *   - rewriteClangd 是「把 `Config.userAddFlags` 通过 flagGlossary.resolveFlags 渲染为
 *     字面串后整体 force-write 到 .clangd」的统一入口。
 *   - 不再依赖 defaultClangdConfig 的 opts 注入 Add；所有 Add 由 flagGlossary 控制。
 *   - rewriteClangd 仍接受一个可选 `mode` 参数仅为兼容旧调用点（test 中 `rewriteClangd('slow')`）；
 *     实际值被忽略 —— T2.1 后 fast/slow 已合并，统一 slow。
 *
 * 兼容性策略：
 *   - `setClangdOps / setProjectContext / setProjectPath` 接口保留
 *     以兼容现有调用点（`src/clangd/index.ts`、测试）。
 *   - `config` 由 constructor 直接注入（Phase 8 完整流程必须注入）。
 *   - `setConfig` 方法已删除（config 构造期注入，无后置注入路径）。
 *   - `refresh / dispose` 空实现已删除（状态栏按钮已删，无调用方）。
 *   - `toggle()` 方法已删除。
 *   - `ToggleResult` 类型已删除。
 */

import type { Config } from '@core/config';
import type { ClangdOps } from './clangdOps';
// [D5] 统一渲染 + 写入入口 —— ctx 五项由 collectClangdFlagContext 统一采集
import { writeClangdAddFlags } from './clangdFlagRenderer';

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

export type RewriteWarning = 'missingProjectPath' | 'no-clangdOps' | 'writeFailed';

export class CompletionModeController {
  private projectContext: CompletionModeProjectContext | null = null;
  private clangdOps: ClangdOps | null = null;

  /** [Plan D] constructor 注入 Config（用于读 userAddFlags）。 */
  constructor(private readonly config: Config) {}

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
   * 把当前 `Config.userAddFlags` 渲染后写入 .clangd。
   *
   * [D5] 走**统一入口** `writeClangdAddFlags` —— ctx 的五项
   * （compatHeader / macroHelper / preparseHeaders / intermediateUhtDirs /
   * systemIncludeFlags）由 `collectClangdFlagContext` 统一采集。
   * 旧实现自己调 `resolveFlags` 且 ctx 只带三项，`uht-include-dirs` 与
   * `system-include-windows` 永远渲染不出来。
   *
   * 签名仍接受一个可选 `mode` 参数仅为兼容旧调用点（test 中 `rewriteClangd('slow')`）；
   * 实际值被忽略 —— T2.1 后 fast/slow 已合并，统一 slow。
   *
   * @returns RewriteResult: written=false 表示缺少项目路径/ClangdOps 或写入失败
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async rewriteClangd(_mode?: unknown): Promise<RewriteResult> {
    if (!this.clangdOps) {
      return { written: false, warning: 'no-clangdOps' };
    }

    const projectPath = this.projectContext?.projectPath;
    if (!projectPath) {
      return { written: false, warning: 'missingProjectPath' };
    }

    const result = await writeClangdAddFlags(
      { clangdOps: this.clangdOps, config: this.config },
      this.config.userAddFlags,
    );
    if (result.ok) {
      return { written: true };
    }
    return { written: false, warning: 'writeFailed' };
  }
}
