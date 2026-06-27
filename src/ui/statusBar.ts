/**
 * statusBar —— 底部 Rider 风格工具栏(移植自 engine-link)
 *
 * 布局(从左到右,11 个按钮):
 *   [$(play) Build] [$(refresh) Rebuild] [$(trash) Clean]
 *   [$(gear) Config] [$(symbol-class) Target] [$(device-desktop) Platform]
 *   [$(library) MSVC/SDK]                                         ← 新增
 *   [$(file-code) Project] [$(package) Engine]
 *   [$(zap) Live Coding] [$(rocket) Launch]
 *
 * 主要按钮特性:
 *   - Build / Live Coding / Launch 用 prominent 背景(高亮)
 *   - Build 按钮在 build 中显示 spinner,完成后显示绿勾或红错
 *   - Project / Engine 缺失时用 warning 背景(红黄)
 *   - 没有项目时,Build/Rebuild/Clean/LiveCoding/Launch 按钮隐藏
 *
 * 绑定的命令:
 *   vscodeUEHelper.build / rebuild / clean / launchEditor / liveCoding
 *   vscodeUEHelper.selectConfig / selectTarget
 *   vscodeUEHelper.setSystemIncludes / showProjectInfo
 *
 * 主要导出:
 *   - StatusBarManager: 类,管理 11 个 StatusBarItem
 *   - settingsFromConfig: 从 Config 提取 StatusBarSettings
 *   - StatusBarContext / StatusBarSettings: 类型定义
 *
 * API:
 *   - update(ctx, settings): 根据 ctx / settings 重绘所有按钮
 *   - showBuilding(): build 开始时调,显示 spinner + 禁用按钮
 *   - showBuildResult(success, errorCount, ctx, settings): build 完成后,显示结果 5 秒后恢复
 *   - dispose(): 释放所有按钮(插件卸载时)
 *
 * 详细说明见 doc/01-architecture.md 第 4 节。
 */

import * as vscode from 'vscode';
import { Config } from '@core/config';

export interface StatusBarContext {
  /** Selected or detected project — null when none is available. */
  project: { name: string; path: string } | null;
  /** Selected or detected engine — null when none is available. */
  engine: { version: string; path: string } | null;
}

export interface StatusBarSettings {
  buildConfiguration: string;
  buildTarget: string;
  platform: string;
}

/** Pull the three relevant fields off a `Config` instance. */
export function settingsFromConfig(config: Config): StatusBarSettings {
  return {
    buildConfiguration: config.configuration,
    buildTarget: config.target,
    platform: config.platform,
  };
}

export class StatusBarManager {
  // --- Action buttons ---
  private buildBtn: vscode.StatusBarItem;
  private rebuildBtn: vscode.StatusBarItem;
  private cleanBtn: vscode.StatusBarItem;
  private liveCodingBtn: vscode.StatusBarItem;
  private launchBtn: vscode.StatusBarItem;

  // --- Config / info items ---
  private configBtn: vscode.StatusBarItem;
  private targetBtn: vscode.StatusBarItem;
  private platformBtn: vscode.StatusBarItem;
  private sdkBtn: vscode.StatusBarItem;
  private projectBtn: vscode.StatusBarItem;
  private engineBtn: vscode.StatusBarItem;

  private _isBuilding = false;

  constructor() {
    // Higher priority = further left. Actions on left, info on right.

    // Left group: build actions
    this.buildBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 300);
    this.buildBtn.command = 'vscodeUEHelper.build';
    this.buildBtn.name = 'UE Helper: Build';

    this.rebuildBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 299);
    this.rebuildBtn.command = 'vscodeUEHelper.rebuild';
    this.rebuildBtn.name = 'UE Helper: Rebuild';

    this.cleanBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 298);
    this.cleanBtn.command = 'vscodeUEHelper.clean';
    this.cleanBtn.name = 'UE Helper: Clean';

    // Middle group: config selectors
    this.configBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 297);
    this.configBtn.command = 'vscodeUEHelper.selectConfig';
    this.configBtn.name = 'UE Helper: Configuration';

    this.targetBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 297);
    this.targetBtn.command = 'vscodeUEHelper.selectTarget';
    this.targetBtn.name = 'UE Helper: Target';

    this.platformBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 296);
    this.platformBtn.name = 'UE Helper: Platform';

    this.sdkBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 295);
    this.sdkBtn.command = 'vscodeUEHelper.setSystemIncludes';
    this.sdkBtn.name = 'UE Helper: Windows SDK / MSVC / C++ Standard';

    this.projectBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 294);
    this.projectBtn.command = 'vscodeUEHelper.showProjectInfo';
    this.projectBtn.name = 'UE Helper: Project';

    this.engineBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 293);
    this.engineBtn.command = 'vscodeUEHelper.showProjectInfo';
    this.engineBtn.name = 'UE Helper: Engine';

    // Right group: Live Coding + Launch
    this.liveCodingBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 292);
    this.liveCodingBtn.command = 'vscodeUEHelper.liveCoding';
    this.liveCodingBtn.name = 'UE Helper: Live Coding';

    this.launchBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 291);
    this.launchBtn.command = 'vscodeUEHelper.launchEditor';
    this.launchBtn.name = 'UE Helper: Launch';
  }

  get isBuilding(): boolean {
    return this._isBuilding;
  }

  /** Update all status bar items based on current context and settings. */
  update(ctx: StatusBarContext, settings: StatusBarSettings): void {
    if (this._isBuilding) return;

    // ── Build (prominent) ──
    this.buildBtn.text = '$(play)  Build';
    this.buildBtn.tooltip = 'Build project';
    this.buildBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    this.buildBtn.color = undefined;
    this.buildBtn.command = 'vscodeUEHelper.build';

    // ── Rebuild ──
    this.rebuildBtn.text = '$(refresh)  Rebuild';
    this.rebuildBtn.tooltip = 'Clean + Build';

    // ── Clean ──
    this.cleanBtn.text = '$(trash)  Clean';
    this.cleanBtn.tooltip = 'Clean build artifacts';

    // ── Configuration ──
    this.configBtn.text = `$(gear)  ${settings.buildConfiguration}`;
    this.configBtn.tooltip = 'Build configuration — click to change';

    // ── Target ──
    this.targetBtn.text = `$(symbol-class)  ${settings.buildTarget}`;
    this.targetBtn.tooltip = 'Build target — click for details';

    // ── Platform ──
    this.platformBtn.text = `$(device-desktop)  ${settings.platform}`;
    this.platformBtn.tooltip = `Target platform: ${settings.platform}`;

    // ── Windows SDK / MSVC / C++ standard (Windows-only quickPick) ──
    this.sdkBtn.text = '$(library)  MSVC/SDK';
    this.sdkBtn.tooltip =
      'Pick Windows SDK + MSVC + C++ standard — writes /imsvc flags into .clangd';

    // ── Project ──
    if (ctx.project) {
      this.projectBtn.text = `$(file-code)  ${ctx.project.name}`;
      this.projectBtn.tooltip = ctx.project.path;
      this.projectBtn.backgroundColor = undefined;
    } else {
      this.projectBtn.text = '$(warning)  No Project';
      this.projectBtn.tooltip = 'No .uproject detected — click for details';
      this.projectBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    // ── Engine ──
    if (ctx.engine) {
      this.engineBtn.text = `$(package)  UE ${ctx.engine.version}`;
      this.engineBtn.tooltip = ctx.engine.path;
      this.engineBtn.backgroundColor = undefined;
    } else {
      this.engineBtn.text = '$(warning)  No Engine';
      this.engineBtn.tooltip = 'No engine detected — click for details';
      this.engineBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    // ── Live Coding (prominent) ──
    this.liveCodingBtn.text = '$(zap)  Live Coding';
    this.liveCodingBtn.tooltip = 'Trigger Live Coding compile';
    this.liveCodingBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');

    // ── Launch (prominent) ──
    this.launchBtn.text = '$(rocket)  Launch';
    this.launchBtn.tooltip = 'Launch Unreal Editor';
    this.launchBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');

    // Visibility — without a project, hide the build / launch actions.
    if (ctx.project) {
      this.buildBtn.show();
      this.rebuildBtn.show();
      this.cleanBtn.show();
      this.configBtn.show();
      this.targetBtn.show();
      this.platformBtn.show();
      this.sdkBtn.show();
      this.projectBtn.show();
      this.engineBtn.show();
      this.liveCodingBtn.show();
      this.launchBtn.show();
    } else {
      this.buildBtn.hide();
      this.rebuildBtn.hide();
      this.cleanBtn.hide();
      this.configBtn.show();
      this.targetBtn.show();
      this.platformBtn.show();
      this.sdkBtn.show();
      this.projectBtn.show();
      this.engineBtn.hide();
      this.liveCodingBtn.hide();
      this.launchBtn.hide();
    }
  }

  /** Show the build spinner and disable the button while a build runs. */
  showBuilding(): void {
    this._isBuilding = true;
    this.buildBtn.text = '$(sync~spin)  Building...';
    this.buildBtn.tooltip = 'Build in progress...';
    this.buildBtn.backgroundColor = undefined;
    this.buildBtn.command = undefined;
  }

  /** Show the build result for 5 seconds, then revert to normal. */
  showBuildResult(
    success: boolean,
    errorCount: number,
    ctx: StatusBarContext,
    settings: StatusBarSettings,
  ): void {
    this._isBuilding = false;

    if (success) {
      this.buildBtn.text = '$(check)  Build OK';
      this.buildBtn.tooltip = 'Build succeeded — click to build again';
      this.buildBtn.backgroundColor = undefined;
      this.buildBtn.command = 'vscodeUEHelper.build';
    } else {
      this.buildBtn.text = `$(error)  ${errorCount} error${errorCount !== 1 ? 's' : ''}`;
      this.buildBtn.tooltip = 'Build failed — click to view problems';
      this.buildBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      this.buildBtn.command = 'workbench.action.problems.focus';
    }

    setTimeout(() => {
      this._isBuilding = false;
      this.update(ctx, settings);
    }, 5000);
  }

  dispose(): void {
    this.buildBtn.dispose();
    this.rebuildBtn.dispose();
    this.cleanBtn.dispose();
    this.configBtn.dispose();
    this.targetBtn.dispose();
    this.platformBtn.dispose();
    this.sdkBtn.dispose();
    this.projectBtn.dispose();
    this.engineBtn.dispose();
    this.liveCodingBtn.dispose();
    this.launchBtn.dispose();
  }
}
