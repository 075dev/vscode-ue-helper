/**
 * launchEditor —— 启动 Unreal Editor（Windows-only）
 *
 * Windows: 直接 spawn UnrealEditor.exe projectPath
 *
 * 进程 detached —— 我们不等 Editor 退出,用户看到 Editor 窗口弹出后继续在 VS Code 工作。
 *
 * [F2-12] Editor 由用户管理生命周期,不接入 SubprocessRegistry:插件 deactivate 不应杀掉
 * 用户手动启动的编辑器。detached + stdio ignore + unref 让 Editor 完全独立于扩展进程存活。
 *
 * [D13] 不再经 `cmd /c start` 启动。
 *   旧写法 `spawn('cmd', ['/c','start','""', editorPath, ...args])` 的问题:Node 只对
 *   **含空格**的参数加引号,其余原样交给 cmd.exe 解析 —— 路径里的 `&` `|` `^` `%`
 *   会被 cmd 当元字符拆词。实测 `D:\R&D\My.uproject` 被截断成 `D:\R`(exit 1),
 *   而含空格的 `D:\R&D Folder\...` 反而安全。
 *   现在直接 spawn .exe(不经 shell),含空格与含元字符的路径都能正确传递。
 *   附带收益:少一层 cmd.exe 进程,且 spawn 失败能通过 'error' 事件被捕获
 *   (旧写法 fire-and-forget,失败被静默吞掉,用户只看到"launched"成功提示)。
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

/** 给 OS 拉起进程的时间窗(ms)。窗口内发生 'error' 则视为启动失败。 */
const SPAWN_SETTLE_MS = 500;

export async function launchEditor(opts: LaunchOptions): Promise<void> {
  const editorPath = resolveEditorPath(opts.engineRoot, opts.platform);
  const args = [opts.projectPath, ...(opts.extraArgs ?? [])];

  return new Promise<void>((resolve, reject) => {
    // Detach so killing our extension doesn't kill the editor.
    const detached = true;

    // [D13] 直接 spawn .exe,不经 cmd.exe —— 路径中的 & | ^ % 不会被 shell 拆词。
    const child = spawn(editorPath, args, {
      detached,
      stdio: 'ignore',
      windowsHide: false,
    });
    // [F2-12] 不接入 SubprocessRegistry:Editor 生命周期归用户,deactivate 不应杀。
    // unref() 让 Node 不因该子进程句柄而挂住事件循环,配合 detached 保持完全独立。
    child.unref();

    let settled = false;
    // spawn 失败(路径不存在 / 权限不足)是异步 'error' 事件,不是同步 throw。
    // 旧实现没有监听 → 失败被静默吞掉,用户看到的是"启动成功"提示。
    child.once('error', (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    });

    // Give the OS a moment to spawn before resolving.
    setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    }, SPAWN_SETTLE_MS);
  });
}
