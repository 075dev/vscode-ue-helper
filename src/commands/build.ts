/**
 * build —— 实现 vscodeUEHelper.build / .rebuild / .clean 三个命令
 *
 * 流程:
 *   1. 解析选中的项目(detection.scanner.scan + workspaceContext 缓存)
 *   2. 解析选中的引擎(workspaceContext 缓存)
 *   3. 用 resolveUBTTarget 把 Editor/Game 转成具体 target 名
 *   4. 用 withProgress 显示进度条,支持取消
 *   5. 调 runBuild 跑 UBT,流式输出到 Output 通道
 *   6. 把 MSVC diagnostics 推到 Problems 面板
 *
 * MSVC 错误解析由 @parsers/msvcParser 完成。
 */

import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import { t } from '@i18n';
import { runBuild, buildUBTCommand, resolveUBTPath, resolveUBTTarget } from '@build';
import { pushDiagnostics, clearDiagnostics } from '@ui/problemsPanel';
import { withProgress } from '@ui/notifications';
import { getOutputChannel } from '@ui/outputChannel';
import { WorkspaceBackup } from '@clangd';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import { resolveProjectOrPick, resolveEngineOrPick, persistSelection } from '@commands/_resolve';

type Mode = 'build' | 'rebuild' | 'clean';

// [F2-2 并发守卫] 模块级 in-flight 标记:构建进行中再次触发时直接拒绝,不排队。
// 完成后(无论成功/失败/取消)在 finally 清空,避免永久卡死后续构建。
let buildInFlight: Promise<void> | null = null;

export async function executeBuild(
  mode: Mode,
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
  // [Phase 11 SSoT] silent = true 时跳过 auto-pick / picker，供 MCP tools 调用
  silent: boolean = false,
): Promise<void> {
  // [F2-2] 已有构建在运行时,提示并直接返回(不排队,避免并行 spawn 两个 UBT,
  // 以及第二次 clearDiagnostics() 清掉第一次的诊断)
  if (buildInFlight) {
    void vscode.window.showInformationMessage(t('cmd.buildInFlight'));
    return;
  }
  const task = executeBuildInner(mode, config, logger, detection, workspace, silent);
  buildInFlight = task;
  try {
    await task;
  } finally {
    buildInFlight = null;
  }
}

/** executeBuild 的实际执行体 —— 仅由 executeBuild 的并发守卫调用 */
async function executeBuildInner(
  mode: Mode,
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
  // [Phase 11 SSoT] silent = true 时跳过 auto-pick / picker，供 MCP tools 调用
  silent: boolean = false,
): Promise<void> {
  // [Phase 11 SSoT] 选目标逻辑收敛到 @commands/_resolve
  const project = await resolveProjectOrPick({
    detection,
    workspace,
    silent,
    warningKey: 'cmd.noUprojectSelected',
  });
  if (!project) {
    return;
  }
  await persistSelection(workspace, detection, project, undefined);

  const engine = await resolveEngineOrPick({
    detection,
    workspace,
    silent,
    warningKey: 'cmd.noUnrealEngineSelected',
  });
  if (!engine) {
    return;
  }
  await persistSelection(workspace, detection, undefined, engine);

  const ubtPath = resolveUBTPath(engine.path);
  const cmd = buildUBTCommand({
    project: project.path,
    target: resolveUBTTarget(project.path, config.target),
    platform: config.platform,
    configuration: config.configuration,
    ubtPath,
  });

  // Adjust args for rebuild/clean modes.
  if (mode === 'rebuild') {
    cmd.args.push('-Rebuild');
  }
  if (mode === 'clean') {
    cmd.args.push('-Clean');
  }

  const titleMap: Record<Mode, string> = {
    build: 'Building UE project',
    rebuild: 'Rebuilding UE project',
    clean: 'Cleaning UE project',
  };

  const channel = getOutputChannel();
  channel.clear();
  channel.appendLine(`[UE Helper] ${mode}: ${cmd.args.join(' ')}`);
  channel.show(true);

  clearDiagnostics();

  // [WorkspaceBackup 接入] UBT -ProjectFiles 会重写 .code-workspace 丢失用户自定义，
  // 构建前快照 .code-workspace、构建后恢复。尊重 autoBackupWorkspace 设置（默认 true）；
  // 无 .code-workspace 文件时 snapshot/restore 自然 no-op。
  const backup = config.autoBackupWorkspace ? new WorkspaceBackup(project.path) : undefined;
  if (backup) {
    await backup.snapshot();
  }

  try {
    const result = await withProgress(titleMap[mode], async (report, token) => {
      // Bridge VS Code's CancellationToken to a Web AbortSignal so runBuild
      // can kill the child process when the user clicks Cancel.
      const controller = new AbortController();
      const onCancel = (): void => controller.abort();
      if (token.isCancellationRequested) {
        void onCancel();
      } else {
        token.onCancellationRequested(onCancel);
      }

      const r = await runBuild(
        { file: cmd.file, args: cmd.args },
        {
          signal: controller.signal,
          onProgress: (msg) => report(msg),
          onOutput: (line) => channel.appendLine(line),
        },
      );
      if (!r.ok) {
        channel.appendLine(`[UE Helper] build failed: ${r.error.message}`);
        void vscode.window.showErrorMessage(`Build failed: ${r.error.message}`);
        return null;
      }
      pushDiagnostics(r.value.diagnostics);
      channel.appendLine(
        `[UE Helper] finished in ${r.value.durationMs}ms with exit code ${r.value.exitCode}; ` +
          `${r.value.diagnostics.length} diagnostic(s)`,
      );
      return r.value;
    });

    if (result?.cancelled) {
      // [F2-1] 用户取消构建:显示中性提示,不弹"构建失败"警告
      void vscode.window.showInformationMessage(t('cmd.buildCancelled'));
    } else if (result && result.exitCode === 0) {
      void vscode.window.showInformationMessage(
        `${titleMap[mode]} succeeded (${(result.durationMs / 1000).toFixed(1)}s, ` +
          `${result.diagnostics.length} diagnostics)`,
      );
    } else if (result) {
      void vscode.window.showWarningMessage(
        `${titleMap[mode]} failed with exit code ${result.exitCode}. See output for details.`,
      );
    }
    logger.info(`[build.${mode}] exit=${result?.exitCode ?? 'n/a'}`);
  } finally {
    // UBT 无论成功/失败/取消都恢复 .code-workspace（幂等，无备份则 no-op）
    if (backup) {
      await backup.restore();
    }
  }
}
