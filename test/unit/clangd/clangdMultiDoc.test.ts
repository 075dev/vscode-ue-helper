/**
 * clangdMultiDoc.test —— [D3] `.clangd` 多文档 YAML 安全
 *
 * ## 背景
 *
 * clangd 的 `.clangd` 是 **YAML stream（多文档）** 文件 —— 多个配置块用 `---`
 * 分隔，clangd 按目录深度逐个叠加。这是 clangd 的官方能力，用户手写的
 * `.clangd` 经常带 per-directory 覆盖块。
 *
 * 旧实现用 `yaml.parse(text)`，它遇到第二个文档会**直接抛异常**：
 *
 *   Source contains multiple documents; please use YAML.parseAllDocuments()
 *
 * 后果：
 *   - `readConfig()` 永远返回 null
 *   - `mutate()` 永远返回 `parse-failed` → 扩展对多文档 `.clangd` **完全无法写入**
 *   - 即便读得进去，`renderClangdConfig()` 只输出单文档 → 写回时用户手写的
 *     其它文档**整体覆盖丢失**
 *
 * ## 覆盖
 *
 *   - 多文档可读（取第一个 map 文档）
 *   - 多文档可写（mutate 不再 parse-failed）
 *   - 写回后其它文档**原样保留**
 *   - 用户手写的**注释保留**（递归合并，不整体替换子树）
 *   - YAML 语法错误仍然报 parse-failed（不放宽）
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { Logger } from '@core/logger';
import { WorkspaceState } from '@core/workspace';
import { ClangdOps } from '@clangd/clangdOps';
import { mergeConfigIntoDoc, parseClangdDocs, renderClangdDocs } from '@clangd/clangdYaml';

interface Harness {
  ops: ClangdOps;
  tmpDir: string;
  clangdPath: string;
  cleanup: () => Promise<void>;
}

async function setupHarness(initialText?: string): Promise<Harness> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clangdMultiDoc-test-'));
  const clangdPath = path.join(tmpDir, '.clangd');
  if (initialText !== undefined) {
    await fs.writeFile(clangdPath, initialText, 'utf-8');
  }

  const logger = new Logger('clangdMultiDocTest');
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

  return {
    ops: new ClangdOps({ workspace, logger }),
    tmpDir,
    clangdPath,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

const MULTI_DOC = `# 顶部注释
CompileFlags:
  # Add 注释
  Add: [-DFOO=1]
  Compiler: clang-cl.exe
---
# 第二个文档：per-directory 覆盖
If:
  PathMatch: [Plugins/.*]
CompileFlags:
  Add: [-DBAR=1]
`;

describe('[D3] .clangd 多文档 YAML —— 原语', () => {
  it('parseClangdDocs 对多文档不抛异常,返回全部文档', () => {
    const parsed = parseClangdDocs(MULTI_DOC);
    expect(parsed.error).toBeUndefined();
    expect(parsed.docs).toHaveLength(2);
    expect(parsed.mainIndex).toBe(0);
  });

  it('parseClangdDocs 对 YAML 语法错误返回 error(不抛)', () => {
    const parsed = parseClangdDocs('a: [1, 2\nb: :::\n');
    expect(parsed.error).toBeDefined();
    expect(parsed.docs).toHaveLength(0);
  });

  it('parseClangdDocs 空字符串 → 无文档,不报错', () => {
    const parsed = parseClangdDocs('');
    expect(parsed.error).toBeUndefined();
    expect(parsed.docs).toHaveLength(0);
    expect(parsed.mainIndex).toBe(-1);
  });

  it('mergeConfigIntoDoc 递归合并 → 未变动子树的注释保留', () => {
    const parsed = parseClangdDocs(MULTI_DOC);
    const main = parsed.docs[parsed.mainIndex]!;
    const config = main.toJS() as Record<string, unknown>;
    config.CompileFlags = {
      ...(config.CompileFlags as Record<string, unknown>),
      Add: ['-DFOO=1', '-DNEW=2'],
    };
    mergeConfigIntoDoc(main, config);

    const text = main.toString({ lineWidth: 0 });
    expect(text).toContain('# 顶部注释');
    expect(text).toContain('# Add 注释');
    expect(text).toContain('-DNEW=2');
  });

  it('renderClangdDocs 保留 --- 分隔', () => {
    const parsed = parseClangdDocs(MULTI_DOC);
    const text = renderClangdDocs(parsed.docs);
    expect(text).toContain('---');
    // 渲染结果重新解析仍是两个文档
    expect(yaml.parseAllDocuments(text)).toHaveLength(2);
  });
});

describe('[D3] ClangdOps 对多文档 .clangd 的读写', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness(MULTI_DOC);
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('readConfig 读出主文档(不再返回 null)', async () => {
    const config = await h.ops.readConfig();
    expect(config).not.toBeNull();
    expect((config!.CompileFlags as { Add: string[] }).Add).toEqual(['-DFOO=1']);
  });

  it('applyAddFlags 成功(不再 parse-failed)', async () => {
    const result = await h.ops.applyAddFlags(['-DFOO=1', '-DNEW=2']);
    expect(result.ok).toBe(true);
  });

  it('写回后第二个文档原样保留', async () => {
    await h.ops.applyAddFlags(['-DFOO=1', '-DNEW=2']);
    const text = await fs.readFile(h.clangdPath, 'utf-8');

    expect(text).toContain('PathMatch');
    expect(text).toContain('-DBAR=1');
    // 两个文档都在
    const docs = yaml.parseAllDocuments(text);
    expect(docs).toHaveLength(2);
  });

  it('写回后用户手写的注释保留', async () => {
    await h.ops.applyAddFlags(['-DFOO=1', '-DNEW=2']);
    const text = await fs.readFile(h.clangdPath, 'utf-8');

    expect(text).toContain('# 顶部注释');
    expect(text).toContain('# Add 注释');
    expect(text).toContain('# 第二个文档：per-directory 覆盖');
  });

  it('主文档的 Add 被正确替换', async () => {
    await h.ops.applyAddFlags(['-DREPLACED=1']);
    const text = await fs.readFile(h.clangdPath, 'utf-8');
    const docs = yaml.parseAllDocuments(text);
    const main = docs[0]!.toJS() as { CompileFlags: { Add: string[] } };
    expect(main.CompileFlags.Add).toEqual(['-DREPLACED=1']);
  });
});

describe('[D3] YAML 语法错误仍然拒绝写入', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness('CompileFlags:\n  Add: [unclosed\n');
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('applyAddFlags → parse-failed', async () => {
    const result = await h.ops.applyAddFlags(['-DX=1']);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('parse-failed');
  });

  it('readConfig → null(不抛)', async () => {
    await expect(h.ops.readConfig()).resolves.toBeNull();
  });
});
