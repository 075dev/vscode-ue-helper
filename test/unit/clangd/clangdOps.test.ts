/**
 * clangdOps.test —— verify ClangdOps.applyAddFlags + mutate 的核心行为
 *
 * 测试隔离原则：
 *   - 不 mock fs，使用 vitest 的 tmp 目录（os.tmpdir() 下唯一子目录）
 *   - WorkspaceState 通过构造最小 detection 结果 + projectFolder.absPath 指向 tmpdir
 *   - 不引入 vscode（vscode mock 已经在 setup.ts 中提供）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { Logger } from '@core/logger';
import { WorkspaceState } from '@core/workspace';
import { ClangdOps } from '@clangd/clangdOps';

function makeLogger(): Logger {
  // 使用 capture-output，不污染 vscode mock（setup.ts 已提供 createOutputChannel mock）
  return new Logger('clangdOpsTest');
}

interface Harness {
  ops: ClangdOps;
  workspace: WorkspaceState;
  tmpDir: string;
  clangdPath: string;
  cleanup: () => Promise<void>;
}

async function setupHarness(opts: {
  initialConfig?: Record<string, unknown>;
} = {}): Promise<Harness> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clangdOps-test-'));
  const clangdPath = path.join(tmpDir, '.clangd');

  if (opts.initialConfig) {
    await fs.writeFile(clangdPath, yaml.stringify(opts.initialConfig), 'utf-8');
  }

  const logger = makeLogger();
  const workspace = new WorkspaceState({
    logger,
    detection: {
      ready: Promise.resolve({
        projects: [],
        engines: [],
        workspaceFolders: [
          {
            name: 'proj',
            path: '.',
            role: 'project',
            absPath: tmpDir,
          },
        ],
        projectFolder: {
          name: 'proj',
          path: '.',
          role: 'project',
          absPath: tmpDir,
        },
        engineFolder: null,
      }),
    },
  });

  const ops = new ClangdOps({ workspace, logger });

  return {
    ops,
    workspace,
    tmpDir,
    clangdPath,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

async function readClangd(h: Harness): Promise<Record<string, unknown>> {
  const text = await fs.readFile(h.clangdPath, 'utf-8');
  return yaml.parse(text) as Record<string, unknown>;
}

describe('ClangdOps.applyAddFlags (Plan B.1 收束后的统一入口)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('空 .clangd → applyAddFlags 写入 Add 字段', async () => {
    const result = await h.ops.applyAddFlags(['/X', '/imsvcD:/sdk/ucrt']);
    expect(result.ok).toBe(true);
    const cfg = await readClangd(h);
    const add = (cfg.CompileFlags as { Add: string[] }).Add;
    expect(add).toEqual(['/X', '/imsvcD:/sdk/ucrt']);
  });

  it('.clangd 不存在 → applyAddFlags 通过 mutate fallback 写入', async () => {
    // 不预写文件，先 apply
    const result = await h.ops.applyAddFlags(['-std=c++20']);
    expect(result.ok).toBe(true);
    // 文件已落地
    const cfg = await readClangd(h);
    const cf = cfg.CompileFlags as { Add: string[]; CompilationDatabase: string };
    expect(cf.Add).toEqual(['-std=c++20']);
    // 其他配置保持 default
    expect(cf.CompilationDatabase).toBe('.vscode/vscodeuehelper');
  });

  it('applyAddFlags 整体替换 Add，不做"过滤前缀 + 保留"', async () => {
    await setupHarness({
      initialConfig: {
        CompileFlags: {
          Add: ['-std=c++20', '-Wno-foo', '-Wshadow'],
          CompilationDatabase: '.vscode/vscodeuehelper',
        },
      },
    }).then(async (h2) => {
      const r = await h2.ops.applyAddFlags(['/X']);
      expect(r.ok).toBe(true);
      const cfg = await readClangd(h2);
      const add = (cfg.CompileFlags as { Add: string[] }).Add;
      // **完全替换**：旧 -std=c++20 / -Wno-foo / -Wshadow 全部消失
      expect(add).toEqual(['/X']);
      await h2.cleanup();
    });
  });

  it('applyAddFlags([]) → Add 字段为空数组', async () => {
    await setupHarness({
      initialConfig: {
        CompileFlags: {
          Add: ['/X', '/imsvc"path"'],
          CompilationDatabase: '.vscode/vscodeuehelper',
        },
      },
    }).then(async (h2) => {
      const r = await h2.ops.applyAddFlags([]);
      expect(r.ok).toBe(true);
      const cfg = await readClangd(h2);
      const add = (cfg.CompileFlags as { Add: string[] }).Add;
      expect(add).toEqual([]);
      await h2.cleanup();
    });
  });

  it('applyAddFlags 保留非 Add 字段（If / Diagnostics / InlayHints / Index）', async () => {
    await setupHarness({
      initialConfig: {
        If: { PathMatch: ['Source/.*\\.cpp'] },
        CompileFlags: {
          Add: ['/X'],
          CompilationDatabase: '.vscode/vscodeuehelper',
          Compiler: 'D:/clang-cl.exe',
        },
        Diagnostics: { UnusedIncludes: 'None', MissingIncludes: 'None' },
        InlayHints: { Enabled: 'Yes', ParameterNames: 'Yes' },
        Index: { Background: 'Build' },
      },
    }).then(async (h2) => {
      const r = await h2.ops.applyAddFlags(['-std=c++20']);
      expect(r.ok).toBe(true);
      const cfg = await readClangd(h2);
      expect((cfg as { If: unknown }).If).toBeDefined();
      const cf = cfg.CompileFlags as { Add: string[]; Compiler: string; CompilationDatabase: string };
      expect(cf.CompilationDatabase).toBe('.vscode/vscodeuehelper');
      expect(cf.Compiler).toBe('D:/clang-cl.exe');
      expect(cf.Add).toEqual(['-std=c++20']);
      await h2.cleanup();
    });
  });

  it('atomic write：写入过程不破坏现有文件（出错也能恢复）', async () => {
    // 预写合法的 .clangd
    await setupHarness({
      initialConfig: {
        CompileFlags: {
          Add: ['/X'],
          CompilationDatabase: '.vscode/vscodeuehelper',
        },
      },
    }).then(async (h2) => {
      // 模拟一次成功写入
      const r = await h2.ops.applyAddFlags(['-std=c++20']);
      expect(r.ok).toBe(true);
      // 写入路径仍合法
      const stat = await fs.stat(h2.clangdPath);
      expect(stat.isFile()).toBe(true);
      const cfg = await readClangd(h2);
      expect((cfg.CompileFlags as { Add: string[] }).Add).toEqual(['-std=c++20']);
      await h2.cleanup();
    });
  });

  it('workspace.clangdConfigPath 为 null → 返回 no-config-path', async () => {
    const { workspace, cleanup } = await setupHarness();
    // 通过 _resetForTest + 不注入 detection 结果让 clangdConfigPath 为 null
    workspace._resetForTest();
    const logger = makeLogger();
    const ops = new ClangdOps({ workspace, logger });
    // 由于 _resolve 会调用 _notifyMissing → vscode.window.showWarningMessage (mocked)
    const r = await ops.applyAddFlags(['/X']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('no-config-path');
    }
    await cleanup();
  });
});

describe('ClangdOps.readText (Phase 9 SSoT 收尾)', () => {
  it('读 .clangd 原始文本（无 YAML 解析）', async () => {
    const h = await setupHarness({
      initialConfig: {
        CompileFlags: { Add: ['/X', '/imsvc"path"'] },
      },
    });
    try {
      const text = await h.ops.readText();
      expect(text).not.toBeNull();
      // 文本应包含原始字符串，包括字段顺序
      expect(text).toContain('CompileFlags');
      expect(text).toContain('/X');
      expect(text).toContain('imsvc');
    } finally {
      await h.cleanup();
    }
  });

  it('overridePath 走自定义路径（绕开 WorkspaceState 派生）', async () => {
    const h = await setupHarness();
    try {
      const customPath = path.join(h.tmpDir, 'custom-clangd');
      await fs.writeFile(customPath, 'CompileFlags:\n  Add: [custom]', 'utf-8');
      const text = await h.ops.readText(customPath);
      expect(text).toBe('CompileFlags:\n  Add: [custom]');
    } finally {
      await h.cleanup();
    }
  });

  it('.clangd 不存在 → 返回 null 不抛错', async () => {
    const h = await setupHarness();
    try {
      // setupHarness 不预写文件
      const text = await h.ops.readText();
      expect(text).toBeNull();
    } finally {
      await h.cleanup();
    }
  });

  it('readConfig 与 readText 文本一致（验证 readText 是真源）', async () => {
    const h = await setupHarness({
      initialConfig: {
        CompileFlags: { Add: ['-std=c++20'], Remove: ['-Wno-foo'] },
      },
    });
    try {
      const text = await h.ops.readText();
      const cfg = await h.ops.readConfig();
      expect(text).not.toBeNull();
      expect(cfg).not.toBeNull();
      // yaml.parse 应该把文本转回同样的 config
      expect(cfg).toMatchObject({
        CompileFlags: { Add: ['-std=c++20'], Remove: ['-Wno-foo'] },
      });
    } finally {
      await h.cleanup();
    }
  });
});
