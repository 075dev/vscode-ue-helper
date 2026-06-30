/**
 * completionMode —— 切换 clangd 快速/慢速宏补全模式
 *
 * Fast: 不添加 macroCompletionHelper.h 的 -include，只加载基础补全
 * Slow: 在 .clangd 的 CompileFlags.Add 中添加
 *       `-include <项目>/.vscode/vscodeuehelper/macroCompletionHelper.h`
 *       让 clangd 能补全 UPROPERTY / UFUNCTION / UE_LOG 等 30+ UE 宏
 *
 * 状态栏显示当前模式，点击切换。切换时自动重写 .clangd 文件。
 *
 * 参考 unreal-clangd 的 completionMode 实现。
 */

import * as vscode from 'vscode';
import { Config } from '@core/config';
import { t } from '@i18n';
import { CompletionMode as Mode } from './types';
import { writeClangdConfig } from './clangdConfig';
import { getMacroCompletionHelperPath } from './completionFiles';
import { getPrepareIncludesList } from './preparseIncludes';
import { getUeClangdCompatPath } from './ueClangdCompat';

/** toggle() 返回结果，让调用方知道是否实际写入了 .clangd */
export interface ToggleResult {
  /** 切换后的模式 */
  mode: Mode;
  /** 是否因缺少上下文或写入失败而跳过写入 */
  skipped: boolean;
  /** 可展示给用户/日志的跳过原因 */
  warning?: RewriteWarning;
}

/** rewriteClangd() 返回结果，区分写入成功和可恢复跳过原因 */
export interface RewriteResult {
  /** 是否真实写入 .clangd */
  written: boolean;
  /** 未写入时的原因 */
  warning?: RewriteWarning;
}

/** CompletionModeController 需要的项目上下文 */
export interface CompletionModeProjectContext {
  /** .uproject 文件绝对路径 */
  projectPath: string;
  /** UE 引擎根目录；缺失时会过滤 $(EngineRoot) preparse header */
  engineRoot?: string;
}

export type RewriteWarning = 'missingProjectPath' | 'writeFailed';

export class CompletionModeController {
  private statusBarItem: vscode.StatusBarItem;
  private projectContext: CompletionModeProjectContext | null = null;

  constructor(private readonly config: Config) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99,
    );
    this.statusBarItem.command = 'vscodeUEHelper.toggleCompletionMode';
  }

  /**
   * 设置项目上下文。切换模式时需要知道在哪写 .clangd，以及如何解析
   * $(EngineRoot) preparse header。由 detection.ready 成功后注入。
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

  show(): void {
    this.render();
    this.statusBarItem.show();
  }

  hide(): void {
    this.statusBarItem.hide();
  }

  /**
   * 切换 fast ↔ slow，并重写 .clangd 文件。
   *
   * @returns ToggleResult: { mode, skipped, warning? }
   *   skipped=true 表示 .clangd 未写入，warning 说明原因
   */
  async toggle(): Promise<ToggleResult> {
    const next: Mode = this.config.completionMode === 'fast' ? 'slow' : 'fast';
    await vscode.workspace
      .getConfiguration('vscodeUEHelper')
      .update('completionMode', next, vscode.ConfigurationTarget.Workspace);

    // 重写 .clangd 以生效
    const rewriteResult = await this.rewriteClangd(next);

    return {
      mode: next,
      skipped: !rewriteResult.written,
      ...(rewriteResult.warning ? { warning: rewriteResult.warning } : {}),
    };
  }

  /**
   * 用当前 config 中的模式重写 .clangd。
   * 用于初始激活或 refresh。
   *
   * @returns RewriteResult: written=false 表示缺少 projectPath 或写入失败
   */
  async rewriteClangd(mode?: Mode): Promise<RewriteResult> {
    if (!this.projectContext) {
      return { written: false, warning: 'missingProjectPath' };
    }

    const currentMode = mode ?? this.config.completionMode;
    const { projectPath, engineRoot } = this.projectContext;

    // Load SharedPCH preparse headers for this mode.
    // Both fast and slow get the bundled list; slow additionally gets
    // macroCompletionHelper.h appended below.
    const preparseHeaders = await getPrepareIncludesList(
      currentMode,
      projectPath,
    );

    const macroHelperPath =
      currentMode === 'slow'
        ? getMacroCompletionHelperPath(projectPath)
        : undefined;

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
      // .clangd write 失败不阻塞用户操作，但必须让调用方看到未成功写入。
      return { written: false, warning: 'writeFailed' };
    }
  }

  private render(): void {
    const mode = this.config.completionMode;
    if (mode === 'fast') {
      this.statusBarItem.text = '$(zap) UE⚡';
      this.statusBarItem.tooltip = t('completion.fast');
    } else {
      this.statusBarItem.text = '$(clock) UE⌚';
      this.statusBarItem.tooltip = t('completion.slow');
    }
  }

  refresh(): void {
    this.render();
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
