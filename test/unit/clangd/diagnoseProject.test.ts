/**
 * diagnoseProject.test.ts —— clangd 项目诊断红测
 *
 * Given/When/Then 覆盖 T7 要求的只读诊断能力：
 * .clangd、/FI 强制包含、compile_commands 路径与条目、completionHelper、系统 include flag。
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { createCompletionFiles, getCompletionHelperPath } from '@clangd/completionFiles';
// [Phase 9 SSoT] 测试内部直 import src/，绕开 barrel
// eslint-disable-next-line no-restricted-imports
import { defaultClangdConfig, renderClangdConfig } from '../../../src/clangd/clangdConfig';
import { getUeClangdCompatPath } from '@clangd/ueClangdCompat';
import { diagnoseProject } from '@clangd/diagnoseProject';

type FixtureOptions = {
  readonly writeClangd?: boolean;
  readonly clangdText?: string;
  readonly writeCompletionFiles?: boolean;
  readonly writeCompileCommands?: boolean;
  readonly includeCompletionHelperEntry?: boolean;
  readonly completionDatabase?: string;
  readonly addSystemIncludes?: boolean;
};

type ProjectFixture = {
  readonly rootDir: string;
  readonly projectPath: string;
  readonly compileCommandsPath: string;
};

async function createFixture(options: FixtureOptions = {}): Promise<ProjectFixture> {
  const rootDir = await fs.mkdtemp(path.join(tmpdir(), 'diagnose-clangd-'));
  const projectPath = path.join(rootDir, 'MyGame.uproject');
  const compileCommandsDir = path.join(rootDir, options.completionDatabase ?? '.vscode/vscodeuehelper');
  const compileCommandsPath = path.join(compileCommandsDir, 'compile_commands.json');

  await fs.writeFile(projectPath, '{"FileVersion": 3}', 'utf-8');

  if (options.writeCompletionFiles ?? true) {
    await createCompletionFiles(projectPath);
  }

  if (options.writeClangd ?? true) {
    // Plan Add 收束：directly build YAML text instead of relying on defaultClangdConfig opts.
    const compat = getUeClangdCompatPath(projectPath);
    const sysFlags = options.addSystemIncludes === false
      ? []
      : ['/X', '/imsvc"C:/VS/VC/Tools/MSVC/include"', '-fms-compatibility-version=19.38'];
    const addFlags = ['/FI' + compat, ...sysFlags];
    const clangdText = options.clangdText ?? renderClangdConfig({
      ...defaultClangdConfig({ projectPath }),
      CompileFlags: {
        ...defaultClangdConfig({ projectPath }).CompileFlags,
        Add: addFlags,
      },
    });
    await fs.writeFile(path.join(rootDir, '.clangd'), clangdText, 'utf-8');
  }

  if (options.writeCompileCommands ?? true) {
    await fs.mkdir(compileCommandsDir, { recursive: true });
    const sourcePath = path.join(rootDir, 'Source', 'MyGame', 'Private', 'MyActor.cpp');
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, '// Given: source file for compile database', 'utf-8');
    const entries = [
      {
        directory: rootDir,
        file: sourcePath,
        command: `clang-cl.exe /c "${sourcePath}"`,
      },
      ...(options.includeCompletionHelperEntry === false
        ? []
        : [
            {
              directory: rootDir,
              file: getCompletionHelperPath(projectPath),
              command: `clang-cl.exe /c "${getCompletionHelperPath(projectPath)}"`,
            },
          ]),
    ];
    await fs.writeFile(compileCommandsPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  return { rootDir, projectPath, compileCommandsPath };
}

async function removeFixture(fixture: ProjectFixture): Promise<void> {
  await fs.rm(fixture.rootDir, { recursive: true, force: true });
}

function failedCheckNames(report: Awaited<ReturnType<typeof diagnoseProject>>): readonly string[] {
  return report.checks
    .filter((check) => check.status === 'fail')
    .map((check) => check.name);
}

describe('diagnoseProject', () => {
  it('Given 缺失 .clangd When 诊断 Then 报告 clangdConfig 失败', async () => {
    const fixture = await createFixture({ writeClangd: false });
    try {
      const report = await diagnoseProject(fixture.projectPath);
      expect(report.overallStatus).toBe('error');
      expect(failedCheckNames(report)).toContain('clangdConfig');
    } finally {
      await removeFixture(fixture);
    }
  });

  it('Given 缺少 /FI forced include When 诊断 Then 报告 forcedIncludes 失败', async () => {
    // 故意写一个不带任何 /FI flag 的 .clangd：默认模板注入 MSVC baseline 但没有 /FI<compatHeader>。
    const placeholderPath = path.join(tmpdir(), 'placeholder.uproject');
    const clangdText = renderClangdConfig({
      ...defaultClangdConfig({ projectPath: placeholderPath }),
      CompileFlags: {
        ...defaultClangdConfig({ projectPath: placeholderPath }).CompileFlags,
        Add: ['/X', '/imsvc"C:/VS/include"'],
      },
    });
    const fixture = await createFixture({ clangdText });
    try {
      const report = await diagnoseProject(fixture.projectPath);
      expect(failedCheckNames(report)).toContain('forcedIncludes');
    } finally {
      await removeFixture(fixture);
    }
  });

  it('Given CompilationDatabase 指向错误目录 When 诊断 Then 报告 compileCommands 失败', async () => {
    const placeholderPath = path.join(tmpdir(), 'unused', 'placeholder.uproject');
    const baseDoc = defaultClangdConfig({ projectPath: placeholderPath });
    const fixture = await createFixture({
      clangdText: renderClangdConfig({
        ...baseDoc,
        CompileFlags: {
          ...baseDoc.CompileFlags,
          CompilationDatabase: '.bad-db',
        },
      }),
    });
    try {
      const report = await diagnoseProject(fixture.projectPath);
      expect(failedCheckNames(report)).toContain('compileCommands');
    } finally {
      await removeFixture(fixture);
    }
  });

  it('Given 缺少 completionHelper.cpp 条目 When 诊断 Then 报告 completionHelperEntry 失败', async () => {
    const fixture = await createFixture({ includeCompletionHelperEntry: false });
    try {
      const report = await diagnoseProject(fixture.projectPath);
      expect(failedCheckNames(report)).toContain('completionHelperEntry');
    } finally {
      await removeFixture(fixture);
    }
  });

  it('Given 缺少系统 include flags When 诊断 Then 报告 systemIncludeFlags 失败', async () => {
    const fixture = await createFixture({ addSystemIncludes: false });
    try {
      const report = await diagnoseProject(fixture.projectPath);
      expect(failedCheckNames(report)).toContain('systemIncludeFlags');
    } finally {
      await removeFixture(fixture);
    }
  });

  it('Given 完整临时项目 When 诊断 Then 所有必需项 all ok', async () => {
    const fixture = await createFixture();
    try {
      const report = await diagnoseProject(fixture.projectPath);
      expect(report.overallStatus).toBe('ok');
      expect(report.checks.every((check) => check.status === 'pass')).toBe(true);
    } finally {
      await removeFixture(fixture);
    }
  });

  it('Given malformed YAML 和 JSON When 诊断 Then 不抛出且报告解析失败', async () => {
    const fixture = await createFixture({ clangdText: 'CompileFlags: [unterminated' });
    try {
      await fs.writeFile(fixture.compileCommandsPath, '{bad json', 'utf-8');
      const report = await diagnoseProject(fixture.projectPath);
      expect(report.overallStatus).toBe('error');
      expect(failedCheckNames(report)).toContain('clangdConfig');
      expect(failedCheckNames(report)).toContain('compileCommandsJson');
    } finally {
      await removeFixture(fixture);
    }
  });
});
