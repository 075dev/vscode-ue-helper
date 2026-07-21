/**
 * intermediateUhtCollector —— 收集 UHT 生成的 .generated.h 所在目录
 *
 * 路径固定格式：
 *   <projectDir>/Intermediate/Build/<PlatformCfg>/<Target>/Inc/<Module>/UHT/
 *
 * 三层固定结构（per UEBuildModuleCPP.cs:GenerateIncPathTable），限深扫描。
 * 不读 .h 文件内容，只 stat 验证目录存在。
 *
 * 用途：
 *   - compileCommandsFallback: 注入 -I 让 clangd 找到 .generated.h
 *   - flagGlossary.resolveFlags('uht-include-dirs') → ClangdOps.applyAddFlags（[Phase 9 SSoT]）
 *
 * 性能：<ModuleCount> 次 readdir + stat，典型 5-20ms。
 */

import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';

export interface IntermediateUhtCollectorOptions {
  /** 项目根目录（含 .uproject） */
  projectDir: string;
}

/**
 * 收集 <projectDir>/Intermediate/Build/<PlatformCfg>/<Target>/Inc/<Module>/UHT/ 目录。
 *
 * 任一层目录不存在（try/catch）正常跳过：项目未构建过 → 返回空数组。
 */
export async function collectIntermediateUhtDirs(
  opts: IntermediateUhtCollectorOptions,
): Promise<string[]> {
  const buildDir = path.join(opts.projectDir, 'Intermediate', 'Build');
  const dirs: string[] = [];

  let platformEntries: Dirent[];
  try {
    platformEntries = await fs.readdir(buildDir, { withFileTypes: true });
  } catch {
    return dirs;
  }

  for (const pc of platformEntries) {
    if (!pc.isDirectory()) { continue; }
    const platformCfgDir = path.join(buildDir, pc.name);

    let targetEntries: Dirent[];
    try {
      targetEntries = await fs.readdir(platformCfgDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const target of targetEntries) {
      if (!target.isDirectory()) { continue; }
      const incDir = path.join(platformCfgDir, target.name, 'Inc');

      let moduleEntries: Dirent[];
      try {
        moduleEntries = await fs.readdir(incDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const mod of moduleEntries) {
        if (!mod.isDirectory()) { continue; }
        const uhtDir = path.join(incDir, mod.name, 'UHT');
        try {
          const stat = await fs.stat(uhtDir);
          if (stat.isDirectory()) { dirs.push(uhtDir); }
        } catch {
          /* UHT 目录不存在（该模块没有 UCLASS）跳过 */
        }
      }
    }
  }

  return dirs;
}