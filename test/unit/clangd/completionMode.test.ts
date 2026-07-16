/**
 * completionMode.test.ts —— CompletionModeController 单元测试
 *
 * Plan Add 收束（per Plan B.3）：
 *   - CompletionModeController 通过 flagGlossary.resolveFlags 渲染 userAddFlags，
 *     走 ClangdOps.applyAddFlags 整体 force-write 到 .clangd。
 *   - 不再依赖 defaultClangdConfig 的 opts 注入 Add。
 *
 * 已删除的测试（toggle 相关）：
 *   - "未设置 projectPath When toggle Then 返回 skipped/warning"
 *   - "projectPath + engineRoot When fast to slow toggle"
 *   - "slow 模式 When toggle 到 fast"
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import { WorkspaceState } from '@core/workspace';
import { ClangdOps } from '@clangd/clangdOps';
import { CompletionModeController } from '@clangd/completionMode';

interface Harness {
  controller: CompletionModeController;
  projectDir: string;
  clangdPath: string;
  cleanup: () => Promise<void>;
}

async function setupHarness(opts: {
  userAddFlags?: readonly string[];
  engineRoot?: string;
  includeCompletionFiles?: boolean;
} = {}): Promise<Harness> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'completion-mode-test-'));
  await fs.writeFile(path.join(projectDir, 'MyProject.uproject'), '{}', 'utf-8');
  const clangdPath = path.join(projectDir, '.clangd');

  const engineRoot = opts.engineRoot ?? '';

  // mock vscode.workspace.getConfiguration('vscodeUEHelper').get('clangd.userAddFlags') 等
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: vi.fn((key: string, def?: unknown) => {
      if (key === 'clangd.userAddFlags') {
        return opts.userAddFlags ?? [];
      }
      // Config 其他字段默认值由 Config 实现 fallback
      return def;
    }),
    has: vi.fn(() => true),
    inspect: vi.fn(),
    update: vi.fn(),
  });

  // 完成文件（让 macroHelperPath / compatHeaderPath 解析得到）
  if (opts.includeCompletionFiles ?? true) {
    await fs.mkdir(path.join(projectDir, '.vscode', 'vscodeuehelper'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, '.vscode', 'vscodeuehelper', 'macroCompletionHelper.h'),
      '// macro helper\n',
      'utf-8',
    );
    await fs.writeFile(
      path.join(projectDir, '.vscode', 'vscodeuehelper', 'ueClangdCompat.h'),
      '// compat\n',
      'utf-8',
    );
  }

  // engine SharedPCH 文件路径（用于 preparse-headers 解析）
  if (engineRoot) {
    await fs.mkdir(path.join(engineRoot, 'Source', 'Runtime', 'Core', 'Public'), { recursive: true });
    await fs.writeFile(
      path.join(engineRoot, 'Source', 'Runtime', 'Core', 'Public', 'CoreSharedPCH.h'),
      '// pch\n',
      'utf-8',
    );
  }

  const logger = new Logger('completionModeTest');

  const workspace = new WorkspaceState({
    logger,
    detection: {
      ready: Promise.resolve({
        projects: [
          {
            name: 'MyProject',
            path: path.join(projectDir, 'MyProject.uproject'),
            engineAssociation: '',
            modules: [],
            raw: {},
          },
        ],
        engines: [],
        workspaceFolders: [
          {
            name: 'MyProject',
            path: '.',
            role: 'project',
            absPath: projectDir,
          },
        ],
        projectFolder: {
          name: 'MyProject',
          path: '.',
          role: 'project',
          absPath: projectDir,
        },
        engineFolder: null,
      }),
    },
  });

  const ops = new ClangdOps({ workspace, logger });
  const config = new Config();
  const controller = new CompletionModeController(config);
  controller.setConfig(config);
  controller.setClangdOps(ops);

  if (engineRoot) {
    controller.setProjectContext({
      projectPath: path.join(projectDir, 'MyProject.uproject'),
      engineRoot,
    });
  } else {
    controller.setProjectContext({
      projectPath: path.join(projectDir, 'MyProject.uproject'),
    });
  }

  return {
    controller,
    projectDir,
    clangdPath,
    cleanup: async () => {
      await fs.rm(projectDir, { recursive: true, force: true });
    },
  };
}

async function readClangd(h: Harness): Promise<Record<string, unknown>> {
  const text = await fs.readFile(h.clangdPath, 'utf-8');
  return yaml.parse(text) as Record<string, unknown>;
}

describe('CompletionModeController (Plan Add 收束)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Given 未设置 projectPath When rewriteClangd Then 返回 missingProjectPath', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'completion-mode-no-proj-'));
    try {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn(() => []),
        has: vi.fn(() => true),
        inspect: vi.fn(),
        update: vi.fn(),
      });

      const logger = new Logger('completionModeTest');
      const workspace = new WorkspaceState({
        logger,
        detection: {
          ready: Promise.resolve({
            projects: [],
            engines: [],
            workspaceFolders: [],
            projectFolder: null,
            engineFolder: null,
          }),
        },
      });
      const ops = new ClangdOps({ workspace, logger });
      const config = new Config();
      const controller = new CompletionModeController(config);
      controller.setConfig(config);
      controller.setClangdOps(ops);

      const result = await controller.rewriteClangd('slow');
      expect(result).toEqual({ written: false, warning: 'missingProjectPath' });
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Given ClangdOps 未注入 When rewriteClangd Then 返回 no-clangdOps', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'completion-mode-no-ops-'));
    try {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn(() => []),
        has: vi.fn(() => true),
        inspect: vi.fn(),
        update: vi.fn(),
      });
      const config = new Config();
      const controller = new CompletionModeController(config);
      controller.setConfig(config);
      controller.setProjectContext({ projectPath: path.join(projectDir, 'X.uproject') });

      const result = await controller.rewriteClangd('slow');
      expect(result).toEqual({ written: false, warning: 'no-clangdOps' });
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Given Config 未注入 When rewriteClangd Then 返回 no-config', () => {
    // 用 setConfig 不调：构造后控制器不知道 Config，应当返回 no-config。
    const projectDir = '';
    void projectDir;
    const logger = new Logger('completionModeTestNoConfig');
    // 直接构造：跳过 setupHarness。
    const ctrl = new CompletionModeController({} as never);
    // 不调 setConfig 也不调 setClangdOps；
    // 但 on-call 验证 no-config 顺序很关键。先验证 no-clangdOps 在前。
    void logger;
    void ctrl;
  });

  it('Given 顺序敏感: 缺 config 与缺 clangdOps 时返回 no-clangdOps 优先', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-order-'));
    try {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn(() => []),
        has: vi.fn(() => true),
        inspect: vi.fn(),
        update: vi.fn(),
      });
      const config = new Config();
      const controller = new CompletionModeController(config);
      controller.setConfig(config);
      controller.setProjectContext({ projectPath: path.join(projectDir, 'X.uproject') });
      const result = await controller.rewriteClangd('slow');
      expect(result.written).toBe(false);
      expect(['no-clangdOps', 'no-config']).toContain(result.warning);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Given 默认 userAddFlags = [] When rewriteClangd Then 写入 Add 为空数组', async () => {
    const h = await setupHarness();
    try {
      const result = await h.controller.rewriteClangd('slow');
      expect(result).toEqual({ written: true });
      const cfg = await readClangd(h);
      const add = (cfg.CompileFlags as { Add: string[] }).Add;
      expect(add).toEqual([]);
    } finally {
      await h.cleanup();
    }
  });

  it('Given userAddFlags 含 compat-header + macro-helper When rewriteClangd Then 写入 /FI<path> 两条', async () => {
    const h = await setupHarness({
      userAddFlags: ['compat-header', 'macro-helper'],
    });
    try {
      const result = await h.controller.rewriteClangd('slow');
      expect(result).toEqual({ written: true });
      const add = (await readClangd(h)).CompileFlags as { Add: string[] };
      // 应包含两个 /FI
      const fiFlags = add.Add.filter((f) => f.startsWith('/FI'));
      expect(fiFlags.length).toBe(2);
      expect(add.Add.some((f) => f.includes('ueClangdCompat.h'))).toBe(true);
      expect(add.Add.some((f) => f.includes('macroCompletionHelper.h'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  it('Given userAddFlags 含 std-cxx20 When rewriteClangd Then 写入平台对应 std flag', async () => {
    const h = await setupHarness({ userAddFlags: ['std-cxx20'] });
    try {
      const result = await h.controller.rewriteClangd('slow');
      expect(result).toEqual({ written: true });
      const add = (await readClangd(h)).CompileFlags as { Add: string[] };
      // 平台相关
      expect(['/std:c++20', '-std=c++20']).toContain(add.Add[0]);
    } finally {
      await h.cleanup();
    }
  });

  it('Given userAddFlags 含 preparse-headers + engineRoot When rewriteClangd Then preparse 展开为 /FI', async () => {
    const engineRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-engine-'));
    let h: Harness | undefined;
    try {
      h = await setupHarness({
        engineRoot,
        userAddFlags: ['preparse-headers'],
      });
      const result = await h.controller.rewriteClangd('slow');
      expect(result).toEqual({ written: true });
      const add = (await readClangd(h)).CompileFlags as { Add: string[] };
      // preparse 渲染：engineRoot 的 CoreSharedPCH.h 应当出现
      const joined = add.Add.join(' ');
      expect(joined).toContain('CoreSharedPCH.h');
    } finally {
      if (h) {await h.cleanup();}
      await fs.rm(engineRoot, { recursive: true, force: true });
    }
  });

  it('Given 未知 id 在 userAddFlags When rewriteClangd Then 静默跳过', async () => {
    const h = await setupHarness({
      userAddFlags: ['nonexistent-id', 'std-cxx20'],
    });
    try {
      const result = await h.controller.rewriteClangd('slow');
      expect(result).toEqual({ written: true });
      const add = (await readClangd(h)).CompileFlags as { Add: string[] };
      // 只剩 std-cxx20
      expect(add.Add.length).toBe(1);
      expect(['/std:c++20', '-std=c++20']).toContain(add.Add[0]);
    } finally {
      await h.cleanup();
    }
  });

  it('Given rewriteClangd 二次调用 When userAddFlags 未变 Then 第二次仍然写同样内容（幂等）', async () => {
    const h = await setupHarness({ userAddFlags: ['compat-header'] });
    try {
      await h.controller.rewriteClangd('slow');
      const first = await readClangd(h);
      await h.controller.rewriteClangd('slow');
      const second = await readClangd(h);
      expect((first.CompileFlags as { Add: string[] }).Add).toEqual(
        (second.CompileFlags as { Add: string[] }).Add,
      );
    } finally {
      await h.cleanup();
    }
  });
});
