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
 * [D9] 真实 UBT 命令接线 —— 旧实现是 placeholder:
 *   每个 task 解析成 `cmd.exe /c echo "UE Helper ... wired in Phase 4"`,
 *   终端只打印一行就结束,一秒都不编译,也不报错。
 *   而 README 承诺的是 "Build / Rebuild / Clean via UnrealBuildTool
 *   (Ctrl+Shift+B via TaskProvider)" —— 承诺与实现不符。
 *
 *   当初写成 placeholder 的原因是 `provideTasks()` 是**同步**方法,拿不到
 *   `detection.ready` 的异步结果。但 `WorkspaceState` 的 getter 是同步的
 *   (注入后立即可读),所以这条路可行:注入 WorkspaceState,同步取
 *   projectFile / engineRoot。
 *
 *   工作区尚未就绪时(未检测到项目/引擎)返回空任务列表 —— 不提供
 *   误导性的占位任务。
 *
 * [D9][MAJOR-1] UBT 命令经**环境变量**传给 cmd.exe —— 为什么不用
 * 「`cmd.exe /d /s /c "<整条命令>"`」这种常见写法:
 *
 *   VS Code 的 ProcessExecution 走的是**非 shell**分支(见 VS Code 官方源码
 *   `terminalTaskSystem.ts`: "When we have a process task there is no need to
 *   quote arguments"),args 原样交给进程;此时 `windowsVerbatimArguments` 为
 *   false(Node/libuv 的 `quote_cmd_arg` 负责转义:含空格/引号的参数会被加引号、
 *   内部 `"` 被转义成 `\"`)。
 *
 *   而 cmd.exe 的 /c 引号规则是:引号总数**恰好两个**时整对保留,否则剥掉
 *   首尾引号。UE 的引擎路径(`C:\Program Files\Epic Games\UE_5.x`)与项目
 *   路径通常都含空格 → 两个含空格参数 → 引号总数 4 → cmd 剥掉首尾引号 →
 *   路径被截断,任务报 "The network path was not found."。
 *
 *   实测(见 verification.md §9.9)六种形态在 VS Code 真实转义下的结果:
 *   单串+手工引号 / 参数分离 / 参数分离去 /s —— 全部失败;只有
 *   ① 整条命令放进环境变量、命令行只留 `%VAR%` 引用 ② 临时 .bat 包装 —— 通过。
 *   本实现取前者:不留临时文件、不用清理逻辑,活动部件最少。
 *
 * MSVC 错误解析交给 VS Code 的 problemMatcher(`package.json` 已声明
 * `ue-helper-msvc`),不重复实现。
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { type Config } from '@core/config';
import type { WorkspaceState } from '@core/workspace';
import { buildUBTCommand, resolveUBTPath, resolveUBTTarget } from './ubt';
import { type BuildTarget, type BuildPlatform, type BuildConfiguration } from '@core/config';

/** task 的构建模式 */
type TaskMode = 'build' | 'rebuild' | 'clean';

/**
 * [MAJOR-1] 承载完整 UBT 命令的环境变量名。
 * 前缀 `VSCODEUEHELPER_` 避免与用户环境变量撞名。
 */
export const UBT_COMMAND_ENV_VAR = 'VSCODEUEHELPER_UBT_CMD';

/** 各构建模式的展示名与任务分组 —— provideTasks / resolveTask 共用(单一真相源) */
const TASK_KINDS: Record<TaskMode, { detail: string; group?: vscode.TaskGroup }> = {
  build: { detail: 'Compile UE project', group: vscode.TaskGroup.Build },
  rebuild: { detail: 'Clean and rebuild UE project', group: vscode.TaskGroup.Rebuild },
  clean: { detail: 'Clean UE project intermediates' },
};

export class UBTTaskProvider implements vscode.TaskProvider {
  constructor(
    /**
     * [D9] 单一真相源 —— 项目/引擎路径从这里取,不再自己拼路径。
     * 可选:未注入时 provider 不提供任何任务。
     */
    private readonly workspace: WorkspaceState | undefined,
    private readonly config: Config,
  ) {}

  provideTasks(): vscode.ProviderResult<vscode.Task[]> {
    const tasks: vscode.Task[] = [];
    for (const mode of Object.keys(TASK_KINDS) as TaskMode[]) {
      const kind = TASK_KINDS[mode];
      const task = this.makeTask(mode, kind.detail, kind.group);
      if (task) {
        tasks.push(task);
      }
    }
    return tasks;
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const mode = this.resolveMode(task);
    if (!mode) {
      return undefined;
    }
    // [MAJOR-1 附带修正] 此前这里固定用 'Compile UE project' + TaskGroup.Build,
    // 导致 rebuild / clean 任务在任务列表里被标成"编译"且归错组。
    const kind = TASK_KINDS[mode];
    return this.makeTask(mode, kind.detail, kind.group) ?? undefined;
  }

  /** 从 task 的 name / definition 解析出构建模式 */
  private resolveMode(task: vscode.Task): TaskMode | undefined {
    // TaskDefinition 的索引签名是 any —— 显式收成 unknown，避免把 any 带进返回类型
    const kind: unknown = task.definition?.['taskKind'];
    if (kind === 'build' || kind === 'rebuild' || kind === 'clean') {
      return kind;
    }
    if (task.name === 'vscodeUEHelper.build') {
      return 'build';
    }
    return undefined;
  }

  /**
   * 构造真实 UBT 命令。
   *
   * @returns null = 工作区未就绪(没检测到项目或引擎)→ 不提供任务
   */
  private buildUbtCommand(mode: TaskMode): { file: string; args: string[]; cwd: string } | null {
    const projectPath = this.workspace?.projectFile;
    const engineRoot = this.workspace?.engineRoot;
    if (!projectPath || !engineRoot) {
      return null;
    }

    const ubtPath = resolveUBTPath(engineRoot);
    const cmd = buildUBTCommand({
      project: projectPath,
      target: resolveUBTTarget(projectPath, this.config.target),
      platform: this.config.platform,
      configuration: this.config.configuration,
      ubtPath,
    });

    // rebuild / clean 的额外参数（与 commands/build.ts 保持一致）
    if (mode === 'rebuild') {
      cmd.args.push('-Rebuild');
    } else if (mode === 'clean') {
      cmd.args.push('-Clean');
    }

    return { file: cmd.file, args: cmd.args, cwd: path.dirname(projectPath) };
  }

  private makeTask(
    mode: TaskMode,
    detail: string,
    group?: vscode.TaskGroup,
  ): vscode.Task | undefined {
    const cmd = this.buildUbtCommand(mode);
    if (!cmd) {
      return undefined;
    }

    const definition: vscode.TaskDefinition = {
      type: 'ue',
      taskKind: mode,
      label: detail,
    };

    // [MAJOR-1] 见文件头注释 —— 整条命令(含引号)放进环境变量,命令行只留一个
    // 不含空格、不含引号的变量引用。这样同时避开两个坑:
    //   ① Node/libuv 的参数转义(内部 " → \",cmd.exe 不认这个转义)
    //   ② cmd.exe /c 的「引号总数恰好两个才整对保留」规则
    // 展开后 cmd 收到的正是 `"<Build.bat>" <UBT 参数...>` 标准形态。
    const isShellScript = cmd.file.endsWith('.bat') || cmd.file.endsWith('.cmd');
    const file = isShellScript ? 'cmd.exe' : cmd.file;
    const args = isShellScript ? ['/d', '/s', '/c', `%${UBT_COMMAND_ENV_VAR}%`] : cmd.args;
    const options: vscode.ProcessExecutionOptions = isShellScript
      ? {
          cwd: cmd.cwd,
          env: { [UBT_COMMAND_ENV_VAR]: [`"${cmd.file}"`, ...cmd.args].join(' ') },
        }
      : { cwd: cmd.cwd };

    const task = new vscode.Task(
      definition,
      vscode.TaskScope.Workspace,
      mode,
      'UE Helper',
      new vscode.ProcessExecution(file, args, options),
      'ue-helper-msvc',
    );
    if (group) {
      task.group = group;
    }
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      echo: true,
      focus: false,
      clear: true,
    };
    return task;
  }
}

/**
 * Eager construction helper —— 供需要直接拿到 UBT 参数的调用方使用。
 */
export function buildTaskArgs(opts: {
  project: string;
  engine: string;
  target: BuildTarget;
  platform: BuildPlatform;
  configuration: BuildConfiguration;
}): ReturnType<typeof buildUBTCommand> {
  const ubtPath = resolveUBTPath(opts.engine);
  return buildUBTCommand({
    project: opts.project,
    target: opts.target,
    platform: opts.platform,
    configuration: opts.configuration,
    ubtPath,
  });
}
