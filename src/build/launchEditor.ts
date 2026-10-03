/**
 * launchEditor —— 启动 Unreal Editor（Windows-only）
 *
 * Windows: cmd /c start "" editor.exe projectPath
 *
 * 进程 detached —— 我们不等 Editor 退出,用户看到 Editor 窗口弹出后继续在 VS Code 工作。
 *
 * [F2-12] Editor 由用户管理生命周期,不接入 SubprocessRegistry:插件 deactivate 不应杀掉
 * 用户手动启动的编辑器。detached + stdio ignore + unref 让 Editor 完全独立于扩展进程存活。
 */

import { spawn } from 'node:child_process';
import { resolveEditorPath } from './ubt';
import { type BuildPlatform } from '@core/config';

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

  // Windows: use `cmd /c start "" "<editor>" "<project>"` so it runs detached.
  const child = spawn('cmd', ['/c', 'start', '""', editorPath, ...args], {
    detached,
    stdio: 'ignore',
    windowsHide: false,
  });
  // [F2-12] 不接入 SubprocessRegistry:Editor 生命周期归用户,deactivate 不应杀。
  // unref() 让 Node 不因该子进程句柄而挂住事件循环,配合 detached 保持完全独立。
  child.unref();

  // Give the OS a moment to spawn before resolving.
  await new Promise((resolve) => setTimeout(resolve, 500));
}
