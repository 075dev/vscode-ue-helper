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
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import {
  generateCompileCommands,
  linkToWorkspaceRoot,
  addCompletionHelperToCompileCommands,
  createCompletionFiles,
  startModifyResponseFiles,
  fillMissingCompileCommands,
} from '@clangd';
import { pickProject, pickEngine } from '@ui/quickPicks';
import { resolveProgressLocation } from '@ui/notifications';
import { t } from '@i18n';
import type { DetectionHandles } from '@detection';
import type { ProjectInfo } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import {
  okEnvelope,
  errEnvelope,
  EC_BUILD_FAILED,
  EC_OPERATION_CANCELLED,
  EC_PROJECT_NOT_DETECTED,
  EC_UBT_NOT_FOUND,
  type Envelope,
} from '@core/envelope';
// [Phase 8] cancelHeaderWatcherTrigger removed — headerWatcher.ts deleted

export async function executeGenerateCompileCommands(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
  // [Phase 11 SSoT] silent = true 时跳过 picker，从 workspace selection 读取，供 MCP tools 调用
  silent: boolean = false,
  // [Wave2 envelope 对齐] 运行时契约:resolve 为 Envelope(D5)——无项目 →
  // PROJECT_NOT_DETECTED,无引擎 → UBT_NOT_FOUND,取消 QuickPick → OPERATION_CANCELLED,
  // UBT 管线失败 → BUILD_FAILED,成功 → okEnvelope(data.linkPath)。
  // [Wave3 类型收口] dispatch(src/mcp/tools.ts)形参已放宽为 Promise<unknown>,
  // 声明收紧为精确的 Promise<Envelope<{ linkPath: string }>>(泛型以实际 data 形状为准)。
): Promise<Envelope<{ linkPath: string }>> {
  // [Phase 8] cancelHeaderWatcherTrigger removed — headerWatcher.ts deleted

  // [Phase 11 SSoT] generateCompileCommands 是「显式重生成」语义，picker 优先于 selection，
  // 与其他命令 selection-first 不同——保留原 picker ?? selection ?? legacy 顺序。
  // silent = true 时跳过 picker，仅读 workspace selection（与 MCP tools 集成）。
  // [Phase 11 SSoT 修复] engines 也从 detection.ready 取 SSoT —— detection.discovery 是验证器，
  // 构造时 candidates 为空，在 detection.ready resolve 前调用会拿到空数组触发假"未检测到引擎"提示。
  const { projects, engines } = await detection.ready;
  let project;
  if (!silent) {
    // [F2-18/E5] QuickPick 取消(undefined)时静默返回,不再静默落到 projects[0] 继续执行。
    // 仅当只有一个项目时才自动选中(用户没得选,自动继续合理);多项目取消 = 用户放弃本次操作。
    const picked = await pickProject(projects);
    if (picked) {
      project = picked;
    } else if (projects.length === 1) {
      project = projects[0];
    } else {
      // 行为保持:静默返回,不弹警告。envelope 按可判定场景区分:
      // 无项目可检 → PROJECT_NOT_DETECTED;多项目但用户取消 QuickPick → OPERATION_CANCELLED
      if (projects.length === 0) {
        return errEnvelope(EC_PROJECT_NOT_DETECTED, t('generateCompileCommands.noProject'));
      }
      return errEnvelope(EC_OPERATION_CANCELLED, '已取消选择项目');
    }
  } else {
    project =
      workspace?.resolveSelectedProject(projects) ??
      ((): ProjectInfo | undefined => {
        const sp = detection.workspaceContext.getSelectedProject();
        return sp ? projects.find((p) => p.path === sp) : undefined;
      })();
  }
  if (!project) {
    void vscode.window.showWarningMessage(t('generateCompileCommands.noProject'));
    return errEnvelope(EC_PROJECT_NOT_DETECTED, t('generateCompileCommands.noProject'));
  }

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
    return errEnvelope(EC_UBT_NOT_FOUND, t('cmd.noEngineSelected'));
  }

  try {
    // [Wave2 envelope 对齐] progress task 返回 linkPath,供命令出口组装 envelope
    const linkPath = await vscode.window.withProgress(
      {
        // 进度位置走统一配置(progressLocation):默认状态栏 spinner 自动消失,
        // 设为 notification 才回右下角弹窗(见 src/ui/notifications.ts)
        location: resolveProgressLocation(),
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

        // [Wave2 envelope 对齐] 产出 linkPath 供命令出口组装 envelope
        return linkPath;
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

    return okEnvelope({ linkPath }, t('generateCompileCommands.updated', { 0: linkPath }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(t('generateCompileCommands.failed', { 0: msg }));
    // 管线主体是 UBT 生成(Step 1),失败最常见为 UBT 进程失败 → BUILD_FAILED
    return errEnvelope(EC_BUILD_FAILED, t('generateCompileCommands.failed', { 0: msg }));
  }
}
