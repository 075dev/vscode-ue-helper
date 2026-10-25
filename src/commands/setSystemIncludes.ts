/**
 * setSystemIncludes —— 把 Windows SDK + MSVC + C++ 标准写到 .clangd
 *
 * 流程:
 *   1. 用 clangd --version 推断 InstalledDir,再跑 clang++.exe -v -E 拿到系统 include
 *   2. 三个 quickPick: MSVC 版本 → Windows SDK 版本 → C++ 标准
 *   3. 渲染 /imsvc + -fms-compatibility-version 标志
 *   4. 通过 ClangdOps.applyAddFlags 写入 .clangd 的 CompileFlags.Add（[Phase 9 SSoT] 唯一写入路径）
 *
 * Windows-only。其他平台命令显示信息提示后返回。
 *
 * 状态栏的 $(library) MSVC/SDK 按钮绑到这里。
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from '@clangd/clangdOps';
import {
  discoverSystemIncludes,
  listMsvcVersions,
  listSdkVersions,
  readMsvcVersion,
  renderClangdFlags,
  readRecommendedSdkVersion,
  selectSdkVersion,
} from '@clangd/windowsSdk';
// [D5] .clangd Add 的统一写入入口（ctx 五项统一采集）
import { writeClangdAddFlags } from '@clangd/clangdFlagRenderer';
import type { DetectionHandles } from '@detection';
import { resolveProjectOrPick, persistSelection } from '@commands/_resolve';
import { t } from '@i18n';
import {
  okEnvelope,
  errEnvelope,
  EC_PROJECT_NOT_DETECTED,
  EC_CLANGD_NOT_AVAILABLE,
  EC_OPERATION_CANCELLED,
  EC_INTERNAL_ERROR,
  type Envelope,
} from '@core/envelope';

export async function executeSetSystemIncludes(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 已存在的参数——开始真正使用
  workspace?: WorkspaceState,
  clangdOps?: ClangdOps,
  // [Phase 11 SSoT] silent = true 时跳过 auto-pick / picker，供 MCP tools 调用
  silent: boolean = false,
  // [Wave3 类型收口] dispatch(src/mcp/tools.ts)形参已放宽为 Promise<unknown>,
  // 声明由 Promise<void> 翻转为精确的 Promise<Envelope<undefined>>(成功路径无 data),
  // 骨架阶段的 void 桥接转换已删除。
): Promise<Envelope<undefined>> {
  try {
    return await runSetSystemIncludes(
      config,
      logger,
      detection,
      workspace,
      clangdOps,
      silent,
    );
  } catch (err) {
    // 函数出口 catch:未预期异常统一收口为 EC_INTERNAL_ERROR(任务卡口径 1)
    logger.error('[setSystemIncludes] unexpected error:', err);
    return errEnvelope(
      EC_INTERNAL_ERROR,
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function runSetSystemIncludes(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  workspace?: WorkspaceState,
  clangdOps?: ClangdOps,
  silent: boolean = false,
): Promise<Envelope<undefined>> {
  // [Phase 11 SSoT] 选目标逻辑收敛到 @commands/_resolve（仅 project,engine 路径直接读缓存）
  const project = await resolveProjectOrPick({ detection, workspace, silent });
  if (!project) {
    // 未检测到/未选择 .uproject(非 silent 时 resolveProjectOrPick 会弹 warning;
    // silent 路径不弹 —— 见 @commands/_resolve 的 [D15 收口])
    return errEnvelope(EC_PROJECT_NOT_DETECTED, t('cmd.noUprojectSelected'));
  }
  await persistSelection(workspace, detection, project, undefined);

  // 引擎已经在工作区中选择过，直接读取
  const enginePath = workspace?.selectedEngine ?? detection.workspaceContext.getSelectedEngine();
  logger.info(
    `[setSystemIncludes] project: ${project.path}, engine: ${enginePath ?? 'not selected'}`,
  );

  // Discover what clangd currently sees.
  const detected = await discoverSystemIncludes(config.clangdPath, logger);
  if (!detected) {
    logger.warn('[setSystemIncludes] no clang/clangd found on PATH or default LLVM location');
    // [D15] silent(MCP/AI 代理)路径不弹任何窗 —— 弹窗等人点会让工具调用悬空。
    // 直接返回错误信封,agent 能读到失败原因。
    if (!silent) {
      const choice = await vscode.window.showErrorMessage(
        'Could not detect MSVC / Windows SDK — no clangd (or clang.exe / clang++.exe) found.\n\n' +
          'Searched:\n' +
          '  • vscodeUEHelper.clangdPath setting\n' +
          '  • PATH (via `where` and a manual walk)\n' +
          '  • C:\\Program Files\\LLVM\\bin\n' +
          '  • C:\\Program Files (x86)\\LLVM\\bin\n' +
          '  • %LocalAppData%\\Programs\\LLVM\\bin\n\n' +
          'Install LLVM (clangd) and restart VS Code, or set the clangdPath setting manually.',
        // [D15] 模态弹窗会阻塞整个 VS Code 窗口 —— 改为非模态
        { modal: false },
        'Open LLVM download page',
        'How to install clangd',
      );
      if (choice === 'Open LLVM download page') {
        await vscode.env.openExternal(
          vscode.Uri.parse('https://github.com/llvm/llvm-project/releases'),
        );
      } else if (choice === 'How to install clangd') {
        await vscode.env.openExternal(
          vscode.Uri.parse(
            'https://github.com/llvm/llvm-project/releases' +
              ' (download the latest LLVM-XX.X.X-win64.exe installer; on the install ' +
              "wizard, tick 'Add LLVM to the system environment PATH').",
          ),
        );
      }
    }
    // [envelope 对齐] clangd/clang 可执行文件探测失败 → CLANGD_NOT_AVAILABLE(映射表直配)
    return errEnvelope(
      EC_CLANGD_NOT_AVAILABLE,
      'Could not detect MSVC / Windows SDK — no clangd (or clang.exe / clang++.exe) found.',
    );
  }
  logger.info(
    `[setSystemIncludes] detected MSVC=${detected.msvcRoot} SDK=${detected.sdkRoot} fmsVer=${detected.fmsCompatibilityVersion}`,
  );

  const msvcParent = path.dirname(detected.msvcRoot);
  const sdkParent = path.dirname(detected.sdkRoot);

  // [D15] silent(MCP/AI 代理)路径:不列版本、不弹 QuickPick ——
  // 直接采用自动检测到的 msvcRoot / sdkRoot。agent 无法回答交互式选择框,
  // 弹框只会让工具调用悬着等人点。
  if (silent) {
    logger.info(
      `[setSystemIncludes] silent mode: use detected MSVC=${detected.msvcRoot} SDK=${detected.sdkRoot}`,
    );
    return await applySystemIncludes({
      config,
      logger,
      clangdOps,
      msvcRoot: detected.msvcRoot,
      sdkRoot: detected.sdkRoot,
      msvcLabel: path.basename(detected.msvcRoot),
      sdkLabel: path.basename(detected.sdkRoot),
      silent: true,
    });
  }

  const msvcVersions = await listMsvcVersions(msvcParent);
  const sdkVersions = await listSdkVersions(sdkParent);
  if (msvcVersions.length === 0 || sdkVersions.length === 0) {
    void vscode.window.showErrorMessage(
      'No MSVC or Windows SDK versions found under the detected paths.',
    );
    // [错误码缺口登记] 探测到 clangd 但 MSVC/SDK 版本目录为空,契约 9 项枚举无贴切码
    // → 按兜底规则取 INTERNAL_ERROR(缺口登记见完成报告)
    return errEnvelope(
      EC_INTERNAL_ERROR,
      'No MSVC or Windows SDK versions found under the detected paths.',
      { msvcVersionCount: msvcVersions.length, sdkVersionCount: sdkVersions.length },
    );
  }

  // ── 读取引擎推荐的 SDK 版本 ──
  let recommendedSdk: string | null = null;
  if (enginePath) {
    recommendedSdk = await readRecommendedSdkVersion(enginePath);
  }
  const defaultSdkVersion = selectSdkVersion(sdkVersions, recommendedSdk);
  if (recommendedSdk) {
    logger.info(
      `[setSystemIncludes] engine recommends SDK: ${recommendedSdk}, selected: ${defaultSdkVersion}`,
    );
  } else {
    logger.info(
      `[setSystemIncludes] no SDK recommendation from engine, using latest: ${defaultSdkVersion}`,
    );
  }

  // ── QuickPick 1: MSVC version ──
  const msvcChoice = await vscode.window.showQuickPick(
    msvcVersions.map((v) => ({
      label: v,
      description: path.join(msvcParent, v, 'include'),
      picked: v === path.basename(detected.msvcRoot),
    })),
    { placeHolder: 'Select MSVC version', title: 'MSVC' },
  );
  if (!msvcChoice) {
    // 用户取消 QuickPick(现有行为:静默返回)→ OPERATION_CANCELLED(映射表直配)
    return errEnvelope(EC_OPERATION_CANCELLED, '用户取消了 MSVC 版本选择。');
  }
  const msvcRoot = path.join(msvcParent, msvcChoice.label);

  // ── QuickPick 2: Windows SDK version ──
  // 优先选中引擎推荐的版本，如果找不到则选中检测到的版本，还没有就选最新的
  const sdkChoice = await vscode.window.showQuickPick(
    sdkVersions.map((v) => ({
      label: v,
      description: path.join(sdkParent, v),
      picked: v === defaultSdkVersion,
    })),
    {
      placeHolder: recommendedSdk
        ? `Select Windows SDK version (engine recommends: ${recommendedSdk})`
        : 'Select Windows SDK version',
      title: 'Windows SDK',
    },
  );
  if (!sdkChoice) {
    // 用户取消 QuickPick(现有行为:静默返回)→ OPERATION_CANCELLED(映射表直配)
    return errEnvelope(EC_OPERATION_CANCELLED, '用户取消了 Windows SDK 版本选择。');
  }
  const sdkRoot = path.join(sdkParent, sdkChoice.label);

  return await applySystemIncludes({
    config,
    logger,
    clangdOps,
    msvcRoot,
    sdkRoot,
    msvcLabel: msvcChoice.label,
    sdkLabel: sdkChoice.label,
    silent: false,
  });
}

/**
 * 把选定的 MSVC / SDK 写入 .clangd（统一写入入口 + 设置项持久化）。
 *
 * [D15] silent(MCP/AI 代理)路径复用本函数但**不弹任何窗** ——
 * 交互式路径末尾的 "System includes set" 提示在 agent 场景下只是噪音,
 * 且会让 MCP 工具调用悬着等待 UI 关闭。
 */
async function applySystemIncludes(params: {
  config: Config;
  logger: Logger;
  clangdOps?: ClangdOps;
  msvcRoot: string;
  sdkRoot: string;
  msvcLabel: string;
  sdkLabel: string;
  silent: boolean;
}): Promise<Envelope<undefined>> {
  const { config, logger, clangdOps, msvcRoot, sdkRoot, msvcLabel, sdkLabel, silent } = params;

  // [MAJOR-3] fms 版本必须对应**本次选中的** msvcRoot（探测到的那个可能是另一个版本）。
  //
  // 此前有两个来源：渲染 `.clangd` 用的是探测值 `detected.fmsCompatibilityVersion`，
  // 持久化设置项用的是按选中 msvcRoot 重读的 `selectedFmsVersion` —— 两者可能不同。
  // 后果：`.clangd` 里的 `-fms-compatibility-version=` 与 `/imsvc<选中的 msvc>` 指向
  // 不同版本的 MSVC（`_MSC_VER` 与实际头文件冲突）；且之后任何一次 `.clangd` 重写
  // （面板保存 / 配置变更触发）会写入另一个值 → 同一份 `.clangd` 内容前后不一致。
  //
  // 现在只有一个来源：按选中的 msvcRoot 读一次，渲染与持久化**共用**这个值。
  const selectedFmsVersion = await readMsvcVersion(msvcRoot, logger);

  // applyAddFlags 失败时不提前返回(保持现有控制流:成功提示仍会弹出),
  // 失败信息暂存,最终随 envelope 返回。
  let failure: Envelope<undefined> | undefined;

  // Render flags and splice into .clangd.
  // ⚠️ 注意：不需要再加 /std: 了，renderClangdFlags 已经包含。
  // Plan Add 收束：不再做"过滤前缀 + 保留"操作。
  const systemFlags = await renderClangdFlags({
    msvcRoot,
    sdkRoot,
    fmsCompatibilityVersion: selectedFmsVersion,
  });

  // [Plan D 激活] 读取 userAddFlags（如果没有则视为空数组），把 systemFlags 作为
  // `system-include-windows` 整体 push 进 ids。整个 userAddFlags + system-include-windows
  // 通过统一写入入口一次性写入 .clangd（force-write 语义）。
  // [Plan UX 决策] 用户选择"总是同步"：即运行命令后 userAddFlags 一定会增加 system-include-windows id。
  const currentUserAdd = config.userAddFlags ?? [];
  const nextUserAdd = currentUserAdd.includes('system-include-windows')
    ? currentUserAdd
    : [...currentUserAdd, 'system-include-windows'];

  if (clangdOps) {
    if (!(await clangdOps.exists())) {
      await clangdOps.writeFull({});
    }

    // [D5] 持久化 MSVC / SDK 路径 —— 统一入口靠它们重建 system-include-windows
    // 的 flag 组。没有这一步，之后任何一次 .clangd 重写（面板保存 / 配置变更）
    // 都会把 /imsvc 全部丢掉 → clangd 找不到系统头 → 满屏 false-positive。
    //
    // fms 版本已在上方按选中的 msvcRoot 读出（[MAJOR-3]）—— 渲染 .clangd 与
    // 持久化设置项共用同一个值。
    await config.update('clangd.msvcRoot', msvcRoot);
    await config.update('clangd.sdkRoot', sdkRoot);
    await config.update('clangd.fmsCompatibilityVersion', selectedFmsVersion ?? '');

    // 整体 force-write：走统一入口（ctx 由 collectClangdFlagContext 采集）。
    // systemIncludeFlags 用本次刚渲染出的值覆盖 —— 用户选的就是这个版本，
    // 不依赖设置项持久化是否成功。
    const result = await writeClangdAddFlags(
      { clangdOps, config, logger },
      nextUserAdd,
      { systemIncludeFlags: systemFlags },
    );
    if (result.ok) {
      // 同步回设置 —— 用户已决策"总是同步"。
      await config.update('clangd.userAddFlags', nextUserAdd);
      logger.info(
        `[setSystemIncludes] force-wrote ${systemFlags.length} system flags to .clangd via unified entry, ` +
          `userAddFlags now has ${nextUserAdd.length} ids`,
      );
    } else {
      logger.error(`[setSystemIncludes] writeClangdAddFlags failed: ${result.reason}`);
      // [envelope 对齐] 保持现有控制流:失败不提前返回(下方 "System includes set" 提示
      // 历史上仍会弹出,spec-as-is 原样保留),仅把失败登记进返回 envelope(缺口登记见报告)。
      failure = errEnvelope(
        EC_INTERNAL_ERROR,
        `Failed to write system include flags to .clangd: ${result.reason}`,
      );
    }
  } else {
    // ClangdOps 未注入 —— Phase 8 路径不完整，配置面板 flagGlossary + applyAddFlags 都依赖它。
    throw new Error(
      '[setSystemIncludes] ClangdOps is required but not injected. ' +
        'Phase 8 architecture mandates ClangdOps for all .clangd mutations.',
    );
  }

  // [D15] silent 路径不弹提示框(agent 无人在看;弹窗只会让 MCP 调用悬着)
  if (!silent) {
    void vscode.window.showInformationMessage(
      `System includes set:\nMSVC ${msvcLabel}\nSDK ${sdkLabel}`,
    );
  }

  // [envelope 对齐] 成功摘要复用上方提示的文案语义(英文原样,同现有未本地化文案,
  // i18n 接线登记为填充阶段工作);applyAddFlags 失败时返回暂存的失败 envelope。
  return (
    failure ??
    okEnvelope(
      undefined,
      `System includes set: MSVC ${msvcLabel}, SDK ${sdkLabel}`,
    )
  );
}
