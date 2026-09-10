/**
 * workspaceBackup.test.ts —— WorkspaceBackup snapshot/restore 往返测试
 *
 * 用真实临时目录验证：
 *   1. snapshot() 把 .code-workspace 复制到 .vscode/.code-workspace.backup
 *   2. restore() 从备份恢复（UBT 覆盖后还原用户自定义）
 *   3. 无 .code-workspace 文件时 snapshot/restore 均为 no-op
 *   4. 无备份时 restore 静默 no-op（不抛错）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorkspaceBackup } from '@clangd/workspaceBackup';

const TEMP_ROOTS: string[] = [];

async function makeTempRoot(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  TEMP_ROOTS.push(dir);
  return dir;
}

async function cleanupAll(): Promise<void> {
  for (const dir of TEMP_ROOTS.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('WorkspaceBackup', () => {
  beforeEach(async () => {
    await cleanupAll();
  });

  afterEach(async () => {
    await cleanupAll();
  });

  it('snapshot 把 .code-workspace 备份到 .vscode/.code-workspace.backup', async () => {
    const root = await makeTempRoot('ws-backup-snapshot-');
    const wsFile = path.join(root, 'MyGame.code-workspace');
    const original = '{"folders":[{"path":"."}]}';
    await fs.writeFile(wsFile, original, 'utf-8');

    const backup = new WorkspaceBackup(path.join(root, 'MyGame.uproject'));
    await backup.snapshot();

    const backupFile = path.join(root, '.vscode', '.code-workspace.backup');
    expect(await fs.readFile(backupFile, 'utf-8')).toBe(original);
  });

  it('restore 把备份写回（UBT 覆盖后还原）', async () => {
    const root = await makeTempRoot('ws-backup-restore-');
    const wsFile = path.join(root, 'MyGame.code-workspace');
    const original = '{"folders":[{"path":"."}]}';
    await fs.writeFile(wsFile, original, 'utf-8');

    const backup = new WorkspaceBackup(path.join(root, 'MyGame.uproject'));
    await backup.snapshot();

    // 模拟 UBT -ProjectFiles 覆盖 .code-workspace
    await fs.writeFile(wsFile, '{"folders":[]}', 'utf-8');

    await backup.restore();
    expect(await fs.readFile(wsFile, 'utf-8')).toBe(original);
  });

  it('snapshot 幂等：重复 snapshot 覆盖旧备份', async () => {
    const root = await makeTempRoot('ws-backup-idempotent-');
    const wsFile = path.join(root, 'MyGame.code-workspace');
    await fs.writeFile(wsFile, '{"folders":[{"path":"."}]}', 'utf-8');

    const backup = new WorkspaceBackup(path.join(root, 'MyGame.uproject'));
    await backup.snapshot();
    await backup.snapshot();

    const backupFile = path.join(root, '.vscode', '.code-workspace.backup');
    expect(await fs.readFile(backupFile, 'utf-8')).toBe('{"folders":[{"path":"."}]}');
  });

  it('无 .code-workspace 文件时 snapshot 为 no-op（不创建备份）', async () => {
    const root = await makeTempRoot('ws-backup-no-ws-');
    const backup = new WorkspaceBackup(path.join(root, 'MyGame.uproject'));
    await backup.snapshot();

    const backupFile = path.join(root, '.vscode', '.code-workspace.backup');
    await expect(fs.access(backupFile)).rejects.toThrow();
  });

  it('无备份时 restore 静默 no-op（不抛错）', async () => {
    const root = await makeTempRoot('ws-backup-no-restore-');
    const wsFile = path.join(root, 'MyGame.code-workspace');
    await fs.writeFile(wsFile, '{"folders":[]}', 'utf-8');

    const backup = new WorkspaceBackup(path.join(root, 'MyGame.uproject'));
    await expect(backup.restore()).resolves.toBeUndefined();
  });
});
