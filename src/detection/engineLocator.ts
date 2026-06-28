/**
 * engineLocator —— 按版本号找 UE 引擎安装路径
 *
 * 引擎版本从 .uproject 的 EngineAssociation 字段读取。
 * 给定 "5.8" 这样的版本号,按以下顺序查找实际安装路径:
 *
 *   1. Windows 注册表: HKLM\SOFTWARE\EpicGames\Unreal Engine\<version>
 *   2. 常见路径: C/D/E:\Program Files\Epic Games\UE_<version>
 *   3. Mac 文件系统: ~/Library/Application Support/Epic/UnrealEngine/*
 *   4. Linux 文件系统: ~/UnrealEngine/*, /opt/UnrealEngine/*
 *
 * 每个候选都用 Engine/Build/Build.version 验证。
 *
 * ## 状态
 *
 * 当前未被使用 —— 我们改用 .code-workspace 显式声明引擎路径。
 * 保留作为后备 API。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EngineInstall } from './types';

const execFileAsync = promisify(execFile);

export interface EngineLocation {
  path: string;
  version: string;
  source: 'registry' | 'common-path' | 'mac-fs' | 'linux-fs';
}

export async function locateEngineByVersion(version: string): Promise<EngineLocation | null> {
  if (!version || version.trim().length === 0) {return null;}

  if (process.platform === 'win32') {
    const fromReg = await locateFromRegistry(version);
    if (fromReg) {return fromReg;}
    const fromPath = await locateFromCommonPaths(version);
    if (fromPath) {return fromPath;}
  } else if (process.platform === 'darwin' || process.platform === 'linux') {
    const fromFs = await locateFromFilesystem(version, process.platform);
    if (fromFs) {return fromFs;}
  }
  return null;
}

export async function locateEngineByVersionAsInstall(
  version: string,
): Promise<EngineInstall | null> {
  const loc = await locateEngineByVersion(version);
  if (!loc) {return null;}
  return {
    path: loc.path,
    version: loc.version,
    isLauncherInstall: loc.source === 'registry',
  };
}

// --- Windows ---

async function locateFromRegistry(version: string): Promise<EngineLocation | null> {
  for (const regPath of [
    `HKLM\\SOFTWARE\\EpicGames\\Unreal Engine\\${version}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\EpicGames\\Unreal Engine\\${version}`,
    `HKCU\\SOFTWARE\\Epic Games, Inc.\\Unreal Engine\\${version}`,
  ]) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', regPath, '/v', 'InstallLocation']);
      const m = /InstallLocation\s+REG_SZ\s+(.+)/.exec(stdout);
      const p = m?.[1]?.trim();
      if (p && (await hasBuildVersion(p))) {
        return { path: p, version, source: 'registry' };
      }
    } catch {
      // skip this registry key
    }
  }
  return null;
}

async function locateFromCommonPaths(version: string): Promise<EngineLocation | null> {
  const driveLetters = ['C', 'D', 'E', 'F'];
  for (const drive of driveLetters) {
    const candidate = `${drive}:\\Program Files\\Epic Games\\UE_${version}`;
    if (await hasBuildVersion(candidate)) {
      const v = await readVersion(candidate);
      return { path: candidate, version: v ?? version, source: 'common-path' };
    }
  }
  return null;
}

// --- Mac / Linux ---

async function locateFromFilesystem(
  version: string,
  platform: 'darwin' | 'linux',
): Promise<EngineLocation | null> {
  const home = process.env.HOME ?? '';
  const parents: string[] = [];
  if (platform === 'darwin') {
    parents.push(
      path.join(home, 'Library', 'Application Support', 'Epic', 'UnrealEngine'),
      '/Users/Shared/Epic Games',
    );
  } else {
    parents.push(path.join(home, 'UnrealEngine'), '/opt/UnrealEngine', '/usr/local/UnrealEngine');
  }

  for (const parent of parents) {
    try {
      const entries = await fs.readdir(parent, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {continue;}
        const candidate = path.join(parent, entry.name);
        if (!(await hasBuildVersion(candidate))) {continue;}
        const v = await readVersion(candidate);
        if (v?.startsWith(`${version}.`)) {
          return {
            path: candidate,
            version: v,
            source: platform === 'darwin' ? 'mac-fs' : 'linux-fs',
          };
        }
      }
    } catch {
      // skip unreadable parents
    }
  }
  return null;
}

// --- Validation ---

async function hasBuildVersion(folder: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(folder, 'Engine', 'Build', 'Build.version'));
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readVersion(engineRoot: string): Promise<string | null> {
  try {
    const text = await fs.readFile(
      path.join(engineRoot, 'Engine', 'Build', 'Build.version'),
      'utf-8',
    );
    const v = JSON.parse(text) as {
      MajorVersion: number;
      MinorVersion: number;
      PatchVersion: number;
    };
    return `${v.MajorVersion}.${v.MinorVersion}.${v.PatchVersion}`;
  } catch {
    return null;
  }
}
