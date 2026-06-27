/**
 * ubtParser —— 解析 UnrealBuildTool 进度行
 *
 * UBT 进度格式 [N/M] ModuleName: action,例如:
 *   [1/45] Compile Module.Core.cpp
 *   [12/45] Link UE5Editor.exe
 *   [28/45]   Excluding invalid file ...
 *
 * 解析后用于状态栏进度条显示。
 */

export interface UBTProgress {
  current: number;
  total: number;
  /** Trimmed module/action description. */
  description: string;
}

const UBT_PROGRESS_RE = /^\s*\[\s*(\d+)\s*\/\s*(\d+)\s*\]\s*(.*)$/;

export class UbtParser {
  parse(line: string): UBTProgress | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const m = UBT_PROGRESS_RE.exec(trimmed);
    if (!m) return null;
    const currentStr = m[1] ?? '0';
    const totalStr = m[2] ?? '0';
    const description = m[3] ?? '';
    return {
      current: Number.parseInt(currentStr, 10),
      total: Number.parseInt(totalStr, 10),
      description: description.trim(),
    };
  }
}
