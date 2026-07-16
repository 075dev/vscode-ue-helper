/**
 * setSystemIncludes —— 把 Windows SDK + MSVC + C++ 标准写到 .clangd
 *
 * 流程:
 *   1. 用 clangd --version 推断 InstalledDir,再跑 clang++.exe -v -E 拿到系统 include
 *   2. 三个 quickPick: MSVC 版本 → Windows SDK 版本 → C++ 标准
 *   3. 渲染 /imsvc + -fms-compatibility-version 标志
 *   4. 用 replaceSystemIncludeBlock splice 进 .clangd 的 CompileFlags.Add
 *
 * Windows-only。其他平台命令显示信息提示后返回。
 *
 * 状态栏的 $(library) MSVC/SDK 按钮绑到这里。
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from '@clangd/clangdOps';
import {
  discoverSystemIncludes,
  listMsvcVersions,
  listSdkVersions,
  renderClangdFlags,
  readRecommendedSdkVersion,
  selectSdkVersion,
} from '@clangd/windowsSdk';
import { resolveFlags } from '@clangd/flagGlossary';
import { pickProject } from '@ui/quickPicks';
import type { DetectionHandles } from '@detection';

export async function executeSetSystemIncludes(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  _workspace?: WorkspaceState,
  clangdOps?: ClangdOps,
): Promise<void> {  if (process.platform !== 'win32') {
    void vscode.window.showInformationMessage(
      'Set System Includes only applies on Windows (MSVC + Windows SDK).',
    );
    return;
  }

  // Resolve the active project + engine (same shape as executeBuild).
  const projects = await detection.scanner.scan();
  let project = projects.find((p) => p.path === detection.workspaceContext.getSelectedProject());
  if (!project && projects.length === 1) {project = projects[0];}
  if (!project) {project = await pickProject(projects);}
  if (!project) {return;}
  await detection.workspaceContext.setProject(project);

  // 引擎已经在工作区中选择过，直接读取
  const enginePath = detection.workspaceContext.getSelectedEngine();
  logger.info(`[setSystemIncludes] project: ${project.path}, engine: ${enginePath ?? 'not selected'}`);

  // Discover what clangd currently sees.
  const detected = await discoverSystemIncludes(config.clangdPath, logger);
  if (!detected) {
    logger.warn('[setSystemIncludes] no clang/clangd found on PATH or default LLVM location');
    const choice = await vscode.window.showErrorMessage(
      'Could not detect MSVC / Windows SDK — no clangd (or clang.exe / clang++.exe) found.\n\n' +
        'Searched:\n' +
        '  • vscodeUEHelper.clangdPath setting\n' +
        '  • PATH (via `where` and a manual walk)\n' +
        '  • C:\\Program Files\\LLVM\\bin\n' +
        '  • C:\\Program Files (x86)\\LLVM\\bin\n' +
        '  • %LocalAppData%\\Programs\\LLVM\\bin\n\n' +
        'Install LLVM (clangd) and restart VS Code, or set the clangdPath setting manually.',
      { modal: true },
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
    return;
  }
  logger.info(
    `[setSystemIncludes] detected MSVC=${detected.msvcRoot} SDK=${detected.sdkRoot} fmsVer=${detected.fmsCompatibilityVersion}`,
  );

  const msvcParent = path.dirname(detected.msvcRoot);
  const sdkParent = path.dirname(detected.sdkRoot);

  const msvcVersions = await listMsvcVersions(msvcParent);
  const sdkVersions = await listSdkVersions(sdkParent);
  if (msvcVersions.length === 0 || sdkVersions.length === 0) {
    void vscode.window.showErrorMessage(
      'No MSVC or Windows SDK versions found under the detected paths.',
    );
    return;
  }

  // ── 读取引擎推荐的 SDK 版本 ──
  let recommendedSdk: string | null = null;
  if (enginePath) {
    recommendedSdk = await readRecommendedSdkVersion(enginePath);
  }
  const defaultSdkVersion = selectSdkVersion(sdkVersions, recommendedSdk);
  if (recommendedSdk) {
    logger.info(`[setSystemIncludes] engine recommends SDK: ${recommendedSdk}, selected: ${defaultSdkVersion}`);
  } else {
    logger.info(`[setSystemIncludes] no SDK recommendation from engine, using latest: ${defaultSdkVersion}`);
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
  if (!msvcChoice) {return;}
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
  if (!sdkChoice) {return;}
  const sdkRoot = path.join(sdkParent, sdkChoice.label);

  // Render flags and splice into .clangd.
  // ⚠️ 注意：不需要再加 /std: 了，renderClangdFlags 已经包含。
  // Plan Add 收束：不再做"过滤前缀 + 保留"操作。
  const systemFlags = await renderClangdFlags({
    msvcRoot,
    sdkRoot,
    fmsCompatibilityVersion: detected.fmsCompatibilityVersion,
  });

  // [Plan D 激活] 读取 userAddFlags（如果没有则视为空数组），把 systemFlags 作为
  // `system-include-windows` 整体 push 进 ids。整个 userAddFlags + system-include-windows
  // 通过 flagGlossary.resolveFlags + applyAddFlags 一次性写入 .clangd（force-write 语义）。
  // [Plan UX 决策] 用户选择"总是同步"：即运行命令后 userAddFlags 一定会增加 system-include-windows id。
  const currentUserAdd = config.userAddFlags ?? [];
  const nextUserAdd = currentUserAdd.includes('system-include-windows')
    ? currentUserAdd
    : [...currentUserAdd, 'system-include-windows'];

  if (clangdOps) {
    if (!(await clangdOps.exists())) {
      await clangdOps.writeFull({});
    }

    // 整体 force-write：用 flagGlossary + userAddFlags 决定 Add 内容。
    // resolveFlags 已知 system-include-windows id 会展开 ctx.systemIncludeFlags。
    const addFlags = resolveFlags(nextUserAdd, {
      systemIncludeFlags: systemFlags,
    });

    const result = await clangdOps.applyAddFlags(addFlags);
    if (result.ok) {
      // 同步回设置 —— 用户已决策"总是同步"。
      await config.update('clangd.userAddFlags', nextUserAdd);
      logger.info(
        `[setSystemIncludes] force-wrote ${addFlags.length} flags to .clangd via applyAddFlags, ` +
          `userAddFlags now has ${nextUserAdd.length} ids`,
      );
    } else {
      logger.error(`[setSystemIncludes] applyAddFlags failed: ${result.reason}`);
    }
  } else {
    // ClangdOps 未注入 —— Phase 8 路径不完整，配置面板 flagGlossary + applyAddFlags 都依赖它。
    throw new Error(
      '[setSystemIncludes] ClangdOps is required but not injected. ' +
        'Phase 8 architecture mandates ClangdOps for all .clangd mutations.',
    );
  }

  void vscode.window.showInformationMessage(
    `System includes set:\nMSVC ${msvcChoice.label}\nSDK ${sdkChoice.label}`,
  );
}
