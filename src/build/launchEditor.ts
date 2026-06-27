/**
 * launchEditor —— 启动 Unreal Editor
 *
 * 跨平台启动:
 *   - Windows: cmd /c start "" editor.exe projectPath
 *   - Mac:     open -a <app> --args projectPath
 *   - Linux:   直接 spawn editor 二进制
 *
 * 进程 detached —— 我们不等 Editor 退出,用户看到 Editor 窗口弹出后继续在 VS Code 工作。
 */

import { spawn } from 'node:child_process';
import { resolveEditorPath } from './ubt';
import { BuildPlatform } from '@core/config';

export interface LaunchOptions {
  /** Absolute path to engine root. */
  engineRoot: string;
  /** Target platform — affects which editor binary to launch. */
  platform: BuildPlatform;
  /** Absolute path to .uproject — passed to the editor so it opens the right project. */
  projectPath: string;
  /** Optional extra args (e.g., `-game`, `-map=/Game/Maps/Test`). */
  extraArgs?: string[];
}

export async function launchEditor(opts: LaunchOptions): Promise<void> {
  const editorPath = resolveEditorPath(opts.engineRoot, opts.platform);
  const args = [opts.projectPath, ...(opts.extraArgs ?? [])];

  // Detach so killing our extension doesn't kill the editor.
  const detached = true;
  const stdio: ('ignore' | 'inherit')[] = ['ignore', 'ignore', 'ignore'];

  if (process.platform === 'win32') {
    // Windows: use `cmd /c start "" "<editor>" "<project>"` so it runs detached.
    spawn('cmd', ['/c', 'start', '""', editorPath, ...args], {
      detached,
      stdio: 'ignore',
      windowsHide: false,
    });
  } else if (process.platform === 'darwin') {
    // Mac: use `open -a "<app>" --args <project> <extra>`
    spawn('open', ['-a', editorPath, '--args', ...args], {
      detached,
      stdio,
    });
  } else {
    // Linux: invoke the binary directly.
    spawn(editorPath, args, {
      detached,
      stdio,
    });
  }

  // Give the OS a moment to spawn before resolving.
  await new Promise((resolve) => setTimeout(resolve, 500));
}
