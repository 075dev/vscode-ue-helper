/**
 * taskProvider 测试 —— [D9] TaskProvider 接线真实 UBT 命令
 *
 * ## 背景
 *
 * 旧实现的每个 task 都解析成:
 *
 *   cmd.exe /c echo "UE Helper ... wired in Phase 4"
 *
 * 终端只打印一行就结束 —— 一秒都不编译,也不报错。而 README 承诺的是
 * "Build / Rebuild / Clean via UnrealBuildTool (Ctrl+Shift+B via TaskProvider)",
 * 承诺与实现不符,用户按 Ctrl+Shift+B 会以为构建已经开始。
 *
 * 新实现注入 `WorkspaceState`,同步取 projectFile / engineRoot,用
 * `resolveUBTPath` + `resolveUBTTarget` + `buildUBTCommand` 构造真实 UBT 命令;
 * 工作区未就绪时返回空任务列表,不提供误导性的占位任务。
 *
 * 覆盖:
 *   - 工作区未就绪 → 空任务列表(而不是 placeholder)
 *   - build / rebuild / clean 三种模式的 UBT 参数
 *   - .bat 走 cmd.exe /d /s /c + **环境变量传整条命令**(Windows 不能直接 spawn .bat;
 *     且 cmd.exe /c 的引号规则与 Node 参数转义冲突 —— 见下)
 *   - cwd = 项目目录
 *   - 不再出现 placeholder echo
 *
 * [MAJOR-1] 为什么命令走环境变量:
 *   VS Code 的 ProcessExecution 走非 shell 分支,args 原样交给进程,
 *   `windowsVerbatimArguments` 为 false → Node/libuv 会给含空格/引号的参数加引号、
 *   把内部 `"` 转义成 `\"`;而 cmd.exe /c 只在「引号总数恰好两个」时整对保留引号。
 *   引擎路径与项目路径都含空格 → 两个含空格参数 → cmd 剥掉首尾引号 → 路径被截断。
 *   实测(六种形态)只有「整条命令进环境变量」与「临时 .bat 包装」能跑通。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  class ProcessExecution {
    constructor(
      public readonly process: string,
      public readonly args: string[],
      public readonly options?: { cwd?: string; env?: Record<string, string> },
    ) {}
  }
  class Task {
    group?: unknown;
    presentationOptions?: unknown;
    constructor(
      public readonly definition: Record<string, unknown>,
      public readonly scope: unknown,
      public readonly name: string,
      public readonly source: string,
      public readonly execution: ProcessExecution,
      public readonly problemMatchers?: string | string[],
    ) {}
  }
  return {
    Task,
    ProcessExecution,
    TaskScope: { Workspace: 1, Global: 2 },
    TaskGroup: { Build: 'build', Rebuild: 'rebuild' },
    TaskRevealKind: { Always: 1, Never: 0, Silent: 2 },
    tasks: {
      registerTaskProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
  };
});

import * as path from 'node:path';
import type { Task } from 'vscode';
import { UBTTaskProvider, UBT_COMMAND_ENV_VAR } from '@build/taskProvider';
import type { WorkspaceState } from '@core/workspace';
import type { Config } from '@core/config';

const ENGINE_ROOT = 'E:\\UE_5.3';
const PROJECT_FILE = 'D:\\MyGame\\MyGame.uproject';

function makeWorkspace(overrides?: {
  projectFile?: string | null;
  engineRoot?: string | null;
}): WorkspaceState {
  return {
    projectFile: overrides?.projectFile === undefined ? PROJECT_FILE : overrides.projectFile,
    engineRoot: overrides?.engineRoot === undefined ? ENGINE_ROOT : overrides.engineRoot,
  } as unknown as WorkspaceState;
}

function makeConfig(overrides?: {
  target?: string;
  platform?: string;
  configuration?: string;
}): Config {
  return {
    target: overrides?.target ?? 'Editor',
    platform: overrides?.platform ?? 'Win64',
    configuration: overrides?.configuration ?? 'Development',
  } as unknown as Config;
}

/** 取出一条 task 的执行参数（provider 只会产出 ProcessExecution） */
function exec(task: Task) {
  const e = task.execution as {
    process: string;
    args: string[];
    options?: { cwd?: string; env?: Record<string, string> };
  };
  return {
    process: e.process,
    args: e.args,
    cwd: e.options?.cwd,
    env: e.options?.env,
  };
}

/** provideTasks 的返回类型是 ProviderResult，这里断言它一定是同步数组 */
function provideTasks(p: UBTTaskProvider): Task[] {
  return p.provideTasks() as Task[];
}

/**
 * [MAJOR-1] 完整 UBT 命令现在放在环境变量里 —— 命令行上只留 `%VAR%` 引用。
 * 这里取出环境变量中的命令串。
 */
function innerCommand(task: Task): string {
  const e = task.execution as { options?: { env?: Record<string, string> } };
  return e.options?.env?.[UBT_COMMAND_ENV_VAR] ?? '';
}

describe('UBTTaskProvider —— [D9] 接线真实 UBT 命令', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('工作区未就绪', () => {
    it('没有项目文件 → 不提供任何任务', () => {
      const provider = new UBTTaskProvider(
        makeWorkspace({ projectFile: null }),
        makeConfig(),
      );
      expect(provideTasks(provider)).toEqual([]);
    });

    it('没有引擎根目录 → 不提供任何任务', () => {
      const provider = new UBTTaskProvider(makeWorkspace({ engineRoot: null }), makeConfig());
      expect(provideTasks(provider)).toEqual([]);
    });

    it('未注入 WorkspaceState → 不提供任何任务', () => {
      const provider = new UBTTaskProvider(undefined, makeConfig());
      expect(provideTasks(provider)).toEqual([]);
    });
  });

  describe('provideTasks', () => {
    it('提供 build / rebuild / clean 三个任务', () => {
      const provider = new UBTTaskProvider(makeWorkspace(), makeConfig());
      const tasks = provideTasks(provider);
      expect(tasks).toHaveLength(3);
      expect(tasks.map((t) => t.name)).toEqual(['build', 'rebuild', 'clean']);
    });

    it('不再出现 placeholder echo 命令', () => {
      const provider = new UBTTaskProvider(makeWorkspace(), makeConfig());
      for (const task of provideTasks(provider)) {
        const joined = exec(task).args.join(' ');
        expect(joined).not.toContain('echo');
        expect(joined).not.toContain('wired in Phase 4');
      }
    });

    it('build 任务指向 Build.bat,并带真实 UBT 参数', () => {
      const provider = new UBTTaskProvider(makeWorkspace(), makeConfig());
      const tasks = provideTasks(provider);
      const build = tasks.find((t) => t.name === 'build');
      expect(build).toBeDefined();

      const cmd = innerCommand(build!);
      expect(cmd).toContain('Build.bat');
      expect(cmd).toContain('MyGameEditor');
      expect(cmd).toContain('Win64');
      expect(cmd).toContain('Development');
      expect(cmd).toContain('-Project="D:\\MyGame\\MyGame.uproject"');
      expect(cmd).toContain('-waitmutex');
    });

    it('rebuild 追加 -Rebuild', () => {
      const provider = new UBTTaskProvider(makeWorkspace(), makeConfig());
      const rebuild = provideTasks(provider).find((t) => t.name === 'rebuild');
      expect(innerCommand(rebuild!)).toContain('-Rebuild');
    });

    it('clean 追加 -Clean', () => {
      const provider = new UBTTaskProvider(makeWorkspace(), makeConfig());
      const clean = provideTasks(provider).find((t) => t.name === 'clean');
      expect(innerCommand(clean!)).toContain('-Clean');
    });

    it('target=Game 时 target 名不带 Editor 后缀', () => {
      const provider = new UBTTaskProvider(makeWorkspace(), makeConfig({ target: 'Game' }));
      const cmd = innerCommand(provideTasks(provider).find((t) => t.name === 'build')!);
      expect(cmd).toContain('MyGame');
      expect(cmd).not.toContain('MyGameEditor');
    });

    it('cwd = 项目目录', () => {
      const provider = new UBTTaskProvider(makeWorkspace(), makeConfig());
      const build = provideTasks(provider).find((t) => t.name === 'build');
      expect(exec(build!).cwd).toBe(path.dirname(PROJECT_FILE));
    });

    it('使用声明过的 problemMatcher(MSVC 错误解析交给 VS Code)', () => {
      const provider = new UBTTaskProvider(makeWorkspace(), makeConfig());
      const build = provideTasks(provider).find((t) => t.name === 'build');
      expect(build!.problemMatchers).toBe('ue-helper-msvc');
    });
  });

  describe('Windows .bat 执行形态', () => {
    it('走 cmd.exe /d /s /c,命令行只留环境变量引用', () => {
      const provider = new UBTTaskProvider(makeWorkspace(), makeConfig());
      const build = provideTasks(provider).find((t) => t.name === 'build');
      const e = exec(build!);

      expect(e.process).toBe('cmd.exe');
      expect(e.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
      // [MAJOR-1] 命令行上只允许出现一个不含空格、不含引号的变量引用 ——
      // 这样 Node/libuv 不会对它做任何转义,cmd 展开后拿到的就是标准形态。
      expect(e.args[3]).toBe(`%${UBT_COMMAND_ENV_VAR}%`);
      expect(e.args[3]).not.toContain(' ');
      expect(e.args[3]).not.toContain('"');
    });

    it('完整命令(含引号)放在环境变量里', () => {
      const provider = new UBTTaskProvider(
        makeWorkspace({ projectFile: 'D:\\My Game\\MyGame.uproject' }),
        makeConfig(),
      );
      const build = provideTasks(provider).find((t) => t.name === 'build');
      const e = exec(build!);
      const cmd = e.env?.[UBT_COMMAND_ENV_VAR] ?? '';

      expect(cmd).toContain(`"${path.join(ENGINE_ROOT, 'Engine', 'Build', 'BatchFiles', 'Build.bat')}"`);
      expect(cmd).toContain('-Project="D:\\My Game\\MyGame.uproject"');
      expect(cmd).toContain('MyGameEditor');
      expect(cmd).toContain('-waitmutex');
    });

    it('引擎路径含空格时命令串形态不变(脚本路径独立加引号)', () => {
      const provider = new UBTTaskProvider(
        makeWorkspace({
          projectFile: 'D:\\My Game\\MyGame.uproject',
          engineRoot: 'C:\\Program Files\\Epic Games\\UE_5.4',
        }),
        makeConfig(),
      );
      const build = provideTasks(provider).find((t) => t.name === 'build');
      const cmd = innerCommand(build!);

      expect(cmd).toContain(
        '"C:\\Program Files\\Epic Games\\UE_5.4\\Engine\\Build\\BatchFiles\\Build.bat"',
      );
      expect(cmd).toContain('-Project="D:\\My Game\\MyGame.uproject"');
    });

    it('含空格的路径必须紧跟引号(否则 cmd /c 会在空格处截断)', () => {
      const provider = new UBTTaskProvider(
        makeWorkspace({
          projectFile: 'D:\\My Game\\MyGame.uproject',
          engineRoot: 'C:\\Program Files\\Epic Games\\UE_5.4',
        }),
        makeConfig(),
      );
      const build = provideTasks(provider).find((t) => t.name === 'build');
      const cmd = innerCommand(build!);

      // 路径前必须是引号,而不是空白 —— 否则 cmd.exe /c 按空格切词
      expect(cmd).not.toMatch(/(^|\s)C:\\Program Files/);
      expect(cmd).not.toMatch(/(^|\s)D:\\My Game/);
      expect(cmd).toContain('"C:\\Program Files\\Epic Games\\UE_5.4\\');
      expect(cmd).toContain('-Project="D:\\My Game\\MyGame.uproject"');
    });
  });

  describe('resolveTask', () => {
    it('按 definition.taskKind 解析出对应模式', () => {
      const provider = new UBTTaskProvider(makeWorkspace(), makeConfig());
      const resolved = provider.resolveTask({
        name: 'whatever',
        definition: { type: 'ue', taskKind: 'clean' },
      } as never);

      expect(resolved).toBeDefined();
      expect(innerCommand(resolved!)).toContain('-Clean');
    });

    it('未知 taskKind → undefined', () => {
      const provider = new UBTTaskProvider(makeWorkspace(), makeConfig());
      const resolved = provider.resolveTask({
        name: 'whatever',
        definition: { type: 'ue', taskKind: 'nonsense' },
      } as never);
      expect(resolved).toBeUndefined();
    });

    it('[MAJOR-1 附带修正] rebuild / clean 保留各自的展示名与分组', () => {
      const provider = new UBTTaskProvider(makeWorkspace(), makeConfig());
      const rebuild = provider.resolveTask({
        name: 'whatever',
        definition: { type: 'ue', taskKind: 'rebuild' },
      } as never);
      expect(rebuild!.definition['label']).toBe('Clean and rebuild UE project');
      expect(rebuild!.group).toBe('rebuild');

      const clean = provider.resolveTask({
        name: 'whatever',
        definition: { type: 'ue', taskKind: 'clean' },
      } as never);
      expect(clean!.definition['label']).toBe('Clean UE project intermediates');
    });

    it('工作区未就绪 → undefined(不返回占位任务)', () => {
      const provider = new UBTTaskProvider(makeWorkspace({ projectFile: null }), makeConfig());
      const resolved = provider.resolveTask({
        name: 'vscodeUEHelper.build',
        definition: { type: 'ue', taskKind: 'build' },
      } as never);
      expect(resolved).toBeUndefined();
    });
  });
});
