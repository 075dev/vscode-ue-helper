/**
 * generatedHeaderWatcher —— 监听 .generated.h 文件变化，通过 proxy 注入 clangd 通知。
 *
 * ## Phase 8 HeaderWatcher 支持
 *
 * 问题：HeaderWatcher 完成 UBT codegen 后，.generated.h 文件已更新，
 * 但 clangd 的文件监视有 ~100-500ms 延迟，用户会感知"报错闪烁"。
 *
 * 解法：proxy 直接用 chokidar 监听 .generated.h 文件变化，
 * 文件变化时立即通过 LspBridge.injectClientNotification 推送
 * workspace/didChangeWatchedFiles 给 clangd，触发 clangd 立即重索引。
 *
 * 为什么在 proxy 侧做（而不是 extension 侧）：
 *   - extension 无法直接发送 LSP 通知给 clangd
 *   - proxy 已有到 clangd 的 stdin 通道（ProcessBridge）
 *   - 绕过 VS Code 文件监视延迟
 *
 * 通信方式：
 *   - extension → proxy：通过 trigger 文件（.vscode/ue-helper-reparse-trigger）
 *   - proxy → clangd：通过 injectClientNotification
 *
 * 使用方式：
 *   ```typescript
 *   const watcher = new GeneratedHeaderWatcher(bridge, logger);
 *   watcher.start(projectDir);
 *   // ... UBT 完成后 ...
 *   await triggerReparse(projectDir, changedFiles);
 *   // proxy 自动检测 trigger 文件变化并注入通知
 *   ```
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
//import * as vscode from 'vscode';
import chokidar from 'chokidar';
import type { LspBridge } from './bridge';
import type { Logger } from '@core/logger';

/**
 * Trigger 文件路径（相对于 projectDir）。
 * Extension 在 UBT 完成后写入此文件，proxy 检测到变化后注入 clangd 通知。
 */
const TRIGGER_FILE_NAME = '.vscode/ue-helper-reparse-trigger';

/**
 * Trigger 文件内容格式（JSON）。
 */
interface TriggerPayload {
  /** 变更的 .generated.h 文件绝对路径列表 */
  changedFiles: string[];
  /** UBT 完成时间戳（毫秒） */
  completedAt: number;
}

/**
 * .generated.h 文件变化监听器 + clangd 通知注入器。
 *
 * 两种触发模式：
 * 1. **Trigger 文件模式**（默认）：extension 写 trigger 文件 → proxy 检测 → 注入通知
 * 2. **直接 chokidar 模式**（可选）：proxy 直接 watch .generated.h → 注入通知
 *
 * 推荐模式 1，因为：
 *   - extension 知道哪些文件真正变了（UBT 刚写完）
 *   - 避免 chokidar 误报（UBT 写 .generated.h 时触发）
 *   - 更精确的时序控制
 */
export class GeneratedHeaderWatcher {
  /** chokidar watcher 实例 */
  private chokidarWatcher: chokidar.FSWatcher | null = null;

  constructor(
    private readonly bridge: LspBridge,
    private readonly logger: Logger,
  ) {}

  /**
   * 启动监听。
   *
   * @param projectDir - 项目根目录（.uproject 所在目录）
   */
  start(projectDir: string): void {
    this.dispose();

    const triggerFilePath = path.join(projectDir, TRIGGER_FILE_NAME);

    // 直接监听 trigger 文件本身
    this.chokidarWatcher = chokidar.watch(triggerFilePath, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.chokidarWatcher.on('change', (filePath) => {
      void this.handleTriggerFileChange(filePath);
    });

    this.chokidarWatcher.on('add', (filePath) => {
      void this.handleTriggerFileChange(filePath);
    });

    this.logger.info(`[generatedHeaderWatcher] started, watching trigger: ${triggerFilePath}`);
  }

  /**
   * 处理 trigger 文件变化：读取内容 → 注入 clangd 通知。
   */
  private async handleTriggerFileChange(triggerFilePath: string): Promise<void> {
    try {
      const raw = await fs.readFile(triggerFilePath, 'utf-8');
      const payload = JSON.parse(raw) as TriggerPayload;

      if (!payload.changedFiles || payload.changedFiles.length === 0) {
        this.logger.info('[generatedHeaderWatcher] trigger file has no changed files');
        return;
      }

      // 转换为 URI 格式（clangd 使用 file:// URI）
      const changes = payload.changedFiles.map((fsPath) => ({
        uri: 'file://' + fsPath,
        type: 2 as const, // 2 = Changed (FileChangeType)
      }));

      // 注入 workspace/didChangeWatchedFiles 通知给 clangd
      this.bridge.injectClientNotification('workspace/didChangeWatchedFiles', {
        changes,
      });

      this.logger.info(
        `[generatedHeaderWatcher] injected didChangeWatchedFiles for ${changes.length} file(s)`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[generatedHeaderWatcher] failed to process trigger: ${msg}`);
    }
  }

  /**
   * 停止监听。
   */
  dispose(): void {
    if (this.chokidarWatcher) {
      void this.chokidarWatcher.close();
      this.chokidarWatcher = null;
    }
  }
}

/**
 * 触发 reparse：写 trigger 文件，proxy 检测到后注入 clangd 通知。
 *
 * 由 extension 侧在 UBT 完成后调用。
 *
 * @param projectDir - 项目根目录
 * @param changedFiles - 变更的 .generated.h 文件绝对路径列表
 */
export async function triggerReparse(projectDir: string, changedFiles: string[]): Promise<void> {
  const triggerFilePath = path.join(projectDir, TRIGGER_FILE_NAME);
  const triggerDir = path.dirname(triggerFilePath);

  // 确保 .vscode 目录存在
  await fs.mkdir(triggerDir, { recursive: true });

  const payload: TriggerPayload = {
    changedFiles,
    completedAt: Date.now(),
  };

  await fs.writeFile(triggerFilePath, JSON.stringify(payload, null, 2), 'utf-8');
}
