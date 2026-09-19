/**
 * build —— 实现 vscodeUEHelper.build / .rebuild / .clean 三个命令
 *
 * 流程:
 *   1. 解析选中的项目(detection.scanner.scan + workspaceContext 缓存)
 *   2. 解析选中的引擎(workspaceContext 缓存)
 *   3. 用 resolveUBTTarget 把 Editor/Game 转成具体 target 名
 *   4. withProgress 覆盖「备份工作区 + 跑 UBT」全过程,避免前期静默像"卡住"
 *   5. 调 runBuild 跑 UBT,流式输出到 Output 通道
 *   6. 把 MSVC diagnostics 推到 Problems 面板
 *   7. 状态栏 showBuilding / showBuildResult 反馈构建中与结果
 *
 * MSVC 错误解析由 @parsers/msvcParser 完成。
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import { t } from '@i18n';
import { runBuild, buildUBTCommand, resolveUBTPath, resolveUBTTarget } from '@build';
import { isUnrealEditorRunning, shouldSuggestLiveCoding } from '@build/editorDetect';
import { rememberBuildSnapshot } from '@build/lastBuild';
import { pushDiagnostics, clearDiagnostics } from '@ui/problemsPanel';
import { withProgress } from '@ui/notifications';
import { getOutputChannel } from '@ui/outputChannel';
import { settingsFromConfig, type StatusBarManager, type StatusBarContext } from '@ui/statusBar';
import { WorkspaceBackup } from '@clangd';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import { resolveProjectOrPick, resolveEngineOrPick, persistSelection } from '@commands/_resolve';
import { executeLiveCoding } from './liveCoding';
import {
  okEnvelope,
  errEnvelope,
  EC_BUILD_FAILED,
  EC_INTERNAL_ERROR,
  EC_OPERATION_CANCELLED,
  EC_PROJECT_NOT_DETECTED,
  EC_UBT_NOT_FOUND,
  type Envelope,
} from '@core/envelope';

type Mode = 'build' | 'rebuild' | 'clean';

// [F2-2 并发守卫] 模块级 in-flight 标记:构建进行中再次触发时直接拒绝,不排队。
// 完成后(无论成功/失败/取消)在 finally 清空,避免永久卡死后续构建。
let buildInFlight: Promise<Envelope> | null = null;

export async function executeBuild(
  mode: Mode,
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
  // [Phase 11 SSoT] silent = true 时跳过 auto-pick / picker，供 MCP tools 调用
  silent: boolean = false,
  // [F2-14/W16] 状态栏构建反馈；未注入时仅走 withProgress / 通知
  statusBar?: StatusBarManager,
  // [Wave2 envelope 对齐] 运行时契约:resolve 为 Envelope(D5,见 @core/envelope):
  // 成功 okEnvelope(data: BuildResult, summary) / 失败 errEnvelope(契约全局错误码)。
  // 声明用 Promise<any> 而非 Promise<Envelope>:MCP 层 dispatch(src/mcp/tools.ts,
  // 本任务边界外)将参数锁定为 Promise<void>,Promise<Envelope> 对其不可赋值(TS2322);
  // dispatch 放宽为 Promise<unknown> 后应收紧回 Promise<Envelope>。
): Promise<any> {
  // [F2-2] 已有构建在运行时,提示并直接返回(不排队,避免并行 spawn 两个 UBT,
  // 以及第二次 clearDiagnostics() 清掉第一次的诊断)
  if (buildInFlight) {
    void vscode.window.showInformationMessage(t('cmd.buildInFlight'));
    return errEnvelope(EC_OPERATION_CANCELLED, t('cmd.buildInFlight'));
  }
  const task = executeBuildInner(mode, config, logger, detection, workspace, silent, statusBar);
  buildInFlight = task;
  try {
    return await task;
  } catch (err) {
    // [C8/D5] 未知异常在命令出口统一包装,不向注册层抛裸异常
    return errEnvelope(EC_INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
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
  statusBar?: StatusBarManager,
): Promise<Envelope> {
  // [Phase 11 SSoT] 选目标逻辑收敛到 @commands/_resolve
  const project = await resolveProjectOrPick({
    detection,
    workspace,
    silent,
    warningKey: 'cmd.noUprojectSelected',
  });
  if (!project) {
    return errEnvelope(EC_PROJECT_NOT_DETECTED, t('cmd.noUprojectSelected'));
  }
  await persistSelection(workspace, detection, project, undefined);

  const engine = await resolveEngineOrPick({
    detection,
    workspace,
    silent,
    warningKey: 'cmd.noUnrealEngineSelected',
  });
  if (!engine) {
    return errEnvelope(EC_UBT_NOT_FOUND, t('cmd.noUnrealEngineSelected'));
  }
  await persistSelection(workspace, detection, undefined, engine);

  // [编辑器感知构建 / 借鉴 engine-link "editor-aware build"]
  // 编辑器运行中执行全量构建会撞 UnrealEditor-<Project>.dll 锁定 —— 此时提示
  // 改走 Live Coding。规则：
  //   - 只对增量 build 生效（rebuild/clean 本来就要求关编辑器）
  //   - silent（MCP/AI 代理）跳过，避免交互弹窗阻塞 agent
  //   - config.editorAwareBuild = false 时完全关闭
  //   - Esc / 关闭弹窗 = 中止构建（宁可不建，不给用户一个必然失败的构建）
  if (mode === 'build' && !silent && config.editorAwareBuild) {
    const editorRunning = await isUnrealEditorRunning();
    if (shouldSuggestLiveCoding(mode, editorRunning)) {
      const useLiveCodingLabel = t('cmd.editorRunning.useLiveCoding');
      const buildAnywayLabel = t('cmd.editorRunning.buildAnyway');
      const choice = await vscode.window.showWarningMessage(
        t('cmd.editorRunning.suggest'),
        useLiveCodingLabel,
        buildAnywayLabel,
      );
      if (choice === useLiveCodingLabel) {
        logger.info('[build] editor running → rerouted to Live Coding');
        // 转发 Live Coding,原样透传其 envelope
        return await executeLiveCoding(config, logger, detection, workspace);
      }
      if (choice !== buildAnywayLabel) {
        logger.info('[build] editor running → build dismissed by user');
        return errEnvelope(EC_OPERATION_CANCELLED, t('cmd.buildCancelled'));
      }
    }
  }

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
  channel.appendLine(`[UE Helper] ${mode}: file=${cmd.file}`);
  channel.appendLine(`[UE Helper] ${mode}: args=${cmd.args.join(' ')}`);
  channel.appendLine(`[UE Helper] ${mode}: engine=${engine.path}`);
  channel.appendLine(`[UE Helper] ${mode}: project=${project.path}`);
  channel.show(true);

  // Build.bat 不存在时 spawn 的是 cmd.exe，会在几十 ms 内 exit 1 且几乎无 MSVC 诊断，
  // 用户只看到 "exit code 1; 0 diagnostic(s)"。这里先做存在性校验，给出可定位的错误。
  if (!fs.existsSync(cmd.file)) {
    const msg = `UBT script not found: ${cmd.file}`;
    channel.appendLine(`[UE Helper] ERROR: ${msg}`);
    channel.appendLine(
      '[UE Helper] Check that the engine folder (name="UE5") points to a UE root containing Engine/Build/BatchFiles/Build.bat.',
    );
    // 记录失败快照：MCP ue_get_build_errors 需要能看到"构建没跑起来"的原因
    rememberBuildSnapshot({
      mode,
      ok: false,
      cancelled: false,
      exitCode: null,
      durationMs: 0,
      finishedAtIso: new Date().toISOString(),
      diagnostics: [],
      error: msg,
    });
    void vscode.window.showErrorMessage(msg);
    logger.error(`[build.${mode}] ${msg}`);
    return errEnvelope(EC_UBT_NOT_FOUND, msg);
  }

  clearDiagnostics();

  // [WorkspaceBackup 接入] UBT -ProjectFiles 会重写 .code-workspace 丢失用户自定义，
  // 构建前快照 .code-workspace、构建后恢复。尊重 autoBackupWorkspace 设置（默认 true）；
  // 无 .code-workspace 文件时 snapshot/restore 自然 no-op。
  const backup = config.autoBackupWorkspace ? new WorkspaceBackup(project.path) : undefined;

  const statusCtx: StatusBarContext = {
    project: { name: project.name, path: project.path },
    engine: { version: engine.version, path: engine.path },
  };
  const statusSettings = settingsFromConfig(config);

  // 构建一启动就亮 spinner,让用户明确知道"指令已执行"（而非仍卡在加载）
  statusBar?.showBuilding();

  let buildStarted = false;
  // [Wave2 envelope 对齐] 捕获 spawn 级失败原因(进程没跑起来),供 errEnvelope 使用;
  // UI 行为保持原样(通知文案不变)
  let spawnFailure: string | undefined;
  try {
    const result = await withProgress(titleMap[mode], async (report, token) => {
      // 备份放进 progress,避免 snapshot 期间界面无任何反馈
      if (backup) {
        report('Preparing workspace backup...');
        try {
          await backup.snapshot();
        } catch (err) {
          // 备份失败不阻断构建：UBT 仍可跑，只是可能覆盖 .code-workspace
          logger.warn('[build] workspace snapshot failed (continuing):', err);
        }
      }

      report('Running Unreal Build Tool...');
      buildStarted = true;

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
        spawnFailure = r.error.message;
        channel.appendLine(`[UE Helper] build failed: ${r.error.message}`);
        void vscode.window.showErrorMessage(`Build failed: ${r.error.message}`);
        return null;
      }
      pushDiagnostics(r.value.diagnostics);
      channel.appendLine(
        `[UE Helper] finished in ${r.value.durationMs}ms with exit code ${r.value.exitCode}; ` +
          `${r.value.diagnostics.length} diagnostic(s)`,
      );
      // 非 0 且无 MSVC 诊断时，UBT/Build.bat 往往在编译前就退出了。
      // 把最后若干行原样贴进 Output，避免只剩 "exit code 1; 0 diagnostic(s)" 无法排查。
      if (r.value.exitCode !== 0 && r.value.diagnostics.length === 0) {
        const tail = r.value.output.slice(-20);
        if (tail.length > 0) {
          channel.appendLine('[UE Helper] ---- UBT/batch output (last lines) ----');
          for (const line of tail) {
            channel.appendLine(line);
          }
          channel.appendLine('[UE Helper] ---- end output ----');
        } else {
          channel.appendLine(
            '[UE Helper] No stdout/stderr from UBT — Build.bat may have failed before launching UnrealBuildTool.',
          );
        }
      }
      return r.value;
    });

    // [ue_get_build_errors 数据源] 成功/失败/取消一律记录最近构建快照,
    // MCP 工具 ue_get_build_errors 从这里读（AI 闭环"构建 → 读错误 → 修复"）。
    rememberBuildSnapshot({
      mode,
      ok: !!result && !result.cancelled && result.exitCode === 0,
      cancelled: !!result?.cancelled,
      exitCode: result?.exitCode ?? null,
      durationMs: result?.durationMs ?? 0,
      finishedAtIso: new Date().toISOString(),
      diagnostics: result?.diagnostics ?? [],
    });

    // [Wave2 envelope 对齐] 结果分支同时产出契约 envelope;UI 弹窗/状态栏行为保持原样
    let env: Envelope;
    if (result?.cancelled) {
      // [F2-1] 用户取消构建:显示中性提示,不弹"构建失败"警告
      statusBar?.resetFromBuilding(statusCtx, statusSettings);
      void vscode.window.showInformationMessage(t('cmd.buildCancelled'));
      env = errEnvelope(EC_OPERATION_CANCELLED, t('cmd.buildCancelled'));
    } else if (result && result.exitCode === 0) {
      statusBar?.showBuildResult(true, result.diagnostics.length, statusCtx, statusSettings);
      const summary =
        `${titleMap[mode]} succeeded (${(result.durationMs / 1000).toFixed(1)}s, ` +
        `${result.diagnostics.length} diagnostics)`;
      void vscode.window.showInformationMessage(summary);
      // data 对齐契约 BuildResult { mode, exitCode, durationMs? }(openapi.yaml
      // components.schemas.BuildResult);summary 复用现有成功文案语义
      env = okEnvelope({ mode, exitCode: result.exitCode, durationMs: result.durationMs }, summary);
    } else if (result) {
      statusBar?.showBuildResult(false, result.diagnostics.length, statusCtx, statusSettings);
      const summary = `${titleMap[mode]} failed with exit code ${result.exitCode}. See output for details.`;
      void vscode.window.showWarningMessage(summary);
      // 契约 BuildDone 语义:进程跑完但 exitCode≠0 仍 ok:true,成败以 data.exitCode 判定
      env = okEnvelope({ mode, exitCode: result.exitCode, durationMs: result.durationMs }, summary);
    } else {
      // spawn 失败 / 前期异常：恢复按钮，不显示错误角标（错误通知已单独弹）
      statusBar?.resetFromBuilding(statusCtx, statusSettings);
      // 进程级启动失败/无法执行 → 契约全局错误码 BUILD_FAILED
      env = errEnvelope(EC_BUILD_FAILED, spawnFailure ?? `Build failed: ${mode}`);
    }
    logger.info(`[build.${mode}] exit=${result?.exitCode ?? 'n/a'}`);
    return env;
  } catch (err) {
    statusBar?.resetFromBuilding(statusCtx, statusSettings);
    // 异常中断也记录快照（error 字段说明为什么没有 exitCode）
    rememberBuildSnapshot({
      mode,
      ok: false,
      cancelled: false,
      exitCode: null,
      durationMs: 0,
      finishedAtIso: new Date().toISOString(),
      diagnostics: [],
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    // UBT 无论成功/失败/取消都恢复 .code-workspace（幂等，无备份则 no-op）
    if (backup) {
      try {
        await backup.restore();
      } catch (err) {
        logger.warn('[build] workspace restore failed:', err);
      }
    }
    // withProgress 未进入（理论上少见）时也要清 spinner，避免按钮永久 Building...
    if (statusBar?.isBuilding && !buildStarted) {
      statusBar.resetFromBuilding(statusCtx, statusSettings);
    }
  }
}
