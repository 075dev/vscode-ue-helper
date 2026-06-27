/**
 * uprojectAssociation —— 检查系统是否安装了 Unreal Engine
 *
 * ## 用途
 *
 * 当插件在 .code-workspace 不存在的情况下启动时,
 * 用这个模块判断 UE 是否安装,给用户显示正确的引导信息:
 *   - 没装 UE: 引导去 Epic Launcher 下载
 *   - 装了 UE 但没 .code-workspace: 引导生成一个
 *
 * ## 检查方法
 *
 * - Windows: reg query HKCR\.uproject /ve 检查文件关联
 *            fallback: HKLM\SOFTWARE\EpicGames\Unreal Engine
 * - Mac/Linux: 扫描文件系统标准位置(Library/Application Support/Epic/...)
 *
 * ## 关键函数
 *
 * checkUprojectAssociation() 返回 boolean,所有检查都失败才返回 false
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Returns true if the OS has UE installed (either via registry association
 * or via filesystem scan of common install locations).
 */
export async function checkUprojectAssociation(): Promise<boolean> {
  if (process.platform === 'win32') {
    return checkWindowsRegistry();
  }
  return checkFilesystemFallback();
}

async function checkWindowsRegistry(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKCR\\.uproject', '/ve']);
    // Success + non-empty output means there's an association registered.
    return /Default\s+REG_SZ\s+\S+/i.test(stdout);
  } catch {
    // If HKCR\.uproject doesn't exist at all, reg query fails — UE not installed.
    // Also try the Epic Games registry as a fallback (some installs register there).
    return checkEpicGamesRegistry();
  }
}

async function checkEpicGamesRegistry(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('reg', [
      'query',
      'HKLM\\SOFTWARE\\EpicGames\\Unreal Engine',
    ]);
    return stdout.includes('Unreal Engine');
  } catch {
    return false;
  }
}

async function checkFilesystemFallback(): Promise<boolean> {
  // Mac: ~/Library/Application Support/Epic/UnrealEngine/*/Engine/Binaries/Mac/UnrealEditor
  // Linux: any standard install location
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const candidates: string[] = [];
  if (process.platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Application Support', 'Epic', 'UnrealEngine'),
      '/Users/Shared/Epic Games',
    );
  } else if (process.platform === 'linux') {
    candidates.push(
      path.join(home, 'UnrealEngine'),
      '/opt/UnrealEngine',
      '/usr/local/UnrealEngine',
    );
  }
  for (const parent of candidates) {
    try {
      const entries = await fs.readdir(parent, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const buildVersion = path.join(parent, entry.name, 'Engine', 'Build', 'Build.version');
        try {
          const stat = await fs.stat(buildVersion);
          if (stat.isFile()) return true;
        } catch {
          // not an engine root, skip
        }
      }
    } catch {
      // parent doesn't exist, skip
    }
  }
  return false;
}
