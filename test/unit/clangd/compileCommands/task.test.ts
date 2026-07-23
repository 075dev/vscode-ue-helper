/**
 * task.test.ts —— UBT 参数构造 + Shell quoting 纯函数单测
 *
 * TDD: task 子模块拆出后立即补测试，验证拆分不破坏既有行为契约。
 *
 * 覆盖范围（纯函数，无 vscode.tasks 依赖）：
 *   - getShellQuoting: Windows Strong 引用 + Unix Weak 引用 + Mac 行为
 *   - buildNativeArgs: 返回 5 个固定参数（-projectfiles 路径）
 *   - buildNonNativeArgs: 完整参数序列（含 -NoExecCodeGenActions）
 *   - buildNonNativeArgs: Source 缺 Target.cs 抛错
 *   - buildNonNativeArgs: architecture / buildType / platform 可选字段传递
 *
 * 显式跳过（依赖 vscode.tasks 或 child_process，有现成集成测试覆盖）：
 *   - executeShellTask
 *   - findClangToolchain
 *   - isClangdAvailable
 *
 * Mock 策略：用 vi.mock 替换 ueHelpers.getBuildTargetNames（避免 fs 扫描），
 * 保留该模块其它常量（如 getUnrealPlatform）的真实行为。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 在 import 之前 mock: ueHelpers.getBuildTargetNames 改为可控 vi.fn
vi.mock('@clangd/ueHelpers', async () => {
  const actual = await vi.importActual<typeof import('@clangd/ueHelpers')>('@clangd/ueHelpers');
  return {
    ...actual,
    getBuildTargetNames: vi.fn(),
  };
});

import {
  getShellQuoting,
  buildNativeArgs,
  buildNonNativeArgs,
  type BuildArgsOptions,
} from '@clangd/compileCommands/task';
import { getBuildTargetNames } from '@clangd/ueHelpers';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getShellQuoting (Shell quoting 规则)', () => {
  it('Windows: command 用 Strong 引用，所有 args 也用 Strong', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    try {
      const result = getShellQuoting('cmd.exe', ['arg with space', 'simple']);
      expect(result.command).toEqual({ value: 'cmd.exe', quoting: 'strong' });
      expect(result.args).toEqual([
        { value: 'arg with space', quoting: 'strong' },
        { value: 'simple', quoting: 'strong' },
      ]);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  // 注：原"Unix (Linux/Mac) Weak 引用"两条 case 已删除——本插件仅支持 Windows，
  //      getShellQuoting 永远走 Strong 引用路径。N2 死代码清理后失去意义。
});

describe('buildNativeArgs (Native -projectfiles 路径)', () => {
  it('返回固定 5 个参数', () => {
    const args = buildNativeArgs({ project: '/proj/MyProj.uproject' });
    expect(args).toEqual([
      '-projectfiles',
      '-project=/proj/MyProj.uproject',
      '-game',
      '-engine',
      '-dotnet',
    ]);
  });

  it('project 路径含空格原样保留（引号由调用方负责）', () => {
    const args = buildNativeArgs({ project: '/My Project/MyProj.uproject' });
    expect(args).toContain('-project=/My Project/MyProj.uproject');
  });
});

describe('buildNonNativeArgs (GenerateClangDatabase 路径)', () => {
  it('完整构造: target + platform + buildType + project + -Mode=GenerateClangDatabase + -NoExecCodeGenActions', async () => {
    vi.mocked(getBuildTargetNames).mockResolvedValue(['MyProjEditor']);
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    try {
      const args = await buildNonNativeArgs({
        project: 'C:/proj/MyProj.uproject',
        engineRoot: 'C:/UE',
      });

      expect(args).toEqual([
        'MyProjEditor',
        'Win64', // getUnrealPlatform('win32') = 'Win64'
        'Development',
        'C:/proj/MyProj.uproject',
        '-Mode=GenerateClangDatabase',
        '-NoExecCodeGenActions',
      ]);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('Source 缺 Target.cs 时抛明确错误', async () => {
    vi.mocked(getBuildTargetNames).mockResolvedValue([]);

    await expect(
      buildNonNativeArgs({
        project: 'C:/proj/MyProj.uproject',
        engineRoot: 'C:/UE',
      }),
    ).rejects.toThrow(/No \*\.Target\.cs files found/);
  });

  it('architecture 提供时附加 -architecture=<arch> (位置: 在 -Mode=GenerateClangDatabase 之后，在 -NoExecCodeGenActions 之前)', async () => {
    vi.mocked(getBuildTargetNames).mockResolvedValue(['T']);
    const args = await buildNonNativeArgs({
      project: 'C:/proj/MyProj.uproject',
      engineRoot: 'C:/UE',
      architecture: 'arm64',
    });

    expect(args).toContain('-architecture=arm64');
    const archIdx = args.indexOf('-architecture=arm64');
    const modeIdx = args.indexOf('-Mode=GenerateClangDatabase');
    const noExecIdx = args.indexOf('-NoExecCodeGenActions');
    // 原代码顺序为: target / platform / buildType / project / -Mode=... / -architecture=... / -NoExecCodeGenActions
    expect(modeIdx).toBeLessThan(archIdx);
    expect(archIdx).toBeLessThan(noExecIdx);
  });

  it('buildType 自定义能正确传递（联动 config.configuration）', async () => {
    vi.mocked(getBuildTargetNames).mockResolvedValue(['T']);
    const args = await buildNonNativeArgs({
      project: '/x/y.uproject',
      engineRoot: '/UE',
      buildType: 'DebugGame',
    });
    expect(args).toContain('DebugGame');
  });

  it('platform 自定义优先于 process.platform 检测', async () => {
    vi.mocked(getBuildTargetNames).mockResolvedValue(['T']);
    const args = await buildNonNativeArgs({
      project: '/x/y.uproject',
      engineRoot: '/UE',
      platform: 'Linux',
    });
    expect(args).toContain('Linux');
  });

  it('architecture 缺省时不附加 -architecture= 标志', async () => {
    vi.mocked(getBuildTargetNames).mockResolvedValue(['T']);
    const args = await buildNonNativeArgs({
      project: '/x/y.uproject',
      engineRoot: '/UE',
    });
    expect(args.find((a) => a.startsWith('-architecture='))).toBeUndefined();
  });
});

// 类型契约冒烟测试: 确保 BuildArgsOptions 接口包含全部可选字段
describe('BuildArgsOptions (类型契约)', () => {
  it('所有字段都可独立省略', () => {
    const opts: BuildArgsOptions = { project: '/x/y.uproject', engineRoot: '/UE' };
    expect(opts.architecture).toBeUndefined();
    expect(opts.platform).toBeUndefined();
    expect(opts.buildType).toBeUndefined();
    expect(opts.workspace).toBeUndefined();
  });
});
