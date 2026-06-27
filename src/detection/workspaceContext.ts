/**
 * workspaceContext —— 跨会话持久化用户选择的项目和引擎
 *
 * ## 目的
 *
 * 用户可能开多个 UE 项目,我们需要记住每个工作区上次选的是哪个项目/引擎。
 * 比如用户上次在 XianDreamwalking 工作区选了 XianDreamwalking 项目和 UE 5.8 引擎,
 * 下次打开同一工作区,直接恢复,不需要重新 QuickPick 选。
 *
 * ## 持久化机制
 *
 * 用 VS Code 的 Memento API(context.workspaceState),数据写到
 * .vscode/<workspace-storage>/...,跨会话保留。
 *
 * ## 用法
 *
 *   const ctx = new WorkspaceContext(context.workspaceState);
 *   await ctx.setProject(project);  // 用户选了一个新项目
 *   const selectedPath = ctx.getSelectedProject();  // 下次拿来用
 */

import * as vscode from 'vscode';
import { ProjectInfo, EngineInstall, WorkspaceSelection } from './types';

const KEY = 'vscodeUEHelper.selection';

export class WorkspaceContext {
  private current: WorkspaceSelection;

  constructor(private readonly memento: vscode.Memento) {
    this.current = memento.get<WorkspaceSelection>(KEY) ?? {};
  }

  getSelection(): WorkspaceSelection {
    return { ...this.current };
  }

  getSelectedProject(): string | undefined {
    return this.current.selectedProject;
  }

  getSelectedEngine(): string | undefined {
    return this.current.selectedEngine;
  }

  async setProject(project: ProjectInfo | undefined): Promise<void> {
    this.current = {
      ...this.current,
      selectedProject: project?.path,
    };
    await this.memento.update(KEY, this.current);
  }

  async setEngine(engine: EngineInstall | undefined): Promise<void> {
    this.current = {
      ...this.current,
      selectedEngine: engine?.path,
    };
    await this.memento.update(KEY, this.current);
  }

  async clear(): Promise<void> {
    this.current = {};
    await this.memento.update(KEY, this.current);
  }
}
