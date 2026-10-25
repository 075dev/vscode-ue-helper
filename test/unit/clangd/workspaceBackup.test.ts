/**
 * workspaceBackup.test.ts —— WorkspaceBackup snapshot/restore 往返测试
 *
 * 用真实临时目录验证：
 *   1. snapshot() 把 .code-workspace 备份到 `.vscode/uehelper-backup/<原文件名>`
 *   2. restore() 从备份恢复（UBT 覆盖后还原用户自定义）
 *   3. 无 .code-workspace 文件时 snapshot/restore 均为 no-op
 *   4. 无备份时 restore 静默 no-op（不抛错）
 *
 * [D12] 新增覆盖：
 *   5. 目录内有两个 `.code-workspace` 时，恢复的是**被备份的那一个**
 *   6. `.vscode/launch.json` 也被备份并恢复
 *   7. 恢复中途失败时目标文件字节不变（原子替换）
 *   8. 旧的单文件备份 `.vscode/.code-workspace.backup` 被忽略
 *   9. 传入 logger 时备份 / 恢复都记日志（恢复失败要能提示用户手动核对）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorkspaceBackup } from '@clangd/workspaceBackup';
import { type Logger } from '@core/logger';

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

  it('[D12] snapshot 把 .code-workspace 备份到 .vscode/uehelper-backup/<原文件名>', async () => {
    const root = await makeTempRoot('ws-backup-snapshot-');
    const wsFile = path.join(root, 'MyGame.code-workspace');
    const original = '{"folders":[{"path":"."}]}';
    await fs.writeFile(wsFile, original, 'utf-8');

    const backup = new WorkspaceBackup(path.join(root, 'MyGame.uproject'));
    await backup.snapshot();

    const backupFile = path.join(root, '.vscode', 'uehelper-backup', 'MyGame.code-workspace');
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

    const backupFile = path.join(root, '.vscode', 'uehelper-backup', 'MyGame.code-workspace');
    expect(await fs.readFile(backupFile, 'utf-8')).toBe('{"folders":[{"path":"."}]}');
  });

  it('无 .code-workspace 文件时 snapshot 为 no-op（不创建备份）', async () => {
    const root = await makeTempRoot('ws-backup-no-ws-');
    const backup = new WorkspaceBackup(path.join(root, 'MyGame.uproject'));
    await backup.snapshot();

    const backupFile = path.join(root, '.vscode', 'uehelper-backup', 'MyGame.code-workspace');
    await expect(fs.access(backupFile)).rejects.toThrow();
  });

  it('无备份时 restore 静默 no-op（不抛错）', async () => {
    const root = await makeTempRoot('ws-backup-no-restore-');
    const wsFile = path.join(root, 'MyGame.code-workspace');
    await fs.writeFile(wsFile, '{"folders":[]}', 'utf-8');

    const backup = new WorkspaceBackup(path.join(root, 'MyGame.uproject'));
    await expect(backup.restore()).resolves.toBeUndefined();
  });

  /* ================================================================ */
  /*  [D12] 恢复目标不错位                                              */
  /* ================================================================ */
  it('[D12] 目录内有两个 .code-workspace 时,恢复的是被备份的那一个', async () => {
    const root = await makeTempRoot('ws-backup-two-ws-');
    const aFile = path.join(root, 'A.code-workspace');
    const bFile = path.join(root, 'B.code-workspace');
    const originalA = '{"folders":[{"path":"A"}]}';
    await fs.writeFile(aFile, originalA, 'utf-8');
    await fs.writeFile(bFile, '{"folders":[{"path":"B"}]}', 'utf-8');

    const backup = new WorkspaceBackup(path.join(root, 'MyGame.uproject'));
    await backup.snapshot();

    // UBT 重写目录：覆盖 A，又新增了 B
    await fs.writeFile(aFile, '{"folders":[]}', 'utf-8');
    await fs.writeFile(bFile, '{"folders":[]}', 'utf-8');

    await backup.restore();

    // 恢复的是被备份的 A（B 不受影响）
    expect(await fs.readFile(aFile, 'utf-8')).toBe(originalA);
    expect(await fs.readFile(bFile, 'utf-8')).toBe('{"folders":[]}');
  });

  /* ================================================================ */
  /*  [D12] launch.json 一并纳入备份                                     */
  /* ================================================================ */
  it('[D12] .vscode/launch.json 也被备份并恢复', async () => {
    const root = await makeTempRoot('ws-backup-launch-');
    const launchFile = path.join(root, '.vscode', 'launch.json');
    const original = '{"version":"0.2.0","configurations":[]}';
    await fs.mkdir(path.dirname(launchFile), { recursive: true });
    await fs.writeFile(launchFile, original, 'utf-8');

    const backup = new WorkspaceBackup(path.join(root, 'MyGame.uproject'));
    await backup.snapshot();

    // 备份文件按名保存
    const backupFile = path.join(root, '.vscode', 'uehelper-backup', 'launch.json');
    expect(await fs.readFile(backupFile, 'utf-8')).toBe(original);

    // 模拟 UBT 重写 launch.json
    await fs.writeFile(launchFile, '{"version":"0.2.0"}', 'utf-8');

    await backup.restore();
    expect(await fs.readFile(launchFile, 'utf-8')).toBe(original);
  });

  /* ================================================================ */
  /*  [D12] 恢复原子性                                                  */
  /* ================================================================ */
  it('[D12] 恢复中途失败时目标文件字节不变', async () => {
    const root = await makeTempRoot('ws-backup-atomic-');
    const wsFile = path.join(root, 'MyGame.code-workspace');
    await fs.writeFile(wsFile, '{"folders":[{"path":"."}]}', 'utf-8');

    const backup = new WorkspaceBackup(path.join(root, 'MyGame.uproject'));
    await backup.snapshot();

    // 模拟 UBT 覆盖
    const overwritten = '{"folders":[]}';
    await fs.writeFile(wsFile, overwritten, 'utf-8');

    // 让恢复失败：把项目目录变成不可写（用「目标是目录」的方式模拟 rename 失败）
    // —— 删掉目标文件后建同名目录，rename 到目录会失败
    await fs.rm(wsFile, { force: true });
    await fs.mkdir(wsFile, { recursive: true });

    await expect(backup.restore()).resolves.toBeUndefined();

    // 目标仍是目录（未被半截文件覆盖），且没有残留临时文件
    expect((await fs.stat(wsFile)).isDirectory()).toBe(true);
    const leftovers = (await fs.readdir(root)).filter((f) => f.includes('.restore-'));
    expect(leftovers).toEqual([]);
  });

  /* ================================================================ */
  /*  [D12] 旧备份布局忽略                                              */
  /* ================================================================ */
  it('[D12] 旧的单文件备份 .vscode/.code-workspace.backup 被忽略', async () => {
    const root = await makeTempRoot('ws-backup-legacy-');
    const wsFile = path.join(root, 'MyGame.code-workspace');
    await fs.writeFile(wsFile, '{"folders":[{"path":"."}]}', 'utf-8');
    await fs.mkdir(path.join(root, '.vscode'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.vscode', '.code-workspace.backup'),
      '{"stale":true}',
      'utf-8',
    );

    const backup = new WorkspaceBackup(path.join(root, 'MyGame.uproject'));
    await backup.snapshot();
    await fs.writeFile(wsFile, '{"folders":[]}', 'utf-8');
    await backup.restore();

    // 恢复的是本次的新备份，不是旧布局里的陈旧内容
    expect(await fs.readFile(wsFile, 'utf-8')).toBe('{"folders":[{"path":"."}]}');
  });

  /* ================================================================ */
  /*  [D12] logger 接线                                               */
  /* ================================================================ */

  /**
   * [D12] 备份 / 恢复的关键动作必须能进日志 —— 恢复失败时要「记 error 提示用户
   * 手动核对」（计划里的恢复语义）。`WorkspaceBackup` 的 logger 是可选参数，
   * 但此前**没有任何调用方传它**，这条恢复语义实际不成立。本例钉住接线：
   * 备份与恢复各记一条，备份文件缺失时记 error 且**不覆盖**目标文件。
   */
  it('[D12] 传入 logger 时备份与恢复都记日志；备份丢失时记 error 且不覆盖目标文件', async () => {
    const root = await makeTempRoot('ws-backup-logger-');
    const wsFile = path.join(root, 'MyGame.code-workspace');
    const original = '{"folders":[{"path":"."}]}';
    await fs.writeFile(wsFile, original, 'utf-8');

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const backup = new WorkspaceBackup(
      path.join(root, 'MyGame.uproject'),
      logger as unknown as Logger,
    );

    await backup.snapshot();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('[workspaceBackup] backed up'));

    // 备份文件丢失（磁盘清理 / 手工误删）
    await fs.rm(path.join(root, '.vscode', 'uehelper-backup', 'MyGame.code-workspace'), {
      force: true,
    });

    // UBT 重写了 .code-workspace
    const ubtRewritten = '{"folders":[]}';
    await fs.writeFile(wsFile, ubtRewritten, 'utf-8');

    await backup.restore();

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('no backup named'));
    // 恢复失败不得二次破坏目标文件 —— 保持 UBT 写入后的内容
    expect(await fs.readFile(wsFile, 'utf-8')).toBe(ubtRewritten);
  });
});
