/**
 * compileCommandsHint —— 新增源文件时提示刷新 compile_commands.json
 *
 * 模式借鉴 boocs/unreal-clangd："自动检测何时需更新编译命令（新增 .h/.cpp）"。
 * compile_commands.json 是 clangd 的输入清单 —— 新建的 .cpp 不会自动进清单，
 * 导致新文件长期"零 IntelliSense"。本模块消费 IncrementalFileWatcher 的
 * addedFiles（见 fileWatcher.ts），在检测到新增 C++ 源文件时按节流间隔提示。
 *
 * 设计要点：
 *   - 只看 add 事件：change（编辑已有文件）与 unlink（删除）不需要刷新清单。
 *   - 节流：intervalMs 内最多提示一次 —— UE 项目批量生成/拷贝文件时避免连环弹窗。
 *   - 可注入 notify / execute：生产环境默认走 vscode.window.showInformationMessage
 *     + vscode.commands.executeCommand('vscodeUEHelper.generateCompileCommands')。
 *     用命令间接调用（而非直接 import commands 模块）避免 clangd → commands 循环依赖。
 */

import type { IncrementalBatch } from './fileWatcher';
import { t } from '@i18n';

/** 默认节流间隔：10 分钟 */
export const DEFAULT_HINT_INTERVAL_MS = 10 * 60 * 1000;

/** 需要进编译清单的扩展名（与 fileWatcher 监听范围一致，大小写不敏感） */
const RELEVANT_EXT_RE = /\.(h|hpp|inl|cpp|cc|c)$/i;

export interface CompileCommandsHintOptions {
  /** 节流间隔（毫秒），默认 10 分钟 */
  intervalMs?: number;
  /** 时间源（测试注入）；默认 performance.now */
  now?: () => number;
  /**
   * 提示函数，返回用户点击的按钮文案；默认 vscode.window.showInformationMessage。
   * 返回 undefined（Esc/关闭）视为放弃。
   */
  notify?: (relevantFiles: string[]) => Promise<string | undefined>;
  /** "更新" 动作执行函数；默认 vscode.commands.executeCommand */
  execute?: () => Promise<unknown>;
  /** "更新" 按钮文案 */
  updateLabel?: string;
  /** logger 兼容接口（只用到 warn/info 级别签名） */
  logger?: {
    info: (msg: string, ...rest: unknown[]) => void;
    warn: (msg: string, ...rest: unknown[]) => void;
  };
}

/**
 * CompileCommandsRefreshHint —— 挂在 IncrementalFileWatcher.onBatch 之后的提示器
 *
 * 用法：
 *   ```ts
 *   const hint = new CompileCommandsRefreshHint({ logger });
 *   watcher.onBatch = (batch) => {
 *     perfLog.recordIncrementalScan(batch.totalLatencyMs, batch.files.length);
 *     void hint.onBatch(batch);
 *   };
 *   ```
 */
export class CompileCommandsRefreshHint {
  private lastHintAt: number | null = null;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly notifyImpl: (relevantFiles: string[]) => Promise<string | undefined>;
  private readonly executeImpl: () => Promise<unknown>;
  private readonly updateLabel: string;
  private readonly logger?: CompileCommandsHintOptions['logger'];

  constructor(options: CompileCommandsHintOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_HINT_INTERVAL_MS;
    this.now = options.now ?? (() => performance.now());
    this.notifyImpl =
      options.notify ??
      (async (relevantFiles) => {
        const vscode = await import('vscode');
        const update = t('clangd.newFilesHint.update');
        return vscode.window.showInformationMessage(
          t('clangd.newFilesHint', { count: relevantFiles.length }),
          update,
        );
      });
    this.executeImpl =
      options.execute ??
      (async () => {
        const vscode = await import('vscode');
        return vscode.commands.executeCommand('vscodeUEHelper.generateCompileCommands');
      });
    // 注意:zh locale 的文案是"中文 / English"双语串,必须用运行时 t() 求值,
    // 否则 zh 环境下按钮文案与 updateLabel 永远不相等。
    this.updateLabel = options.updateLabel ?? t('clangd.newFilesHint.update');
    this.logger = options.logger;
  }

  /**
   * 消费一个 watcher 批次。命中新增 C++ 源文件且已过节流间隔时弹提示。
   * 本方法吞掉自身异常 —— 提示失败绝不影响 perfLog 主流程。
   */
  async onBatch(batch: IncrementalBatch): Promise<void> {
    try {
      const relevant = batch.addedFiles.filter((f) => RELEVANT_EXT_RE.test(f));
      if (relevant.length === 0) {
        return;
      }
      const ts = this.now();
      if (this.lastHintAt !== null && ts - this.lastHintAt < this.intervalMs) {
        this.logger?.info(
          `[compileCommandsHint] ${relevant.length} new file(s) within throttle window, skip`,
        );
        return;
      }
      this.lastHintAt = ts;
      const choice = await this.notifyImpl(relevant);
      if (choice === this.updateLabel) {
        this.logger?.info('[compileCommandsHint] user accepted → regenerate compile_commands');
        await this.executeImpl();
      }
    } catch (err) {
      this.logger?.warn(
        '[compileCommandsHint] failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** 重置节流状态（测试 / 手动重置用） */
  reset(): void {
    this.lastHintAt = null;
  }
}
