/**
 * Logger —— 全插件共享的日志器
 *
 * 封装 VS Code 的 `OutputChannel`，提供分级日志（info / warn / error / debug）。
 * 所有模块共用一个 Logger 实例（在 `extension.ts` 创建）。
 *
 * ## 用法
 *
 * ```ts
 * const logger = new Logger('MyModule');  // 创建独立 channel
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
 */

import * as vscode from 'vscode';

/** 日志级别，按严重程度从低到高排序 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export class Logger {
  /** VS Code Output 通道引用 */
  private channel: vscode.OutputChannel;
  /** 日志前缀，构造时指定，如 '[VSCodeUEHelper]' */
  private prefix: string;
  /** 当前日志级别（'info' 及以上会被记录） */
  private currentLevel: LogLevel = 'info';

  /**
   * @param prefix 同时作为 Output 通道的标题和每条日志的前缀
   *                习惯上每个模块用模块名（如 'detection'、'clangd'）
   */
  constructor(prefix: string = 'VSCodeUEHelper') {
    // createOutputChannel 注册一个新的 Output 面板 tab
    this.channel = vscode.window.createOutputChannel(prefix);
    this.prefix = `[${prefix}]`;
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
   * 对象参数会被 JSON.stringify 序列化。
   */
  private format(level: LogLevel, args: unknown[]): string {
    const ts = new Date().toISOString().slice(11, 23);
    const tail = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
      .join(' ');
    return `${ts} [${level.toUpperCase()}] ${this.prefix} ${tail}`;
  }

  /** 普通日志。记录运行状态、检测到的路径、用户操作等 */
  info(...args: unknown[]): void {
    if (!this.shouldLog('info')) {return;}
    const line = this.format('info', args);
    this.channel.appendLine(line);
    console.log(line);
  }

  /** 警告日志。不致命的异常、降级处理、找不到资源等 */
  warn(...args: unknown[]): void {
    if (!this.shouldLog('warn')) {return;}
    const line = this.format('warn', args);
    this.channel.appendLine(line);
    console.warn(line);
  }

  /** 错误日志。命令失败、激活失败、解析错误等 */
  error(...args: unknown[]): void {
    if (!this.shouldLog('error')) {return;}
    const line = this.format('error', args);
    this.channel.appendLine(line);
    console.error(line);
  }

  /** 调试日志。仅在 lspLoggingLevel = debug 时记录 */
  debug(...args: unknown[]): void {
    if (!this.shouldLog('debug')) {return;}
    const line = this.format('debug', args);
    this.channel.appendLine(line);
  }

  /** 把 Output 面板显示给用户。参数 `preserveFocus=true` 不会抢焦点 */
  show(): void {
    this.channel.show(true);
  }

  /** 释放 Output 通道（VS Code 卸载插件时调用） */
  dispose(): void {
    this.channel.dispose();
  }
}

// [Phase 11 SSoT] sharedLogger 单例——模块内部统一用这个,不要 new Logger()
// 主入口 src/extension.ts:30 仍可 new Logger()(独立 OutputChannel),test 可 new Logger mock
// eslint-disable-next-line no-restricted-syntax -- [Phase 11 SSoT] 本文件就是 SSoT 定义点
export const sharedLogger = new Logger('VSCodeUEHelper');
