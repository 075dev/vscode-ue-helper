/**
 * noLint 测试 —— clang-tidy 行级屏蔽命令
 *
 * 覆盖:
 *   - planNoLintEdit 纯函数:current 行尾 / next 行首+缩进 / 幂等跳过
 *   - executeNoLint:无编辑器提示 / 多光标批量插入 / 全部跳过时不编辑
 */

import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { planNoLintEdit, executeNoLint } from '@commands/noLint';

function doc(lines: string[]) {
  return { lineAt: (line: number) => ({ text: lines[line] ?? '' }) };
}

describe('planNoLintEdit(current = 行尾 NOLINT)', () => {
  it('普通行 → 在行尾追加 " // NOLINT"', () => {
    const plan = planNoLintEdit(doc(['void foo();']), 0, 'current');
    expect(plan).toEqual({ line: 0, character: 11, text: ' // NOLINT' });
  });

  it('该行已有 NOLINT → 跳过(null)', () => {
    const d = doc(['foo(); // NOLINT']);
    expect(planNoLintEdit(d, 0, 'current')).toBeNull();
  });

  it('行尾已是 NOLINTNEXTLINE 注释也算已屏蔽(NOLINT 家族子串)', () => {
    const d = doc(['foo(); // NOLINTNEXTLINE']);
    expect(planNoLintEdit(d, 0, 'current')).toBeNull();
  });
});

describe('planNoLintEdit(next = 上方 NOLINTNEXTLINE)', () => {
  it('插入缩进对齐的 NOLINTNEXTLINE + 换行', () => {
    const plan = planNoLintEdit(doc(['    foo(); // NOLINT(google-build)']), 0, 'next');
    expect(plan).toEqual({ line: 0, character: 0, text: '    // NOLINTNEXTLINE\n' });
  });

  it('上一行已是 NOLINTNEXTLINE → 幂等跳过', () => {
    const d = doc(['// NOLINTNEXTLINE', 'foo();']);
    expect(planNoLintEdit(d, 1, 'next')).toBeNull();
  });

  it('首行上方无行 → 不幂等跳过', () => {
    const d = doc(['foo();']);
    expect(planNoLintEdit(d, 0, 'next')).not.toBeNull();
  });

  it('tab 缩进原样保留', () => {
    const plan = planNoLintEdit(doc(['\t\tfoo();']), 0, 'next');
    expect(plan?.text).toBe('\t\t// NOLINTNEXTLINE\n');
  });
});

describe('executeNoLint', () => {
  function fakeEditor(lines: string[], cursorLines: number[]) {
    return {
      document: doc(lines),
      selections: cursorLines.map((line) => ({ active: { line } })),
      edit: vi.fn(),
    };
  }

  it('无活动编辑器 → 提示并返回 err envelope(INTERNAL_ERROR 缺口登记)', async () => {
    (vscode.window.activeTextEditor as unknown) = undefined;
    const show = vscode.window.showInformationMessage as unknown as ReturnType<typeof vi.fn>;

    // [envelope 对齐] 无编辑器不属取消(任务卡明示慎用 OPERATION_CANCELLED),
    // 契约 9 项枚举无贴切码 → 兜底 INTERNAL_ERROR
    await expect(executeNoLint('current')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(show).toHaveBeenCalled();
  });

  it('多光标批量插入(忽略已屏蔽的行) → ok envelope', async () => {
    const editor = fakeEditor(['a();', 'b(); // NOLINT', 'c();'], [0, 1, 2]);
    const inserted: string[] = [];
    // executeNoLint 内部 editBuilder 回调无返回值,cb 按 void 标注
    editor.edit.mockImplementation(
      (cb: (b: { insert: (pos: unknown, text: string) => void }) => void) => {
        cb({
          insert: (_pos: unknown, text: string) => {
            inserted.push(text);
          },
        });
        return Promise.resolve(true);
      },
    );

    const env = await executeNoLint('current', editor as never);
    // [envelope 对齐] 插入成功 → ok envelope,摘要含插入处数
    expect(env.ok).toBe(true);
    expect(env.error).toBeUndefined();
    expect(env.summary).toEqual(expect.stringContaining('2 处'));
    // 第 1/3 行插入,第 2 行(已有 NOLINT)跳过
    expect(inserted).toEqual([' // NOLINT', ' // NOLINT']);
  });

  it('所有光标行都已屏蔽 → 不产生编辑,返回 ok envelope(幂等无操作)', async () => {
    // 光标在第 1 行,其上一行(第 0 行)已是 NOLINTNEXTLINE → 幂等跳过
    const editor = fakeEditor(['// NOLINTNEXTLINE', 'a();'], [1]);

    const env = await executeNoLint('next', editor as never);
    // [envelope 对齐] 幂等跳过 = 成功无操作(与旧行为一致:不产生编辑、不弹窗)
    expect(env.ok).toBe(true);
    expect(env.error).toBeUndefined();
    expect(editor.edit).not.toHaveBeenCalled();
  });

  it('编辑未应用(edit resolve false) → err envelope(INTERNAL_ERROR 缺口登记)', async () => {
    const editor = fakeEditor(['a();'], [0]);
    editor.edit.mockImplementation(
      (cb: (b: { insert: (pos: unknown, text: string) => void }) => void) => {
        cb({ insert: () => undefined });
        return Promise.resolve(false);
      },
    );

    await expect(executeNoLint('current', editor as never)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });
});
