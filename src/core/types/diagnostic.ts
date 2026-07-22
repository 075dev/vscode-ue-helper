/**
 * diagnostic —— MSVC / UBT / linker 通用诊断类型
 *
 * 抽离自 @build/types（Wave 4 T4.2）—— 让 parser 层不必依赖 build 模块。
 *
 * 字段约束（与历史 @build/types 完全兼容，禁止改动）：
 *  - `line`  必填：MSVC 必有行号；linker fallback 填 1
 *  - `code`  必填：MSVC 必有错误码；linker fallback 由 LinkerParser 提供
 *  - `raw`   必填：原始行用于 fallback 显示
 *  - `column` 可选：MSVC 行内 (line,col) 才带列
 */

export interface ParsedDiagnostic {
  file: string;
  line: number;
  column?: number;
  severity: 'error' | 'warning' | 'note';
  code: string;
  message: string;
  /** Raw line for fallback display. */
  raw: string;
}
