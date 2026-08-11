/**
 * Logger —— 全插件共享的日志器
 *
 * 封装 VS Code 的 `OutputChannel`，提供分级日志（info / warn / error / debug）。
 * 所有模块共用一个 Logger 实例（在 `extension.ts` 创建）。
 *
 * ## 用法
 *
 * ```ts
 * const logger = new Logger('MyModule');  // 使用对应名称的共享 channel
 * logger.info('something happened');
 * logger.warn('careful!', { extra: 'data' });
 * logger.error('oops', err);
 * logger.show();  // 把 Output 面板显示给用户
 * ```
 *
 * ## 输出格式
 *
 * ```
 * 14:23:45.678 [INFO] [MyModule] something happened
 * 14:23:45.679 [WARN] [MyModule] careful! {"extra":"data"}
 * ```
 *
 * 同时写入：
 *   - VS Code Output 面板（用户能看到）
 *   - console.log / console.warn / console.error（DevTools 也能看）
 *
 * ## 日志级别
 *
 * 默认 'info' —— 记录 info/warn/error，过滤 debug。
 * 可以用 `logger.setLevel('debug')` 调到最详细。
 *
 * 对应 VS Code 设置：`vscodeUEHelper.lspLoggingLevel`。
 *
 * ## 为什么不用第三方日志库？
 *
 * 简单场景下原生 console + OutputChannel 已经够用，省去依赖。
 *
 * ## 日志前缀约定
 *
 * 所有模块的 `logger.info/warn/error/debug` 调用,首参数必须以 `[<moduleName>]` 开头,
 * 例 `logger.info('[build] task provider registered')`。
 *
 * - 模块名:从文件所在 `src/<module>/` 推断;子目录用 `[module/sub]`
 * - 仓库已通过 ESLint `no-restricted-syntax` 锁住 `new Logger()` 在 extension.ts:30 之外禁止
 *   (必须用 `sharedLogger` 或参数注入的 `logger` 对象)
 * - 仓库约定:前缀与"日志信息"之间用空格分隔,不要冒号
 *
 * 反例(将被 code review 退回):
 *   - `logger.info('task provider registered')` — 无前缀
 *   - `logger.info('[build]: task provider registered')` — 冒号分隔(约定)
 *   - `new Logger('build')` — 模块内部禁止(ESLint 报错)
  */

import * as vscode from 'vscode';

/** 按通道名称复用 OutputChannel，避免同名通道被重复创建。 */
const channels = new Map<string, vscode.OutputChannel>();

export function getLoggerOutputChannel(name: string = 'VSCodeUEHelper'): vscode.OutputChannel {
  let channel = channels.get(name);
  if (!channel) {
    channel = vscode.window.createOutputChannel(name);
    channels.set(name, channel);
  }
  return channel;
}

export function disposeLoggerOutputChannel(name: string = 'VSCodeUEHelper'): void {
  const channel = channels.get(name);
  channel?.dispose();
  channels.delete(name);
}

/** 日志级别，按严重程度从低到高排序 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export class Logger {
  /** Output 通道名称，用于在 dispose 后重新获取共享通道。 */
  private readonly channelName: string;
  /** 日志前缀，构造时指定，如 '[VSCodeUEHelper]' */
  private prefix: string;
  /** 当前日志级别（'info' 及以上会被记录） */
  private currentLevel: LogLevel = 'info';

  /**
   * @param prefix 同时作为 Output 通道的标题和每条日志的前缀
   *                习惯上每个模块用模块名（如 'detection'、'clangd'）
   */
  constructor(prefix: string = 'VSCodeUEHelper') {
    this.channelName = prefix;
    this.prefix = `[${prefix}]`;
  }

  /** 获取当前共享通道；通道被释放后自动创建新的实例。 */
  private ensureChannel(): vscode.OutputChannel {
    const channel = getLoggerOutputChannel(this.channelName);
    return channel;
  }

  /**
   * 动态调整日志级别。
   * 等级低于当前级别的日志会被 shouldLog() 过滤掉，不会写入 Output。
   */
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  /**
   * 判断给定级别是否应该被记录。
   * 用数字比较：error=0 最严重，永远记录；debug=3 最详细，仅 debug 模式记录。
   */
  private shouldLog(level: LogLevel): boolean {
    const order: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
    return order[level] <= order[this.currentLevel];
  }

  /**
   * 格式化一条日志。
   * 时间戳精确到毫秒（ISO 8601 格式切到 11:23 位置开始）。
   * 参数处理：字符串透传；Error 对象序列化为 `name: message`
   * （JSON.stringify(Error) 会得到 '{}'，丢失错误详情）；其余对象走 JSON.stringify。
   */
  private format(level: LogLevel, args: unknown[]): string {
    const ts = new Date().toISOString().slice(11, 23);
    const tail = args
      .map((a) => {
        if (typeof a === 'string') {
          return a;
        }
        // a 类型是 unknown，instanceof 前无需再收窄；非 Error 对象走 JSON.stringify
        if (a instanceof Error) {
          return `${a.name}: ${a.message}`;
        }
        return JSON.stringify(a, null, 2);
      })
      .join(' ');
    return `${ts} [${level.toUpperCase()}] ${this.prefix} ${tail}`;
  }

  /** 普通日志。记录运行状态、检测到的路径、用户操作等 */
  info(...args: unknown[]): void {
    if (!this.shouldLog('info')) {
      return;
    }
    const line = this.format('info', args);
    this.ensureChannel().appendLine(line);
    console.log(line);
  }

  /** 警告日志。不致命的异常、降级处理、找不到资源等 */
  warn(...args: unknown[]): void {
    if (!this.shouldLog('warn')) {
      return;
    }
    const line = this.format('warn', args);
    this.ensureChannel().appendLine(line);
    console.warn(line);
  }

  /** 错误日志。命令失败、激活失败、解析错误等 */
  error(...args: unknown[]): void {
    if (!this.shouldLog('error')) {
      return;
    }
    const line = this.format('error', args);
    this.ensureChannel().appendLine(line);
    console.error(line);
  }

  /** 调试日志。仅在 lspLoggingLevel = debug 时记录 */
  debug(...args: unknown[]): void {
    if (!this.shouldLog('debug')) {
      return;
    }
    const line = this.format('debug', args);
    this.ensureChannel().appendLine(line);
  }

  /** 把 Output 面板显示给用户。参数 `preserveFocus=true` 不会抢焦点 */
  show(): void {
    this.ensureChannel().show(true);
  }

  /** 释放 Output 通道（VS Code 卸载插件时调用） */
  dispose(): void {
    disposeLoggerOutputChannel(this.channelName);
  }
}

// [Phase 11 SSoT] sharedLogger 单例——模块内 logger 复用 VSCodeUEHelper channel
// 主入口和模块都通过该单例写入同一 OutputChannel；test 可 new Logger mock
// eslint-disable-next-line no-restricted-syntax -- [Phase 11 SSoT] 本文件就是 SSoT 定义点
export const sharedLogger = new Logger('VSCodeUEHelper');
