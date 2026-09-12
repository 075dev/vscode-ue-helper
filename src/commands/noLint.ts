/**
 * noLint —— clang-tidy 行级屏蔽命令（借鉴 boocs/unreal-clangd 的
 * tidyNoLintCurrentLine / tidyNoLintNextLine）
 *
 * clang-tidy 的两种行级屏蔽写法：
 *   - 行尾注释 `// NOLINT`：屏蔽本行所有检查
 *   - 上一行 `// NOLINTNEXTLINE`：屏蔽下一行（适合整行太长/宏展开误报）
 *
 * 命令：
 *   - vscodeUEHelper.noLintCurrentLine —— 在光标所在行行尾追加 `// NOLINT`
 *   - vscodeUEHelper.noLintNextLine   —— 在光标行上方插入缩进对齐的 `// NOLINTNEXTLINE`
 *
 * 幂等性：目标行已含 NOLINT / 上一行已是 NOLINTNEXTLINE 时跳过该光标，
 * 不产生重复注释。支持多光标 —— 一次 edit 内批量插入。
 */

import * as vscode from 'vscode';
import { t } from '@i18n';
import { type Logger } from '@core/logger';

export type NoLintMode = 'current' | 'next';

/** 单个插入计划（纯数据，便于测试断言） */
export interface NoLintEditPlan {
  /** 插入行号（0-based） */
  line: number;
  /** 插入列（0-based；current 模式为行尾，next 模式为行首） */
  character: number;
  /** 插入文本 */
  text: string;
}

/** 测试友好的最小文档/选区接口（与 vscode.TextDocument / Selection 结构对齐） */
export interface NoLintDocumentLike {
  lineAt(line: number): { text: string };
}
export interface NoLintSelectionLike {
  active: { line: number };
}

/** 行尾追加 NOLINT 前，先确认该行没写过（任何 NOLINT 家族注释都算） */
function lineHasNoLint(text: string): boolean {
  return text.includes('NOLINT');
}

/** 上一行是否已经是 NOLINTNEXTLINE（幂等防御） */
function prevLineHasNoLintNextLine(doc: NoLintDocumentLike, line: number): boolean {
  if (line <= 0) {
    return false;
  }
  return doc.lineAt(line - 1).text.includes('NOLINTNEXTLINE');
}

/** 行首缩进（tab / 空格原样保留） */
function leadingIndent(text: string): string {
  const m = /^[ \t]*/.exec(text);
  return m ? m[0] : '';
}

/**
 * 为一个光标位置计算插入计划（纯函数）。
 * 返回 null 表示该光标应跳过（已有 NOLINT / 已有 NOLINTNEXTLINE）。
 */
export function planNoLintEdit(
  doc: NoLintDocumentLike,
  activeLine: number,
  mode: NoLintMode,
): NoLintEditPlan | null {
  const lineText = doc.lineAt(activeLine).text;

  if (mode === 'current') {
    if (lineHasNoLint(lineText)) {
      return null;
    }
    return { line: activeLine, character: lineText.length, text: ' // NOLINT' };
  }

  // mode === 'next'
  if (prevLineHasNoLintNextLine(doc, activeLine)) {
    return null;
  }
  return {
    line: activeLine,
    character: 0,
    text: `${leadingIndent(lineText)}// NOLINTNEXTLINE\n`,
  };
}

/**
 * 执行 NOLINT 插入命令。
 *
 * @param mode 'current' = 行尾 NOLINT；'next' = 上方 NOLINTNEXTLINE
 * @param editor 可注入编辑器（测试用）；默认当前活动编辑器
 * @returns 是否产生了实际编辑
 */
export async function executeNoLint(
  mode: NoLintMode,
  editor?: vscode.TextEditor,
  logger?: Logger,
): Promise<boolean> {
  const active = editor ?? vscode.window.activeTextEditor;
  if (!active) {
    void vscode.window.showInformationMessage(t('cmd.noLint.noEditor'));
    return false;
  }

  // 多光标：逐个选区计算计划，跳过已屏蔽的行
  const doc = active.document as unknown as NoLintDocumentLike;
  const plans: NoLintEditPlan[] = [];
  for (const sel of active.selections) {
    const plan = planNoLintEdit(doc, sel.active.line, mode);
    if (plan) {
      plans.push(plan);
    }
  }
  if (plans.length === 0) {
    logger?.info(`[noLint] ${mode}: all cursor lines already suppressed, nothing to do`);
    return false;
  }

  // editor.edit 的回调同步执行完毕后 VS Code 才应用编辑,resolve 值为是否应用成功
  return active.edit((editBuilder) => {
    for (const plan of plans) {
      editBuilder.insert(new vscode.Position(plan.line, plan.character), plan.text);
    }
  });
}
