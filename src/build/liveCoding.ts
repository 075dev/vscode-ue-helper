/**
 * liveCoding —— 触发 UE Live Coding 热重载
 *
 * 两种方式:
 *   1. 命令行: UnrealEditor-Cmd.exe -ExecCmds="LiveCoding.Compile"
 *      要求 Editor 已在跑
 *   2. UBT 方式: 用 -LiveCoding 标记重跑 UBT(UE 5.x)
 *
 * 仅 Windows + MSVC 支持。其他平台命令为 no-op + warn。
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
  if (process.platform !== 'win32') {
    throw new Error(
      'Live Coding is currently Windows-only. ' + 'On Mac/Linux, use Build → Rebuild instead.',
    );
  }

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
 * Check whether Live Coding is available for the given platform.
 * Pure function — used by command registration (`when: isWindows`) and UI.
 */
export function isLiveCodingSupported(platform: BuildPlatform): boolean {
  return process.platform === 'win32' && platform === 'Win64';
}
