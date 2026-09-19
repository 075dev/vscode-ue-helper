/**
 * liveCoding —— 触发 UE Live Coding 热重载(Windows-only)
 *
 * UBT -LiveCoding 方式:连接正在运行的编辑器实例的 Live Coding server,
 * 编译变更模块后由编辑器热补丁 —— 等价于编辑器内 Live Coding 按钮。
 *   - 编辑器在跑:直接热重载,不弹任何新窗口
 *   - 编辑器没跑:UBT 回退为普通构建(无害)
 *
 * bugfix-001:旧实现 spawn 不带 -Project 的全新 UnrealEditor.exe
 * -ExecCmds 实例,UE 会打开项目管理器("打开一个新的项目"),
 * 且热重载发生在新实例而非用户正在使用的编辑器上。
 *
 * Build.bat 必须经 runBuild 执行(cmd.exe /c 包装,见 buildRunner F1-1),
 * 并等待 UBT 退出以向用户反馈编译成败。
 */

import { resolveLiveCodingCmd, resolveUBTPath, resolveUBTTarget } from './ubt';
import { runBuild, type BuildResult_ } from './buildRunner';
import { type BuildConfiguration, type BuildPlatform, type BuildTarget } from '@core/config';
import { type BuildOptions } from './types';

export interface LiveCodingOptions {
  engineRoot: string;
  platform: BuildPlatform;
  projectPath: string;
  /** UBT 配置,需与正在运行的编辑器一致(如 Development) */
  configuration: BuildConfiguration;
  /** 抽象 target 类型;生产路径由调用方显式传入(用户选的构建目标,默认 Editor) */
  targetType?: BuildTarget;
}

export async function triggerLiveCoding(
  opts: LiveCodingOptions,
  buildOptions: BuildOptions = {},
): Promise<BuildResult_> {
  const cmd = resolveLiveCodingCmd({
    project: opts.projectPath,
    target: resolveUBTTarget(opts.projectPath, opts.targetType ?? 'Editor'),
    platform: opts.platform,
    configuration: opts.configuration,
    ubtPath: resolveUBTPath(opts.engineRoot),
  });
  return runBuild(cmd, buildOptions);
}

/**
 * Live Coding 始终可用(Windows-only 插件,UE 5.2+ MSVC 全版本支持)。
 * 保留函数供外部条件渲染(when clause)使用。
 */
export function isLiveCodingSupported(_platform: BuildPlatform): boolean {
  return true;
}
