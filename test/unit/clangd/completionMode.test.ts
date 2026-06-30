/**
 * completionMode.test.ts —— CompletionModeController 单元测试
 *
 * TDD: 红测先行覆盖 T1 生命周期缺口：未注入项目/引擎路径时 toggle
 * 只能返回 skipped/warning，不能假装 .clangd 已写入；检测完成后注入路径，
 * slow 模式必须真实重写 .clangd 并包含 macroCompletionHelper.h 与解析后的
 * EngineRoot preparse header。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { Config } from '@core/config';
import { CompletionModeController } from '@clangd/completionMode';

async function makeTempProject(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'completion-mode-test-'));
  await fs.writeFile(path.join(tmpDir, 'MyProject.uproject'), '{}', 'utf-8');
  return tmpDir;
}

async function makeTempEngine(): Promise<string> {
  const engineRoot = await fs.mkdtemp(path.join(tmpdir(), 'completion-mode-engine-'));
  await fs.mkdir(path.join(engineRoot, 'Source', 'Runtime', 'Core', 'Public'), { recursive: true });
  return engineRoot;
}

function getClangdPath(projectDir: string): string {
  return path.join(projectDir, '.clangd');
}

async function pathExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

/**
 * 设置 vscode mock 中 getConfiguration 返回指定的 completionMode。
 * 必须在 Config 构造之前调用。
 */
function mockCompletionMode(mode: 'fast' | 'slow'): Config {
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: vi.fn((key: string, def?: unknown) => {
      if (key === 'completionMode') {
        return mode;
      }
      return def;
    }),
    has: vi.fn(() => true),
    inspect: vi.fn(),
    update: vi.fn(),
  });
  return new Config();
}

describe('CompletionModeController (T1: projectPath/engineRoot lifecycle)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Given 未设置 projectPath When toggle Then 返回 skipped/warning 且不写 .clangd', async () => {
    const projectDir = await makeTempProject();
    try {
      const config = mockCompletionMode('fast');
      const controller = new CompletionModeController(config);

      const result = await controller.toggle();

      expect(result).toEqual({ mode: 'slow', skipped: true, warning: 'missingProjectPath' });
      await expect(fs.readFile(getClangdPath(projectDir), 'utf-8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Given 未设置 projectPath When rewriteClangd Then 返回 skipped 且不写 .clangd', async () => {
    const projectDir = await makeTempProject();
    try {
      const config = mockCompletionMode('fast');
      const controller = new CompletionModeController(config);

      const result = await controller.rewriteClangd('slow');

      expect(result).toEqual({ written: false, warning: 'missingProjectPath' });
      expect(await pathExists(getClangdPath(projectDir))).toBe(false);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Given projectPath 但缺少 engineRoot When slow rewrite Then 写入 macro helper 并过滤 EngineRoot 占位符', async () => {
    const projectDir = await makeTempProject();
    try {
      const config = mockCompletionMode('fast');
      const controller = new CompletionModeController(config);
      controller.setProjectContext({ projectPath: path.join(projectDir, 'MyProject.uproject') });

      const result = await controller.rewriteClangd('slow');

      expect(result).toEqual({ written: true });
      const content = await fs.readFile(getClangdPath(projectDir), 'utf-8');
      expect(content).toContain('macroCompletionHelper.h');
      expect(content).toContain('ueClangdCompat.h');
      expect(content).not.toContain('$(EngineRoot)');
      expect(content).not.toContain('CoreSharedPCH.h');
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Given projectPath 与 engineRoot When fast to slow toggle Then 写入 .clangd、macro helper 与解析后的 preparse header', async () => {
    const projectDir = await makeTempProject();
    const engineRoot = await makeTempEngine();
    try {
      const config = mockCompletionMode('fast');
      const controller = new CompletionModeController(config);
      controller.setProjectContext({
        projectPath: path.join(projectDir, 'MyProject.uproject'),
        engineRoot,
      });

      const result = await controller.toggle();

      expect(result).toEqual({ mode: 'slow', skipped: false });
      const content = await fs.readFile(getClangdPath(projectDir), 'utf-8');
      const normalizedEngineRoot = engineRoot.replace(/\\/g, '/');
      expect(content).toContain('/FI');
      expect(content).toContain('macroCompletionHelper.h');
      expect(content).toContain('ueClangdCompat.h');
      expect(content).toContain(`${normalizedEngineRoot}/Source/Runtime/Core/Public/CoreSharedPCH.h`);
      expect(content).not.toContain('$(EngineRoot)');
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
      await fs.rm(engineRoot, { recursive: true, force: true });
    }
  });

  it('Given slow 模式与完整路径 When toggle 到 fast Then 写入 .clangd 且不包含 macro helper', async () => {
    const projectDir = await makeTempProject();
    const engineRoot = await makeTempEngine();
    try {
      const config = mockCompletionMode('slow');
      const controller = new CompletionModeController(config);
      controller.setProjectContext({
        projectPath: path.join(projectDir, 'MyProject.uproject'),
        engineRoot,
      });

      const result = await controller.toggle();

      expect(result).toEqual({ mode: 'fast', skipped: false });
      const content = await fs.readFile(getClangdPath(projectDir), 'utf-8');
      expect(content).not.toContain('macroCompletionHelper.h');
      expect(content).toContain('ueClangdCompat.h');
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
      await fs.rm(engineRoot, { recursive: true, force: true });
    }
  });
});
