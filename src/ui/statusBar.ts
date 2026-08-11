/**
 * statusBar —— 底部 Rider 风格工具栏(移植自 engine-link)
 *
 * 布局(从左到右,8 个按钮):
 *   [$(file-code) 项目名 | $(package) 引擎版本 | $(device-desktop) 平台]   ← 合并 3 项
 *   [$(gear) Config] [$(symbol-class) Target]
 *   [$(play) Build] [$(refresh) Rebuild] [$(trash) Clean]
 *   [$(zap) Live Coding] [$(rocket) Launch]
 *
 * 主要按钮特性:
 *   - Build / Live Coding / Launch 用 prominent 背景(高亮)
 *   - Build 按钮在 build 中显示 spinner,完成后显示绿勾或红错
 *   - 项目信息按钮缺失任一项时用 warning 背景(红黄)
 *   - 没有项目时,Build/Rebuild/Clean/LiveCoding/Launch 按钮隐藏
 *
 * 绑定的命令:
 *   vscodeUEHelper.build / rebuild / clean / launchEditor / liveCoding
 *   vscodeUEHelper.selectConfig / selectTarget
 *   vscodeUEHelper.showProjectInfo
 *
 * 主要导出:
 *   - StatusBarManager: 类,管理 8 个 StatusBarItem
 *   - settingsFromConfig: 从 Config 提取 StatusBarSettings
 *   - StatusBarContext / StatusBarSettings: 类型定义
 *
 * API:
 *   - update(ctx, settings): 完整重绘(依赖 detection.ready 解析后的 ctx)
 *   - updateConfig(settings): **同步**重绘仅依赖 config 的按钮 (configBtn / targetBtn /
 *     projectInfoBtn 的 platform 段),不依赖 detection.ready。供 config.onDidChange
 *     listener 调用,避免 listener 走 async renderFull 时的 microtask 延迟导致用户
 *     看到「点了 Config 按钮但状态栏没立即刷新」。
 *   - showBuilding(): build 开始时调,显示 spinner + 禁用按钮
 *   - showBuildResult(success, errorCount, ctx, settings): build 完成后,显示结果 5 秒后恢复
 *   - dispose(): 释放所有按钮(插件卸载时)
 *
 * 详细说明见 doc/01-architecture.md 第 4 节。
 */

import * as vscode from 'vscode';
import { type Config } from '@core/config';

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
  private projectInfoBtn: vscode.StatusBarItem;

  private _isBuilding = false;

  /**
   * showBuildResult 的结果回退 timer id。
   *
   * [F2-14/W16] 记录 timer 以便 dispose() 时清理 —— 插件卸载/build 被新构建打断时,
   * 未清理的 setTimeout 会在 dispose 后仍访问已释放的 StatusBarItem,造成悬垂写。
   */
  private _resultTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * 上次完整重绘 (update) 时的 ctx 快照,供 updateConfig 复用。
   *
   * 仅依赖 config 的按钮（configBtn / targetBtn / projectInfoBtn 的 platform 段）
   * 在 updateConfig 内需要 projectName/engineVersion 派生文本,但更新这些字段
   * 的触发源（config.onDidChange）通常发生在 renderFull 已经完成首次注入 ctx
   * 之后。这里缓存最近一次的 ctx,避免 updateConfig 退化为「No Project | No Engine」。
   *
   * 未经过 update 调用前为 null —— updateConfig 此时降级只更新 configBtn/targetBtn,
   * projectInfoBtn 的项目/引擎段保持上次 update 的状态（首次未注入则无操作）。
   */
  private _cachedCtx: StatusBarContext | null = null;

  constructor() {
    // Higher priority = further left. Actions on left, info on right.
    // 合并按钮：项目名|引擎版本|平台
    this.projectInfoBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 300);
    this.projectInfoBtn.command = 'vscodeUEHelper.showProjectInfo';
    this.projectInfoBtn.name = 'UE Helper: Project Info';

    // Middle group: config selectors
    this.configBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 299);
    this.configBtn.command = 'vscodeUEHelper.selectConfig';
    this.configBtn.name = 'UE Helper: Configuration';

    this.targetBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 298);
    this.targetBtn.command = 'vscodeUEHelper.selectTarget';
    this.targetBtn.name = 'UE Helper: Target';

    // Left group: build actions
    this.buildBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 297);
    this.buildBtn.command = 'vscodeUEHelper.build';
    this.buildBtn.name = 'UE Helper: Build';

    this.rebuildBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 296);
    this.rebuildBtn.command = 'vscodeUEHelper.rebuild';
    this.rebuildBtn.name = 'UE Helper: Rebuild';

    this.cleanBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 295);
    this.cleanBtn.command = 'vscodeUEHelper.clean';
    this.cleanBtn.name = 'UE Helper: Clean';

    // Right group: Live Coding + Launch
    this.liveCodingBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 294);
    this.liveCodingBtn.command = 'vscodeUEHelper.liveCoding';
    this.liveCodingBtn.name = 'UE Helper: Live Coding';

    this.launchBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 293);
    this.launchBtn.command = 'vscodeUEHelper.launchEditor';
    this.launchBtn.name = 'UE Helper: Launch';
  }

  get isBuilding(): boolean {
    return this._isBuilding;
  }

  /** Update all status bar items based on current context and settings. */
  update(ctx: StatusBarContext, settings: StatusBarSettings): void {
    if (this._isBuilding) {
      return;
    }

    // 缓存 ctx,供 updateConfig 在 config.onDidChange 同步路径里复用 projectName/engineVersion。
    this._cachedCtx = ctx;

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

    // ── 项目名|引擎版本|平台（合并 3 个信息项）──
    const projectName = ctx.project?.name ?? 'No Project';
    const engineVersion = ctx.engine ? `UE ${ctx.engine.version}` : 'No Engine';
    const platform = settings.platform;
    this.projectInfoBtn.text = `$(file-code)  ${projectName} | $(package)  ${engineVersion} | $(device-desktop)  ${platform}`;
    const tooltipLines: string[] = [];
    if (ctx.project) {
      tooltipLines.push(`项目: ${ctx.project.path}`);
    } else {
      tooltipLines.push('未检测到 .uproject');
    }
    if (ctx.engine) {
      tooltipLines.push(`引擎: ${ctx.engine.path}`);
    } else {
      tooltipLines.push('未检测到引擎');
    }
    tooltipLines.push(`平台: ${platform}`);
    this.projectInfoBtn.tooltip = tooltipLines.join('\n');
    if (!ctx.project || !ctx.engine) {
      this.projectInfoBtn.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground',
      );
    } else {
      this.projectInfoBtn.backgroundColor = undefined;
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
      this.projectInfoBtn.show();
      this.liveCodingBtn.show();
      this.launchBtn.show();
    } else {
      this.buildBtn.hide();
      this.rebuildBtn.hide();
      this.cleanBtn.hide();
      this.configBtn.show();
      this.targetBtn.show();
      this.projectInfoBtn.show();
      this.liveCodingBtn.hide();
      this.launchBtn.hide();
    }
  }

  /**
   * **同步**重绘仅依赖 settings 的按钮 —— 不依赖 ctx,不需要 await detection.ready。
   *
   * 用途：config.onDidChange listener 直接调用,避免走 async renderFull 时的
   * microtask 延迟,确保用户在 selectConfig / selectTarget / 改 platform 后
   * 同一 tick 内看到状态栏按钮更新。
   *
   * 影响范围（仅这三个按钮的文本段,不重绘 visibility / build spinner / warning bg）：
   *   - configBtn.text: $(gear) ${buildConfiguration}
   *   - targetBtn.text:  $(symbol-class) ${buildTarget}
   *   - projectInfoBtn.text 的 platform 段:用 _cachedCtx 派生 projectName/engineVersion,
   *     嵌入 ${platform}
   *
   * 守护行为：
   *   - _isBuilding === true 时直接返回 —— 不让 config 变化打断 build spinner / 结果状态,
   *     build 走完整 update() 路径或 setTimeout 回调刷新即可。
   *   - _cachedCtx === null（首次 update 还未跑过）时只更新 configBtn / targetBtn,
   *     projectInfoBtn 不动 —— 避免在没有 detection 结果时显示「No Project | No Engine」。
   */
  updateConfig(settings: StatusBarSettings): void {
    if (this._isBuilding) {
      return;
    }

    // ── Configuration ──
    this.configBtn.text = `$(gear)  ${settings.buildConfiguration}`;
    this.configBtn.tooltip = 'Build configuration — click to change';

    // ── Target ──
    this.targetBtn.text = `$(symbol-class)  ${settings.buildTarget}`;
    this.targetBtn.tooltip = 'Build target — click for details';

    // ── Project info 的 platform 段(只在缓存过 ctx 后才更新,避免空窗期)──
    if (this._cachedCtx) {
      const projectName = this._cachedCtx.project?.name ?? 'No Project';
      const engineVersion = this._cachedCtx.engine
        ? `UE ${this._cachedCtx.engine.version}`
        : 'No Engine';
      const platform = settings.platform;
      this.projectInfoBtn.text = `$(file-code)  ${projectName} | $(package)  ${engineVersion} | $(device-desktop)  ${platform}`;
      // tooltip 也需要同步刷新 platform 段
      const tooltipLines: string[] = [];
      if (this._cachedCtx.project) {
        tooltipLines.push(`项目: ${this._cachedCtx.project.path}`);
      } else {
        tooltipLines.push('未检测到 .uproject');
      }
      if (this._cachedCtx.engine) {
        tooltipLines.push(`引擎: ${this._cachedCtx.engine.path}`);
      } else {
        tooltipLines.push('未检测到引擎');
      }
      tooltipLines.push(`平台: ${platform}`);
      this.projectInfoBtn.tooltip = tooltipLines.join('\n');
    }
  }

  /** Show the build spinner and disable the button while a build runs. */
  showBuilding(): void {
    // [F2-14/W16] 新构建开始,取消上一个结果回退 timer,避免旧 timer 在构建中
    // 触发 update() 把 spinner 状态冲掉。
    if (this._resultTimer) {
      clearTimeout(this._resultTimer);
      this._resultTimer = undefined;
    }
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

    // [F2-14/W16] 记录 timer id;dispose 或下一次 showBuilding/showBuildResult 时清理。
    if (this._resultTimer) {
      clearTimeout(this._resultTimer);
    }
    this._resultTimer = setTimeout(() => {
      this._resultTimer = undefined;
      this._isBuilding = false;
      this.update(ctx, settings);
    }, 5000);
  }

  dispose(): void {
    // [F2-14/W16] 清理未完成的 build 结果回退 timer,防止 dispose 后仍修改已释放的 StatusBarItem
    if (this._resultTimer) {
      clearTimeout(this._resultTimer);
      this._resultTimer = undefined;
    }
    this.buildBtn.dispose();
    this.rebuildBtn.dispose();
    this.cleanBtn.dispose();
    this.configBtn.dispose();
    this.targetBtn.dispose();
    this.projectInfoBtn.dispose();
    this.liveCodingBtn.dispose();
    this.launchBtn.dispose();
  }
}
