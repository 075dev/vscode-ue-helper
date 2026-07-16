/**
 * completionMode —— 统一 slow 模式的 .clangd 重写
 *
 * Plan B 重构后 fast/slow 模式已合并（内部统一走 slow 路径，因为 slow 已包含
 * fast 的全部内容）。此模块保留 CompletionModeController 类仅为承载
 * rewriteClangd() 工具方法（首次激活、refresh、外部配置变化时调用），
 * 不再拥有状态栏按钮、toggle 命令或 show/hide 渲染入口。
 *
 * 兼容性策略：
 *   - `setClangdOps / setProjectContext / setProjectPath / refresh / dispose`
 *     接口保留以避免破坏现有调用点（`src/clangd/index.ts`、测试）。
 *   - `toggle()` 方法删除——使用场景已通过命令面板入口 `toggleCompletionMode`
 *     删除消失。
 *   - `ToggleResult` 类型删除——依赖它的测试一并删除。
 *
 * 设计背景：
 *   - `Config.completionMode` 字段保留并被归一化为 'slow'，详见 `src/core/config.ts`。
 *   - `preparseHeaders` 始终来自 `getPrepareIncludesList('slow', ...)`，
 *     因 `loadBundledList` 现在忽略 mode 参数。
 *   - `macroCompletionHelper.h` 仍写入但被 `createCompletionFiles` 跳过生成；
 *     为兼容第三方扩展/手动修改的 .clangd，`clangdConfig.defaultClangdConfig`
 *     仍会按原路径注入 /FI。
 *
 * Phase 8 架构：通过 ClangdOps 统一 .clangd 操作，调用方不传 projectPath。
 *
 * 参考 unreal-clangd 的 completionMode 实现。
 */

import type { Config } from '@core/config';
import type { CompletionMode as Mode } from './types';
import type { ClangdOps } from './clangdOps';
import { writeClangdConfig } from './clangdConfig';
import { getMacroCompletionHelperPath } from './completionFiles';
import { getPrepareIncludesList } from './preparseIncludes';
import { getUeClangdCompatPath } from './ueClangdCompat';

/** rewriteClangd() 返回结果，区分写入成功和可恢复跳过原因 */
export interface RewriteResult {
  /** 是否真实写入 .clangd */
  written: boolean;
  /** 未写入时的原因 */
  warning?: RewriteWarning;
}

/** CompletionModeController 需要的项目上下文（兼容旧 API） */
export interface CompletionModeProjectContext {
  /** .uproject 文件绝对路径 */
  projectPath: string;
  /** UE 引擎根目录；缺失时会过滤 $(EngineRoot) preparse header */
  engineRoot?: string;
}

export type RewriteWarning = 'missingProjectPath' | 'writeFailed';

export class CompletionModeController {
  private projectContext: CompletionModeProjectContext | null = null;
  /** [Phase 8] 可选注入 ClangdOps，用于通过统一 API 写入 .clangd */
  private clangdOps: ClangdOps | null = null;

  // [Plan B] 保留 constructor 兼容旧调用点
  constructor(_config: Config) {}

  /**
   * [Phase 8] 注入 ClangdOps（推荐路径）。
   * 注入后 rewriteClangd 通过 ClangdOps.writeFull 操作，
   * 派生路径（macroHelperPath / compatHeaderPath / clangdConfigPath）由 ClangdOps 内部用 WorkspaceState 解析。
   */
  setClangdOps(ops: ClangdOps): void {
    this.clangdOps = ops;
  }

  /**
   * 设置项目上下文。切换模式时需要知道在哪写 .clangd，以及如何解析
   * $(EngineRoot) preparse header。由 detection.ready 成功后注入。
   *
   * @deprecated 推荐用 setClangdOps + WorkspaceState 自动派生路径。
   *            保留此方法仅为向后兼容旧调用点。
   */
  setProjectContext(context: CompletionModeProjectContext): void {
    this.projectContext = context;
  }

  /**
   * 兼容旧调用点：只设置项目路径时，preparse 中的 EngineRoot 占位符会被过滤。
   */
  setProjectPath(projectPath: string): void {
    this.setProjectContext({ projectPath });
  }

  /**
   * 用当前 config 中的模式重写 .clangd。
   * 用于初始激活或 refresh。
   *
   * Plan B 重构后：mode 内部强制为 'slow'（fast 等价于 slow）。保留参数仅为兼容
   * 现有调用点签名；外部传入的值会被忽略。
   *
   * 优先用 ClangdOps 注入路径；如果未注入，回落到旧 projectContext 路径。
   *
   * @returns RewriteResult: written=false 表示缺少 projectPath 或写入失败
   */
  async rewriteClangd(_mode?: Mode): Promise<RewriteResult> {
    // Plan B: 统一 slow，参数忽略
    const currentMode: Mode = 'slow';

    // [Phase 8] 优先路径：通过 ClangdOps + WorkspaceState 派生路径
    if (this.clangdOps) {
      const ws = this.clangdOps.workspace;
      const projectPath = ws.project?.path; // .uproject 路径（preparseIncludes 仍接受）
      if (!projectPath) {
        return { written: false, warning: 'missingProjectPath' };
      }
      const engineRoot = ws.engineRoot ?? undefined;

      const preparseHeaders = await getPrepareIncludesList(currentMode, projectPath);

      const macroHelperPath = ws.macroHelperPath ?? undefined;
      const compatHeaderPath = ws.ueClangdCompatPath ?? undefined;

      const result = await this.clangdOps.writeFull({
        completionMode: currentMode,
        macroHelperPath,
        preparseHeaders,
        compatHeaderPath,
        projectPath,
        engineRoot,
      });
      return result ? { written: true } : { written: false, warning: 'writeFailed' };
    }

    // 兼容路径：通过旧 setProjectContext 注入的 projectPath
    if (!this.projectContext) {
      return { written: false, warning: 'missingProjectPath' };
    }
    const { projectPath, engineRoot } = this.projectContext;
    const preparseHeaders = await getPrepareIncludesList(currentMode, projectPath);
    const macroHelperPath = getMacroCompletionHelperPath(projectPath);
    try {
      await writeClangdConfig(projectPath, {
        completionMode: currentMode,
        macroHelperPath,
        preparseHeaders,
        compatHeaderPath: getUeClangdCompatPath(projectPath),
        projectPath,
        engineRoot,
      });
      return { written: true };
    } catch {
      return { written: false, warning: 'writeFailed' };
    }
  }

  /**
   * @deprecated 状态栏按钮已删除；保留为空实现以兼容可能引用此方法的旧调用点。
   */
  refresh(): void {}

  /**
   * @deprecated 状态栏按钮已删除；保留为空实现以兼容可能引用此方法的旧调用点。
   */
  dispose(): void {}
}
