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
import * as fs from 'node:fs/promises';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import {
  discoverSystemIncludes,
  listMsvcVersions,
  listSdkVersions,
  renderClangdFlags,
  readRecommendedSdkVersion,
  selectSdkVersion,
} from '@clangd/windowsSdk';
import {
  replaceSystemIncludeBlock,
  findClangdConfig,
  writeClangdConfig,
} from '@clangd/clangdConfig';
import { pickProject } from '@ui/quickPicks';
import type { DetectionHandles } from '@detection';

export async function executeSetSystemIncludes(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
): Promise<void> {
  if (process.platform !== 'win32') {
    void vscode.window.showInformationMessage(
      'Set System Includes only applies on Windows (MSVC + Windows SDK).',
    );
    return;
  }

  // Resolve the active project + engine (same shape as executeBuild).
  const projects = await detection.scanner.scan();
  let project = projects.find((p) => p.path === detection.workspaceContext.getSelectedProject());
  if (!project && projects.length === 1) project = projects[0];
  if (!project) project = await pickProject(projects);
  if (!project) return;
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
  if (!msvcChoice) return;
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
  if (!sdkChoice) return;
  const sdkRoot = path.join(sdkParent, sdkChoice.label);

  // Render flags and splice into .clangd.
  // ⚠️ 注意：不需要再加 /std: 了，默认 .clangd 配置已经有 -std=c++20
  // 再加会导致重复，甚至可能覆盖 UE 的编译设置
  const newFlags = await renderClangdFlags({
    msvcRoot,
    sdkRoot,
    fmsCompatibilityVersion: detected.fmsCompatibilityVersion,
  });

  const projectDir = path.dirname(project.path);
  const clangdFile = await findClangdConfig(project.path);
  if (!clangdFile) {
    // No .clangd yet — create one with the default + system flags.
    await writeClangdConfig(project.path);
  }
  const before = await fs.readFile(clangdFile ?? path.join(projectDir, '.clangd'), 'utf-8');
  const after = replaceSystemIncludeBlock(before, newFlags);
  if (after !== before) {
    await fs.writeFile(clangdFile ?? path.join(projectDir, '.clangd'), after, 'utf-8');
    logger.info(`[setSystemIncludes] wrote ${newFlags.length} flags to .clangd`);
  }

  void vscode.window.showInformationMessage(
    `System includes set:\nMSVC ${msvcChoice.label}\nSDK ${sdkChoice.label}`,
  );
}
