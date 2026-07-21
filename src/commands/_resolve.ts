/**
 * _resolve —— 命令链选择项目/引擎的公共 helper
 *
 * Phase 11 包 1 引入,收敛 6 个命令文件里"读 selection 缓存 → 唯一项 auto-pick →
 * picker fallback → showWarning"的重复模式。所有调用方不再自己实现 legacyFind* 闭包。
 *
 * ## 设计原则
 *
 * 1. **不自动持久化**:resolve* 返回后由调用方决定何时持久化(用 persistSelection)。
 * 2. **silent 模式留给包 4**(MCP tools.ts);包 1 命令路径都默认 silent = false。
 *    silent = true 时完全跳过 auto-pick / picker,直接走 showWarning 返回 undefined。
 * 3. **autoPickSingle 接口预留**,当前实现仅跟随 silent 条件(单项目 auto-pick
 *    仅当 !silent 时触发)。后续若要让 `autoPickSingle: false` 真正抑制单项目
 *    auto-pick,在 resolveProjectOrPick/resolveEngineOrPick 内追加 && autoPickSingle。
 * 4. **legacyFind* 内部封装**:仅老调用方 / test 不传 WorkspaceState 时走
 *    detection.workspaceContext 的路径查找(Phase 9 SSoT 收尾前留下的 fallback)。
 */

import * as vscode from 'vscode';
import { t } from '@i18n';
import { pickProject, pickEngine } from '@ui/quickPicks';
import type { DetectionHandles, ProjectInfo, EngineInstall } from '@detection';
import type { WorkspaceState } from '@core/workspace';

export interface ResolveOpts {
  detection: DetectionHandles;
  workspace?: WorkspaceState;
  pickProjectFn?: typeof pickProject;
  pickEngineFn?: typeof pickEngine;
  warningKey?: string;
  autoPickSingle?: boolean;
  silent?: boolean;
}

/** legacy fallback:从 detection.workspaceContext 读 selection 缓存 */
function legacyFindProject(detection: DetectionHandles, projects: readonly ProjectInfo[]): ProjectInfo | undefined {
  const sp = detection.workspaceContext.getSelectedProject();
  return sp ? projects.find((p) => p.path === sp) : undefined;
}

function legacyFindEngine(detection: DetectionHandles, engines: readonly EngineInstall[]): EngineInstall | undefined {
  const se = detection.workspaceContext.getSelectedEngine();
  return se ? engines.find((e) => e.path === se) : undefined;
}

/** 解析项目选择:resolve → 单项目 auto-pick → picker → showWarning+undefined */
export async function resolveProjectOrPick(opts: ResolveOpts): Promise<ProjectInfo | undefined> {
  const silent = opts.silent ?? false;
  const { projects } = await opts.detection.ready;
  let project = opts.workspace?.resolveSelectedProject(projects) ?? legacyFindProject(opts.detection, projects);
  if (!project && projects.length === 1 && !silent) {
    project = projects[0];
  }
  if (!project && !silent) {
    project = await (opts.pickProjectFn ?? pickProject)(projects);
  }
  if (!project) {
    void vscode.window.showWarningMessage(t(opts.warningKey ?? 'cmd.noUprojectSelected'));
    return undefined;
  }
  return project;
}

/** 同 resolveProjectOrPick 引擎版 */
export async function resolveEngineOrPick(opts: ResolveOpts): Promise<EngineInstall | undefined> {
  const silent = opts.silent ?? false;
  const engines = await opts.detection.discovery.discover();
  let engine = opts.workspace?.resolveSelectedEngine(engines) ?? legacyFindEngine(opts.detection, engines);
  if (!engine && engines.length === 1 && !silent) {
    engine = engines[0];
  }
  if (!engine && !silent) {
    engine = await (opts.pickEngineFn ?? pickEngine)(engines);
  }
  if (!engine) {
    void vscode.window.showWarningMessage(t(opts.warningKey ?? 'cmd.noUnrealEngineSelected'));
    return undefined;
  }
  return engine;
}

/** 持久化用户选择 — project / engine 哪个传 undefined 就跳过对应字段 */
export async function persistSelection(
  workspace: WorkspaceState | undefined,
  detection: DetectionHandles,
  project: ProjectInfo | undefined,
  engine: EngineInstall | undefined,
): Promise<void> {
  if (project !== undefined) {
    if (workspace) {
      await workspace.setSelectedProject(project);
    } else {
      await detection.workspaceContext.setProject(project);
    }
  }
  if (engine !== undefined) {
    if (workspace) {
      await workspace.setSelectedEngine(engine);
    } else {
      await detection.workspaceContext.setEngine(engine);
    }
  }
}