/**
 * vsBuildTools —— 通过 vswhere.exe 定位 Visual Studio Build Tools
 *
 * ## 用途
 *
 * 仅 Windows 相关。VS Build Tools 装了多个 VS 实例时,
 * 用 vswhere.exe 查询所有可用版本,给后续 clangd 设置 -imsvc 用。
 *
 * 其他平台直接返回空数组。
 *
 * ## vswhere.exe 在哪
 *
 * - 默认:C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe
 * - 或:C:\Program Files\Microsoft Visual Studio\Installer\vswhere.exe
 * - 不在 PATH 上,大多数情况需要硬编码路径
 *
 * 详见 findAll() 方法。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { VSInstallation } from './types';

interface ExecaOptions {
  reject?: boolean;
  timeout?: number;
}

interface ExecaResult {
  stdout: string;
  stderr: string;
}

/**
 * Drop-in replacement for the subset of execa we use. We avoid the execa
 * dependency here because it's ESM-only and we're emitting CJS from
 * esbuild — Node's built-in `execFile` is simpler and works everywhere.
 */
function runExeca(file: string, args: string[], opts: ExecaOptions = {}): Promise<ExecaResult> {
  return new Promise<ExecaResult>((resolve) => {
    execFile(
      file,
      args,
      { timeout: opts.timeout ?? 30000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && opts.reject !== false) {
          // Caller wants to surface errors.
          resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? err.message) });
        } else {
          resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
        }
      },
    );
  });
}

const DEFAULT_VSWHERE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',
  'C:\\Program Files\\Microsoft Visual Studio\\Installer\\vswhere.exe',
];

interface VsWhereOutput {
  displayName?: string;
  installationPath?: string;
  installationVersion?: string;
}

export class VsBuildTools {
  /**
   * @param vswherePathOverride Override the default vswhere.exe lookup.
   *   Test seam — production code relies on the default locations.
   */
  constructor(private readonly vswherePathOverride?: string) {}

  async findLatest(): Promise<VSInstallation | null> {
    const all = await this.findAll();
    return all[0] ?? null;
  }

  async findAll(): Promise<VSInstallation[]> {
    if (process.platform !== 'win32') {
      return [];
    }

    const vswhere = await this.locateVswhere();
    if (!vswhere) {
      return [];
    }

    try {
      const { stdout } = await runExeca(
        vswhere,
        [
          '-latest',
          '-requires',
          'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
          '-format',
          'json',
          '-utf8',
        ],
        { reject: false, timeout: 10_000 },
      );
      if (!stdout || !stdout.trim()) {
        return [];
      }
      const parsed = JSON.parse(stdout) as VsWhereOutput[];
      const installations: VSInstallation[] = [];
      for (const inst of parsed) {
        if (!inst.installationPath || !inst.displayName) {
          continue;
        }
        const vcToolsPath = await this.findVcToolsPath(inst.installationPath);
        installations.push({
          displayName: inst.displayName,
          installationPath: inst.installationPath,
          version: inst.installationVersion ?? '',
          vcToolsPath,
        });
      }
      return installations;
    } catch (err) {
      console.warn('[VsBuildTools] vswhere invocation failed:', err);
      return [];
    }
  }

  private async locateVswhere(): Promise<string | null> {
    if (this.vswherePathOverride) {
      if (await this.fileExists(this.vswherePathOverride)) {
        return this.vswherePathOverride;
      }
      return null;
    }
    for (const candidate of DEFAULT_VSWHERE_PATHS) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }
    // Last resort: ask PATH via `where`. Most Windows installs don't put
    // vswhere on PATH, but it doesn't hurt to check.
    try {
      const { stdout } = await runExeca('where', ['vswhere'], { reject: false, timeout: 3000 });
      const first = stdout.split(/\r?\n/)[0]?.trim();
      if (first && (await this.fileExists(first))) {
        return first;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      const stat = await fs.stat(p);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Locate the MSVC toolset dir under the VS install. Convention:
   *   <installRoot>\VC\Tools\MSVC\<version>\
   * We pick the highest-versioned subdir.
   */
  private async findVcToolsPath(installRoot: string): Promise<string | undefined> {
    const msvcRoot = path.join(installRoot, 'VC', 'Tools', 'MSVC');
    try {
      const entries = await fs.readdir(msvcRoot, { withFileTypes: true });
      const versions = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
        .reverse();
      const top = versions[0];
      return top ? path.join(msvcRoot, top) : undefined;
    } catch {
      return undefined;
    }
  }
}
