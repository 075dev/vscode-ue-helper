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
 *
 * [deactivate 子进程清理 — 决策记录 2026-07-31,见 AGENTS.md 仓库陷阱 #14]
 *
 * 本文件 2 处 `child_process` 调用全部**短探测**,**不接入 SubprocessRegistry**:
 *   - `runWithEofStdin` 内部 `spawn(file, args)`:clang/clang++ `-v -E -xc++ -` 探测。
 *     **同步 await** 走 Promise,函数返回时 child 已 close,**不会 leak**。
 *   - `spawn(cl, [])`:cl.exe banner 探测 MSVC 版本,await close 后函数返回。
 *
 * [add-003] 原 where / clangd --version 两处 execFile 探测随 findClangdExecutable /
 * readInstalledDir 一并迁移至 locator/clangdLocator.ts(同样的 await 短探测模式)。
 *
 * 设计权衡:`SubprocessRegistry` 只跟踪**长时间运行 / 异步 / 跨函数生命周期**的子进程
 * (UBT 编译、UHT codegen、UE Editor、Live Coding 等)。本文件所有 spawn 都是
 * `await spawn + child.close → resolve` 的同步模式,生命周期被 Promise 严格框定,
 * 接入 registry 反而增加无谓复杂度(register 后立即 unregister,无 deactivate 窗口)。
 * 若未来某个 spawn 改为 fire-and-forget / detached / 后台持续轮询,**必须**接入 registry。
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { type Logger } from '@core/logger';
// [add-003 / D8] clangd 定位与驱动器推导收敛到 locator——本文件不再自带
// PATH 遍历/默认 LLVM 目录/`clangd --version` 的重复实现。
import { findClangdShared, locateClangDriverFrom } from './locator/clangdLocator';

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
    const config = JSON.parse(content) as {
      RecommendedVersion?: string;
      Version?: string;
      SDKVersion?: string;
    };
    // 常见格式：{ "RecommendedVersion": "10.0.26100.0" } 或 { "Version": "10.0.26100" }
    const recommended = config.RecommendedVersion ?? config.Version ?? config.SDKVersion;
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
export function selectSdkVersion(
  availableVersions: string[],
  recommendedVersion?: string | null,
): string {
  if (!recommendedVersion) {
    // 没有推荐版本，选择最新的（按版本号降序排序）
    return availableVersions.sort().reverse()[0] ?? '';
  }

  // 检查推荐版本是否可用（精确匹配）
  const exactMatch = availableVersions.find((v) => v === recommendedVersion);
  if (exactMatch) {
    return exactMatch;
  }

  // 前缀匹配（如推荐 "10.0.26100"，匹配 "10.0.26100.0"）
  const prefixMatch = availableVersions.find((v) => v.startsWith(recommendedVersion));
  if (prefixMatch) {
    return prefixMatch;
  }

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
 * Step 1 — locate a `clangd.exe` via the shared locator chain (add-003 / D8):
 *   1. User-configured `vscodeUEHelper.clangdPath`
 *   2. `where clangd` (resolves PATHEXT, App Paths)
 *   3. Manual walk of `process.env.PATH`
 *   4. Default LLVM install dirs (`%ProgramFiles%\LLVM\bin` etc.)
 *
 * Step 2/3 — derive the clang driver from `clangd --version` InstalledDir
 * (prefer clang++.exe, fall back to clang.exe, then a sibling scan in
 * clangd's own directory); the logic lives in locator/clangdLocator.ts.
 *
 * Returns null when no clangd is found anywhere.
 */
async function resolveClangExecutable(
  clangdPath?: string,
  logger?: Logger,
): Promise<string | null> {
  // Step 1 — find any clangd.exe via the unified locator chain.
  const located = await findClangdShared({ configuredPath: clangdPath, logger });
  if (!located) {
    return null;
  }
  logger?.info(`[windowsSdk] found clangd.exe: ${located.path} (source: ${located.source})`);

  // Step 2/3 — InstalledDir derivation + sibling fallback (single copy in locator).
  return locateClangDriverFrom(located.path, undefined, logger);
}

// [add-003] 原 readInstalledDir 已迁移至 locator/clangdLocator.ts。

/** Parse `clang -v` output between the two search-list markers. */
function parseIncludePaths(stderr: string): string[] {
  const lines = stderr.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.includes('#include <...> search starts here:'));
  const endIdx = lines.findIndex((l) => l.includes('End of search list.'));
  if (startIdx === -1 || endIdx === -1) {
    return [];
  }
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

    if (msvcRoot && sdkRoot) {
      break;
    }
  }

  return { msvcRoot, sdkRoot };
}

/**
 * 读出 MSVC 编译器版本（用于 `-fms-compatibility-version=`）。
 *
 * [D5] 导出供 `setSystemIncludes` 使用 —— 用户在 QuickPick 里选的 msvcRoot
 * 可能与探测到的不是同一个版本，fms 版本必须对应**选中的**那个，
 * 否则持久化下去的 `-fms-compatibility-version` 是错的。
 */
export async function readMsvcVersion(
  msvcRoot: string,
  logger?: Logger,
): Promise<string | null> {
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
