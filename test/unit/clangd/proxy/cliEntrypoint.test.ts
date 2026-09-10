/**
 * cliEntrypoint.test.ts —— CLI 可执行入口单元测试
 *
 * 测试策略：入口判定为主模块才启动代理；普通导入不启动。
 */

import { describe, it, expect } from 'vitest';
import { runProxyWhenExecutedAsEntrypoint } from '@clangd/proxy/cli';

describe('executable entrypoint — CommonJS bundle 自启动', () => {
  it('Given bundled launcher 执行 clangdProxy.js，When 入口判定为主模块，Then 使用 process argv 参数启动 runProxy', () => {
    const argv = ['--real-clangd', '/fake/clangd', '--', '--background-index'];
    const calls: string[][] = [];

    runProxyWhenExecutedAsEntrypoint({
      isEntrypoint: true,
      argv,
      run: (receivedArgv: string[]) => {
        calls.push(receivedArgv);
        return {
          status: 'ok',
          changedFiles: [],
          commands: ['runProxy'],
          evidence: '',
          cleanup: [],
          risks: [],
        };
      },
    });

    expect(calls).toEqual([argv]);
  });

  it('Given cli.ts 被测试导入，When 入口判定不是主模块，Then 不启动 runProxy', () => {
    const calls: string[][] = [];

    runProxyWhenExecutedAsEntrypoint({
      isEntrypoint: false,
      argv: ['--real-clangd', '/fake/clangd'],
      run: (receivedArgv: string[]) => {
        calls.push(receivedArgv);
        return {
          status: 'ok',
          changedFiles: [],
          commands: ['runProxy'],
          evidence: '',
          cleanup: [],
          risks: [],
        };
      },
    });

    expect(calls).toHaveLength(0);
  });
});
