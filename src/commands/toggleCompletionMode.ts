/**
 * toggleCompletionMode —— 切换 clangd 快速/慢速模式
 *
 * 绑定到状态栏的 UE⚡ / UE⌚ 按钮，以及命令面板。
 * 切换 config.completionMode 设置并重写 .clangd 文件。
 * CompletionModeController.toggle() 内部负责：
 *   1. 更新 VS Code 配置
 *   2. 用新模式的参数重写 .clangd（slow 时添加 -include macroCompletionHelper.h）
 *   3. 触发 onDidChange 监听器重新渲染状态栏
 */

import { Logger } from '@core/logger';
import type { ClangdHandles } from '@clangd';

export async function executeToggleCompletionMode(
  logger: Logger,
  clangd: ClangdHandles,
): Promise<void> {
  const result = await clangd.completionMode.toggle();

  if (result.skipped) {
    logger.warn(
      `[toggleCompletionMode] → ${result.mode}（.clangd 未写入：缺少项目路径，请先打开 .code-workspace）`,
    );
    return;
  }

  logger.info(`[toggleCompletionMode] → ${result.mode}（.clangd 已重写）`);
}
