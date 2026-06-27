/**
 * engineDiscovery —— 验证 .code-workspace 里声明的引擎路径
 *
 * ## 设计
 *
 * .code-workspace 是单一信息源。用户在 folders[].path 里声明引擎根目录,
 * 本类负责:
 *   1. 验证每个候选路径下面真的有 Engine/Build/Build.version(才是真引擎)
 *   2. 读 Build.version 拿到版本号
 *   3. 去重(同一路径大小写不同只保留一个)
 *   4. 按版本号倒序排列(最新版本在前)
 *
 * 验证失败的路径通过 getInvalidPaths() 返回,用于错误报告。
 *
 * ## 注意
 *
 * isLauncherInstall 字段当前总是 true,语义上不太准确 —— 我们不再用
 * Epic Launcher 路径,所有引擎都是从 .code-workspace 显式声明的。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface EngineDiscoveryOptions {
  /**
   * Paths to validate as UE engine roots. Typically read from
   * `.code-workspace` `folders[].path` entries.
   */
  candidates: string[];
}

export interface DiscoveryResult {
  valid: EngineInstall[];
  invalid: string[];
}

export interface EngineInstall {
  path: string;
  version: string;
  isLauncherInstall: boolean;
}

interface BuildVersion {
  MajorVersion: number;
  MinorVersion: number;
  PatchVersion: number;
}

export class EngineDiscovery {
  private readonly invalid: string[] = [];

  constructor(private readonly opts: EngineDiscoveryOptions) {
    if (!opts.candidates) {
      throw new Error('EngineDiscovery requires candidates array');
    }
  }

  async discover(): Promise<EngineInstall[]> {
    const result = await this.discoverWithErrors();
    return result.valid;
  }

  async discoverWithErrors(): Promise<DiscoveryResult> {
    const installs: EngineInstall[] = [];
    const seen = new Set<string>();
    this.invalid.length = 0;

    for (const candidate of this.opts.candidates) {
      if (!candidate || candidate.trim().length === 0) continue;
      const install = await this.validate(candidate);
      if (!install) {
        this.invalid.push(candidate);
        continue;
      }
      const key = this.normalize(install.path);
      if (seen.has(key)) continue;
      seen.add(key);
      installs.push(install);
    }

    installs.sort((a, b) => this.compareVersions(b.version, a.version));
    return { valid: installs, invalid: [...this.invalid] };
  }

  /** Return paths that were provided but did not validate. */
  getInvalidPaths(): string[] {
    return [...this.invalid];
  }

  // --- Validation ---

  private async validate(candidate: string): Promise<EngineInstall | null> {
    if (!(await this.isEngineRoot(candidate))) return null;
    const version = await this.readVersion(candidate);
    if (!version) return null;
    return {
      path: candidate,
      version,
      isLauncherInstall: true,
    };
  }

  private async isEngineRoot(candidate: string): Promise<boolean> {
    try {
      const stat = await fs.stat(path.join(candidate, 'Engine', 'Build', 'Build.version'));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private async readVersion(engineRoot: string): Promise<string | null> {
    try {
      const text = await fs.readFile(
        path.join(engineRoot, 'Engine', 'Build', 'Build.version'),
        'utf-8',
      );
      const v = JSON.parse(text) as BuildVersion;
      if (
        typeof v.MajorVersion === 'number' &&
        typeof v.MinorVersion === 'number' &&
        typeof v.PatchVersion === 'number'
      ) {
        return `${v.MajorVersion}.${v.MinorVersion}.${v.PatchVersion}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  private normalize(p: string): string {
    return path
      .resolve(p)
      .toLowerCase()
      .replace(/[\\/]+/g, '/');
  }

  private compareVersions(a: string, b: string): number {
    const parse = (s: string): [number, number, number] => {
      const parts = s.split('.').map((n) => Number.parseInt(n, 10) || 0);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };
    const [aMaj, aMin, aPatch] = parse(a);
    const [bMaj, bMin, bPatch] = parse(b);
    if (aMaj !== bMaj) return aMaj - bMaj;
    if (aMin !== bMin) return aMin - bMin;
    return aPatch - bPatch;
  }
}
