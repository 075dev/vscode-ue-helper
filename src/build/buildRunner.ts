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
 *   6. [deactivate 清理] 子进程自动注册到 SubprocessRegistry,插件关闭时由
 *      sharedSubprocessRegistry 统一杀进程树(兜底;AbortSignal 是主路径)
 */

import { spawn, ChildProcessWithoutNullStreams, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MsvcParser } from '@parsers/msvcParser';
import { UbtParser } from '@parsers/ubtParser';
import {
  sharedSubprocessRegistry,
  type SubprocessRegistry,
} from '@core/subprocessRegistry';
import { BuildOptions, BuildResult } from './types';
import type { ParsedDiagnostic } from '@core/types/diagnostic';

const execFileAsync = promisify(execFile);

/**
 * Kill a child process AND all of its descendants（Windows-only）。
 *
 * Windows: `taskkill /T /F /PID <pid>` walks the parent→child chain and
 * force-terminates each. Plain `child.kill()` only kills cmd.exe here,
 * leaving Build.bat / dotnet / UBT running.
 */
async function killTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = child.pid;
  if (!pid) {return;}
  try {
    await execFileAsync('taskkill', ['/F', '/T', '/PID', String(pid)]);
  } catch {
    /* best-effort */
  }
}

export type BuildResult_ = { ok: true; value: BuildResult } | { ok: false; error: Error };

export async function runBuild(
  cmd: { file: string; args: string[]; cwd?: string },
  options: BuildOptions = {},
  /**
   * 内部测试钩子:替换 SubprocessRegistry 注入,便于 fake child 单元测试。
   * 生产代码不传 —— 默认用 `sharedSubprocessRegistry` 全局单例。
   */
  registry: SubprocessRegistry = sharedSubprocessRegistry,
): Promise<BuildResult_> {
  const start = Date.now();
  const allOutput: string[] = [];
  const diagnostics: ParsedDiagnostic[] = [];
  const msvc = new MsvcParser();
  const ubt = new UbtParser();

  return new Promise<BuildResult_>((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      // Windows: .bat / .cmd files cannot be spawned directly — Node returns
      // EINVAL. Wrap with cmd.exe /c so the shell resolves the script.
      const isShellScript = cmd.file.endsWith('.bat') || cmd.file.endsWith('.cmd');
      const file = isShellScript ? 'cmd.exe' : cmd.file;
      const args = isShellScript ? ['/c', cmd.file, ...cmd.args] : cmd.args;
      child = spawn(file, args, {
        cwd: cmd.cwd,
        env: { ...process.env, ...(options.signal ? {} : {}) },
        windowsHide: true,
      });
      // [deactivate 子进程清理] 注册到 SubprocessRegistry,插件关闭时
      // 由 sharedSubprocessRegistry 兜底杀进程(防止 AbortSignal 没传时漏杀)
      registry.register(child, 'UBT build');
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
