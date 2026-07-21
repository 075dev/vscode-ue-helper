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
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import { runBuild, buildUBTCommand, resolveUBTPath, resolveUBTTarget } from '@build';
import { pushDiagnostics, clearDiagnostics } from '@ui/problemsPanel';
import { withProgress } from '@ui/notifications';
import { getOutputChannel } from '@ui/outputChannel';
import { pickProject, pickEngine } from '@ui/quickPicks';
import type { DetectionHandles } from '@detection';
import type { ProjectInfo, EngineInstall } from '@detection/types';
import type { WorkspaceState } from '@core/workspace';

type Mode = 'build' | 'rebuild' | 'clean';

export async function executeBuild(
  mode: Mode,
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
): Promise<void> {
  // [Phase 9 SSoT] 收敛 selected* 访问
  // Resolve project: production 走 workspace.resolveSelectedProject()，legacy fallback 仅供老调用方/test
  function legacyFindProject(): ProjectInfo | undefined {
    const sp = detection.workspaceContext.getSelectedProject();
    return sp ? projects.find((p) => p.path === sp) : undefined;
  }
  function legacyFindEngine(): EngineInstall | undefined {
    const se = detection.workspaceContext.getSelectedEngine();
    return se ? engines.find((e) => e.path === se) : undefined;
  }

  const { projects } = await detection.ready;
  let project = workspace?.resolveSelectedProject(projects) ?? legacyFindProject();
  if (!project && projects.length === 1) {project = projects[0];}
  if (!project) {project = await pickProject(projects);}
  if (!project) {
    void vscode.window.showWarningMessage('No .uproject selected.');
    return;
  }
  await (workspace ? workspace.setSelectedProject(project) : detection.workspaceContext.setProject(project));

  // Resolve engine: 同上
  const engines = await detection.discovery.discover();
  let engine = workspace?.resolveSelectedEngine(engines) ?? legacyFindEngine();
  if (!engine && engines.length === 1) {engine = engines[0];}
  if (!engine) {engine = await pickEngine(engines);}
  if (!engine) {
    void vscode.window.showWarningMessage('No Unreal Engine installation selected.');
    return;
  }
  await (workspace ? workspace.setSelectedEngine(engine) : detection.workspaceContext.setEngine(engine));

  const ubtPath = resolveUBTPath(engine.path);
  const cmd = buildUBTCommand({
    project: project.path,
    target: resolveUBTTarget(project.path, config.target),
    platform: config.platform,
    configuration: config.configuration,
    ubtPath,
  });

  // Adjust args for rebuild/clean modes.
  if (mode === 'rebuild') {cmd.args.push('-Rebuild');}
  if (mode === 'clean') {cmd.args.push('-Clean');}

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

  const result = await withProgress(titleMap[mode], async (report, token) => {
    // Bridge VS Code's CancellationToken to a Web AbortSignal so runBuild
    // can kill the child process when the user clicks Cancel.
    const controller = new AbortController();
    const onCancel = () => controller.abort();
    if (token.isCancellationRequested) { void onCancel(); }
    else { token.onCancellationRequested(onCancel); }

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

  if (result && result.exitCode === 0) {
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
}
