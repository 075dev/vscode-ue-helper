/**
 * uprojectParser.test.ts —— F1-8 .uproject JSON5 解析测试
 *
 * 真实 UE .uproject 允许注释/尾部逗号,旧代码实际用 JSON.parse 会失败,
 * 修复后走 JSON5.parse。这里 mock vscode.workspace.fs.readFile 喂入 JSONC 文本。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { readUProject, getEnabledPlugins } from '@parsers/uprojectParser';

describe('readUProject —— F1-8 JSON5 解析', () => {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock accessor
  const readFileMock = vi.mocked(vscode.workspace.fs.readFile);

  beforeEach(() => {
    readFileMock.mockReset();
  });

  function feed(content: string): void {
    readFileMock.mockResolvedValue(new TextEncoder().encode(content));
  }

  it('解析含注释/尾逗号的 .uproject(JSONC 场景)', async () => {
    // JSONC 文本:注释 + 尾逗号,旧 JSON.parse 会抛错返回 null
    const jsonc = [
      '{',
      '  // UE 项目描述',
      '  "FileVersion": 3,',
      '  "EngineAssociation": "5.8",',
      '  "Plugins": [',
      '    { "Name": "EnhancedInput", "Enabled": true, },',
      '    { "Name": "SomeDisabled", "Enabled": false, },',
      '  ],',
      '}',
    ].join('\n');
    feed(jsonc);

    const raw = await readUProject('C:/fake/XianDreamwalking.uproject');
    expect(raw).not.toBeNull();
    expect(raw?.FileVersion).toBe(3);
    expect(raw?.EngineAssociation).toBe('5.8');
    expect(raw?.Plugins).toHaveLength(2);
  });

  it('解析失败(文件读不出来)返回 null', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    expect(await readUProject('C:/fake/missing.uproject')).toBeNull();
  });
});

describe('getEnabledPlugins', () => {
  it('过滤掉显式 Enabled:false 的插件', () => {
    expect(
      getEnabledPlugins({
        Plugins: [{ Name: 'A', Enabled: true }, { Name: 'B' }, { Name: 'C', Enabled: false }],
      }),
    ).toEqual(['A', 'B']);
  });

  it('Plugins 不是数组时返回空数组', () => {
    expect(getEnabledPlugins({})).toEqual([]);
  });
});
