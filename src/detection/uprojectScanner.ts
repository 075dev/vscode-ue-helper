/**
 * uprojectScanner —— 解析 .uproject 文件
 *
 * ## 设计原则
 *
 * 项目路径严格来自 .code-workspace folders[],不接受任何全工作区扫描。
 * 调用方必须显式传入 folderPaths 数组,否则抛错。
 *
 * ## 入口
 *
 * - scan(folderPaths): 必须传 folderPaths 数组(从 detection.workspaceFolders 取)
 * - parseFromPath(uprojectPath): 给定已知路径直接解析(detection 主入口用这个)
 *
 * ## JSON5 解析
 *
 * UE 的 .uproject 不是严格 JSON —— 允许注释、尾部逗号、单引号。
 * 之前用 JSON.parse 会失败(用户报告 status bar 显示 No Project),改用 JSON5.parse。
 */

import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import * as JSON5 from 'json5';
import { ProjectInfo } from './types';

interface RawUProject {
  EngineAssociation?: string;
  Modules?: Array<{ Name?: string }>;
  Targets?: Array<{ Name?: string; PlatformAllowList?: string[] }>;
}

export class UprojectScanner {
  /**
   * Scan .uproject files inside the given workspace folders.
   *
   * **Caller must supply `folderPaths` explicitly** — this method never
   * falls back to a full-workspace scan. Empty / undefined input throws so
   * that any future violation is caught at runtime (TypeScript also
   * prevents `scan()` without arguments because the parameter is required).
   */
  async scan(folderPaths: string[]): Promise<ProjectInfo[]> {
    if (!folderPaths || folderPaths.length === 0) {
      throw new Error(
        'UprojectScanner.scan requires non-empty folderPaths array — no full-workspace scanning allowed',
      );
    }
    const files: string[] = [];
    for (const folder of folderPaths) {
      try {
        // Use VS Code's native file search — it handles Windows drive
        // letters, path encoding, and case-insensitivity correctly.
        // `fs.readdir` directly on Windows paths can fail in extension
        // host context (we saw "projects: (none)" with 2 folders detected).
        const pattern = new vscode.RelativePattern(folder, '*.uproject');
        const found = await vscode.workspace.findFiles(pattern);
        for (const uri of found) {
          files.push(uri.fsPath);
        }
      } catch (err) {
        // Folder may not exist or not be readable — skip silently.
        console.warn(`[uprojectScanner] failed to scan ${folder}:`, err);
      }
    }

    const projects: ProjectInfo[] = [];
    for (const filePath of files) {
      try {
        const info = await this.parseUProject(filePath);
        if (info) {projects.push(info);}
      } catch (err) {
        console.warn(`[uprojectScanner] failed to parse ${filePath}:`, err);
      }
    }
    return projects;
  }

  /**
   * Parse a known `.uproject` file path directly. Used by the detection
   * layer when `.code-workspace` `folders[0]` already gives us the exact
   * path — no filesystem search needed.
   */
  async parseFromPath(uprojectPath: string): Promise<ProjectInfo | null> {
    try {
      return await this.parseUProject(uprojectPath);
    } catch (err) {
      console.warn(`[uprojectScanner] failed to parse ${uprojectPath}:`, err);
      return null;
    }
  }

  private async parseUProject(filePath: string): Promise<ProjectInfo | null> {
    const bytes = await fs.readFile(filePath);
    const text = new TextDecoder('utf-8').decode(bytes);
    let raw: RawUProject;
    try {
      // UE's .uproject is JSON5-ish: allows trailing commas and comments.
      // Strict JSON.parse fails on these — use JSON5 to match UBT's tolerance.
      raw = JSON5.parse(text);
    } catch (err) {
      console.warn(`[uprojectScanner] JSON5 parse failed for ${filePath}:`, err);
      return null;
    }

    const name = stripExt(baseName(filePath));
    const modules: string[] = [];
    if (Array.isArray(raw.Modules)) {
      for (const m of raw.Modules) {
        if (m?.Name && typeof m.Name === 'string') {modules.push(m.Name);}
      }
    }
    if (Array.isArray(raw.Targets)) {
      for (const t of raw.Targets) {
        if (t?.Name && typeof t.Name === 'string' && !modules.includes(t.Name)) {
          modules.push(t.Name);
        }
      }
    }

    return {
      path: filePath,
      name,
      engineAssociation: typeof raw.EngineAssociation === 'string' ? raw.EngineAssociation : '',
      modules,
      raw,
    };
  }
}

function baseName(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? p : p.slice(idx + 1);
}

function stripExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? name : name.slice(0, idx);
}
