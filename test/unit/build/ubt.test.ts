/**
 * ubt.test.ts —— buildUBTCommand 单测([add-002] 单模块过滤)
 *
 * - 带 module:args 追加 `-Module="<名>"`(与 -Project 同风格引号)
 * - 不带 module:args 与既有五段式逐项一致(不出现 -Module)
 * - resolveLiveCodingCmd 复用 buildUBTCommand:调用方不传 module 时
 *   Live Coding 命令不受影响
 */

import { describe, it, expect } from 'vitest';
import { buildUBTCommand, resolveLiveCodingCmd } from '@build/ubt';
import type { UBTArgs } from '@build/types';

function baseArgs(extra?: Partial<UBTArgs>): UBTArgs {
  return {
    project: 'D:/fake/MyGame/MyGame.uproject',
    target: 'MyGameEditor',
    platform: 'Win64',
    configuration: 'Development',
    ubtPath: 'D:/UE_5.2/Engine/Build/BatchFiles/Build.bat',
    ...extra,
  };
}

describe('buildUBTCommand [add-002] module 过滤', () => {
  it('带 module 时 args 追加 -Module="<名>"', () => {
    const cmd = buildUBTCommand(baseArgs({ module: 'MyGame' }));
    expect(cmd.args).toEqual([
      'MyGameEditor',
      'Win64',
      'Development',
      '-Project="D:/fake/MyGame/MyGame.uproject"',
      '-waitmutex',
      '-Module="MyGame"',
    ]);
  });

  it('不带 module 时与既有五段式逐项一致(无 -Module)', () => {
    const cmd = buildUBTCommand(baseArgs());
    expect(cmd.args).toEqual([
      'MyGameEditor',
      'Win64',
      'Development',
      '-Project="D:/fake/MyGame/MyGame.uproject"',
      '-waitmutex',
    ]);
  });

  it('module 为空字符串时不追加 -Module', () => {
    const cmd = buildUBTCommand(baseArgs({ module: '' }));
    expect(cmd.args.some((a) => a.startsWith('-Module='))).toBe(false);
  });

  it('resolveLiveCodingCmd 不传 module 时命令不含 -Module(Live Coding 不受影响)', () => {
    const cmd = resolveLiveCodingCmd(baseArgs());
    expect(cmd.args.at(-1)).toBe('-LiveCoding');
    expect(cmd.args.some((a) => a.startsWith('-Module='))).toBe(false);
  });

  it('resolveLiveCodingCmd 复用 buildUBTCommand:传 module 时同样拼接(调用方现不传,防御性)', () => {
    const cmd = resolveLiveCodingCmd(baseArgs({ module: 'MyGame' }));
    expect(cmd.args).toContain('-Module="MyGame"');
    expect(cmd.args.at(-1)).toBe('-LiveCoding');
  });
});
