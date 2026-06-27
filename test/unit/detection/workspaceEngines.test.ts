import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readWorkspaceFolders, classifyFolders } from '@detection/workspaceFolders';

describe('readWorkspaceFolders', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-folders-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns ALL folders (no name filter) — engine classification happens later', async () => {
    // The new architecture treats all folders equally. Project vs engine
    // is determined by file presence (Build.version / .uproject), not by
    // folder name.
    const wsPath = path.join(tmpDir, 'XianDreamwalking.code-workspace');
    const json = JSON.stringify({
      folders: [
        { name: 'XianDreamwalking', path: '.' },
        { name: 'UE5', path: 'D:\\Program Files\\Epic Games\\UE_5.8' },
      ],
    });
    await fs.writeFile(wsPath, json, 'utf-8');

    const result = await readWorkspaceFolders(wsPath);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(tmpDir);
    expect(result[1]).toBe('D:\\Program Files\\Epic Games\\UE_5.8');
  });

  it('handles forward-slash absolute paths', async () => {
    const wsPath = path.join(tmpDir, 'test.code-workspace');
    await fs.writeFile(
      wsPath,
      JSON.stringify({ folders: [{ name: 'UE', path: '/Users/Foo/UE_5.4' }] }),
      'utf-8',
    );
    expect(await readWorkspaceFolders(wsPath)).toEqual(['/Users/Foo/UE_5.4']);
  });

  it('returns [] for missing file', async () => {
    expect(await readWorkspaceFolders(path.join(tmpDir, 'nonexistent.code-workspace'))).toEqual([]);
  });

  it('returns [] for empty folders array', async () => {
    const wsPath = path.join(tmpDir, 'empty.code-workspace');
    await fs.writeFile(wsPath, JSON.stringify({ folders: [] }), 'utf-8');
    expect(await readWorkspaceFolders(wsPath)).toEqual([]);
  });
});

describe('classifyFolders', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'classify-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('classifies folder with .uproject as project', async () => {
    const projectDir = path.join(tmpDir, 'MyProject');
    await fs.mkdir(projectDir);
    await fs.writeFile(
      path.join(projectDir, 'MyProject.uproject'),
      JSON.stringify({ EngineAssociation: '5.7' }),
      'utf-8',
    );

    const result = await classifyFolders([projectDir]);
    expect(result).toHaveLength(1);
    expect(result[0]?.isProject).toBe(true);
    expect(result[0]?.isEngine).toBe(false);
    expect(result[0]?.uprojectPath).toContain('MyProject.uproject');
  });

  it('classifies folder with Build.version as engine', async () => {
    const engineDir = path.join(tmpDir, 'UE_5.8');
    await fs.mkdir(path.join(engineDir, 'Engine', 'Build'), { recursive: true });
    await fs.writeFile(
      path.join(engineDir, 'Engine', 'Build', 'Build.version'),
      JSON.stringify({ MajorVersion: 5, MinorVersion: 8, PatchVersion: 0 }),
      'utf-8',
    );

    const result = await classifyFolders([engineDir]);
    expect(result).toHaveLength(1);
    expect(result[0]?.isProject).toBe(false);
    expect(result[0]?.isEngine).toBe(true);
  });

  it('classifies both when a folder has both files', async () => {
    const dir = path.join(tmpDir, 'BothDir');
    await fs.mkdir(path.join(dir, 'Engine', 'Build'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'Engine', 'Build', 'Build.version'),
      JSON.stringify({ MajorVersion: 5 }),
      'utf-8',
    );
    await fs.writeFile(
      path.join(dir, 'BothDir.uproject'),
      JSON.stringify({ EngineAssociation: '5.8' }),
      'utf-8',
    );

    const result = await classifyFolders([dir]);
    expect(result[0]?.isProject).toBe(true);
    expect(result[0]?.isEngine).toBe(true);
  });

  it('classifies as neither for empty folders', async () => {
    const empty = path.join(tmpDir, 'Empty');
    await fs.mkdir(empty);
    const result = await classifyFolders([empty]);
    expect(result[0]?.isProject).toBe(false);
    expect(result[0]?.isEngine).toBe(false);
  });
});
