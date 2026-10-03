/**
 * logger.test.ts —— Logger 全量单元测试
 *
 * 覆盖:
 *  - 4 个 public 写入方法(info/warn/error/debug)与 setLevel/show/dispose
 *  - Level 过滤矩阵(error ≤ warn ≤ info ≤ debug)
 *  - format 行为:时间戳切片、字符串透传、对象 JSON.stringify
 *  - sink 行为:OutputChannel.appendLine + console.* 都被调用
 *  - dispose 行为:disposeLoggerOutputChannel 后再写入能重新创建 channel
 *  - sharedLogger 单例语义
 *
 * 设计要点:
 *  - Logger 内部用 module-level `channels` Map;为避免测试间串扰,每个测试前
 *    `disposeLoggerOutputChannel('test')` 清理。
 *  - Logger 构造**不**触发 createOutputChannel(懒加载);只有第一次写入
 *    或 show() 才走 ensureChannel()。这是为了避免未实际使用的模块白白创建通道。
 *  - setup.ts 已 mock vscode.createOutputChannel 为 `{ appendLine, show, ... }`,
 *    我们直接抓 channel 对象断言。
 *  - console.* 是 node 全局,Logger 内部真会调用,这里用 vi.spyOn 拦截,
 *    既验证调用又不污染测试输出。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  Logger,
  type LogLevel,
  disposeLoggerOutputChannel,
  getLoggerOutputChannel,
  sharedLogger,
} from '@core/logger';
import { Config } from '@core/config';

function freshLogger(prefix = 'test'): Logger {
  disposeLoggerOutputChannel(prefix);
  return new Logger(prefix);
}

/**
 * mock OutputChannel 视图:appendLine/show 声明为 Mock 属性(而非方法签名),避免 unbound-method。
 * 运行时仍是 setup.ts 注入的 vi.fn,可直接做 spy 断言。
 */
type MockOutputChannel = {
  appendLine: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
};

/** 把 vscode.OutputChannel 转成 mock 视图,供 spy 断言使用 */
function asMockChannel(channel: vscode.OutputChannel): MockOutputChannel {
  return channel as unknown as MockOutputChannel;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // 清理所有可能的通道,避免跨测试串扰
  for (const name of ['test', 'A', 'B', 'core', 'clangd']) {
    disposeLoggerOutputChannel(name);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Logger — 基础写入', () => {
  it('info 调用 appendLine + console.log', () => {
    const log = freshLogger('test');
    const channel = getLoggerOutputChannel('test');
    log.info('hello'); // prefix 由 Logger 自动添加,入参里不要重复
    expect(asMockChannel(channel).appendLine).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledTimes(1);
    const line = (channel.appendLine as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    // 格式: HH:MM:SS.mmm [LEVEL] [prefix] tail — prefix 自动包裹在 [] 中
    expect(line).toMatch(/\[INFO\] \[test\] hello$/);
  });

  it('warn 调用 console.warn', () => {
    const log = freshLogger('test');
    log.warn('[test] careful');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('error 调用 console.error', () => {
    const log = freshLogger('test');
    log.error('[test] boom');
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('debug 默认(info 级别)不写入,只 console.log 也不调', () => {
    const log = freshLogger('test');
    const channel = getLoggerOutputChannel('test');
    log.debug('[test] hidden');
    expect(asMockChannel(channel).appendLine).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('debug 在 setLevel("debug") 后被记录', () => {
    const log = freshLogger('test');
    log.setLevel('debug');
    const channel = getLoggerOutputChannel('test');
    log.debug('[test] visible');
    expect(asMockChannel(channel).appendLine).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('error 在 setLevel("error") 时 warn/info/debug 都被过滤', () => {
    const log = freshLogger('test');
    log.setLevel('error');
    const channel = getLoggerOutputChannel('test');
    log.info('[test] i');
    log.warn('[test] w');
    log.debug('[test] d');
    log.error('[test] e');
    expect(asMockChannel(channel).appendLine).toHaveBeenCalledTimes(1);
    const line = (channel.appendLine as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(line).toContain('[ERROR]');
  });
});

describe('Logger — format 行为', () => {
  it('时间戳切片到 11:23 位置(保留 HH:MM:SS.mmm)', () => {
    const log = freshLogger('test');
    log.info('[test] ts');
    const channel = getLoggerOutputChannel('test');
    const line = (channel.appendLine as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    // 格式: HH:MM:SS.mmm [LEVEL] [prefix] tail
    expect(line).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3} /);
  });

  it('字符串 args 用空格拼接', () => {
    const log = freshLogger('test');
    log.info('[test]', 'foo', 'bar');
    const channel = getLoggerOutputChannel('test');
    const line = (channel.appendLine as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(line).toMatch(/foo bar$/);
  });

  it('对象 args 走 JSON.stringify(2 缩进)', () => {
    const log = freshLogger('test');
    log.info('[test] data', { x: 1, y: 'two' });
    const channel = getLoggerOutputChannel('test');
    const line = (channel.appendLine as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(line).toContain('"x": 1');
    expect(line).toContain('"y": "two"');
  });

  it('混合 args: 字符串直接拼接,对象序列化', () => {
    const log = freshLogger('test');
    log.info('[test]', 'meta=', { k: 'v' });
    const channel = getLoggerOutputChannel('test');
    const line = (channel.appendLine as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(line).toMatch(/meta= \{[\s\S]*"k": "v"[\s\S]*\}$/);
  });

  it('F1-4 Error 对象序列化为 "name: message"（而非 JSON.stringify 的 {}）', () => {
    const log = freshLogger('test');
    log.error('[test] failed:', new Error('boom'));
    const channel = getLoggerOutputChannel('test');
    const line = (channel.appendLine as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    // 修复前 JSON.stringify(Error) 返回 '{}',错误详情丢失;修复后应包含 name: message
    expect(line).toContain('Error: boom');
  });

  it('prefix 自动加 [] 包裹', () => {
    const log = freshLogger('core');
    log.info('[core] x');
    const channel = getLoggerOutputChannel('core');
    const line = (channel.appendLine as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(line).toContain('[core]');
  });
});

describe('Logger — sink 行为', () => {
  it('同一 prefix 复用同一个 OutputChannel(避免重复创建)', () => {
    const a = new Logger('A');
    a.info('[A] 1'); // 第一次写入懒创建
    const b = new Logger('A');
    b.info('[A] 2'); // 已有,不再创建
    expect(vscode.window.createOutputChannel).toHaveBeenCalledTimes(1);
  });

  it('不同 prefix 走不同 OutputChannel', () => {
    const a = new Logger('A');
    a.info('[A] x');
    const b = new Logger('B');
    b.info('[B] y');
    expect(vscode.window.createOutputChannel).toHaveBeenCalledTimes(2);
  });

  it('构造时**不**触发 createOutputChannel(懒加载)', () => {
    new Logger('lazy');
    expect(vscode.window.createOutputChannel).not.toHaveBeenCalled();
  });

  it('dispose 后再写入能 fallback 到新 channel 而不抛', () => {
    const log = freshLogger('test');
    log.dispose();
    // dispose 后再调用,ensureChannel 内部会重新创建一个新 channel(因为 Map 已 delete)
    expect(() => log.info('[test] after-dispose')).not.toThrow();
    expect(console.log).toHaveBeenCalled();
  });

  it('dispose 后再创建同名 Logger,createOutputChannel 会再调一次', () => {
    const first = new Logger('test');
    first.info('[test] warm'); // 第一次创建
    first.dispose(); // 清理 map
    new Logger('test').info('[test] cold'); // 重新创建
    expect(vscode.window.createOutputChannel).toHaveBeenCalledTimes(2);
  });
});

describe('Logger — show / dispose', () => {
  it('show 调用 channel.show(true)', () => {
    const log = freshLogger('test');
    const channel = getLoggerOutputChannel('test');
    log.show();
    expect(asMockChannel(channel).show).toHaveBeenCalledWith(true);
  });

  it('dispose 不会抛,且 channel 被从 map 移除', () => {
    const log = freshLogger('test');
    log.info('[test] warm');
    expect(() => log.dispose()).not.toThrow();
    // dispose 后再次写入,会重新创建 channel
    log.info('[test] re-warm');
    expect(vscode.window.createOutputChannel).toHaveBeenCalledTimes(2);
  });
});

describe('Logger — 级别枚举', () => {
  it('LogLevel 只暴露 error/warn/info/debug 四个值', () => {
    const values: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    // 编译期类型约束;运行时再确认每个值都能 setLevel
    const log = freshLogger('test');
    for (const v of values) {
      expect(() => log.setLevel(v)).not.toThrow();
    }
  });
});

describe('Logger — F1-5 配置联动', () => {
  /**
   * 构造 mock WorkspaceConfiguration,`get(key)` 命中 values 则返回对应值,
   * 否则回退到默认值(与 setup.ts 的 mock 行为一致)。
   */
  function mockWorkspaceConfig(values: Record<string, unknown>): vscode.WorkspaceConfiguration {
    return {
      get: vi.fn((key: string, def?: unknown) =>
        Object.prototype.hasOwnProperty.call(values, key) ? values[key] : def,
      ),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration;
  }

  it('F1-5 lspLoggingLevel 经 setLevel 接线后驱动 debug 过滤', () => {
    const log = freshLogger('test');
    const channel = getLoggerOutputChannel('test');

    // 模拟 extension.ts 激活接线:logger.setLevel(config.lspLoggingLevel)
    // 未设置时 getter 回退 'info',debug 应被过滤
    log.setLevel(new Config().lspLoggingLevel);
    log.debug('[test] hidden');
    expect(asMockChannel(channel).appendLine).not.toHaveBeenCalled();

    // 模拟用户把 lspLoggingLevel 改为 debug 后再次接线,debug 应被记录
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
      mockWorkspaceConfig({ lspLoggingLevel: 'debug' }),
    );
    log.setLevel(new Config().lspLoggingLevel);
    log.debug('[test] visible');
    expect(asMockChannel(channel).appendLine).toHaveBeenCalledTimes(1);
    const line = (channel.appendLine as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(line).toContain('[DEBUG]');
  });
});

describe('sharedLogger', () => {
  it('是 Logger 实例,默认 prefix VSCodeUEHelper', () => {
    expect(sharedLogger).toBeInstanceOf(Logger);
    // sharedLogger 用 'VSCodeUEHelper' 通道名,可能已被前面测试创建过;清理再读
    const channel = getLoggerOutputChannel('VSCodeUEHelper');
    expect(channel).toBeDefined();
  });

  it('setLevel 会被多个写入路径共享(同实例)', () => {
    sharedLogger.setLevel('debug');
    sharedLogger.debug('[shared] probe');
    const channel = getLoggerOutputChannel('VSCodeUEHelper');
    // sharedLogger 是单例;debug 在 debug 级别应记录
    expect(asMockChannel(channel).appendLine).toHaveBeenCalled();
  });
});
