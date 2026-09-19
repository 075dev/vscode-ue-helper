/**
 * liveCoding 命令构造测试 —— bugfix-001 回归锁定
 *
 * Bug 现象:点击 Live Coding 按钮后启动了一个不带 -Project 的全新
 * UnrealEditor.exe 实例(UE 弹出项目管理器,表现为"打开一个新的项目"),
 * 而不是连接已运行的编辑器实例触发热重载。
 *
 * 契约(UE 官方等价于编辑器内 Live Coding 按钮的方式):
 *   Build.bat <Target> <Platform> <Config> -Project="<uproject>" -waitmutex -LiveCoding
 *   —— UBT -LiveCoding 连接正在运行的编辑器 Live Coding server,
 *   不启动新实例;编辑器未运行时 UBT 回退为普通构建。
 */

import { describe, expect, it } from 'vitest';
import { resolveLiveCodingCmd } from '@build/ubt';

describe('resolveLiveCodingCmd(bugfix-001: 连接现有项目热重载)', () => {
  const UBT_PATH = 'E:/UE_5.3/Engine/Build/BatchFiles/Build.bat';

  const baseArgs = {
    project: 'D:/MyGame/MyGame.uproject',
    target: 'MyGameEditor',
    platform: 'Win64' as const,
    configuration: 'Development' as const,
    ubtPath: UBT_PATH,
  };

  it('命令入口必须是 Build.bat(UBT),而非启动新的 UnrealEditor 实例', () => {
    const cmd = resolveLiveCodingCmd(baseArgs);
    expect(cmd.file).toBe(UBT_PATH);
    expect(cmd.file).not.toContain('UnrealEditor');
  });

  it('必须带 -Project 参数连接现有项目(路径含空格时整体加引号)', () => {
    const cmd = resolveLiveCodingCmd(baseArgs);
    expect(cmd.args.join(' ')).toContain('-Project="D:/MyGame/MyGame.uproject"');
  });

  it('必须带 -LiveCoding 标志(连接已运行编辑器的 Live Coding server)', () => {
    const cmd = resolveLiveCodingCmd(baseArgs);
    expect(cmd.args).toContain('-LiveCoding');
  });

  it('命令参数顺序与 UBT 构建命令一致,且不残留旧的 ExecCmds 方式', () => {
    const cmd = resolveLiveCodingCmd(baseArgs);
    expect(cmd.args.slice(0, 5)).toEqual([
      'MyGameEditor',
      'Win64',
      'Development',
      '-Project="D:/MyGame/MyGame.uproject"',
      '-waitmutex',
    ]);
    expect(cmd.args.join(' ')).not.toContain('ExecCmds');
  });
});
