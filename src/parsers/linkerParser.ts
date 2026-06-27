/**
 * linkerParser —— 提取 MSVC 链接器错误(LNK2019、LNK1120 等)
 *
 * 链接器错误有两种形式:
 *  - 行内: Module.Gen.cpp.obj : error LNK2019: unresolved external symbol foo
 *  - 堆叠: 文件名一行,然后 : error LNK2019: ...
 *
 * MsvcParser 已经处理行内情况,本模块用于堆叠情况(链接器有时分多行输出)。
 * where the linker output is structured differently (cross-compile,
 * specific LLD output) and we want to be more permissive.
 */

import { ParsedDiagnostic } from '@build/types';

const LINKER_ERR_RE = /^LNK(\d+):\s*(.*)$/;
const UNDEFINED_REF_RE = /undefined reference to [`']?([^\s'`]+)[`']?/;

export interface LinkerMatch {
  code: string;
  message: string;
}

export class LinkerParser {
  parse(line: string): LinkerMatch | null {
    const m = LINKER_ERR_RE.exec(line.trim());
    if (!m) return null;
    return {
      code: `LNK${m[1]}`,
      message: m[2]?.trim() ?? '',
    };
  }

  /** Try to extract a symbol name from a linker message. */
  extractSymbol(message: string): string | null {
    const m = UNDEFINED_REF_RE.exec(message);
    return m && m[1] ? m[1] : null;
  }
}

/**
 * Helper — combine parser outputs into a ParsedDiagnostic.
 * Used when MsvcParser missed something but LinkerParser caught it.
 */
export function toDiagnostic(match: LinkerMatch, file: string, raw: string): ParsedDiagnostic {
  return {
    file,
    line: 1,
    severity: 'error',
    code: match.code,
    message: match.message,
    raw,
  };
}
