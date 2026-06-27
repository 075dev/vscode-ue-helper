/**
 * uprojectParser —— 读 .uproject 文件返回原始 JSON
 *
 * 用于运行时读 UprojectScanner 没建模的字段(Plugins 列表、额外依赖等)。
 * 同样用 JSON5.parse(UE 的 .uproject 容忍注释和尾部逗号)。
 */

import * as vscode from 'vscode';

export interface UProjectRaw {
  FileVersion?: number;
  EngineAssociation?: string;
  Category?: string;
  Description?: string;
  Modules?: Array<{ Name: string; Type?: string; LoadingPhase?: string }>;
  Plugins?: Array<{ Name: string; Enabled?: boolean }>;
  TargetPlatforms?: string[];
  [key: string]: unknown;
}

export async function readUProject(projectPath: string): Promise<UProjectRaw | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(projectPath));
    const text = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(text) as UProjectRaw;
  } catch {
    return null;
  }
}

/**
 * Returns the list of enabled plugins, e.g. for clangd `.clangd` config
 * generation in Phase 3.
 */
export function getEnabledPlugins(raw: UProjectRaw): string[] {
  if (!Array.isArray(raw.Plugins)) return [];
  return raw.Plugins.filter((p) => p?.Enabled !== false)
    .map((p) => p.Name)
    .filter(Boolean);
}
