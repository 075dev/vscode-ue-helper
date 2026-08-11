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

import { spawn, type ChildProcessWithoutNullStreams, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MsvcParser } from '@parsers/msvcParser';
import { UbtParser } from '@parsers/ubtParser';
import {
  sharedSubprocessRegistry,
  type SubprocessRegistry,
} from '@core/subprocessRegistry';
import { type BuildOptions, type BuildResult } from './types';
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
      // Windows: .bat / .cmd 文件不能直接被 spawn(Node 会抛 EINVAL),
      // 必须用 cmd.exe /c 包装,让 shell 解析脚本。
      // F1-1:cmd.exe 的 /c 对超过 2 个引号的参数会剥离首尾引号,引擎路径与
      // 项目路径同时含空格时构建必失败(报"不是内部或外部命令")。因此把整条
      // 命令拼成单个引号包裹的字符串交给 /d /s /c,并开启
      // windowsVerbatimArguments 禁止 Node 对参数二次加引号。
      const isShellScript = cmd.file.endsWith('.bat') || cmd.file.endsWith('.cmd');
      const file = isShellScript ? 'cmd.exe' : cmd.file;
      const args = isShellScript
        ? ['/d', '/s', '/c', `"${[cmd.file, ...cmd.args].join(' ')}"`]
        : cmd.args;
      child = spawn(file, args, {
        cwd: cmd.cwd,
        // env 直接透传 process.env(FIX-PLAN §8.20:原展开式是死代码)
        env: process.env,
        windowsHide: true,
        // 仅 shell 脚本需要;非 shell 路径保持 Node 默认的加引号行为
        ...(isShellScript ? { windowsVerbatimArguments: true } : {}),
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
    //
    // [F2-3 资源清理] onAbort 必须具名:进程正常结束(close)但 signal 未 abort 时,
    // 若不移除监听器,signal 会一直持有该监听器引用直到被 GC。once:true 只覆盖
    // "abort 已触发"这一条路径,close 路径必须显式 removeEventListener。
    const onAbort = (): void => {
      void killTree(child);
    };
    if (options.signal) {
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
      // [F2-3] close 后移除 abort 监听器,防止 signal 持有已结束进程的引用
      options.signal?.removeEventListener('abort', onAbort);
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
          // [F2-1] 用户取消(taskkill 杀树)后 close 到达时标记 cancelled,
          // 让命令层区分"取消"与"真实失败",取消不弹失败警告
          cancelled: options.signal?.aborted ?? false,
        },
      });
    });
  });
}
