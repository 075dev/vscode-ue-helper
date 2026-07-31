/**
 * launchEditor —— 启动 Unreal Editor（Windows-only）
 *
 * Windows: cmd /c start "" editor.exe projectPath
 *
 * 进程 detached —— 我们不等 Editor 退出,用户看到 Editor 窗口弹出后继续在 VS Code 工作。
 *
 * [deactivate 子进程清理] 子进程仍注册到 SubprocessRegistry —— 决策是"全部都杀"。
 * 实际效果:detached + `start ""` 启动的进程组,Windows taskkill /F /T 能杀掉
 * cmd.exe 包装层,但 UnrealEditor.exe 可能已独立成新进程组(取决于 UBT 启动方式),
 * best-effort 不保证。
 */

import { spawn } from 'node:child_process';
import { resolveEditorPath } from './ubt';
import { BuildPlatform } from '@core/config';
import { sharedSubprocessRegistry } from '@core/subprocessRegistry';

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
  // [deactivate 子进程清理] 注册到 registry,best-effort 杀进程树
  sharedSubprocessRegistry.register(child, 'Unreal Editor launch');

  // Give the OS a moment to spawn before resolving.
  await new Promise((resolve) => setTimeout(resolve, 500));
}
