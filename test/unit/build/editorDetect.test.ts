/**
 * editorDetect 测试 —— 编辑器感知构建的检测层
 *
 * 覆盖:
 *   - parseTasklistOutput:CSV 命中 / 本地化"无任务"文本不误判 / 多进程名
 *   - isUnrealEditorRunning:注入 execFile 的成功 / 失败 / 超时(err)路径
 *   - shouldSuggestLiveCoding:mode × running 决策矩阵
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseTasklistOutput,
  isUnrealEditorRunning,
  shouldSuggestLiveCoding,
  EDITOR_PROCESS_IMAGE_NAMES,
} from '@build/editorDetect';

describe('parseTasklistOutput', () => {
  it('CSV 行中带引号的映像名 → true', () => {
    const output =
      '"UnrealEditor.exe","12345","Console","1","1,234,567 K"\r\n' +
      '"UnrealEditor.exe","12346","Console","1","999,999 K"\r\n';
    expect(parseTasklistOutput(output)).toBe(true);
  });

  it('本地化"没有任务"提示文本 → false(不依赖英文关键词)', () => {
    expect(parseTasklistOutput('信息: 没有运行的任务匹配指定的标准。\r\n')).toBe(false);
    expect(parseTasklistOutput('INFO: No tasks are running which match the specified criteria.\r\n')).toBe(false);
  });

  it('不带引号的进程名出现在提示文本中不误判', () => {
    // 防御:某些本地化消息可能包含映像名本身,但 tasklist CSV 输出必然带引号
    expect(parseTasklistOutput('UnrealEditor.exe not found (hint text)')).toBe(false);
  });

  it('UnrealEditor-Cmd.exe 也能命中', () => {
    const output = '"UnrealEditor-Cmd.exe","777","Console","1","100 K"\r\n';
    expect(parseTasklistOutput(output)).toBe(true);
  });

  it('支持自定义进程名列表', () => {
    expect(parseTasklistOutput('"MyGame.exe","1","Console","1","1 K"', ['MyGame.exe'])).toBe(true);
    expect(parseTasklistOutput('"Other.exe","1","Console","1","1 K"', ['MyGame.exe'])).toBe(false);
  });

  it('默认列表包含编辑器主进程与 Cmd 变体', () => {
    expect(EDITOR_PROCESS_IMAGE_NAMES).toContain('UnrealEditor.exe');
    expect(EDITOR_PROCESS_IMAGE_NAMES).toContain('UnrealEditor-Cmd.exe');
  });
});

describe('isUnrealEditorRunning(注入 execFile)', () => {
  it('tasklist 输出命中 → true', async () => {
    const execFileImpl = vi.fn(
      (_cmd: string, _args: readonly string[], _opts: unknown, cb: (err: null, out: string) => void) =>
        cb(null, '"UnrealEditor.exe","42","Console","1","1 K"'),
    );
    await expect(isUnrealEditorRunning({ execFileImpl })).resolves.toBe(true);
    // 主映像名参与 /FI 过滤
    const args = execFileImpl.mock.calls[0]![1];
    expect(args).toContain('IMAGENAME eq UnrealEditor.exe');
  });

  it('tasklist 正常退出但无进程 → false', async () => {
    const execFileImpl = vi.fn(
      (_cmd: string, _args: readonly string[], _opts: unknown, cb: (err: null, out: string) => void) =>
        cb(null, 'INFO: No tasks are running which match the specified criteria.'),
    );
    await expect(isUnrealEditorRunning({ execFileImpl })).resolves.toBe(false);
  });

  it('execFile 出错(非 Windows / 超时)→ false 不抛错', async () => {
    const execFileImpl = vi.fn(
      (_cmd: string, _args: readonly string[], _opts: unknown, cb: (err: Error, out: string) => void) =>
        cb(new Error('tasklist ENOENT'), ''),
    );
    await expect(isUnrealEditorRunning({ execFileImpl })).resolves.toBe(false);
  });
});

describe('shouldSuggestLiveCoding', () => {
  it('build + 编辑器运行 → true', () => {
    expect(shouldSuggestLiveCoding('build', true)).toBe(true);
  });

  it('编辑器未运行 → false', () => {
    expect(shouldSuggestLiveCoding('build', false)).toBe(false);
  });

  it('rebuild / clean 即使编辑器运行也不提示', () => {
    expect(shouldSuggestLiveCoding('rebuild', true)).toBe(false);
    expect(shouldSuggestLiveCoding('clean', true)).toBe(false);
  });
});
