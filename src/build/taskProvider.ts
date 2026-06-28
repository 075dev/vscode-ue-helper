/**
 * taskProvider —— 把 UBT 构建注册成 VS Code Task
 *
 * 这样用户能通过 Ctrl+Shift+B 直接绑定构建任务。
 *
 * 模式参考 engine-link taskProvider.ts。暴露 3 种 task:
 *   - build    (默认, Ctrl+Shift+B)
 *   - rebuild
 *   - clean
 *
 * 当前是 placeholder 实现 —— 每个 task 解析成一个 echo 命令占位。
 * 真实命令实现在 commands/build.ts 里,通过 executeBuild() 调用。
 */

import * as vscode from 'vscode';
import { Config } from '@core/config';
import { UprojectScanner, EngineDiscovery } from '@detection';
import { buildUBTCommand, resolveUBTPath } from './ubt';
import { BuildTarget, BuildPlatform, BuildConfiguration } from '@core/config';

export class UBTTaskProvider implements vscode.TaskProvider {
  constructor(
    scanner: UprojectScanner,
    discovery: EngineDiscovery,
    private readonly config: Config,
  ) {
    // Suppress unused-parameter warnings — these are stashed for Phase 4
    // when commands/build.ts will dispatch actual UBT calls.
    void scanner;
    void discovery;
  }

  provideTasks(): vscode.ProviderResult<vscode.Task[]> {
    const tasks: vscode.Task[] = [];
    const kinds: Array<{ name: string; detail: string; group?: vscode.TaskGroup }> = [
      { name: 'build', detail: 'Compile UE project', group: vscode.TaskGroup.Build },
      { name: 'rebuild', detail: 'Clean and rebuild UE project', group: vscode.TaskGroup.Rebuild },
      { name: 'clean', detail: 'Clean UE project intermediates' },
    ];
    for (const k of kinds) {
      tasks.push(this.makeTask(k.name, k.detail, k.group));
    }
    return tasks;
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    if (task.name === 'vscodeUEHelper.build' || task.definition.taskKind === 'build') {
      return this.makeTask('build', 'Compile UE project', vscode.TaskGroup.Build);
    }
    return undefined;
  }

  private makeTask(name: string, detail: string, group?: vscode.TaskGroup): vscode.Task {
    const definition: vscode.TaskDefinition = {
      type: 'ue',
      taskKind: name,
      label: detail,
    };
    // Build a placeholder UBT command line. The real execution happens
    // through commands/build.ts (Phase 4) — here we just construct a
    // valid command that VS Code can run via ProcessExecution.
    const cmd = this.placeholderCommand();
    const task = new vscode.Task(
      definition,
      vscode.TaskScope.Workspace,
      name,
      'UE Helper',
      new vscode.ProcessExecution(cmd.file, cmd.args, {
        cwd: cmd.cwd,
      }),
      'ue-helper-msvc',
    );
    if (group) {task.group = group;}
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      echo: true,
      focus: false,
      clear: true,
    };
    return task;
  }

  /**
   * Build a placeholder command — Phase 4 will replace this with the
   * real UBT invocation. For now we just `echo` so VS Code has something
   * to run when the user invokes the task.
   */
  private placeholderCommand(): { file: string; args: string[]; cwd?: string } {
    if (process.platform === 'win32') {
      return {
        file: 'cmd.exe',
        args: ['/c', 'echo', `UE Helper ${this.config.configuration} task — wired in Phase 4`],
      };
    }
    return {
      file: 'echo',
      args: [`UE Helper ${this.config.configuration} task — wired in Phase 4`],
    };
  }
}

// Eager construction helper — used by @build/index.ts and Phase 4 commands.
export function buildTaskArgs(opts: {
  project: string;
  engine: string;
  target: BuildTarget;
  platform: BuildPlatform;
  configuration: BuildConfiguration;
}) {
  const ubtPath = resolveUBTPath(opts.engine);
  return buildUBTCommand({
    project: opts.project,
    target: opts.target,
    platform: opts.platform,
    configuration: opts.configuration,
    ubtPath,
  });
}
