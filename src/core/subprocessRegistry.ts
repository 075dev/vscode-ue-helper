/**
 * subprocessRegistry.ts —— 全插件子进程注册表
 *
 * ## 职责
 *
 * 跟踪本插件通过 `child_process.spawn` 启动的所有子进程(UBT 编译、
 * UHT codegen、UE Editor、Live Coding、MSVC/clangd 探测等),在插件
 * deactivate(卸载 / 窗口 reload / VS Code 关闭)时优雅杀掉。
 *
 * ## 关闭流程
 *
 * 1. `dispose()` 被 VS Code 通过 `context.subscriptions` 触发
 * 2. 对每个注册的 child,Windows-only 第一刀直接 `taskkill /F /T /PID <pid>`
 *    (`/F` 本身就是强杀并带进程树,Plain `child.kill()` 只杀顶层 cmd.exe,UBT/dotnet 仍在跑)
 * 3. 3 秒后仍未退出的进程,再补一刀 `taskkill /F`(无 `/T`,直接 PID 兜底)
 * 4. 所有操作 best-effort,失败仅 warn
 *
 * ## 设计原则
 *
 * - 单一模块级单例 `sharedSubprocessRegistry`(对齐 `sharedLogger` 模式)
 * - `register(child, label)` 必须在 spawn 之后立刻调用;child 自然 exit 时自动 unregister
 * - `dispose()` 幂等(可被 context.subscriptions 多次调)
 * - Windows-only:依赖 `taskkill`(Mac/Linux 不在仓库支持范围,见 AGENTS.md)
 *
 * ## 风险
 *
 * - `dispose()` 是同步(`vscode.Disposable.dispose(): void`),我们不 await 杀进程的回调;
 *   VS Code deactivate 返回后,扩展 host 仍会存活几百毫秒到数秒(taskkill 同步等待),
 *   足够让 taskkill 完成信号投递
 * - detached + unref 的进程(UE Editor / Live Coding):taskkill 对 `start ""` 启动的
 *   进程组有效,best-effort
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';
import type { Disposable } from 'vscode';
import { type Logger, sharedLogger } from '@core/logger';

const execFileAsync = promisify(execFile);

/** SIGTERM 后升级到 SIGKILL 的等待时间(毫秒) */
const SIGKILL_DELAY_MS = 3000;

/** 杀整个进程树(Windows-only) */
async function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    return;
  }
  try {
    await execFileAsync('taskkill', ['/F', '/T', '/PID', String(pid)]);
  } catch {
    /* best-effort:进程可能已退出,taskkill 找不到 PID 报 128 视为成功 */
  }
}

/** 内部条目:子进程 + 诊断用 label */
interface RegistryEntry {
  readonly child: ChildProcess;
  readonly label: string;
}

/**
 * 子进程注册表。
 *
 * 使用方式(以 UBT 编译为例):
 *
 * ```ts
 * const child = spawn(cmd, args, { windowsHide: true });
 * sharedSubprocessRegistry.register(child, 'UBT build');
 * // 进程自然 exit 后自动 unregister,不需要手动调
 * ```
 *
 * 接入 deactivate:在 `extension.ts` activate 流程里
 * `context.subscriptions.push(sharedSubprocessRegistry)`,
 * VS Code 卸载扩展时自动调 `dispose()`。
 */
export class SubprocessRegistry implements Disposable {
  private readonly entries = new Set<RegistryEntry>();
  private _disposed = false;
  private _killed = false;
  /**
   * 可选日志器:register 时机异常(dispose 后)时显式记录。
   * 单例传入 `sharedLogger`;测试可直接不传(静默)。
   */
  private readonly logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  /** 当前注册的子进程数(测试 + 调试) */
  get size(): number {
    return this.entries.size;
  }

  /** 是否已 dispose(deactivate 触发后为 true) */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * 注册一个子进程,跟踪到 dispose 时的清理列表。
   *
   * - child 自然 exit 时自动 unregister(set 不会无限增长)
   * - 重复注册同一个 child 是 no-op
   * - dispose 之后注册:显式 warn 一条日志并丢弃(不抛错)。注入 logger 后
   *   从"静默 return"升级为可观测;不注入时保持静默(与旧行为一致)。
   */
  register(child: ChildProcess, label: string): void {
    if (this._disposed) {
      // dispose 之后还 register 怎么办?大概率是某 dispose 顺序问题;不抛错,仅日志提醒。
      // (理论上不会发生:registry 第一个 push 进 subscriptions,其他模块 dispose 之前
      //  我们已经 dispose 完。但 detached spawn 可能在 deactivate 中途发生。)
      this.logger?.warn(
        `[subprocessRegistry] register after dispose ignored: ${label} (pid ${child.pid ?? 'unknown'})`,
      );
      return;
    }
    if (!child.pid) {
      // spawn 还没绑定 PID(罕见,可能 spawn 失败)
      return;
    }

    // 查重(同一个 child 引用不能 register 两次)
    for (const entry of this.entries) {
      if (entry.child === child) {
        return;
      }
    }

    const entry: RegistryEntry = { child, label };
    this.entries.add(entry);
    child.once('exit', () => {
      this.entries.delete(entry);
    });
  }

  /**
   * 主动注销(进程已自然结束,但 'exit' 事件已错过,例如 spawn 失败后立刻清理)。
   * 重复注销是 no-op。
   */
  unregister(child: ChildProcess): void {
    for (const entry of this.entries) {
      if (entry.child === child) {
        this.entries.delete(entry);
        return;
      }
    }
  }

  /**
   * 杀所有子进程:Windows 下第一刀 `taskkill /F /T` 强杀进程树,
   * 3s 后对仍未退出的进程再补一刀 `taskkill /F` 兜底。
   *
   * - 幂等:重复调用安全
   * - 不会等 child 真正 exit 才返回(每个 child 走独立 await,但不串行等)
   * - 调用方可以在测试中 `await` 等待所有 taskkill 投递完成
   */
  async killAll(): Promise<void> {
    if (this._killed) {
      return;
    }
    this._killed = true;

    if (this.entries.size === 0) {
      return;
    }

    // 拷贝当前 entries:kill 过程中 entries 可能变化('exit' 事件异步触发 unregister)
    const snapshot = Array.from(this.entries);

    const killPromises: Promise<void>[] = [];

    for (const { child, label } of snapshot) {
      if (!child.pid) {
        continue;
      }
      // 1) 先 taskkill /T(走进程树,cmd.exe → UBT 全部杀掉)
      killPromises.push(this.killWithEscalation(child, label));
    }

    await Promise.allSettled(killPromises);
  }

  /**
   * 杀单个子进程:taskkill /F /T → 3s → taskkill /F(无 /T,确保强杀底层)。
   *
   * 用 child 的局部闭包引用,即使 unregister 把它从 set 移走,timeout 回调仍能拿到。
   *
   * @param _label 保留参数供未来扩展(诊断日志,例如 `[subprocessRegistry] killing UBT (pid 1234)`),
   * 当前不直接用,因 taskkill 失败被 try/catch 吞,无法稳定输出 label 关联信息。
   */
  private async killWithEscalation(child: ChildProcess, _label: string): Promise<void> {
    const pid = child.pid;
    if (!pid) {
      return;
    }

    // 第一刀:taskkill /F /T 强杀整个进程树(不是"优雅"关闭 —— /F 本身就是强杀)。
    // 带 /T 才能连 cmd.exe 包装层一起杀,UBT/dotnet 才不会残留成孤儿。
    await killTree(child);

    // 检查是否已退出(可能在第一刀与第二刀之间自然退出了)
    if (this.hasExited(child)) {
      return;
    }

    // 第二刀:3s 后强杀(无 /T,直接 PID 强杀)
    await new Promise<void>((resolve) => {
      const escalationTimer = setTimeout(() => {
        if (this.hasExited(child)) {
          resolve();
          return;
        }
        // 强杀日志:label + pid 便于诊断
        try {
          execFile('taskkill', ['/F', '/PID', String(pid)], (err) => {
            if (err) {
              // best-effort:进程可能已自然退出
            }
          });
        } catch {
          /* taskkill 启动失败,继续 */
        }
        // 异步等强杀投递完成(不再升级了,best-effort 兜底)
        setTimeout(resolve, 200);
      }, SIGKILL_DELAY_MS);

      // 进程在 3s 内已退出,清除 escalation 定时器
      const onExit = (): void => {
        clearTimeout(escalationTimer);
        resolve();
      };
      child.once('exit', onExit);
    });
  }

  /** 检查 child 是否已退出(pid 为 undefined 或已发出 exit 事件) */
  private hasExited(child: ChildProcess): boolean {
    if (!child.pid) {
      return true;
    }
    // child.exitCode 在 'exit' 事件后被设置;但我们不依赖事件触发,
    // 因为 'exit' 是异步的。这里用 child.killed 兜底:
    // child.killed === true 表示已收到 kill 信号但不一定退出。
    // 更可靠的判断:child.exitCode !== null 表示已退出。
    return child.exitCode !== null;
  }

  /**
   * vscode.Disposable.dispose:同步版本,触发 SIGTERM,不等 SIGKILL 升级。
   *
   * VS Code 在 deactivate 时同步调所有 disposable.dispose(),我们不能在这里 await。
   * killAll() 的完整流程(SIGTERM → 3s → SIGKILL)在 fire-and-forget 中跑。
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;

    // 触发杀进程(不等完成)
    void this.killAll().catch(() => {
      /* killAll 内部已 best-effort,这里吞错 */
    });
  }
}

/**
 * 全插件共享的 SubprocessRegistry 单例。
 * 注入 `sharedLogger`:dispose 之后 register 这类异常时序能被显式记录(而非静默丢弃)。
 */
export const sharedSubprocessRegistry = new SubprocessRegistry(sharedLogger);
