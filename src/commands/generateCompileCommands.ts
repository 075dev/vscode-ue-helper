/**
 * generateCompileCommands —— 重新生成 compile_commands.json（完整的刷新管线）
 *
 * 跑 UBT -ProjectFiles -Mode=GenerateProjectFiles，让 UBT 生成 compile_commands.json
 * 到项目根目录（.uproject 同级），然后 symlink/copy 到项目根供 clangd 使用。
 *
 * 完整的刷新管线（参考 unreal-clangd 的 updateCompileCommands）：
 *   1. 备份 .code-workspace
 *   2. 跑 UBT 生成
 *   3. symlink/copy 到项目根
 *   4. 恢复 .code-workspace
 *   5. 重新创建补全文件（确保与 project 一致）
 *   6. 将 completionHelper.cpp 加入 compile_commands.json
 *   7. 修改 rsp 文件（移除 PCH）—— 后台执行，不阻塞
 *
 * 最后提示用户重启 clangd 语言服务器。
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import {
  generateCompileCommands,
  linkToWorkspaceRoot,
  addCompletionHelperToCompileCommands,
  createCompletionFiles,
  startModifyResponseFiles,
  fillMissingCompileCommands,
} from '@clangd';
import { pickProject, pickEngine } from '@ui/quickPicks';
import { t } from '@i18n';
import type { DetectionHandles } from '@detection';
import type { ProjectInfo } from '@detection';
import type { WorkspaceState } from '@core/workspace';
// [Phase 8] cancelHeaderWatcherTrigger removed — headerWatcher.ts deleted

export async function executeGenerateCompileCommands(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
  // [Phase 11 SSoT] silent = true 时跳过 picker，从 workspace selection 读取，供 MCP tools 调用
  silent: boolean = false,
): Promise<void> {
  // [Phase 8] cancelHeaderWatcherTrigger removed — headerWatcher.ts deleted

  // [Phase 11 SSoT] generateCompileCommands 是「显式重生成」语义，picker 优先于 selection，
  // 与其他命令 selection-first 不同——保留原 picker ?? selection ?? legacy 顺序。
  // silent = true 时跳过 picker，仅读 workspace selection（与 MCP tools 集成）。
  const { projects } = await detection.ready;
  let project;
  if (!silent) {
    project = (await pickProject(projects)) ?? projects[0];
  } else {
    project = workspace?.resolveSelectedProject(projects) ??
      ((): ProjectInfo | undefined => {
        const sp = detection.workspaceContext.getSelectedProject();
        return sp ? projects.find((p) => p.path === sp) : undefined;
      })();
  }
  if (!project) {
    void vscode.window.showWarningMessage(t('generateCompileCommands.noProject'));
    return;
  }

  const engines = await detection.discovery.discover();
  const se = detection.workspaceContext.getSelectedEngine();
  let engine;
  if (!silent) {
    engine =
      (await pickEngine(engines)) ??
      workspace?.resolveSelectedEngine(engines) ??
      (se ? engines.find((e) => e.path === se) : undefined);
  } else {
    engine =
      workspace?.resolveSelectedEngine(engines) ??
      (se ? engines.find((e) => e.path === se) : undefined);
  }
  if (!engine) {
    void vscode.window.showWarningMessage(t('cmd.noEngineSelected'));
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t('generateCompileCommands.updating'),
        cancellable: false,
      },
      async (progress) => {
        // Step 1: 生成 compile_commands.json
        progress.report({ message: 'Running UBT...', increment: 0 });
        const jsonPath = await generateCompileCommands({
          project: project.path,
          engineRoot: engine.path,
          buildType: config.configuration,
          progress,
          logger,
        });

        // Step 2: symlink/copy 到项目根
        progress.report({ message: 'Linking to workspace root...', increment: 20 });
        const linkPath = await linkToWorkspaceRoot(jsonPath, project.path, logger);

        // Step 2.5: 🔧 补全缺失的 compile_commands 条目（新文件、头文件等）
        progress.report({ message: 'Filling missing entries...', increment: 10 });
        await fillMissingCompileCommands(linkPath, project.path, logger);

        // Step 3: 创建补全文件（确保最新）
        progress.report({ message: 'Refreshing completion files...', increment: 30 });
        await createCompletionFiles(project.path);

        // Step 4: 将 completionHelper.cpp 加入 compile_commands.json
        progress.report({
          message: 'Adding completion helper...',
          increment: 20,
        });
        const helperAdded = await addCompletionHelperToCompileCommands(project.path, linkPath);
        if (!helperAdded) {
          throw new Error(`Unable to add completion helper entry to ${linkPath}`);
        }

        progress.report({ increment: 20 });

        void vscode.window.showInformationMessage(
          t('generateCompileCommands.updated', { 0: linkPath }),
        );
        logger.info(`[generateCompileCommands] done → ${linkPath}`);

        // Step 5: 修改 rsp 文件（后台，不显示进度）
        startModifyResponseFiles(project.path, logger).catch((err) =>
          logger.warn('[generateCompileCommands] modifyRspFiles failed:', err),
        );
      },
    );

    // 提示用户重启 clangd
    const restartBtn = t('generateCompileCommands.restartBtn');
    const laterBtn = t('generateCompileCommands.laterBtn');
    const choice = await vscode.window.showInformationMessage(
      t('generateCompileCommands.restartPrompt'),
      restartBtn,
      laterBtn,
    );
    if (choice === restartBtn) {
      await vscode.commands.executeCommand('clangd.restart');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(t('generateCompileCommands.failed', { 0: msg }));
  }
}
