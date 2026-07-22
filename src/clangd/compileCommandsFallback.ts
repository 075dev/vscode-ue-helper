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
import { Logger, sharedLogger } from '@core/logger';
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
  'Core',
  'CoreUObject',
  'ApplicationCore',
  'RHI',
  'RenderCore',
  'SlateCore',
  'Slate',
  'Engine',
  'InputCore',
  'AssetRegistry',
  'Json',
  'JsonUtilities',
  'Projects',
  'NetCore',
  'Sockets',
];

/**
 * buildType -> UE_BUILD_* 宏映射。
 * 让条件编译 #if UE_BUILD_* 等在 fallback DB 下也能正确分支。
 */
function buildTypeToMacro(buildType: string | undefined): string {
  switch (buildType) {
    case 'Debug':
      return 'UE_BUILD_DEBUG=1';
    case 'DebugGame':
      return 'UE_BUILD_DEBUG_GAME=1';
    case 'Shipping':
      return 'UE_BUILD_SHIPPING=1';
    case 'Test':
      return 'UE_BUILD_TEST=1';
    case 'Development':
    default:
      return 'UE_BUILD_DEVELOPMENT=1';
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
  /**
   * 标记结果来自 fallback 路径（UBT 失败时的降级 DB）。
   * 主路径（UBT 成功生成 compile_commands.json）不设置该字段。
   * 下游可借此区分走"重试 UBT"还是"接受 fallback"策略。
   */
  fromFallback?: true;
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
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      results.push(...(await scanCppFiles(full)));
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
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
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
      results.push(...(await findFilesByExt(full, ext)));
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
 * 从 UHT manifest 提取项目内模块的 OutputDirectory。
 *
 * 用于 stub .generated.h 的优先写入位置（UHT 失败时 OutputDirectory 目录可能尚未生成，
 * 此时把 stub 直接写到同一位置即可让 `-I<OutputDirectory>` 自然找到 stub）。
 * 仅保留 BaseDirectory 在 projectDir 下（含子目录）的模块，
 * 避免误用引擎自带 manifest 的引擎模块 OutputDirectory。
 *
 * best-effort：manifest 不存在或解析失败则返回空。
 */
async function extractUhtManifestOutputDirs(projectDir: string): Promise<string[]> {
  const buildDir = path.join(projectDir, 'Intermediate', 'Build');
  const manifests = await findFilesByExt(buildDir, '.uhtmanifest');
  const outputs: string[] = [];
  for (const manifest of manifests) {
    try {
      const content = await fs.readFile(manifest, 'utf-8');
      const parsed = JSON.parse(content) as {
        Modules?: Array<{ BaseDirectory?: string; OutputDirectory?: string }>;
      };
      for (const mod of parsed.Modules ?? []) {
        const baseDir = mod.BaseDirectory;
        const outputDir = mod.OutputDirectory;
        if (!baseDir || !outputDir) {
          continue;
        }
        // 仅保留 BaseDirectory 位于 projectDir 之内的模块
        const rel = path.relative(projectDir, baseDir);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          continue;
        }
        outputs.push(outputDir);
      }
    } catch {
      // 解析失败跳过该 manifest
    }
  }
  return outputs;
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
      logger?.warn(
        `[fallback] failed to create ueClangdCompat.h: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return compatPath;
}

/** 反射宏正则：UCLASS / USTRUCT / UINTERFACE / UENUM 后紧跟括号 */
const REFLECTION_MACRO_RE = /\b(UCLASS|USTRUCT|UINTERFACE|UENUM)\s*\(/;

/**
 * 从 .h 路径派生 UE module 名。
 *
 *  - `Source/MyModule/Public/Foo.h` → `MyModule`
 *  - `Plugins/MyPlugin/Source/MyModule/Public/Foo.h` → `MyModule`
 *
 * 无法匹配标准布局时返回 undefined，调用方应跳过该 header。
 */
function deriveModuleName(headerPath: string, projectDir: string): string | undefined {
  const rel = path.relative(projectDir, headerPath);
  // path.relative 在 Windows 上使用 \，需兼容两种分隔符
  const parts = rel.split(/[\\/]/);
  if (parts.length < 3) {
    return undefined;
  }

  // Plugins/<Plugin>/Source/<Module>/...
  if (parts[0] === 'Plugins' && parts[2] === 'Source' && parts.length >= 4) {
    return parts[3];
  }

  // Source/<Module>/...
  if (parts[0] === 'Source' && parts.length >= 2) {
    return parts[1];
  }

  return undefined;
}

/**
 * 递归扫描目录下所有 .h 文件，复用 SKIP_DIRS 跳过 Intermediate/Binaries/Build 等生成物目录。
 */
async function scanHeaderFiles(dir: string, acc: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await scanHeaderFiles(full, acc);
    } else if (entry.isFile() && /\.h$/i.test(entry.name)) {
      acc.push(path.normalize(full));
    }
  }
}

/**
 * 扫描项目 Source + Plugins 下含 UE 反射宏的 .h，返回绝对路径列表。
 *
 * 用于无 .cpp 时为 fallback DB 生成 entry（让 clangd 仍能 attach、看到反射宏展开后的类型）。
 * 复用 scanHeaderFiles 递归逻辑 + REFLECTION_MACRO_RE 过滤；
 * 不写 stub（stub 由 writeStubGeneratedHeaders 提前生成，本函数不重复 IO）。
 */
async function scanReflectedHeadersForEntries(projectDir: string): Promise<string[]> {
  const headerFiles: string[] = [];
  await scanHeaderFiles(path.join(projectDir, 'Source'), headerFiles);
  try {
    const pluginsDir = path.join(projectDir, 'Plugins');
    const pluginEntries = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const e of pluginEntries) {
      if (e.isDirectory()) {
        await scanHeaderFiles(path.join(pluginsDir, e.name, 'Source'), headerFiles);
      }
    }
  } catch {
    // 无 Plugins 目录，跳过
  }

  const reflected: string[] = [];
  for (const headerPath of headerFiles) {
    try {
      const content = await fs.readFile(headerPath, 'utf-8');
      if (REFLECTION_MACRO_RE.test(content)) {
        reflected.push(path.normalize(headerPath));
      }
    } catch {
      // 读取失败跳过
    }
  }
  return reflected;
}

/**
 * 为含 UE 反射宏（UCLASS / USTRUCT / UINTERFACE / UENUM）的 .h 写一份兜底 stub .generated.h。
 *
 * 目的：当 UBT 失败导致 Intermediate/Build/<PlatformCfg>/<Target>/UHT/<Module>.generated.h 不存在时，
 *       `#include "Foo.generated.h"` 在 clangd 索引阶段找不到对应文件会报 unknown_typename。
 *       这里写入一份最小 stub：仅含 `#pragma once` + `#include "<ueClangdCompat.h>"`，
 *       让 include 路径至少能解析、clangd 把 .h 视作空 unit（真正的 UCLASS / GENERATED_BODY
 *       等宏展开由 ueClangdCompat.h 在编译期兜底）。
 *
 * stub 路径优先级：
 *   1. 解析 .uhtmanifest（Intermediate/Build/**.uhtmanifest），取项目内模块的 OutputDirectory。
 *      写入该目录时可以让 `-I<OutputDirectory>` 自然覆盖到 stub（UBT 失败场景）。
 *   2. 无 manifest 匹配时回退到 `.vscode/vscodeuehelper/fallback-generated/<Module>/`，
 *      按模块分子目录避免同名 header 冲突。
 *
 * 约束：
 *   - 不覆盖真实产物（任何路径写入前 fs.access 探测，存在则跳过）
 *   - 不为无反射宏的普通 .h 写 stub（噪声防护）
 *   - atomic write（先 .tmp 再 rename，参考 headerCache.recordHeader）
 *
 * @returns stub 写入数 + stub 根目录绝对路径（用于加入 includeCandidates）
 */
async function writeStubGeneratedHeaders(
  projectDir: string,
  log: Logger,
): Promise<{ count: number; stubDir: string }> {
  // 优先从 .uhtmanifest 取 OutputDirectory 作为 stub 写入根目录 + -I 候选；
  // 无匹配时回退到项目内自建目录 fallback-generated（绝不污染 Intermediate）。
  const manifestOutputs = await extractUhtManifestOutputDirs(projectDir);
  const fallbackDir = path.join(projectDir, FALLBACK_CC_DIR_REL, 'fallback-generated');

  // 收集项目 Source + Plugins/*/Source 下的所有 .h
  const headerFiles: string[] = [];
  await scanHeaderFiles(path.join(projectDir, 'Source'), headerFiles);
  const pluginsDir = path.join(projectDir, 'Plugins');
  try {
    const pluginEntries = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const e of pluginEntries) {
      if (e.isDirectory()) {
        await scanHeaderFiles(path.join(pluginsDir, e.name, 'Source'), headerFiles);
      }
    }
  } catch {
    // 无 Plugins 目录，跳过
  }

  // 解析 compat 头绝对路径（供 stub 文件 #include 用）。
  // getUeClangdCompatPath 内部用 path.dirname(projectPath) 定位 projectDir,
  // 这里传 path.join(projectDir, 'Stub.uproject') 即可让 dirname 解出 projectDir。
  const projectPathStub = path.join(projectDir, 'Stub.uproject');
  const compatAbsPath = getUeClangdCompatPath(projectPathStub);
  const stubContent = `#pragma once\n#include "${compatAbsPath}"\n`;

  // 仅取首个匹配的 OutputDirectory 作为主 stub 写入根目录 + stubDir 返回值。
  // stubDir 字段语义为单一字符串，与调用方 add(stubResult.stubDir) 兼容。
  const primaryOutputDir: string | null = manifestOutputs[0] ?? null;

  let count = 0;
  for (const headerPath of headerFiles) {
    // 1. 内容必须含 UE 反射宏
    let content: string;
    try {
      content = await fs.readFile(headerPath, 'utf-8');
    } catch {
      continue;
    }
    if (!REFLECTION_MACRO_RE.test(content)) {
      continue;
    }

    // 2. 派生 module 名
    const moduleName = deriveModuleName(headerPath, projectDir);
    if (!moduleName) {
      continue;
    }

    // 3. 构造 stub 路径
    //    a) 有 manifest 匹配的 OutputDirectory:写到那里（扁平化文件名，
    //       OutputDirectory 本身已按模块分目录）。取首个 OutputDirectory 作为主 stubDir。
    //    b) 无 manifest 时:写到 fallback-generated/<Module>/ 子目录。
    const baseName = path.basename(headerPath); // e.g. Player.h
    const stem = baseName.replace(/\.h$/i, ''); // e.g. Player
    const stubFile = primaryOutputDir
      ? path.join(primaryOutputDir, `${stem}.generated.h`)
      : path.join(fallbackDir, moduleName, `${stem}.generated.h`);

    // 4. 已存在则跳过（真实产物/手写 stub 优先，绝不覆盖）
    try {
      await fs.access(stubFile);
      continue;
    } catch {
      // 不存在，继续
    }

    // 5. atomic write
    try {
      await fs.mkdir(path.dirname(stubFile), { recursive: true });
      const tmpPath = `${stubFile}.tmp`;
      await fs.writeFile(tmpPath, stubContent, 'utf-8');
      await fs.rename(tmpPath, stubFile);
      count++;
    } catch (err) {
      log.warn(
        `[fallback] failed to write stub .generated.h for ${headerPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // stubDir：有 manifest 时取首个 OutputDirectory；否则 fallback-generated。
  const stubDir = primaryOutputDir ?? fallbackDir;
  return { count, stubDir };
}

/**
 * 过滤 include 集合，仅保留实际存在的目录。
 */
async function filterExistingDirs(
  candidates: Iterable<string>,
  existing: Set<string>,
): Promise<void> {
  for (const p of candidates) {
    if (existing.has(p)) {
      continue;
    }
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        existing.add(p);
      }
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
export async function generateFallbackCompileCommands(
  opts: FallbackOptions,
): Promise<FallbackResult | undefined> {
  const log = opts.logger ?? sharedLogger;
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

  // 1g. 为含 UE 反射宏的 .h 写 stub .generated.h（fallback 路径下 UHT 失败时 X.generated.h 不存在，
  //      #include "X.generated.h" 找不到会报 unknown_typename；写一份空 stub 让 include 至少能解析，
  //      真正的宏展开由 ueClangdCompat.h 在编译期兜底）
  const stubResult = await writeStubGeneratedHeaders(projectDir, log);
  if (stubResult.count > 0) {
    log.warn(`[fallback] wrote ${stubResult.count} stub .generated.h under ${stubResult.stubDir}`);
    includeCandidates.add(stubResult.stubDir);
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
        cppFiles.push(...(await scanCppFiles(path.join(pluginsDir, e.name, 'Source'))));
      }
    }
  } catch {
    // 无 Plugins，跳过
  }

  // 3b. 扫反射 .h（无 .cpp 时作为 fallback entries；不重写 stub，stub 由 writeStubGeneratedHeaders 提前生成）
  const reflectedHeaders = await scanReflectedHeadersForEntries(projectDir);

  // entries 顺序：.cpp 先，然后反射 .h
  const allSourceFiles = [...cppFiles, ...reflectedHeaders];
  if (allSourceFiles.length === 0) {
    // 既无 .cpp 也无反射 .h（极少见，新项目空目录）：仍写出空 entries，让 clangd 能 attach
    log.warn('[fallback] no .cpp or reflected headers found, writing empty entries array');
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
    // 关闭 clangd 的诊断数量上限：fallback DB 不含完整宏/PCH，clangd 会报大量误报（如
    // unknown_typename、未解析的 UCLASS 宏等）。默认 -ferror-limit=19 会让 clangd 在达到上限后
    // 丢弃后续诊断，导致某些关键错误（如 .generated.h 真正缺失）被截断隐藏。设为 0 让所有
    // 诊断都进入 Problems 面板，便于排查。注意：此 flag 仅影响 clangd 索引；真实编译仍走 UBT。
    '-ferror-limit=0',
    ...[...includePaths].map((p) => `-I${p}`),
    // [-include 兼容头] fallback 路径下 .generated.h 可能缺失或过期，强制在所有其他 include
    // 之前 include ueClangdCompat.h。重写 BODY_MACRO_COMBINE 后，UCLASS() / GENERATED_BODY()
    // 仍能展开为合法 C++ stub，避免 clangd 报 unknown_typename 以及后续补全失效。
    // 注意：此 -include 仅影响 clangd 索引；真实编译仍由真正的 .generated.h 驱动。
    '-include',
    compatPath,
  ];

  const entries = allSourceFiles.map((file) => ({
    directory: projectDir,
    file,
    command: `${commonArgs.join(' ')} ${file}`,
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
  return {
    ccPath,
    entryCount: entries.length,
    includeCount: includePaths.size,
    fromFallback: true,
  };
}
