/**
 * uninstall.test.ts —— executeUninstall 清理语义单元测试
 *
 * 覆盖:
 *   1. 无工作区根 → 弹警告并返回
 *   2. 清理托管文件(.clangd / compile_commands.json / 托管补全文件)
 *   3. [F2-20/§8.8] 保留 addCompletions.h / addMacroCompletions.h(用户可能编辑过)
 *
 * 用真实临时目录验证文件系统行为,不 mock node:fs。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { executeUninstall } from '@commands/uninstall';
import type { Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import { initI18n } from '@i18n';

function createLoggerMock() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    show: vi.fn(),
    setLevel: vi.fn(),
    dispose: vi.fn(),
  } as unknown as Logger;
}

/** 构造最小 workspace mock:只需 projectDir 与 clangdConfigPath 两个 getter */
function makeWorkspace(root: string): WorkspaceState {
  return {
    get projectDir() {
      return root;
    },
    get clangdConfigPath() {
      return path.join(root, '.clangd');
    },
  } as unknown as WorkspaceState;
}

/** 构造一个典型的插件生成文件布局 */
async function makePluginLayout(root: string): Promise<void> {
  const helperDir = path.join(root, '.vscode', 'vscodeuehelper');
  await fs.mkdir(helperDir, { recursive: true });
  // 托管文件(应被删除)
  await fs.writeFile(path.join(root, '.clangd'), 'CompileFlags:\n', 'utf-8');
  await fs.writeFile(path.join(root, 'compile_commands.json'), '[]', 'utf-8');
  await fs.writeFile(path.join(helperDir, 'completionHelper.cpp'), '// managed', 'utf-8');
  await fs.writeFile(path.join(helperDir, 'defaultCompletions.h'), '// managed', 'utf-8');
  // 用户可能编辑过的文件(应被保留)
  await fs.writeFile(path.join(helperDir, 'addCompletions.h'), '// user edits', 'utf-8');
  await fs.writeFile(
    path.join(helperDir, 'addMacroCompletions.h'),
    '// BEGIN MANAGED\n// END MANAGED\n// user edits',
    'utf-8',
  );
}

describe('executeUninstall', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    initI18n();
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'uninstall-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('无工作区根目录 → 弹警告并返回 PROJECT_NOT_DETECTED envelope,不执行任何清理', async () => {
    const result = await executeUninstall(createLoggerMock(), undefined);
    // [Wave2 契约对齐] 无项目根 → 契约错误码 PROJECT_NOT_DETECTED
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('PROJECT_NOT_DETECTED');
    expect(result.error?.message).toContain('No workspace root found.');
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No workspace root found.'),
    );
  });

  it('清理托管文件,保留 addCompletions.h / addMacroCompletions.h(F2-20/§8.8)', async () => {
    await makePluginLayout(tmpRoot);
    const helperDir = path.join(tmpRoot, '.vscode', 'vscodeuehelper');

    const result = await executeUninstall(createLoggerMock(), makeWorkspace(tmpRoot));

    // [Wave2 契约对齐] 成功 → ok envelope,data.removed 携带清理清单
    expect(result.ok).toBe(true);
    expect(result.data?.removed).toContain('.clangd');
    expect(result.data?.removed).toContain('.vscode/vscodeuehelper/');
    expect(result.summary).toContain('.vscode/vscodeuehelper/');

    // 托管文件已删除
    await expect(fs.access(path.join(tmpRoot, '.clangd'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpRoot, 'compile_commands.json'))).rejects.toThrow();
    await expect(fs.access(path.join(helperDir, 'completionHelper.cpp'))).rejects.toThrow();
    await expect(fs.access(path.join(helperDir, 'defaultCompletions.h'))).rejects.toThrow();

    // 用户可能编辑过的文件保留
    expect(await fs.readFile(path.join(helperDir, 'addCompletions.h'), 'utf-8')).toBe(
      '// user edits',
    );
    expect(await fs.readFile(path.join(helperDir, 'addMacroCompletions.h'), 'utf-8')).toContain(
      '// user edits',
    );

    // 用户反馈包含 helper 目录(说明走了定点删除路径)
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('.vscode/vscodeuehelper/'),
    );
  });

  it('helper 目录不存在时静默跳过,不报错', async () => {
    // 只创建项目根,不创建 .vscode/vscodeuehelper
    await fs.writeFile(path.join(tmpRoot, '.clangd'), 'CompileFlags:\n', 'utf-8');

    const result = await executeUninstall(createLoggerMock(), makeWorkspace(tmpRoot));
    // [Wave2 契约对齐] 正常完成 → ok envelope;removed 为已处理目标 label
    // (存量语义:fs.rm force 对不存在的文件不抛错,故列表含全部目标 label)
    expect(result.ok).toBe(true);
    expect(result.data?.removed).toContain('.clangd');
    await expect(fs.access(path.join(tmpRoot, '.clangd'))).rejects.toThrow();
  });

  // [M1] 插件自己创建的备份目录必须被清理 ——
  // D12 起备份落在 `.vscode/uehelper-backup/<原文件名>`，而清理清单此前仍写着
  // D12 之前的旧路径 `.vscode/.code-workspace.backup` → 备份目录永远不会被删。
  it('[M1] 清理插件自己创建的 .vscode/uehelper-backup/ 目录(含 D12 前的旧目录)', async () => {
    const backupDir = path.join(tmpRoot, '.vscode', 'uehelper-backup');
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(path.join(backupDir, 'MyGame.code-workspace'), '{}', 'utf-8');
    await fs.writeFile(path.join(backupDir, 'launch.json'), '{}', 'utf-8');

    const legacyBackupDir = path.join(tmpRoot, '.vscode', '.code-workspace.backup');
    await fs.mkdir(legacyBackupDir, { recursive: true });
    await fs.writeFile(path.join(legacyBackupDir, 'MyGame.code-workspace'), '{}', 'utf-8');

    const result = await executeUninstall(createLoggerMock(), makeWorkspace(tmpRoot));

    expect(result.ok).toBe(true);
    expect(result.data?.removed).toContain('.vscode/uehelper-backup/');

    // 两个备份目录都不该残留
    await expect(fs.access(backupDir)).rejects.toThrow();
    await expect(fs.access(legacyBackupDir)).rejects.toThrow();
  });
});
