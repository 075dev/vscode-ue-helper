/**
 * problemsPanel —— 推送 diagnostics 到 VS Code Problems 面板
 *
 * 封装 vscode.languages.createDiagnosticCollection,这样从构建输出
 * 解析的 MSVC 错误能进入标准 Problems 面板,点击 file:line:col 跳转到源码。
 *
 * 主要导出:
 *   - getDiagnosticCollection: 懒创建 DiagnosticCollection
 *   - pushDiagnostics(diagnostics): 推送一组 ParsedDiagnostic
 *   - clearDiagnostics(): 清空(下次 build 开始时调用)
 *   - disposeDiagnosticCollection: 释放
 */

import * as vscode from 'vscode';
import { ParsedDiagnostic } from '@build/types';

let collection: vscode.DiagnosticCollection | undefined;

export function getDiagnosticCollection(): vscode.DiagnosticCollection {
  if (!collection) {
    collection = vscode.languages.createDiagnosticCollection('UE Helper');
  }
  return collection;
}

export function pushDiagnostics(parsed: ParsedDiagnostic[]): void {
  if (parsed.length === 0) return;
  const c = getDiagnosticCollection();
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const d of parsed) {
    const line = Math.max(0, d.line - 1);
    const col = Math.max(0, (d.column ?? 1) - 1);
    const range = new vscode.Range(line, col, line, col);
    const diag = new vscode.Diagnostic(range, `${d.code}: ${d.message}`, severity(d.severity));
    diag.source = 'UE Helper';
    diag.code = d.code;
    const file = vscode.Uri.file(d.file);
    const list = byFile.get(file.fsPath) ?? [];
    list.push(diag);
    byFile.set(file.fsPath, list);
  }
  c.clear();
  for (const [fsPath, diags] of byFile) {
    c.set(vscode.Uri.file(fsPath), diags);
  }
}

export function clearDiagnostics(): void {
  collection?.clear();
}

export function disposeDiagnosticCollection(): void {
  collection?.dispose();
  collection = undefined;
}

function severity(s: 'error' | 'warning' | 'note'): vscode.DiagnosticSeverity {
  switch (s) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'note':
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}
