/**
 * workspaceEngines — read `.code-workspace` files to discover UE engine
 * paths declared in `folders[].path`.
 *
 * Pattern: a multi-root workspace can list the UE engine as one of its
 * folders. The path may be absolute ("D:\\Program Files\\Epic Games\\UE_5.7")
 * or relative ("./Engine"). We resolve both to absolute paths and let
 * the caller validate them via `EngineDiscovery`.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface WorkspaceFolder {
  path: string;
  name?: string;
}

interface WorkspaceFile {
  folders?: WorkspaceFolder[];
}

export async function readWorkspaceEngines(workspaceFile: string): Promise<string[]> {
  try {
    const text = await fs.readFile(workspaceFile, 'utf-8');
    const parsed = JSON.parse(text) as WorkspaceFile;
    if (!Array.isArray(parsed.folders)) return [];
    const workspaceRoot = path.dirname(workspaceFile);
    const out: string[] = [];
    for (const folder of parsed.folders) {
      if (!folder?.path) continue;
      const resolved = path.isAbsolute(folder.path)
        ? folder.path
        : path.resolve(workspaceRoot, folder.path);
      out.push(resolved);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Find all .code-workspace files in the workspace folders and return
 * the engine candidate paths they declare.
 *
 * Heuristic: a folder is an "engine candidate" if its name is one of:
 *   - "UE" / "UE5" / "UE4" / "UnrealEngine"
 *   - contains "UE_" (Epic Launcher install naming)
 *   - contains "Unreal Engine"
 *
 * We could just return ALL folder paths and let EngineDiscovery validate,
 * but filtering by name cuts false positives from non-engine folders.
 */
export async function discoverEngineCandidatesFromWorkspace(
  workspaceRoots: string[],
): Promise<string[]> {
  const candidates: string[] = [];
  const enginePattern =
    /(^|[\\/])(UE\d?|UE_\d|UE_\d+\.\d|UnrealEngine|Unreal Engine|UnrealEngine\d*)$/i;
  for (const root of workspaceRoots) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.code-workspace')) continue;
        const paths = await readWorkspaceEngines(path.join(root, entry.name));
        for (const p of paths) {
          if (enginePattern.test(p) || enginePattern.test(path.basename(p))) {
            candidates.push(p);
          }
        }
      }
    } catch {
      // skip unreadable roots
    }
  }
  return candidates;
}
