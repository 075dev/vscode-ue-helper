/**
 * clearClangdIndex —— 定位并清理 clangd 的持久化索引缓存
 *
 * ## 借鉴来源
 *
 * **[Incanta/vscode-cpp-unreal](https://github.com/Incanta/vscode-cpp-unreal)** 的
 * `Clear clangd Index` 命令。本插件的 `Diagnose Clangd Project` 原本只能报告
 * 「clangd 索引坏了」,却给不出补救动作;补上这个命令后,诊断 → 修复形成闭环。
 *
 * ## 行为约定
 *
 * 1. 只探测 clangd profile 目录下的 `index/` 子目录,不碰其他 profile 数据。
 * 2. **不存在就如实说「未找到」**,不猜路径、不空删。
 * 3. 删除前弹出确认框,列出每个目录的体积与文件数。
 * 4. 删除后询问是否重启 clangd(扩展未激活时该命令不存在,失败仅 warn)。
 */

import * as vscode from 'vscode';
import * as nodeFs from 'node:fs/promises';
import { type Logger } from '@core/logger';
import type { WorkspaceState } from '@core/workspace';
import {
  clangdIndexCacheCandidates,
  clearIndexCache,
  discoverIndexCaches,
  formatIndexCacheSize,
  type IndexCacheCandidate,
  type IndexCacheEnv,
  type IndexCacheFs,
} from '@clangd/clangdIndexCache';
import {
  okEnvelope,
  errEnvelope,
  EC_OPERATION_CANCELLED,
  EC_INTERNAL_ERROR,
  type Envelope,
} from '@core/envelope';
import { t } from '@i18n';

/** 可注入依赖(测试用) */
export interface ClearClangdIndexDeps {
  /** 文件系统实现,省略时用 node:fs/promises */
  fs?: IndexCacheFs;
  /** 环境变量,省略时用 process.env */
  env?: IndexCacheEnv;
  /** 用户确认回调;返回 false 表示取消 */
  confirm?: (message: string, confirmLabel: string) => Promise<boolean>;
  /** 通知回调 */
  notify?: (message: string) => void;
  /** 重启 clangd(默认调 vscode clangd 扩展的 clangd.restart) */
  restartClangd?: () => Promise<void>;
}

/** 默认 fs 实现(包一层,匹配 IndexCacheFs 接口) */
const defaultFs: IndexCacheFs = {
  stat: (target) => nodeFs.stat(target),
  readdir: (target) => nodeFs.readdir(target),
  rm: (target, options) => nodeFs.rm(target, options),
};

/** 默认环境变量 */
function defaultEnv(): IndexCacheEnv {
  return {
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    USERPROFILE: process.env.USERPROFILE,
    HOME: process.env.HOME,
  };
}

/** 清理结果 */
export interface ClearClangdIndexResult {
  /** 实际清理的目录 */
  readonly cleared: readonly string[];
  /** 释放的字节数 */
  readonly freedBytes: number;
}

/**
 * 执行「清理 clangd 索引缓存」。
 *
 * @returns 契约 envelope:成功时 data 为清理结果;用户取消 → OPERATION_CANCELLED;
 *          清理过程抛错 → INTERNAL_ERROR。
 */
export async function executeClearClangdIndex(
  logger: Logger,
  workspace?: WorkspaceState,
  deps: ClearClangdIndexDeps = {},
): Promise<Envelope<ClearClangdIndexResult>> {
  const fs = deps.fs ?? defaultFs;
  const env = deps.env ?? defaultEnv();

  let projectDir: string | null = null;
  try {
    projectDir = workspace?.projectDir ?? null;
  } catch {
    // workspace 派生字段缺失属于预期(未检测到项目),全局索引候选仍然可用
    projectDir = null;
  }

  const candidates = clangdIndexCacheCandidates(projectDir, env);
  let found: IndexCacheCandidate[];
  try {
    found = await discoverIndexCaches(candidates, fs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[clearClangdIndex] discovery failed:', msg);
    return errEnvelope(EC_INTERNAL_ERROR, msg);
  }

  if (found.length === 0) {
    const message = t('cmd.clearClangdIndex.notFound');
    if (deps.notify) {
      deps.notify(message);
    } else {
      void vscode.window.showInformationMessage(message);
    }
    logger.info('[clearClangdIndex] no clangd index cache found');
    return okEnvelope({ cleared: [], freedBytes: 0 }, message);
  }

  const totalBytes = found.reduce((sum, item) => sum + item.sizeBytes, 0);
  const detail = found
    .map(
      (item) => `${item.path} (${formatIndexCacheSize(item.sizeBytes)}, ${item.fileCount} files)`,
    )
    .join('\n');
  const confirmMessage = `${t('cmd.clearClangdIndex.confirm', {
    size: formatIndexCacheSize(totalBytes),
  })}\n${detail}`;

  const confirmLabel = t('cmd.clearClangdIndex.confirmButton');
  const confirmed = deps.confirm
    ? await deps.confirm(confirmMessage, confirmLabel)
    : (await vscode.window.showWarningMessage(confirmMessage, { modal: true }, confirmLabel)) ===
      confirmLabel;

  if (!confirmed) {
    const message = t('cmd.clearClangdIndex.cancelled');
    logger.info('[clearClangdIndex] user cancelled');
    return errEnvelope(EC_OPERATION_CANCELLED, message);
  }

  const cleared: string[] = [];
  let freedBytes = 0;
  for (const item of found) {
    try {
      await clearIndexCache(item.path, fs);
      cleared.push(item.path);
      freedBytes += item.sizeBytes;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[clearClangdIndex] failed to remove ${item.path}:`, msg);
    }
  }

  const message =
    cleared.length === 0
      ? t('cmd.clearClangdIndex.failed')
      : t('cmd.clearClangdIndex.cleared', {
          size: formatIndexCacheSize(freedBytes),
          count: cleared.length,
        });
  logger.info(`[clearClangdIndex] cleared ${cleared.length} dir(s), freed ${freedBytes} bytes`);

  // 索引已删,clangd 需要重启才会重新建库 —— 扩展未激活时该命令不存在,失败仅 warn。
  // 只弹一次通知(带「重启 clangd」按钮),不叠加第二条 toast。
  const restartBtn = t('cmd.clearClangdIndex.restartClangd');
  if (deps.notify) {
    deps.notify(message);
  } else {
    const choice = await vscode.window.showInformationMessage(message, restartBtn);
    if (choice === restartBtn) {
      try {
        if (deps.restartClangd) {
          await deps.restartClangd();
        } else {
          await vscode.commands.executeCommand('clangd.restart');
        }
      } catch (err) {
        logger.warn('[clearClangdIndex] clangd.restart failed, restart manually:', err);
      }
    }
  }

  return okEnvelope({ cleared, freedBytes }, message);
}
