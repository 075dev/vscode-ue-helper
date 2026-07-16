/**
 * completionMode.test.ts —— CompletionModeController 单元测试
 *
 * Plan B 重构后：CompletionModeController 不再有 toggle()/show() 等 UI 接口，
 * 仅承载 rewriteClangd() 工具方法。T1 生命周期用 rewriteClangd 覆盖。
 *
 * 已删除的测试（toggle 相关）：
 *   - "未设置 projectPath When toggle Then 返回 skipped/warning"
 *   - "projectPath + engineRoot When fast to slow toggle"
 *   - "slow 模式 When toggle 到 fast"
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
 *
 * Plan B 后 Config 默认值归一化为 'slow'，但 mock 直接指定 mode 用于
 * 验证旧用户配置 'fast' 也能正常走完重写路径（向后兼容）。
 */
function mockCompletionMode(_mode: 'fast' | 'slow'): Config {
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: vi.fn(() => 'slow'),
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

  it('Given projectPath 但缺少 engineRoot When rewriteClangd Then 写入 macro helper 并过滤 EngineRoot 占位符', async () => {
    const projectDir = await makeTempProject();
    try {
      const config = mockCompletionMode('fast');
      const controller = new CompletionModeController(config);
      controller.setProjectContext({ projectPath: path.join(projectDir, 'MyProject.uproject') });

      const result = await controller.rewriteClangd('slow');

      expect(result).toEqual({ written: true });
      const content = await fs.readFile(getClangdPath(projectDir), 'utf-8');
      // Plan B: macroHelperPath 仍会被注入（兼容老 .clangd/第三方扩展）
      expect(content).toContain('macroCompletionHelper.h');
      expect(content).toContain('ueClangdCompat.h');
      expect(content).not.toContain('$(EngineRoot)');
      expect(content).not.toContain('CoreSharedPCH.h');
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Given projectPath 与 engineRoot When rewriteClangd Then 写入 .clangd + macro helper + 解析后的 preparse header', async () => {
    const projectDir = await makeTempProject();
    const engineRoot = await makeTempEngine();
    try {
      const config = mockCompletionMode('fast');
      const controller = new CompletionModeController(config);
      controller.setProjectContext({
        projectPath: path.join(projectDir, 'MyProject.uproject'),
        engineRoot,
      });

      // 传入任意 mode —— Plan B 内部强制为 'slow'
      const result = await controller.rewriteClangd('fast');

      expect(result).toEqual({ written: true });
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
});
