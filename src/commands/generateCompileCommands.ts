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
  buildCompletionHelperEntry,
  computeMissingEntries,
  createCompletionFiles,
  getCompletionHelperPath,
  startModifyResponseFiles,
  readCompileCommands,
  writeCompileCommandsAtomic,
  resolveCompileCommandsWriteTarget,
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
  // [add-004 / D9] opts.quiet = 后台自动重建形态:隐含 silent(跳过 picker),
  // 且全程无 UI 弹窗(无成功提示、无"重启 clangd?"询问、失败不弹窗只返回 envelope)
  // ——供 CompileCommandsRefreshHint 自动模式经 executeCommand 触发,弹窗反而比被替换掉的
  // 提示更打扰。clangd 12+ 热重载 compile_commands.json,跳过重启询问不损失功能。
  opts?: { quiet?: boolean },
): Promise<Envelope<{ linkPath: string }>> {
  // [add-004 / D9] quiet 隐含 silent 路径(项目/引擎从 selection 解析,无 picker)
  const isSilent = silent || opts?.quiet === true;
  const isQuiet = opts?.quiet === true;
  // [Phase 8] cancelHeaderWatcherTrigger removed — headerWatcher.ts deleted

  // [Phase 11 SSoT] generateCompileCommands 是「显式重生成」语义，picker 优先于 selection，
  // 与其他命令 selection-first 不同——保留原 picker ?? selection ?? legacy 顺序。
  // silent = true 时跳过 picker，仅读 workspace selection（与 MCP tools 集成）。
  // [Phase 11 SSoT 修复] engines 也从 detection.ready 取 SSoT —— detection.discovery 是验证器，
  // 构造时 candidates 为空，在 detection.ready resolve 前调用会拿到空数组触发假"未检测到引擎"提示。
  const { projects, engines } = await detection.ready;
  let project;
  if (!isSilent) {
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
    // quiet(后台自动)不弹窗——节流窗后自然重试,避免每窗一次警告弹窗
    if (!isQuiet) {
      void vscode.window.showWarningMessage(t('generateCompileCommands.noProject'));
    }
    return errEnvelope(EC_PROJECT_NOT_DETECTED, t('generateCompileCommands.noProject'));
  }

  const se = detection.workspaceContext.getSelectedEngine();
  let engine;
  if (!isSilent) {
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
    if (!isQuiet) {
      void vscode.window.showWarningMessage(t('cmd.noEngineSelected'));
    }
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

        // Step 2: symlink/copy 到 helper 目录
        // [D4] symlink 指向**项目本地副本**（jsonPath）—— 写操作落在项目内，
        //        不再顺着 symlink 写回引擎根的共享 DB。
        progress.report({ message: 'Linking to workspace root...', increment: 20 });
        const linkPath = await linkToWorkspaceRoot(jsonPath, project.path, logger);

        // Step 3: 创建补全文件（确保最新）
        progress.report({ message: 'Refreshing completion files...', increment: 30 });
        await createCompletionFiles(project.path);

        // Step 4: [D14] 补齐缺失条目 + 注入 completionHelper —— 合并成**一次**原子写
        //
        // 旧实现分两步：fillMissing 写一次、addCompletionHelper 再写一次 ——
        //   ① 同一次刷新里写两遍，两次之间 clangd 可能读到中间态；
        //   ② 两处都是 `writeFile` 直接覆盖，中途失败会留下**半截 JSON**，
        //      clangd 读到坏文件整个编译数据库就失效了。
        // 现在：先算好（补齐 + helper 注入），最后统一原子写一次。
        progress.report({ message: 'Filling missing entries...', increment: 20 });
        const dbEntries = await readCompileCommands(linkPath);
        if (!dbEntries || dbEntries.length === 0) {
          throw new Error(`Unable to read compile_commands.json at ${linkPath}`);
        }
        const filled = await computeMissingEntries(dbEntries, project.path, logger);
        const helperPath = getCompletionHelperPath(project.path);
        const finalEntries = buildCompletionHelperEntry(filled.entries, helperPath);
        // [MAJOR-2] 写入目标必须是 **clangd 实际读取的那个文件**。
        //
        // helper 目录里的 compile_commands.json 有两种形态：
        //   · 符号链接（Windows 开了开发者模式）→ 指向项目本地副本
        //   · 独立副本（symlink 失败后的 copy 回退，**Windows 默认状态**）→ 与副本各写各的
        // 之前固定写 jsonPath，在 copy 退化场景下 clangd 读到的仍是旧内容 ——
        // D1 补齐的条目与 completionHelper 条目对它完全不可见，且无任何报错。
        // 现在先解析真实目标：符号链接 → 解析到它指向的文件；独立副本 → 就是它自己。
        const writeTarget = await resolveCompileCommandsWriteTarget(linkPath);
        await writeCompileCommandsAtomic(writeTarget, finalEntries);

        progress.report({ increment: 20 });

        // quiet(后台自动)不弹成功提示——状态栏进度(spinner)本身就是完成反馈
        if (!isQuiet) {
          void vscode.window.showInformationMessage(
            t('generateCompileCommands.updated', { 0: linkPath }),
          );
        }
        logger.info(`[generateCompileCommands] done → ${linkPath}`);

        // Step 5: 修改 rsp 文件（后台，不显示进度）
        startModifyResponseFiles(project.path, logger).catch((err) =>
          logger.warn('[generateCompileCommands] modifyRspFiles failed:', err),
        );

        // [Wave2 envelope 对齐] 产出 linkPath 供命令出口组装 envelope
        return linkPath;
      },
    );

    // 提示用户重启 clangd(quiet/后台自动跳过:clangd 12+ 热重载 compile_commands.json,
    // 弹窗对无人值守场景只会累积未处理通知)
    if (!isQuiet) {
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
    }

    return okEnvelope({ linkPath }, t('generateCompileCommands.updated', { 0: linkPath }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // quiet(后台自动)失败不弹错误窗,但必须落失败日志(评审 F-1:无人值守失败
    // 只能靠日志排障);非 quiet 由错误弹窗告知
    if (isQuiet) {
      logger.error(`[generateCompileCommands] quiet pipeline failed: ${msg}`);
    } else {
      void vscode.window.showErrorMessage(t('generateCompileCommands.failed', { 0: msg }));
    }
    // 管线主体是 UBT 生成(Step 1),失败最常见为 UBT 进程失败 → BUILD_FAILED
    return errEnvelope(EC_BUILD_FAILED, t('generateCompileCommands.failed', { 0: msg }));
  }
}
