/**
 * liveCoding —— 触发 UE Live Coding 热重载（Windows-only）
 *
 * 两种方式:
 *   1. 命令行: UnrealEditor-Cmd.exe -ExecCmds="LiveCoding.Compile"
 *      要求 Editor 已在跑
 *   2. UBT 方式: 用 -LiveCoding 标记重跑 UBT(UE 5.x)
 */

import { spawn } from 'node:child_process';
import { resolveLiveCodingCmd } from './ubt';
import { BuildPlatform } from '@core/config';

export interface LiveCodingOptions {
  engineRoot: string;
  platform: BuildPlatform;
  projectPath: string;
}

export async function triggerLiveCoding(opts: LiveCodingOptions): Promise<void> {
  const cmd = resolveLiveCodingCmd(opts.engineRoot, opts.platform);
  const child = spawn(cmd.file, cmd.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  // Best-effort — Live Coding has no "completion" event we can await.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/**
 * Live Coding 始终可用（Windows-only 插件，UE 5.2+ MSVC 全版本支持）。
 * 保留函数供外部条件渲染（when clause）使用。
 */
export function isLiveCodingSupported(_platform: BuildPlatform): boolean {
  return true;
}
