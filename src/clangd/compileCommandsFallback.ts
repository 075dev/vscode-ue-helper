/**
 * compileCommandsFallback -- UBT 失败时的降级 compile_commands.json 生成（P1-3）
 *
 * 当 UBT GenerateClangDatabase 失败（UHT 错误等）导致 compile_commands.json 缺失时，
 * 生成一份"够用"的 fallback DB，让 clangd 能附着、给基本补全。
 * 借鉴 unreal-sense.nvim 的 generate_fallback_db。
 *
 * 数据来源：
 *   1. 项目 Source 下所有 .Build.cs -> PublicIncludePaths / PrivateIncludePaths
 *   2. UHT manifest（Intermediate/Build 下所有 .uhtmanifest）-> Modules[].IncludePaths
 *   3. engine core include（Engine/Source/Runtime/<core>/Public）
 *   4. 项目 Source / Plugins 所有含源码的子目录
 *
 * 每个 .cpp 生成一条：
 *   clang++ -std=c++20 -DUE_BUILD_* -D__UNREAL__=1 ... -I<paths> -include ueClangdCompat.h <cpp>
 *
 * ⚠️ fallback DB 不含完整宏定义/正确的 PCH，clangd 会有误报，但比"完全不可用"强。
 *    日志明确标注 fallback 状态；缓存条目标 fallback: true，命中时不走快路径（下次仍重试 UBT）。
 */

import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import { getUeClangdCompatPath, getUeClangdCompatContent } from './ueClangdCompat';
import { collectIntermediateUhtDirs } from './intermediateUhtCollector';

/** fallback DB 写入位置（与 linkToWorkspaceRoot 目标一致：.vscode/vscodeuehelper/） */
const FALLBACK_CC_DIR_REL = path.join('.vscode', 'vscodeuehelper');

/** compile_commands.json 文件名 */
const CC_FILENAME = 'compile_commands.json';

/** 扫描时跳过的目录名（非源码 / 生成物） */
const SKIP_DIRS = new Set(['Intermediate', 'Binaries', '.git', 'Saved', '.vs', 'Build']);

/** 引擎核心模块（其 Public 目录作为 fallback include） */
const ENGINE_CORE_MODULES = [
  'Core', 'CoreUObject', 'ApplicationCore', 'RHI', 'RenderCore',
  'SlateCore', 'Slate', 'Engine', 'InputCore', 'AssetRegistry',
  'Json', 'JsonUtilities', 'Projects', 'NetCore', 'Sockets',
];

/**
 * buildType -> UE_BUILD_* 宏映射。
 * 让条件编译 #if UE_BUILD_* 等在 fallback DB 下也能正确分支。
 */
function buildTypeToMacro(buildType: string | undefined): string {
  switch (buildType) {
    case 'Debug': return 'UE_BUILD_DEBUG=1';
    case 'DebugGame': return 'UE_BUILD_DEBUG_GAME=1';
    case 'Shipping': return 'UE_BUILD_SHIPPING=1';
    case 'Test': return 'UE_BUILD_TEST=1';
    case 'Development':
    default: return 'UE_BUILD_DEVELOPMENT=1';
  }
}

export interface FallbackOptions {
  /** .uproject 绝对路径 */
  project: string;
  /** engine root 绝对路径 */
  engineRoot: string;
  logger?: Logger;
  workspace?: WorkspaceState;
  /** UBT buildType（默认 Development） */
  buildType?: string;
}

export interface FallbackResult {
  /** 写入的 cc.json 绝对路径 */
  ccPath: string;
  /** 生成的条目数 */
  entryCount: number;
  /** 收集的 include 路径数 */
  includeCount: number;
}

/**
 * 递归扫描目录下所有 .cpp 文件（跳过 Intermediate/Binaries 等生成物目录）。
 */
async function scanCppFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) { continue; }
      results.push(...await scanCppFiles(full));
    } else if (entry.isFile() && /\.cpp$/i.test(entry.name)) {
      results.push(path.normalize(full));
    }
  }
  return results;
}

/**
 * 递归收集含源码（.h/.hpp/.cpp/.inl）的目录到 acc（作为 include 路径）。
 */
async function collectSourceDirs(dir: string, acc: Set<string>): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  let hasSource = false;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) { continue; }
      await collectSourceDirs(path.join(dir, entry.name), acc);
    } else if (entry.isFile() && /\.(h|hpp|cpp|inl)$/i.test(entry.name)) {
      hasSource = true;
    }
  }
  if (hasSource) {
    acc.add(dir);
  }
}

/**
 * 递归查找指定后缀的文件。
 */
async function findFilesByExt(dir: string, ext: string): Promise<string[]> {
  const results: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findFilesByExt(full, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * 从 Source 下 .Build.cs 提取 PublicIncludePaths / PrivateIncludePaths。
 *
 * 匹配 `PublicIncludePaths.AddRange(new string[] { "Path1", "Path2" })` 形式，
 * 路径相对 .Build.cs 所在目录解析为绝对路径。
 */
async function extractBuildCsIncludes(projectDir: string): Promise<string[]> {
  const sourceDir = path.join(projectDir, 'Source');
  const buildCsFiles = await findFilesByExt(sourceDir, '.Build.cs');
  const includes: string[] = [];
  const re = /(?:Public|Private)IncludePaths\.AddRange\s*\(\s*new\s+string\[\]\s*\{([^}]*)\}/g;
  for (const csFile of buildCsFiles) {
    try {
      const content = await fs.readFile(csFile, 'utf-8');
      const csDir = path.dirname(csFile);
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const pathsStr = m[1] ?? '';
        const strs = pathsStr.match(/"([^"]+)"/g) ?? [];
        for (const s of strs) {
          const p = s.slice(1, -1);
          // 相对路径相对 csDir 解析；绝对路径直接用
          includes.push(path.isAbsolute(p) ? p : path.join(csDir, p));
        }
      }
    } catch {
      // 读取失败跳过该 .Build.cs
    }
  }
  return includes;
}

/**
 * 从 UHT manifest（Intermediate/Build 下 .uhtmanifest）提取 Modules[].IncludePaths。
 * best-effort：manifest 不存在或解析失败则返回空。
 */
async function extractUhtManifestIncludes(projectDir: string): Promise<string[]> {
  const buildDir = path.join(projectDir, 'Intermediate', 'Build');
  const manifests = await findFilesByExt(buildDir, '.uhtmanifest');
  const includes: string[] = [];
  for (const manifest of manifests) {
    try {
      const content = await fs.readFile(manifest, 'utf-8');
      const parsed = JSON.parse(content) as { Modules?: Array<{ IncludePaths?: string[] }> };
      for (const mod of parsed.Modules ?? []) {
        for (const p of mod.IncludePaths ?? []) {
          includes.push(p);
        }
      }
    } catch {
      // 解析失败跳过该 manifest
    }
  }
  return includes;
}

/**
 * 确保 ueClangdCompat.h 存在，不存在则 best-effort 写入。
 * fallback 可能在 createProject step 2（completionFiles 之前）调用，需自洽。
 */
async function ensureCompatHeader(projectPath: string, logger?: Logger): Promise<string> {
  const compatPath = getUeClangdCompatPath(projectPath);
  try {
    await fs.access(compatPath);
  } catch {
    try {
      await fs.mkdir(path.dirname(compatPath), { recursive: true });
      await fs.writeFile(compatPath, getUeClangdCompatContent(), 'utf-8');
      logger?.info(`[fallback] created ueClangdCompat.h at ${compatPath}`);
    } catch (err) {
      logger?.warn(`[fallback] failed to create ueClangdCompat.h: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return compatPath;
}

/**
 * 过滤 include 集合，仅保留实际存在的目录。
 */
async function filterExistingDirs(candidates: Iterable<string>, existing: Set<string>): Promise<void> {
  for (const p of candidates) {
    if (existing.has(p)) { continue; }
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) { existing.add(p); }
    } catch {
      // 不存在，跳过
    }
  }
}

/**
 * 生成 fallback compile_commands.json。
 *
 * @returns 写入路径与统计；无 .cpp 文件或写入失败时返回 undefined
 */
export async function generateFallbackCompileCommands(opts: FallbackOptions): Promise<FallbackResult | undefined> {
  const log = opts.logger ?? new Logger('fallback');
  const projectDir = opts.workspace?.projectDir ?? path.dirname(opts.project);

  log.warn(`[fallback] generating FALLBACK compile_commands.json (UBT failed) for ${projectDir}`);

  // 1. 收集 include 路径候选（去重）
  const includeCandidates = new Set<string>();

  // 1a. engine core Public 目录
  for (const mod of ENGINE_CORE_MODULES) {
    includeCandidates.add(path.join(opts.engineRoot, 'Source', 'Runtime', mod, 'Public'));
  }

  // 1b. 项目 Source 子目录
  const sourceDir = path.join(projectDir, 'Source');
  await collectSourceDirs(sourceDir, includeCandidates);

  // 1c. Plugins/*/Source 子目录
  const pluginsDir = path.join(projectDir, 'Plugins');
  try {
    const pluginEntries = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const e of pluginEntries) {
      if (e.isDirectory()) {
        await collectSourceDirs(path.join(pluginsDir, e.name, 'Source'), includeCandidates);
      }
    }
  } catch {
    // 无 Plugins 目录，跳过
  }

  // 1d. .Build.cs IncludePaths
  for (const p of await extractBuildCsIncludes(projectDir)) {
    includeCandidates.add(p);
  }

  // 1e. uhtmanifest IncludePaths
  for (const p of await extractUhtManifestIncludes(projectDir)) {
    includeCandidates.add(p);
  }

  // 1f. UHT 生成的 .generated.h 路径（修复 plugin .cpp 找不到 .generated.h）
  //      Intermediate/Build/<PlatformCfg>/<Target>/Inc/<Module>/UHT/
  for (const uhtDir of await collectIntermediateUhtDirs({ projectDir })) {
    includeCandidates.add(uhtDir);
  }

  // 过滤出实际存在的目录
  const includePaths = new Set<string>();
  await filterExistingDirs(includeCandidates, includePaths);

  // 2. 确保 compat header
  const compatPath = await ensureCompatHeader(opts.project, log);

  // 3. 扫 .cpp（项目 Source + Plugins/*/Source）
  const cppFiles = await scanCppFiles(sourceDir);
  try {
    const pluginEntries = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const e of pluginEntries) {
      if (e.isDirectory()) {
        cppFiles.push(...await scanCppFiles(path.join(pluginsDir, e.name, 'Source')));
      }
    }
  } catch {
    // 无 Plugins，跳过
  }

  if (cppFiles.length === 0) {
    log.warn('[fallback] no .cpp files found, cannot generate fallback DB');
    return undefined;
  }

  // 4. 构造条目
  const buildMacro = buildTypeToMacro(opts.buildType);
  const commonArgs = [
    'clang++',
    '-std=c++20',
    `-D${buildMacro}`,
    '-D__UNREAL__=1',
    '-DWITH_ENGINE=1',
    '-DWITH_UNREAL_DEVELOPER_TOOLS=1',
    '-DWITH_APPLICATION_CORE=1',
    '-DWITH_COREUOBJECT=1',
    '-fms-compatibility',
    '-fms-compatibility-version=19.29',
    ...[...includePaths].map((p) => `-I${p}`),
    // [-include 兼容头] fallback 路径下 .generated.h 可能缺失或过期，强制在所有其他 include
    // 之前 include ueClangdCompat.h。重写 BODY_MACRO_COMBINE 后，UCLASS() / GENERATED_BODY()
    // 仍能展开为合法 C++ stub，避免 clangd 报 unknown_typename 以及后续补全失效。
    // 注意：此 -include 仅影响 clangd 索引；真实编译仍由真正的 .generated.h 驱动。
    '-include',
    compatPath,
  ];

  const entries = cppFiles.map((cpp) => ({
    directory: projectDir,
    file: cpp,
    command: `${commonArgs.join(' ')} ${cpp}`,
  }));

  // 5. 原子写入（temp + rename）
  const ccDir = path.join(projectDir, FALLBACK_CC_DIR_REL);
  await fs.mkdir(ccDir, { recursive: true });
  const ccPath = path.join(ccDir, CC_FILENAME);
  const tmpPath = `${ccPath}.tmp`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
    await fs.rename(tmpPath, ccPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[fallback] failed to write fallback DB: ${msg}`);
    return undefined;
  }

  log.warn(
    `[fallback] FALLBACK DB written: ${entries.length} entries, ${includePaths.size} include paths -> ${ccPath}`,
  );
  return { ccPath, entryCount: entries.length, includeCount: includePaths.size };
}
