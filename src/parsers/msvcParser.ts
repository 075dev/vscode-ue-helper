/**
 * msvcParser —— 从构建输出提取 MSVC / UBT / 链接器诊断信息
 *
 * MSVC 格式参考:
 *   file.cpp(line,col): error C2065: undeclared identifier
 *   file.cpp(line): warning C4244: conversion from double to int
 *
 * UBT 在 MSVC 外面再包一层构建上下文,我们剥掉:
 *   [N/M] EngineModule: file.cpp(line,col): error C2065: ...
 *
 * 解析后的 ParsedDiagnostic 推到 Problems 面板(file:line:col 可点击跳转)。
 */

import { ParsedDiagnostic } from '@build/types';

// Pattern 1: file(line,col): severity Code: message
// Group 1: file, 2: line, 3: column (optional), 4: severity, 5: code, 6: message
const MSVC_RE =
  /^(.*?)\((\d+)(?:,(\d+))?\)\s*:\s*(error|warning|note|fatal error)\s+([A-Z]+\d+)\s*:\s*(.*)$/;

// Pattern 2: linker LNK2019 / LNK1120 — file path on its own line then
//   ": error LNK2019: ..."  OR  "Module : error LNK2019: ..."
const LINKER_RE = /^(.*?)\s*:\s*(error|warning)\s+(LNK\d+)\s*:\s*(.*)$/;

export class MsvcParser {
  private buffer = '';
  private currentFile: string | undefined;

  /**
   * Feed a chunk of output and return any complete diagnostics.
   * State (the partial-line buffer) is preserved across calls.
   */
  parse(chunk: string): ParsedDiagnostic[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    // Last line may be incomplete — keep it in the buffer.
    this.buffer = lines.pop() ?? '';

    const diagnostics: ParsedDiagnostic[] = [];
    for (const line of lines) {
      const parsed = this.parseLine(line);
      if (parsed) {
        diagnostics.push(parsed);
        // Linker errors sometimes include the offending file on a preceding
        // line. Capture it for context.
        if (parsed.code.startsWith('LNK') && parsed.file) {
          this.currentFile = parsed.file;
        }
      }
    }
    return diagnostics;
  }

  /** Flush any trailing buffered line. Call when the build ends. */
  flush(): ParsedDiagnostic[] {
    if (!this.buffer.trim()) {return [];}
    const parsed = this.parseLine(this.buffer);
    this.buffer = '';
    return parsed ? [parsed] : [];
  }

  private parseLine(rawLine: string): ParsedDiagnostic | null {
    const line = rawLine.trim();
    if (!line) {return null;}

    // Strip UBT build context prefix: "[1/45] ModuleName: " or similar.
    const cleaned = line.replace(/^\s*\[\d+\/\d+\]\s+[^:]+:\s*/, '');

    // Try MSVC first.
    const m = MSVC_RE.exec(cleaned);
    if (m) {
      const file = m[1] ?? '';
      const lineStr = m[2] ?? '1';
      const colStr = m[3];
      const severity = m[4] ?? 'error';
      const code = m[5] ?? '';
      const message = m[6] ?? '';
      return {
        file: this.normalizePath(file),
        line: Number.parseInt(lineStr, 10),
        column: colStr ? Number.parseInt(colStr, 10) : undefined,
        severity: this.normalizeSeverity(severity),
        code,
        message: message.trim(),
        raw: rawLine,
      };
    }

    // Try linker.
    const l = LINKER_RE.exec(cleaned);
    if (l) {
      const file = l[1] ?? '';
      const severity = l[2] ?? 'error';
      const code = l[3] ?? '';
      const message = l[4] ?? '';
      return {
        file: this.normalizePath(file || this.currentFile || ''),
        line: 1,
        severity: this.normalizeSeverity(severity),
        code,
        message: message.trim(),
        raw: rawLine,
      };
    }

    return null;
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/').trim();
  }

  private normalizeSeverity(s: string): 'error' | 'warning' | 'note' {
    const lower = s.toLowerCase();
    if (lower === 'error' || lower === 'fatal error') {return 'error';}
    if (lower === 'warning') {return 'warning';}
    return 'note';
  }
}
