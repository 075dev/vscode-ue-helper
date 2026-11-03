/**
 * workspaceBackup —— 保护 .code-workspace / launch.json 不被 UBT 覆盖
 *
 * UBT 的 -ProjectFiles 重新生成模式会重写项目的 .code-workspace(以及
 * .vscode/launch.json),不保留用户自定义。本模块:
 *   1. UBT 跑前快照 workspace
 *   2. UBT 跑完后恢复用户自定义
 *
 * 模式参考 unreal-clangd 的 src/workspaceBackup.ts。
 *
 * 类 WorkspaceBackup:
 *   - snapshot(): 复制当前 .code-workspace / .vscode/launch.json 到
 *                 `.vscode/uehelper-backup/<原文件名>`
 *   - restore(): 从备份恢复（同名文件，原子替换）
 *   - startWatching(): 监听变化自动恢复
 *
 * 接入点：src/commands/build.ts 在 UBT 构建前 snapshot()、构建后（finally）restore()，
 * 尊重 `autoBackupWorkspace` 设置（默认 true）。无 .code-workspace 文件时自然 no-op。
 *
 * ## [D12] 备份布局升级为「按名保存」+ 恢复目标不再错位
 *
 * 旧实现有四个问题：
 *
 *   (a) **恢复目标错位**：`snapshot()` 与 `restore()` 各自独立地
 *       `entries.find(e => e.endsWith('.code-workspace'))`，取各自那次调用时的
 *       第一个匹配。UBT 重写目录后（可能新增/重命名 workspace 文件），恢复的
 *       目标可能变成**另一个**文件 → 用户自定义丢到别的文件里。
 *   (b) **launch.json 丢失**：文件头承诺保护 `.vscode/launch.json`，实现只处理
 *       `.code-workspace`。
 *   (c) **恢复非原子**：`fs.copyFile` 直接覆盖，中途失败留下半截文件。
 *   (d) 所有备份挤在一个文件里，且永不清理。
 *
 * 现在：
 *   - 备份**按原文件名**保存到 `.vscode/uehelper-backup/<原文件名>`
 *     （文件名即天然去重，备份目录大小有界 —— 顺带解决 (d)）；
 *   - `snapshot()` 记录被备份的文件名，`restore()` 用**同一个名字**恢复；
 *     找不到同名备份**不退化**为"取第一个"（找不到就不恢复并记 error）；
 *   - `.vscode/launch.json` 一并纳入备份清单；
 *   - 恢复改 temp + rename（原子），中途失败目标文件字节不变。
 *
 * 旧的单文件备份 `.vscode/.code-workspace.backup` **忽略不迁移** ——
 * 旧备份可能已过期，用陈旧内容覆盖用户当前文件的风险更高。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from '@core/logger';

/** 受保护文件所在的目录（相对项目根） */
const BACKUP_ROOT_DIR = '.vscode';
/** 备份子目录（相对项目根） */
const BACKUP_SUBDIR = 'uehelper-backup';
/** launch.json 的固定文件名 */
const LAUNCH_JSON = 'launch.json';

/**
 * 备份目录的绝对路径 —— **单一真相源**。
 *
 * `src/commands/uninstall.ts` 的清理清单必须用这个来算，否则两处各写一份
 * 路径常量就会漂移（本轮评审 M1 就是这么发现的：D12 把备份挪到了
 * `.vscode/uehelper-backup/`，uninstall 还在清旧的 `.vscode/.code-workspace.backup`
 * —— 插件自己创建的备份目录永远不会被清理）。
 *
 * @param projectDir 项目根目录（`.uproject` 所在目录）
 */
export function getWorkspaceBackupDir(projectDir: string): string {
  return path.join(projectDir, BACKUP_ROOT_DIR, BACKUP_SUBDIR);
}

export class WorkspaceBackup {
  /**
   * 本次 snapshot 实际备份的文件：备份文件名 → 还原目标绝对路径。
   *
   * 用实例状态记录，保证 restore 恢复到**被备份的那一个**文件，
   * 而不是"目录里第一个 .code-workspace"。
   */
  private readonly backedUp = new Map<string, string>();

  constructor(
    private readonly projectPath: string,
    private readonly logger?: Logger,
  ) {}

  private get projectDir(): string {
    return path.dirname(this.projectPath);
  }

  private get backupDir(): string {
    return getWorkspaceBackupDir(this.projectDir);
  }

  /**
   * Snapshot the current .code-workspace / .vscode/launch.json.
   * Called before UBT regenerates. If no such file exists, this is a no-op.
   */
  async snapshot(): Promise<void> {
    const dir = this.projectDir;

    // ① .code-workspace —— 文件名不固定（`<Project>.code-workspace`），取第一个匹配。
    //    注意：这里只决定「备份谁」，restore 用记录下来的名字还原，不会再重新 find。
    const entries = await fs.readdir(dir).catch(() => []);
    const workspaceFile = entries.find((e) => e.endsWith('.code-workspace'));
    if (workspaceFile) {
      await this.backupFile(path.join(dir, workspaceFile), workspaceFile);
    }

    // ② .vscode/launch.json —— 固定名，UBT 也会重写它
    const launchSrc = path.join(dir, BACKUP_ROOT_DIR, LAUNCH_JSON);
    if (await pathExists(launchSrc)) {
      await this.backupFile(launchSrc, LAUNCH_JSON);
    }
  }

  /** 备份单个文件到按名布局的备份目录，并记录还原目标 */
  private async backupFile(src: string, backupName: string): Promise<void> {
    const dst = path.join(this.backupDir, backupName);
    await fs.mkdir(this.backupDir, { recursive: true });
    await fs.copyFile(src, dst);
    this.backedUp.set(backupName, src);
    this.logger?.info(`[workspaceBackup] backed up ${src} → ${dst}`);
  }

  /**
   * Restore the workspace from the backup. Called after UBT finishes.
   *
   * - 恢复到**被备份的那一个**文件（用 snapshot 记录的名字）；
   * - 找不到同名备份 → 不恢复，记 error（不退化为"取目录里第一个"）；
   * - 恢复用 temp + rename（原子）—— 中途失败目标文件字节不变。
   */
  async restore(): Promise<void> {
    const targets = this.resolveRestoreTargets();
    if (targets.length === 0) {
      return;
    }

    for (const [backupName, dst] of targets) {
      const src = path.join(this.backupDir, backupName);
      if (!(await pathExists(src))) {
        this.logger?.error(
          `[workspaceBackup] no backup named "${backupName}" — skip restore (target left as-is): ${dst}`,
        );
        continue;
      }
      try {
        await atomicRestore(src, dst);
        this.logger?.info(`[workspaceBackup] restored ${dst} from ${src}`);
      } catch (err) {
        // 恢复失败 → 目标文件保持 UBT 写入后的状态，不被二次破坏
        this.logger?.error(
          `[workspaceBackup] restore failed for ${dst}:` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 解析本次要恢复的目标列表。
   *
   * **只用 snapshot 记录的名字**（实例状态）—— 不扫描备份目录做「兜底恢复」：
   * 备份可能来自上一次会话（陈旧），用它覆盖用户当前文件的风险更高。
   * 找不到同名备份就不恢复（记 error）。
   */
  private resolveRestoreTargets(): Array<[string, string]> {
    return [...this.backedUp.entries()];
  }
}

/** 路径是否存在 */
async function pathExists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

/**
 * 原子恢复：先复制到同目录临时文件，再 rename 覆盖目标。
 *
 * rename 在同一卷内是原子的 → 目标要么是旧内容要么是完整的新内容，
 * 不会出现半截文件。失败时清理临时文件并把错误抛给调用方。
 */
async function atomicRestore(src: string, dst: string): Promise<void> {
  const dir = path.dirname(dst);
  const tmp = path.join(dir, `.${path.basename(dst)}.restore-${process.pid}-${Date.now()}`);
  await fs.copyFile(src, tmp);
  try {
    await fs.rename(tmp, dst);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
