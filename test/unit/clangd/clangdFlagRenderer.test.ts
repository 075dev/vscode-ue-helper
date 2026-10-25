/**
 * clangdFlagRenderer.test —— [D5] `.clangd` Add 的统一渲染 + 写入入口
 *
 * ## 背景
 *
 * 旧实现有 3 条各自独立的「渲染 + 整体替换」路径，ctx 覆盖范围各不相同：
 *
 * | 路径 | ctx 内容 | 后果 |
 * | --- | --- | --- |
 * | `setSystemIncludes.ts` | 只有 systemIncludeFlags | compat/preparse/uht 全丢 |
 * | `controlPanel.ts` | **完全为空** | 依赖动态路径的词条渲染出 0 个 flag |
 * | `completionMode.ts` | compat/macro/preparse | 缺 uht 与 system |
 *
 * `applyAddFlags` 是整体替换 → 谁最后写谁赢 → 用户在面板勾选
 * 「强制包含 UE Clangd 兼容头」后保存成功，但 `.clangd` 里啥也没有。
 *
 * 另外 `system-include-windows` 不在 glossary 里（无 checkbox），webview 保存
 * 时会把它丢掉 → Windows SDK / MSVC 的 `/imsvc` 全部消失。
 *
 * ## 覆盖
 *
 *   - ctx 五项来源正确（compat / macro / preparse / uht / system）
 *   - `uht-include-dirs` 真的能渲染出 `/I<dir>`（此前从未被生产代码调用）
 *   - `system-include-windows` 从持久化的 msvcRoot/sdkRoot 重建
 *   - 统一入口写入 `.clangd` 的 `CompileFlags.Add`
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Logger } from '@core/logger';
import { WorkspaceState } from '@core/workspace';
import { ClangdOps } from '@clangd/clangdOps';
import {
  collectClangdFlagContext,
  renderClangdAddFlags,
  writeClangdAddFlags,
} from '@clangd/clangdFlagRenderer';
import type { Config } from '@core/config';

interface Harness {
  ops: ClangdOps;
  workspace: WorkspaceState;
  tmpDir: string;
  clangdPath: string;
  cleanup: () => Promise<void>;
}

async function setupHarness(opts?: {
  compatHeaderPath?: string;
  macroHelperPath?: string;
  projectFile?: string;
}): Promise<Harness> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clangdFlagRenderer-test-'));
  const clangdPath = path.join(tmpDir, '.clangd');

  const logger = new Logger('clangdFlagRendererTest');
  const workspace = new WorkspaceState({
    logger,
    detection: {
      ready: Promise.resolve({
        projects: [],
        engines: [],
        workspaceFolders: [
          { name: 'proj', path: '.', role: 'project', absPath: tmpDir },
        ],
        projectFolder: { name: 'proj', path: '.', role: 'project', absPath: tmpDir },
        engineFolder: null,
      }),
    },
  });

  // WorkspaceState 的 getter 是只读的（原型上的 get）—— 用 defineProperty 在实例上
  // 覆盖，shadow 掉原型 getter。
  if (opts?.compatHeaderPath) {
    Object.defineProperty(workspace, 'ueClangdCompatPath', {
      value: opts.compatHeaderPath,
      configurable: true,
    });
  }
  if (opts?.macroHelperPath) {
    Object.defineProperty(workspace, 'macroHelperPath', {
      value: opts.macroHelperPath,
      configurable: true,
    });
  }
  if (opts?.projectFile) {
    Object.defineProperty(workspace, 'projectFile', {
      value: opts.projectFile,
      configurable: true,
    });
  }

  return {
    ops: new ClangdOps({ workspace, logger }),
    workspace,
    tmpDir,
    clangdPath,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

function makeConfig(overrides?: {
  userAddFlags?: readonly string[];
  msvcRoot?: string;
  sdkRoot?: string;
  fmsVersion?: string;
}): Config {
  return {
    userAddFlags: overrides?.userAddFlags ?? [],
    clangdMsvcRoot: overrides?.msvcRoot,
    clangdSdkRoot: overrides?.sdkRoot,
    clangdFmsCompatibilityVersion: overrides?.fmsVersion,
  } as unknown as Config;
}

describe('[D5] renderClangdAddFlags —— 渲染入口', () => {
  it('把 id 渲染成 flag 字面串', () => {
    expect(renderClangdAddFlags(['std-cxx20'], {})).toEqual(['/std:c++20']);
  });

  it('ctx 带动态路径时 compat-header 渲染出 /FI', () => {
    expect(
      renderClangdAddFlags(['compat-header'], { compatHeaderPath: 'D:/x/ueClangdCompat.h' }),
    ).toEqual(['/FID:/x/ueClangdCompat.h']);
  });

  it('uht-include-dirs 按目录逐条渲染成 /I', () => {
    expect(
      renderClangdAddFlags(['uht-include-dirs'], {
        intermediateUhtDirs: ['D:/a/UHT', 'D:/b/UHT'],
      }),
    ).toEqual(['/ID:/a/UHT', '/ID:/b/UHT']);
  });

  it('system-include-windows 展开 ctx.systemIncludeFlags', () => {
    expect(
      renderClangdAddFlags(['system-include-windows'], {
        systemIncludeFlags: ['/X', '/imsvcD:/sdk/ucrt'],
      }),
    ).toEqual(['/X', '/imsvcD:/sdk/ucrt']);
  });
});

describe('[D5] collectClangdFlagContext —— ctx 五项来源', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('compatHeaderPath / macroHelperPath 来自 workspace', async () => {
    const h2 = await setupHarness({
      compatHeaderPath: 'D:/x/ueClangdCompat.h',
      macroHelperPath: 'D:/x/macroCompletionHelper.h',
    });
    const ctx = await collectClangdFlagContext({
      clangdOps: h2.ops,
      config: makeConfig(),
    });
    expect(ctx.compatHeaderPath).toBe('D:/x/ueClangdCompat.h');
    expect(ctx.macroHelperPath).toBe('D:/x/macroCompletionHelper.h');
    await h2.cleanup();
  });

  it('intermediateUhtDirs 由 collectIntermediateUhtDirs 采集（本轮首次接线）', async () => {
    // 造一个 Intermediate/Build/<cfg>/<target>/Inc/<Module>/UHT 目录
    const uhtDir = path.join(
      h.tmpDir,
      'Intermediate',
      'Build',
      'Win64',
      'MyGameEditor',
      'Inc',
      'MyGame',
      'UHT',
    );
    await fs.mkdir(uhtDir, { recursive: true });

    const h2 = await setupHarness({ projectFile: path.join(h.tmpDir, 'MyGame.uproject') });

    const ctx = await collectClangdFlagContext({
      clangdOps: h2.ops,
      config: makeConfig(),
    });
    expect(ctx.intermediateUhtDirs).toContain(uhtDir);
    await h2.cleanup();
  });

  it('systemIncludeFlags 从持久化的 msvcRoot/sdkRoot 重建', async () => {
    const ctx = await collectClangdFlagContext({
      clangdOps: h.ops,
      config: makeConfig({
        msvcRoot: path.join(h.tmpDir, 'MSVC'),
        sdkRoot: path.join(h.tmpDir, 'SDK'),
        fmsVersion: '19.39',
      }),
    });
    // SDK 目录不存在 → renderClangdFlags 仍会产出 /X + /imsvc<msvc>/include
    expect(ctx.systemIncludeFlags).toBeDefined();
    expect(ctx.systemIncludeFlags!.some((f) => f === '/X')).toBe(true);
    expect(
      ctx.systemIncludeFlags!.some((f) => f.includes('-fms-compatibility-version=19.39')),
    ).toBe(true);
  });

  it('未持久化 msvcRoot/sdkRoot → systemIncludeFlags 为空', async () => {
    const ctx = await collectClangdFlagContext({
      clangdOps: h.ops,
      config: makeConfig(),
    });
    expect(ctx.systemIncludeFlags).toBeUndefined();
  });
});

describe('[D5] writeClangdAddFlags —— 统一写入入口', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness({
      compatHeaderPath: 'D:/x/ueClangdCompat.h',
    });
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('把渲染结果整体写入 .clangd 的 CompileFlags.Add', async () => {
    const result = await writeClangdAddFlags(
      { clangdOps: h.ops, config: makeConfig() },
      ['compat-header', 'std-cxx20'],
    );
    expect(result.ok).toBe(true);

    const text = await fs.readFile(h.clangdPath, 'utf-8');
    expect(text).toContain('/FID:/x/ueClangdCompat.h');
    expect(text).toContain('/std:c++20');
  });

  it('overrides 优先于采集到的 ctx', async () => {
    const result = await writeClangdAddFlags(
      { clangdOps: h.ops, config: makeConfig() },
      ['system-include-windows'],
      { systemIncludeFlags: ['/X', '/imsvcD:/sdk/ucrt'] },
    );
    expect(result.ok).toBe(true);

    const text = await fs.readFile(h.clangdPath, 'utf-8');
    expect(text).toContain('/imsvcD:/sdk/ucrt');
  });

  it('.clangd 不存在时自动创建', async () => {
    const result = await writeClangdAddFlags(
      { clangdOps: h.ops, config: makeConfig() },
      ['std-cxx20'],
    );
    expect(result.ok).toBe(true);
    await expect(fs.access(h.clangdPath)).resolves.toBeUndefined();
  });

  it('日志缺失时不抛错（logger 可选）', async () => {
    const loggerSpy = vi.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
    const result = await writeClangdAddFlags(
      { clangdOps: h.ops, config: makeConfig() },
      ['std-cxx20'],
    );
    expect(result.ok).toBe(true);
    loggerSpy.mockRestore();
  });
});
