/**
 * windowsSdk —— 在用户机器上发现 MSVC + Windows SDK 路径
 *
 * 不 hardcode VS 安装位置(每年版本号都变)。
 * 改为两步走:
 *   1. 跑 clangd --version 读 InstalledDir: 字段(LVVM 真实安装目录)
 *   2. 用 InstalledDir 拼 clang++.exe 路径
 *   3. 跑 clang++.exe -v -E -xc++ - 拿系统 include 搜索列表
 *   4. 从 include 路径识别 MSVC root 和 Windows SDK root
 *
 * POSIX 返回空(没有 MSVC / Windows SDK 概念)。
 *
 * 参考 unreal-clangd 的 src/modules/setCustomSysInc.ts,它用同样的技巧(只是用 clang++.exe)。
 *
 * 详见 doc/05-code-reference.md 第 2 节。
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Logger } from '@core/logger';

const execFileAsync = promisify(execFile);

/**
 * Spawn a process, capture its stderr, and end its stdin immediately so
 * the child doesn't hang waiting for input (e.g. clang -E - reads stdin).
 * Returns the full stderr string. Always resolves — child exit code is
 * ignored because `clang -E` exits non-zero when there's no input file.
 */
function runWithEofStdin(file: string, args: string[]): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', reject);
    child.on('close', () => resolve({ stderr }));
    // Tell clang there's no input — `-E -` would otherwise block on stdin.
    child.stdin.end();
  });
}

export interface SystemIncludeInfo {
  /** Absolute path to MSVC version dir, e.g. `...\VC\Tools\MSVC\14.39.33519`. */
  msvcRoot: string;
  /** Absolute path to Windows SDK Include dir, e.g. `...\Windows Kits\10\Include\10.0.22621.0`. */
  sdkRoot: string;
  /** MSVC compiler version reported by `cl.exe /?` — used for `-fms-compatibility-version`. */
  fmsCompatibilityVersion: string | null;
}

/** Discover MSVC + SDK paths by asking clangd what it actually searches. */
export async function discoverSystemIncludes(
  clangdPath?: string,
  logger?: Logger,
): Promise<SystemIncludeInfo | null> {
  if (process.platform !== 'win32') return null;

  const clangExe = await resolveClangExecutable(clangdPath, logger);
  if (!clangExe) {
    logger?.warn('[windowsSdk] no clangd.exe found anywhere (config / PATH / default LLVM paths)');
    return null;
  }

  try {
    // clang -v -E -xc++ - reads source from stdin (the trailing `-`).
    // We end stdin immediately so clang doesn't hang waiting for input.
    // We always resolve (ignore exit code) because clang returns non-zero
    // when no input is provided, even though stderr is what we want.
    const { stderr } = await runWithEofStdin(clangExe, ['-v', '-E', '-xc++', '-']);
    const paths = parseIncludePaths(stderr);
    if (paths.length < 2) {
      logger?.warn(
        `[windowsSdk] only ${paths.length} include paths parsed from ${clangExe}; need >=2`,
      );
      return null;
    }

    const { msvcRoot, sdkRoot } = identifyRoots(paths);
    if (!msvcRoot || !sdkRoot) {
      logger?.warn(
        `[windowsSdk] could not identify MSVC/SDK roots from include paths (msvcRoot=${msvcRoot} sdkRoot=${sdkRoot})`,
      );
      return null;
    }
    logger?.info(`[windowsSdk] resolved clang exe:       ${clangExe}`);
    logger?.info(`[windowsSdk] detected MSVC include root: ${msvcRoot}`);
    logger?.info(`[windowsSdk] detected Windows SDK root:   ${sdkRoot}`);

    const fmsCompatibilityVersion = await readMsvcVersion(msvcRoot, logger);
    logger?.info(
      `[windowsSdk] MSVC fms-compatibility-version: ${fmsCompatibilityVersion ?? '(unknown)'}`,
    );
    return { msvcRoot, sdkRoot, fmsCompatibilityVersion };
  } catch (err) {
    logger?.warn(
      `[windowsSdk] discovery failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** List MSVC version dirs under `<VC/Tools/MSVC>`. */
export async function listMsvcVersions(parentMsvcRoot: string): Promise<string[]> {
  return listSubdirs(parentMsvcRoot);
}

/** List Windows SDK version dirs under `<Windows Kits/10/Include>`. */
export async function listSdkVersions(parentSdkRoot: string): Promise<string[]> {
  return listSubdirs(parentSdkRoot);
}

/**
 * Render the .clangd `CompileFlags.Add` entries that point clangd at the
 * chosen MSVC + SDK. Returns `/imsvc <path>` lines (MSVC-style) and a
 * leading `/X` to suppress clangd's own builtin include search.
 */
export async function renderClangdFlags(opts: {
  msvcRoot: string;
  sdkRoot: string;
  fmsCompatibilityVersion: string | null;
}): Promise<string[]> {
  const flags: string[] = [];

  // ✅ /X flag 是必须的（参照 unreal-clangd 的 setCustomSysInc 实现）
  // 作用：抑制 clang 内置的 include 搜索路径（避免与 MSVC 标准库冲突）
  // 注意：compile_commands.json 中的 UE /I 路径不受 /X 影响（它们是命令行参数，不是内置 include）
  flags.push('/X');

  // Include every SDK subdir (ucrt, shared, um, winrt, cppwinrt).
  try {
    const sdkEntries = await fs.readdir(opts.sdkRoot, { withFileTypes: true });
    for (const entry of sdkEntries) {
      if (entry.isDirectory()) {
        flags.push(`/imsvc${path.join(opts.sdkRoot, entry.name)}`);
      }
    }
  } catch {
    /* SDK dir not readable — skip */
  }

  // MSVC C++ headers.
  flags.push(`/imsvc${path.join(opts.msvcRoot, 'include')}`);

  if (opts.fmsCompatibilityVersion) {
    flags.push(`-fms-compatibility-version=${opts.fmsCompatibilityVersion}`);
  }

  return flags;
}

/**
 * 从引擎配置读取推荐的 Windows SDK 版本
 * 文件位置: <EngineRoot>/Engine/Config/Windows/Windows_SDK.json
 */
export async function readRecommendedSdkVersion(engineRoot: string): Promise<string | null> {
  const sdkConfigPath = path.join(engineRoot, 'Engine', 'Config', 'Windows', 'Windows_SDK.json');
  try {
    const content = await fs.readFile(sdkConfigPath, 'utf-8');
    const config = JSON.parse(content);
    // 常见格式：{ "RecommendedVersion": "10.0.26100.0" } 或 { "Version": "10.0.26100" }
    const recommended = config.RecommendedVersion || config.Version || config.SDKVersion;
    if (recommended && typeof recommended === 'string') {
      return recommended;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 从可用的 SDK 版本中选择：优先使用引擎推荐的版本，否则使用最新版本
 */
export function selectSdkVersion(availableVersions: string[], recommendedVersion?: string | null): string {
  if (!recommendedVersion) {
    // 没有推荐版本，选择最新的（按版本号降序排序）
    return availableVersions.sort().reverse()[0] ?? '';
  }

  // 检查推荐版本是否可用（精确匹配）
  const exactMatch = availableVersions.find((v) => v === recommendedVersion);
  if (exactMatch) return exactMatch;

  // 前缀匹配（如推荐 "10.0.26100"，匹配 "10.0.26100.0"）
  const prefixMatch = availableVersions.find((v) => v.startsWith(recommendedVersion));
  if (prefixMatch) return prefixMatch;

  // 没有匹配的，使用最新版本
  return availableVersions.sort().reverse()[0] ?? '';
}

/**
 * 一键检测系统头文件 + 应用引擎推荐的 SDK 版本
 * 返回最终的 clangd flag 列表
 */
export async function detectSystemIncludesWithEngineRecommendation(
  engineRoot: string,
  clangdPath: string | undefined,
  logger?: Logger,
): Promise<string[] | null> {
  if (process.platform !== 'win32') return null;

  // Step 1: 自动检测当前的 SDK + MSVC
  const detected = await discoverSystemIncludes(clangdPath, logger);
  if (!detected) {
    logger?.warn('[windowsSdk] 自动检测系统头文件失败（没有找到 clangd）');
    return null;
  }

  logger?.info(`[windowsSdk] 自动检测到 MSVC=${detected.msvcRoot}, SDK=${detected.sdkRoot}`);

  // Step 2: 读取引擎推荐的 SDK 版本
  const recommendedSdk = await readRecommendedSdkVersion(engineRoot);
  if (recommendedSdk) {
    logger?.info(`[windowsSdk] 引擎推荐的 SDK 版本: ${recommendedSdk}`);

    // 尝试使用推荐的版本（如果已安装）
    const sdkParent = path.dirname(detected.sdkRoot);
    const availableSdks = await listSdkVersions(sdkParent);
    const selectedSdk = selectSdkVersion(availableSdks, recommendedSdk);

    if (selectedSdk && selectedSdk !== path.basename(detected.sdkRoot)) {
      logger?.info(`[windowsSdk] 切换到引擎推荐的 SDK 版本: ${selectedSdk}`);
      detected.sdkRoot = path.join(sdkParent, selectedSdk);
    }
  } else {
    logger?.info('[windowsSdk] 引擎没有指定 SDK 版本，使用最新安装的版本');
  }

  // Step 3: 生成最终的 flag 列表
  return renderClangdFlags({
    msvcRoot: detected.msvcRoot,
    sdkRoot: detected.sdkRoot,
    fmsCompatibilityVersion: detected.fmsCompatibilityVersion,
  });
}

// --- internals ---

/**
 * Resolve the path to a clang-family executable we can run with `-v -E`.
 *
 * Step 1 — locate a `clangd.exe`:
 *   1. User-configured `vscodeUEHelper.clangdPath`
 *   2. `where clangd` (resolves PATHEXT, App Paths)
 *   3. Manual walk of `process.env.PATH`
 *   4. Default LLVM install dirs (`%ProgramFiles%\LLVM\bin` etc.)
 *
 * Step 2 — once a clangd is found, run `clangd --version` and parse the
 * `InstalledDir: <path>` line. That path is the authoritative LLVM bin
 * directory; we prefer `clang++.exe` there (matches upstream unreal-clangd),
 * falling back to `clang.exe`.
 *
 * Step 3 — if `clangd --version` doesn't yield InstalledDir (older builds),
 * fall back to sibling scan in clangd's own directory.
 *
 * Returns null on POSIX or when no clangd is found anywhere.
 */
async function resolveClangExecutable(
  clangdPath?: string,
  logger?: Logger,
): Promise<string | null> {
  if (process.platform !== 'win32') return null;

  // Step 1 — find any clangd.exe.
  const clangdExe = await findClangdExecutable(clangdPath, logger);
  if (!clangdExe) return null;
  logger?.info(`[windowsSdk] found clangd.exe: ${clangdExe}`);

  // Step 2 — read InstalledDir from `clangd --version`.
  const installedDir = await readInstalledDir(clangdExe, logger);
  if (installedDir) {
    logger?.info(`[windowsSdk] clangd --version reports InstalledDir: ${installedDir}`);
    for (const name of ['clang++.exe', 'clang.exe']) {
      const candidate = path.join(installedDir, name);
      try {
        await fs.access(candidate);
        logger?.info(`[windowsSdk] resolved clang driver (from InstalledDir): ${candidate}`);
        return candidate;
      } catch {
        /* try next */
      }
    }
    logger?.warn(
      `[windowsSdk] InstalledDir=${installedDir} has no clang++.exe / clang.exe — falling back to sibling scan`,
    );
  }

  // Step 3 — fallback: clangd's own directory might still have clang++.exe
  // alongside (common in slim LLVM builds).
  const dir = path.dirname(clangdExe);
  for (const name of ['clang++.exe', 'clang.exe', 'clangd.exe']) {
    const candidate = path.join(dir, name);
    try {
      await fs.access(candidate);
      logger?.info(`[windowsSdk] resolved clang driver (sibling fallback): ${candidate}`);
      return candidate;
    } catch {
      /* try next */
    }
  }

  return null;
}

/** Locate a clangd.exe via config → where → PATH walk → default LLVM dirs. */
async function findClangdExecutable(clangdPath?: string, logger?: Logger): Promise<string | null> {
  const exists = async (p: string): Promise<boolean> => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  };

  // 1. User-configured path.
  if (clangdPath && clangdPath.length > 0) {
    if (await exists(clangdPath)) {
      logger?.info(`[windowsSdk] using clangdPath from config: ${clangdPath}`);
      return clangdPath;
    }
    logger?.warn(`[windowsSdk] clangdPath from config not found: ${clangdPath}`);
  }

  // 2. `where clangd`.
  try {
    const { stdout } = await execFileAsync('where', ['clangd'], {
      windowsHide: true,
      timeout: 5_000,
    });
    const first = stdout.split(/\r?\n/)[0]?.trim();
    if (first && (await exists(first))) {
      logger?.info(`[windowsSdk] \`where clangd\` resolved: ${first}`);
      return first;
    }
  } catch {
    /* `where` unavailable or no match */
  }

  // 3. Manual PATH walk.
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter((d) => d.length > 0);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, 'clangd.exe');
    if (await exists(candidate)) {
      logger?.info(`[windowsSdk] found clangd in PATH: ${candidate}`);
      return candidate;
    }
  }

  // 4. Default LLVM install paths.
  const defaultRoots = [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'LLVM', 'bin'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'LLVM', 'bin'),
    path.join(process.env.LocalAppData ?? '', 'Programs', 'LLVM', 'bin'),
  ];
  for (const root of defaultRoots) {
    const candidate = path.join(root, 'clangd.exe');
    if (await exists(candidate)) {
      logger?.info(`[windowsSdk] found clangd at default LLVM path: ${candidate}`);
      return candidate;
    }
  }

  return null;
}

/**
 * Run `clangd --version` and extract the `InstalledDir:` line.
 *
 * Example output:
 *   clangd version 19.1.0
 *   Target: x86_64-pc-windows-msvc
 *   Thread model: posix
 *   InstalledDir: C:\Program Files\LLVM\bin
 */
async function readInstalledDir(clangdExe: string, logger?: Logger): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(clangdExe, ['--version'], {
      windowsHide: true,
      timeout: 5_000,
    });
    const output = `${stdout}\n${stderr}`;
    const m = output.match(/^InstalledDir:\s*(.+)\s*$/m);
    if (m) {
      logger?.debug(`[windowsSdk] raw clangd --version output: ${output.replace(/\n/g, ' | ')}`);
    } else {
      logger?.warn(
        `[windowsSdk] \`${clangdExe} --version\` did not include an InstalledDir line — output:\n${output}`,
      );
    }
    return m ? (m[1]?.trim() ?? null) : null;
  } catch (err) {
    logger?.warn(
      `[windowsSdk] \`${clangdExe} --version\` failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Parse `clang -v` output between the two search-list markers. */
function parseIncludePaths(stderr: string): string[] {
  const lines = stderr.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.includes('#include <...> search starts here:'));
  const endIdx = lines.findIndex((l) => l.includes('End of search list.'));
  if (startIdx === -1 || endIdx === -1) return [];
  return lines
    .slice(startIdx + 1, endIdx)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.toLowerCase().includes('clang'));
}

/**
 * Collapse all `…/MSVC/<ver>/include` style paths back to their MSVC
 * version root; same for `…/Windows Kits/10/Include/<ver>/ucrt` → SDK root.
 */
function identifyRoots(paths: string[]): { msvcRoot: string | null; sdkRoot: string | null } {
  let msvcRoot: string | null = null;
  let sdkRoot: string | null = null;

  for (const p of paths) {
    const parts = p.split(/[\\/]/);
    const lower = parts.map((s) => s.toLowerCase());

    // MSVC: anchor is the literal MSVC segment. The next segment is the
    // MSVC toolset version (e.g. 14.51.36231). Earlier we looked for
    // first digit-containing segment which wrongly picked up the parent
    // VS install year (18 for VS 2026).
    if (!msvcRoot) {
      const msvcIdx = lower.indexOf('msvc');
      if (msvcIdx >= 0 && msvcIdx + 1 < parts.length) {
        msvcRoot = parts.slice(0, msvcIdx + 2).join(path.sep);
      }
    }

    // Windows SDK: anchor is the Windows Kits/10/Include/<ver> pattern.
    // The 10 is the SDK major (stable for years), the next segment is
    // the actual SDK version (e.g. 10.0.26100.0).
    if (!sdkRoot) {
      const kitsIdx = lower.indexOf('windows kits');
      if (
        kitsIdx >= 0 &&
        parts[kitsIdx + 1] === '10' &&
        lower[kitsIdx + 2] === 'include' &&
        kitsIdx + 3 < parts.length
      ) {
        sdkRoot = parts.slice(0, kitsIdx + 4).join(path.sep);
      }
    }

    if (msvcRoot && sdkRoot) break;
  }

  return { msvcRoot, sdkRoot };
}

async function readMsvcVersion(msvcRoot: string, logger?: Logger): Promise<string | null> {
  // Run `<msvcRoot>/bin/Hostx64/x64/cl.exe` — its banner contains the
  // MSVC version (e.g. "19.39.33523"). cl.exe exits non-zero with no
  // input file, but the banner is what we want.
  const cl = path.join(msvcRoot, 'bin', 'Hostx64', 'x64', 'cl.exe');
  try {
    await fs.access(cl);
  } catch {
    logger?.warn(`[windowsSdk] cl.exe not found at ${cl}`);
    return null;
  }

  const extractVersion = (text: string): string | null => {
    const m = text.match(/(\d+\.\d+\.\d+)/);
    return m ? (m[1] ?? null) : null;
  };

  // Use spawn so we can capture both stdout and stderr even when cl.exe
  // exits non-zero. Banner appears on stdout.
  return new Promise<string | null>((resolve) => {
    const child = spawn(cl, [], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf-8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf-8')));
    child.on('error', (err) => {
      logger?.warn(`[windowsSdk] cl.exe spawn failed: ${err.message}`);
      resolve(null);
    });
    // cl.exe exits after printing banner; ignore exit code.
    child.on('close', () => {
      const version = extractVersion(stdout) ?? extractVersion(stderr);
      if (!version) {
        logger?.warn(
          `[windowsSdk] could not extract MSVC version from cl.exe output (stdout=${stdout.length} chars, stderr=${stderr.length} chars)`,
        );
      }
      resolve(version);
    });
  });
}

async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
