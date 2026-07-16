/**
 * buildRunner —— 执行 UBT 构建并流式输出
 *
 * 返回 Result<BuildResult, Error> 风格的 { ok, value/error },
 * 类似 neverthrow 但避免引入该依赖。
 *
 * 关键功能:
 *   1. Windows spawn .bat 必须用 cmd.exe /c 包装(否则 EINVAL)
 *   2. 杀整个进程树(taskkill /F /T,POSIX 用 kill(-pid))
 *   3. AbortSignal 支持取消按钮(由 withProgress 桥接 CancellationToken)
 *   4. 实时解析 stdout(MSVC + UBT progress)
 *   5. 推送 diagnostics 到 Problems 面板
 */

import { spawn, ChildProcessWithoutNullStreams, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MsvcParser } from '@parsers/msvcParser';
import { UbtParser } from '@parsers/ubtParser';
import { BuildOptions, BuildResult } from './types';
import type { ParsedDiagnostic } from '@core/types/diagnostic';

const execFileAsync = promisify(execFile);

/**
 * Kill a child process AND all of its descendants.
 *
 * - Windows: `taskkill /T /F /PID <pid>` walks the parent→child chain and
 *   force-terminates each. Plain `child.kill()` only kills cmd.exe here,
 *   leaving Build.bat / dotnet / UBT running.
 * - POSIX: SIGTERM to the process group. The child is spawned with
 *   `detached: true` so it leads its own group; we kill the whole group.
 */
async function killTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = child.pid;
  if (!pid) {return;}
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/F', '/T', '/PID', String(pid)]);
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        // Process group may not exist if the child already exited.
        try {
          child.kill('SIGTERM');
        } catch {
          /* already dead */
        }
      }
    }
  } catch {
    /* best-effort */
  }
}

export type BuildResult_ = { ok: true; value: BuildResult } | { ok: false; error: Error };

export async function runBuild(
  cmd: { file: string; args: string[]; cwd?: string },
  options: BuildOptions = {},
): Promise<BuildResult_> {
  const start = Date.now();
  const allOutput: string[] = [];
  const diagnostics: ParsedDiagnostic[] = [];
  const msvc = new MsvcParser();
  const ubt = new UbtParser();

  return new Promise<BuildResult_>((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      // On Windows, .bat / .cmd files cannot be spawned directly — Node returns
      // EINVAL. Wrap with cmd.exe /c so the shell resolves the script. We also
      // do this for shell scripts on POSIX for consistency (RunUBT.sh).
      const isWin = process.platform === 'win32';
      const isShellScript = cmd.file.endsWith('.bat') || cmd.file.endsWith('.cmd');
      const file = isWin && isShellScript ? 'cmd.exe' : cmd.file;
      const args = isWin && isShellScript ? ['/c', cmd.file, ...cmd.args] : cmd.args;
      child = spawn(file, args, {
        cwd: cmd.cwd,
        env: { ...process.env, ...(options.signal ? {} : {}) },
        windowsHide: true,
        // detached:true makes the child a process-group leader on POSIX so
        // process.kill(-pid) terminates the whole tree. On Windows it's a
        // no-op for kill but doesn't hurt.
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      resolve({ ok: false, error: err as Error });
      return;
    }

    // Abort signal handling — must kill the whole process tree, not just
    // the top-level cmd.exe wrapper. On Windows we use `taskkill /T /F`
    // which walks the parent→child chain.
    if (options.signal) {
      const onAbort = (): void => {
        void killTree(child);
      };
      if (options.signal.aborted) { void onAbort(); }
      else { options.signal.addEventListener('abort', onAbort, { once: true }); }
    }

    let stdoutBuf = '';
    let stderrBuf = '';

    const flushLines = (buf: string, isStderr: boolean): string => {
      const lines = buf.split(/\r?\n/);
      const remaining = lines.pop() ?? '';
      for (const line of lines) {
        allOutput.push(line);
        options.onOutput?.(line);

        // Progress (UBT only emits on stdout).
        if (!isStderr) {
          const progress = ubt.parse(line);
          if (progress) {
            options.onProgress?.(`[${progress.current}/${progress.total}] ${progress.description}`);
          }
        }

        // Diagnostics (both streams; UBT sometimes interleaves).
        const diagChunk = msvc.parse(line + '\n');
        diagnostics.push(...diagChunk);
      }
      return remaining;
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf = flushLines(stdoutBuf + chunk.toString('utf-8'), false);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf = flushLines(stderrBuf + chunk.toString('utf-8'), true);
    });

    child.on('error', (err) => {
      resolve({ ok: false, error: err });
    });

    child.on('close', (code) => {
      // Drain remaining buffers.
      if (stdoutBuf) {
        flushLines(stdoutBuf + '\n', false);
      }
      if (stderrBuf) {
        flushLines(stderrBuf + '\n', true);
      }
      diagnostics.push(...msvc.flush());

      resolve({
        ok: true,
        value: {
          exitCode: code ?? -1,
          durationMs: Date.now() - start,
          output: allOutput,
          diagnostics,
        },
      });
    });
  });
}
