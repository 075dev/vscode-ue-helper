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
import { tryLockBuild, unlockBuild } from '@build/lock';
import {
  rememberBuildSnapshot,
  getLastBuildSnapshot,
  newBuildId,
  markBuildInProgress,
  clearBuildInProgress,
  type LastBuildSnapshot,
} from '@build/lastBuild';
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

/** okEnvelope 的 data 形状(契约 openapi.yaml components.schemas.BuildResult,不含 summary 位) */
type BuildResultData = {
  mode: Mode;
  /** [add-002] 单模块过滤(UBT -Module=);全 target 构建时缺省 */
  module?: string;
  exitCode: number;
  durationMs: number;
};

// [F2-2 并发守卫] 构建互斥锁 —— [D16] 从本文件抽出到 @build/lock,
// 与 executeLiveCoding 共用。旧实现在这里维护模块级 buildInFlight,
// liveCoding 路径没有守卫 → 两个 UBT 可同时跑,交叉写 Intermediate/Build
// 下的 .generated.h,表现为随机出现的 "unknown type name 'FID_...'" 假诊断。

/**
 * executeBuild 的 envelope 类型:data 为 BuildResultData,或无 data(编辑器运行中
 * 转发 Live Coding 时原样透传 executeLiveCoding 的 envelope,成功路径无 data)。
 */
type BuildEnvelope = Envelope<BuildResultData | undefined>;

/**
 * [D8] 计算快照里的 module 字段。
 *
 * module 仅 build 模式语义(UBT -Module=);rebuild/clean 直调携带时丢弃,
 * 保证"不带 module 的调用与现状行为一致"(快照/envelope 均无该字段)。
 */
function moduleFieldsFor(mode: Mode, module?: string): { module?: string } {
  const effective = mode === 'build' ? module : undefined;
  return effective ? { module: effective } : {};
}

/**
 * [D8] 早退收口用的失败快照。
 *
 * 构建命令的每个早退分支(没选到项目 / 没选到引擎 / 并发守卫 / 用户取消)
 * 都要留一条快照 —— 否则 MCP `ue_get_build_errors` 读到的是上一次成功构建的
 * 旧结果,agent 会误以为"这次改动编译通过了"。
 */
function failureSnapshot(params: {
  buildId: string;
  startedAtIso: string;
  mode: Mode;
  moduleFields: { module?: string };
  cancelled: boolean;
  error: string;
}): LastBuildSnapshot {
  return {
    buildId: params.buildId,
    startedAtIso: params.startedAtIso,
    mode: params.mode,
    ...params.moduleFields,
    ok: false,
    cancelled: params.cancelled,
    exitCode: null,
    durationMs: 0,
    finishedAtIso: new Date().toISOString(),
    diagnostics: [],
    error: params.error,
  };
}

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
  // [add-002] UBT -Module= 单模块过滤;仅 mode=build 语义(MCP 层已拦截 rebuild/clean),
  // 只编译不链接,定位是快速验证编译错误
  module?: string,
  // [Wave2 envelope 对齐] 运行时契约:resolve 为 Envelope(D5,见 @core/envelope):
  // 成功 okEnvelope(data: BuildResult, summary) / 失败 errEnvelope(契约全局错误码)。
  // [Wave3 类型收口] dispatch(src/mcp/tools.ts)形参已放宽为 Promise<unknown>,
  // 声明收紧为精确的 Promise<Envelope<...>>(泛型以实际 data 形状为准,见 BuildEnvelope)。
): Promise<BuildEnvelope> {
  // [D8] 每次构建尝试一个唯一 id + 开始时刻。
  // 早退分支同样产生 buildId —— agent 用它判断读到的快照属于哪一次尝试。
  const buildId = newBuildId();
  const startedAtIso = new Date().toISOString();
  const moduleFields = moduleFieldsFor(mode, module);

  // [F2-2] 已有构建在运行时,提示并直接返回(不排队,避免并行 spawn 两个 UBT,
  // 以及第二次 clearDiagnostics() 清掉第一次的诊断)
  // [D16] 锁与 liveCoding 共用 —— 两条路径都是 spawn UBT。
  if (!tryLockBuild()) {
    void vscode.window.showInformationMessage(t('cmd.buildInFlight'));
    // [D8] 并发守卫早退也要留快照(否则读到上一次构建的旧结果)
    rememberBuildSnapshot(
      failureSnapshot({
        buildId,
        startedAtIso,
        mode,
        moduleFields,
        cancelled: false,
        error: t('cmd.buildInFlight'),
      }),
    );
    return errEnvelope(EC_OPERATION_CANCELLED, t('cmd.buildInFlight'));
  }
  // [D8] 标记构建进行中 —— MCP ue_get_build_errors 在此期间回
  // hasResult=false + reason='build-in-progress',避免 agent 把旧快照当新结果。
  markBuildInProgress(buildId);
  try {
    const env = await executeBuildInner(
      mode,
      config,
      logger,
      detection,
      workspace,
      silent,
      statusBar,
      module,
      buildId,
      startedAtIso,
    );
    // [D8] 早退收口:inner 若没写快照(没选到项目 / 没选到引擎 / 用户关掉弹窗),
    // 这里按 envelope 的错误补一条失败快照。
    const snap = getLastBuildSnapshot();
    if (!snap || snap.buildId !== buildId) {
      rememberBuildSnapshot(
        failureSnapshot({
          buildId,
          startedAtIso,
          mode,
          moduleFields,
          cancelled: env.error?.code === 'OPERATION_CANCELLED',
          error: env.error?.message ?? t('cmd.buildFailed'),
        }),
      );
    }
    return env;
  } catch (err) {
    // [C8/D5] 未知异常在命令出口统一包装,不向注册层抛裸异常
    // [D8] 异常路径同样兜底补快照(inner 的 catch 已写过的则跳过)
    const snap = getLastBuildSnapshot();
    if (!snap || snap.buildId !== buildId) {
      rememberBuildSnapshot(
        failureSnapshot({
          buildId,
          startedAtIso,
          mode,
          moduleFields,
          cancelled: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return errEnvelope(EC_INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
  } finally {
    // [D8] 清除进行中标记(必须在快照写入之后 —— 顺序由 finally 保证)
    clearBuildInProgress(buildId);
    unlockBuild();
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
  // [add-002] UBT -Module= 单模块过滤;与编辑器感知构建互斥(module 仅从 MCP silent 路径进来)
  module?: string,
  // [D8] 本次构建尝试的唯一标识与开始时刻(由 executeBuild 生成并传入)
  buildId?: string,
  // [D8] 本次构建的开始时刻(ISO 8601)
  startedAtIso?: string,
): Promise<BuildEnvelope> {
  // [D8] 兜底:直接调用 inner(仅测试)时生成一个 id,保证快照字段永远存在
  const snapBuildId = buildId ?? newBuildId();
  const snapStartedAt = startedAtIso ?? new Date().toISOString();
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
        // [D16] alreadyLocked=true —— 本调用已持有构建锁(见 executeBuild),
        // 转发路径不能重复加锁,否则会被自己拒绝。
        const lcEnv = await executeLiveCoding(config, logger, detection, workspace, silent, true);
        // [D8] 转发路径也要写快照 —— UBT 全量构建没有跑,若不写,MCP 读到的
        // 就是上一次构建的旧结果,agent 会误判"这次编译通过"。
        rememberBuildSnapshot({
          buildId: snapBuildId,
          startedAtIso: snapStartedAt,
          mode,
          ...moduleFieldsFor(mode, module),
          ok: false,
          cancelled: lcEnv.error?.code === 'OPERATION_CANCELLED',
          exitCode: null,
          durationMs: 0,
          finishedAtIso: new Date().toISOString(),
          diagnostics: [],
          error: t('cmd.buildReroutedLiveCoding'),
        });
        return lcEnv;
      }
      if (choice !== buildAnywayLabel) {
        logger.info('[build] editor running → build dismissed by user');
        return errEnvelope(EC_OPERATION_CANCELLED, t('cmd.buildCancelled'));
      }
    }
  }

  // [add-002] module 可选字段的统一展开:未指定时对象里不出现 module 键,
  // 保证"不带 module 的调用与现状行为一致"(快照/envelope 均无该字段)
  // [评审 minor] 函数层防线:module 仅 build 模式语义(MCP 层已拦截,这里兜住
  // 未来直调 executeBuild('rebuild'|'clean', …, module) 的调用方)
  const effectiveModule = mode === 'build' ? module : undefined;
  const moduleFields = effectiveModule ? { module: effectiveModule } : {};

  const ubtPath = resolveUBTPath(engine.path);
  const cmd = buildUBTCommand({
    project: project.path,
    target: resolveUBTTarget(project.path, config.target),
    platform: config.platform,
    configuration: config.configuration,
    ubtPath,
    module: effectiveModule,
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
  if (effectiveModule) {
    // [add-002] 单模块过滤一目了然,便于排查"只编了部分模块"的困惑
    channel.appendLine(`[UE Helper] ${mode}: module=${effectiveModule} (compile-only, no link)`);
  }
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
      buildId: snapBuildId,
      startedAtIso: snapStartedAt,
      mode,
      ...moduleFields,
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
  const backup = config.autoBackupWorkspace ? new WorkspaceBackup(project.path, logger) : undefined;

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
      buildId: snapBuildId,
      startedAtIso: snapStartedAt,
      mode,
      ...moduleFields,
      ok: !!result && !result.cancelled && result.exitCode === 0,
      cancelled: !!result?.cancelled,
      exitCode: result?.exitCode ?? null,
      durationMs: result?.durationMs ?? 0,
      finishedAtIso: new Date().toISOString(),
      diagnostics: result?.diagnostics ?? [],
    });

    // [Wave2 envelope 对齐] 结果分支同时产出契约 envelope;UI 弹窗/状态栏行为保持原样
    // [add-002] 带 module 时结果文案注明模块名,避免与全量构建的提示混淆
    const resultLabel = effectiveModule
      ? `Module build (${effectiveModule})`
      : titleMap[mode];
    let env: BuildEnvelope;
    if (result?.cancelled) {
      // [F2-1] 用户取消构建:显示中性提示,不弹"构建失败"警告
      statusBar?.resetFromBuilding(statusCtx, statusSettings);
      void vscode.window.showInformationMessage(t('cmd.buildCancelled'));
      env = errEnvelope(EC_OPERATION_CANCELLED, t('cmd.buildCancelled'));
    } else if (result && result.exitCode === 0) {
      statusBar?.showBuildResult(true, result.diagnostics.length, statusCtx, statusSettings);
      const summary =
        `${resultLabel} succeeded (${(result.durationMs / 1000).toFixed(1)}s, ` +
        `${result.diagnostics.length} diagnostics)`;
      void vscode.window.showInformationMessage(summary);
      // data 对齐契约 BuildResult { mode, module?, exitCode, durationMs? }(openapi.yaml
      // components.schemas.BuildResult);summary 复用现有成功文案语义
      env = okEnvelope(
        { mode, ...moduleFields, exitCode: result.exitCode, durationMs: result.durationMs },
        summary,
      );
    } else if (result) {
      statusBar?.showBuildResult(false, result.diagnostics.length, statusCtx, statusSettings);
      const summary = `${resultLabel} failed with exit code ${result.exitCode}. See output for details.`;
      void vscode.window.showWarningMessage(summary);
      // 契约 BuildDone 语义:进程跑完但 exitCode≠0 仍 ok:true,成败以 data.exitCode 判定
      env = okEnvelope(
        { mode, ...moduleFields, exitCode: result.exitCode, durationMs: result.durationMs },
        summary,
      );
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
      buildId: snapBuildId,
      startedAtIso: snapStartedAt,
      mode,
      ...moduleFields,
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
