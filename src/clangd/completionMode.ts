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

export class CompletionModeController {
  private statusBarItem: vscode.StatusBarItem;
  private projectPath: string | null = null;

  constructor(private readonly config: Config) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99,
    );
    this.statusBarItem.command = 'vscodeUEHelper.toggleCompletionMode';
  }

  /**
   * 设置项目路径。切换模式时需要知道在哪写 .clangd。
   * 在用户选取项目后调用。
   */
  setProjectPath(projectPath: string): void {
    this.projectPath = projectPath;
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
   */
  async toggle(): Promise<Mode> {
    const next: Mode = this.config.completionMode === 'fast' ? 'slow' : 'fast';
    await vscode.workspace
      .getConfiguration('vscodeUEHelper')
      .update('completionMode', next, vscode.ConfigurationTarget.Workspace);

    // 重写 .clangd 以生效
    await this.rewriteClangd(next);

    return next;
  }

  /**
   * 用当前 config 中的模式重写 .clangd。
   * 用于初始激活或 refresh。
   */
  async rewriteClangd(mode?: Mode): Promise<void> {
    if (!this.projectPath) {return;}

    const currentMode = mode ?? this.config.completionMode;

    // Load SharedPCH preparse headers for this mode.
    // Both fast and slow get the bundled list; slow additionally gets
    // macroCompletionHelper.h appended below.
    const preparseHeaders = await getPrepareIncludesList(
      currentMode,
      this.projectPath,
    );

    const macroHelperPath =
      currentMode === 'slow'
        ? getMacroCompletionHelperPath(this.projectPath)
        : undefined;

    try {
      await writeClangdConfig(this.projectPath, {
        completionMode: currentMode,
        macroHelperPath,
        preparseHeaders,
        compatHeaderPath: getUeClangdCompatPath(this.projectPath),
      });
    } catch {
      // .clangd write 失败不阻塞用户操作
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
