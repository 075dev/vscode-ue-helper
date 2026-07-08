/**
 * ueReflectionLinter -- UE 反射诊断 linter（P2-2）
 *
 * 用 VS Code 原生 DiagnosticCollection 实现轻量反射诊断，不起第二个 LSP。
 * 监听 onDidChangeTextDocument（防抖）/ onDidSaveTextDocument（立即），正则扫：
 *   1. UCLASS/USTRUCT 后 N 行缺 GENERATED_BODY -> error
 *   2. 反射宏对应的类名前缀违规（UCLASS->A/U、USTRUCT->F、UENUM->E、UINTERFACE->I）-> warning
 *   3. UFUNCTION 同时指定多个 RPC specifier（Server/Client/NetMulticast 互斥）-> error
 *
 * 防抖 250ms（编辑时频繁扫），save 时立即扫。诊断 source='ue-reflection'，
 * 与 clangd 诊断共存于 Problems 面板按 source 区分。
 *
 * 诊断逻辑抽成纯函数 analyzeReflection（不依赖 vscode API，便于单测），lint 仅做
 * offset->Range 转换 + 写 DiagnosticCollection。
 */

import * as vscode from 'vscode';
import {
  GENERATED_BODY_PATTERNS,
  GENERATED_BODY_MAX_LOOKAHEAD_LINES,
  UFUNCTION_RPC_SPECIFIERS,
  REFLECTION_MACRO_PREFIXES,
  type UeReflectionMacroKind,
} from './ueReflectionLinterData';

const CXX_LANGUAGE_IDS = ['cpp', 'c', 'h', 'hpp'] as const;

/** 编辑防抖：避免每次按键都扫 */
const DEBOUNCE_MS = 250;

/** 诊断来源标识（Problems 面板按 source 区分） */
const DIAGNOSTIC_SOURCE = 'ue-reflection';

/**
 * 注册 UE 反射诊断 linter。
 * @returns Disposable，调用方 push 到 context.subscriptions
 */
export function registerUeReflectionLinter(): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  /** uri -> 防抖定时器 */
  const pending = new Map<string, NodeJS.Timeout>();
  /** uri -> 最新文档快照（防抖触发时 lint） */
  const documents = new Map<string, vscode.TextDocument>();

  function schedule(document: vscode.TextDocument): void {
    if (!isCxxLanguage(document.languageId)) {
      return;
    }
    const key = document.uri.toString();
    const existing = pending.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      pending.delete(key);
      const doc = documents.get(key);
      if (doc) {
        lint(doc, collection);
      }
    }, DEBOUNCE_MS);
    pending.set(key, timer);
    documents.set(key, document);
  }

  const changeSub = vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document));

  // save 时立即 lint（绕过防抖，给用户即时反馈）
  const saveSub = vscode.workspace.onDidSaveTextDocument((document) => {
    if (!isCxxLanguage(document.languageId)) {
      return;
    }
    lint(document, collection);
  });

  const closeSub = vscode.workspace.onDidCloseTextDocument((document) => {
    const key = document.uri.toString();
    const timer = pending.get(key);
    if (timer) {
      clearTimeout(timer);
      pending.delete(key);
    }
    documents.delete(key);
    collection.delete(document.uri);
  });

  return vscode.Disposable.from(
    collection,
    changeSub,
    saveSub,
    closeSub,
    {
      dispose: () => {
        for (const timer of pending.values()) {
          clearTimeout(timer);
        }
        pending.clear();
        documents.clear();
      },
    },
  );
}

function isCxxLanguage(languageId: string): boolean {
  return CXX_LANGUAGE_IDS.some((c) => c === languageId);
}

/** offset-based 诊断（不依赖 vscode，便于单测） */
export interface RawDiagnostic {
  readonly startOffset: number;
  readonly length: number;
  readonly message: string;
  readonly severity: 'error' | 'warning';
  readonly code: string;
}

/**
 * 纯函数：分析文本的 UE 反射问题，返回 offset-based 诊断。
 * 不依赖 vscode API，可直接单测。
 */
export function analyzeReflection(text: string): RawDiagnostic[] {
  const diagnostics: RawDiagnostic[] = [];
  const lines = text.split(/\r?\n/);

  // 规则 1+2：反射宏 + 紧跟的声明（前缀检查 + GENERATED_BODY 检查）
  const macroRe = /\b(UCLASS|USTRUCT|UENUM|UINTERFACE)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = macroRe.exec(text)) !== null) {
    const macroKind = m[1] as UeReflectionMacroKind;
    const macroEnd = m.index + m[0].length;
    const afterMacro = text.slice(macroEnd);

    // 找紧跟的声明：class Name / struct Name / enum class Name / enum Name
    const declRe = /\b(class|struct)\s+(\w+)|\benum\s+(?:class\s+)?(\w+)/;
    const declMatch = declRe.exec(afterMacro);
    if (!declMatch || declMatch.index === undefined) {
      continue;
    }
    const name = declMatch[2] ?? declMatch[3];
    if (!name) {
      continue;
    }
    const declOffset = macroEnd + declMatch.index;

    // 规则 2：类名前缀检查
    const expected = REFLECTION_MACRO_PREFIXES[macroKind];
    if (expected && !expected.some((p) => name.startsWith(p))) {
      diagnostics.push({
        startOffset: declOffset,
        length: name.length,
        message: `${macroKind} 声明 "${name}" 的命名前缀不符合 UE 规范，应以 ${expected.join(' / ')} 开头`,
        severity: 'warning',
        code: 'ue-prefix',
      });
    }

    // 规则 1：UCLASS/USTRUCT 后 N 行内必须有 GENERATED_BODY
    if (macroKind === 'UCLASS' || macroKind === 'USTRUCT') {
      const declLine = offsetToLine(text, declOffset);
      const endLine = Math.min(lines.length - 1, declLine + GENERATED_BODY_MAX_LOOKAHEAD_LINES);
      let found = false;
      for (let ln = declLine; ln <= endLine; ln++) {
        const lineText = lines[ln] ?? '';
        if (GENERATED_BODY_PATTERNS.some((p) => lineText.includes(p))) {
          found = true;
          break;
        }
      }
      if (!found) {
        diagnostics.push({
          startOffset: declOffset,
          length: name.length,
          message: `${macroKind} 声明后 ${GENERATED_BODY_MAX_LOOKAHEAD_LINES} 行内未找到 GENERATED_BODY()，反射代码生成将失败`,
          severity: 'error',
          code: 'ue-missing-generated-body',
        });
      }
    }
  }

  // 规则 3：UFUNCTION 同时指定多个 RPC specifier（互斥）
  const ufuncRe = /\bUFUNCTION\s*\(([^)]*)\)/g;
  while ((m = ufuncRe.exec(text)) !== null) {
    const specStr = m[1] ?? '';
    // specifier 形如 "Server, reliable, withValidation" 或 "Category="xxx""，取等号前的标识符
    const specs = specStr
      .split(',')
      .map((s) => s.trim().split('=')[0]!.trim())
      .filter(Boolean);
    const rpcs = specs.filter((s) =>
      (UFUNCTION_RPC_SPECIFIERS as readonly string[]).includes(s),
    );
    if (rpcs.length > 1) {
      diagnostics.push({
        startOffset: m.index,
        length: m[0].length,
        message: `UFUNCTION 不能同时指定多个 RPC specifier（${rpcs.join(', ')}），Server / Client / NetMulticast 互斥`,
        severity: 'error',
        code: 'ue-multi-rpc',
      });
    }
  }

  return diagnostics;
}

/** offset -> 行号（0-based） */
function offsetToLine(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
    }
  }
  return line;
}

/**
 * 对单个文档执行反射诊断，结果写入 collection。
 */
function lint(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
  const raw = analyzeReflection(document.getText());
  const diagnostics: vscode.Diagnostic[] = raw.map((r) => {
    const range = rangeFor(document, r.startOffset, r.length);
    const d = new vscode.Diagnostic(
      range,
      r.message,
      r.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning,
    );
    d.source = DIAGNOSTIC_SOURCE;
    d.code = r.code;
    return d;
  });
  // set 自动覆盖旧诊断；空数组等同清除该 uri
  collection.set(document.uri, diagnostics);
}

function rangeFor(document: vscode.TextDocument, startOffset: number, length: number): vscode.Range {
  const start = document.positionAt(startOffset);
  const end = document.positionAt(startOffset + length);
  return new vscode.Range(start, end);
}
