/**
 * realClangdResolver.test.ts —— 真实 clangd 路径解析器单元测试
 *
 * 测试策略：
 * - 使用纯内存 fake 文件系统和环境变量，避免依赖本机 clangd/PATH/UE。
 * - 按解析优先级覆盖覆盖项、插件 clangdPath、当前/备份 clangd.path、PATH、默认 LLVM。
 * - 明确证明 proxy launcher 不会被当作真实 clangd 返回。
 */

import { describe, expect, it } from 'vitest';
import {
  resolveRealClangdPath,
  type RealClangdResolverInput,
  type RealClangdResolverSource,
} from '@clangd/proxy/realClangdResolver';

const LAUNCHER = 'C:/ext/out/launcher/proxy-launcher.bat';
const OVERRIDE_CLANGD = 'C:/llvm/override/clangd.exe';
const CONFIG_CLANGD = 'C:/llvm/config/clangd.exe';
const CURRENT_CLANGD = 'C:/llvm/current/clangd.exe';
const BACKUP_CLANGD = 'C:/llvm/backup/clangd.exe';
const PATH_CLANGD = 'C:/tools/LLVM/bin/clangd.exe';
const DEFAULT_CLANGD = 'C:/Program Files/LLVM/bin/clangd.exe';

type InputOverrides = Partial<
  Omit<RealClangdResolverInput, 'pathDelimiter' | 'fileExists'>
> & {
  readonly existingPaths?: readonly string[];
};

function makeInput(overrides: InputOverrides = {}): RealClangdResolverInput {
  const existing = new Set(overrides.existingPaths ?? []);
  return {
    proxyRealClangdPath: overrides.proxyRealClangdPath,
    configuredClangdPath: overrides.configuredClangdPath,
    currentClangdPath: overrides.currentClangdPath,
    backupClangdPath: overrides.backupClangdPath,
    launcherPath: overrides.launcherPath ?? LAUNCHER,
    envPath: overrides.envPath,
    pathDelimiter: ';',
    defaultSearchRoots: overrides.defaultSearchRoots ?? [],
    fileExists: (candidate) => existing.has(candidate),
  };
}

function expectSuccess(
  input: RealClangdResolverInput,
  expectedPath: string,
  expectedSource: RealClangdResolverSource,
): void {
  const result = resolveRealClangdPath(input);
  expect(result).toEqual({
    kind: 'found',
    path: expectedPath,
    source: expectedSource,
  });
}

describe('resolveRealClangdPath — 自动解析真实 clangd 路径', () => {
  it('Given 多个候选都存在 When 解析 Then 优先使用 clangdProxy.realClangdPath 覆盖项', () => {
    // Given
    const input = makeInput({
      proxyRealClangdPath: OVERRIDE_CLANGD,
      configuredClangdPath: CONFIG_CLANGD,
      currentClangdPath: CURRENT_CLANGD,
      backupClangdPath: BACKUP_CLANGD,
      envPath: 'C:/tools/LLVM/bin',
      defaultSearchRoots: ['C:/Program Files/LLVM/bin'],
      existingPaths: [OVERRIDE_CLANGD, CONFIG_CLANGD, CURRENT_CLANGD, BACKUP_CLANGD, PATH_CLANGD, DEFAULT_CLANGD],
    });

    // When / Then
    expectSuccess(input, OVERRIDE_CLANGD, 'proxyOverride');
  });

  it('Given proxy 覆盖项为空 When 解析 Then 使用 vscodeUEHelper.clangdPath', () => {
    // Given
    const input = makeInput({
      proxyRealClangdPath: '   ',
      configuredClangdPath: CONFIG_CLANGD,
      currentClangdPath: CURRENT_CLANGD,
      existingPaths: [CONFIG_CLANGD, CURRENT_CLANGD],
    });

    // When / Then
    expectSuccess(input, CONFIG_CLANGD, 'configuredClangdPath');
  });

  it('Given 当前 clangd.path 是第三方真实 clangd When 解析 Then 使用当前 clangd.path', () => {
    // Given
    const input = makeInput({
      currentClangdPath: CURRENT_CLANGD,
      backupClangdPath: BACKUP_CLANGD,
      existingPaths: [CURRENT_CLANGD, BACKUP_CLANGD],
    });

    // When / Then
    expectSuccess(input, CURRENT_CLANGD, 'currentClangdPath');
  });

  it('Given 当前 clangd.path 等于 proxy launcher When 解析 Then 排除 launcher 并回退到备份', () => {
    // Given
    const input = makeInput({
      currentClangdPath: LAUNCHER,
      backupClangdPath: BACKUP_CLANGD,
      existingPaths: [LAUNCHER, BACKUP_CLANGD],
    });

    // When / Then
    expectSuccess(input, BACKUP_CLANGD, 'backupClangdPath');
  });

  it('Given 备份 clangd.path 也等于 proxy launcher When 解析 Then 排除备份并回退到 PATH', () => {
    // Given
    const input = makeInput({
      currentClangdPath: LAUNCHER,
      backupClangdPath: LAUNCHER,
      envPath: 'C:/tools/LLVM/bin',
      existingPaths: [LAUNCHER, PATH_CLANGD],
    });

    // When / Then
    expectSuccess(input, PATH_CLANGD, 'pathEnv');
  });

  it('Given PATH 中有 clangd When 解析 Then 不依赖真实机器 PATH 并返回 PATH 候选', () => {
    // Given
    const input = makeInput({
      envPath: 'C:/empty;C:/tools/LLVM/bin',
      existingPaths: [PATH_CLANGD],
    });

    // When / Then
    expectSuccess(input, PATH_CLANGD, 'pathEnv');
  });

  it('Given PATH 没找到但默认 LLVM 目录存在 When 解析 Then 返回默认目录候选', () => {
    // Given
    const input = makeInput({
      envPath: 'C:/empty',
      defaultSearchRoots: ['C:/Program Files/LLVM/bin'],
      existingPaths: [DEFAULT_CLANGD],
    });

    // When / Then
    expectSuccess(input, DEFAULT_CLANGD, 'defaultLlvmPath');
  });

  it('Given 候选路径缺失或为空 When 解析 Then 返回 typed notFound 且不抛异常', () => {
    // Given
    const input = makeInput({
      proxyRealClangdPath: '',
      configuredClangdPath: 'C:/missing/config/clangd.exe',
      currentClangdPath: ' ',
      backupClangdPath: 'C:/missing/backup/clangd.exe',
      envPath: 'C:/missing/bin',
      defaultSearchRoots: ['C:/missing/default/bin'],
      existingPaths: [],
    });

    // When
    const result = resolveRealClangdPath(input);

    // Then
    expect(result.kind).toBe('notFound');
    if (result.kind === 'notFound') {
      expect(result.checkedCandidates).toEqual([
        { path: 'C:/missing/config/clangd.exe', source: 'configuredClangdPath', reason: 'missing' },
        { path: 'C:/missing/backup/clangd.exe', source: 'backupClangdPath', reason: 'missing' },
        { path: 'C:/missing/bin/clangd.exe', source: 'pathEnv', reason: 'missing' },
        { path: 'C:/missing/default/bin/clangd.exe', source: 'defaultLlvmPath', reason: 'missing' },
      ]);
    }
  });

  it('Given proxy launcher 使用不同大小写和斜杠 When 解析 Then 仍拒绝返回 launcher', () => {
    // Given
    const input = makeInput({
      launcherPath: 'C:/Ext/out/launcher/proxy-launcher.bat',
      currentClangdPath: 'c:\\ext\\out\\launcher\\proxy-launcher.bat',
      existingPaths: ['c:\\ext\\out\\launcher\\proxy-launcher.bat'],
    });

    // When
    const result = resolveRealClangdPath(input);

    // Then
    expect(result.kind).toBe('notFound');
    if (result.kind === 'notFound') {
      expect(result.checkedCandidates).toEqual([
        { path: 'c:\\ext\\out\\launcher\\proxy-launcher.bat', source: 'currentClangdPath', reason: 'proxyLauncher' },
      ]);
    }
  });
});
