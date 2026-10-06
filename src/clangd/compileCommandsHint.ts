/**
 * compileCommandsHint —— 新增源文件时刷新 compile_commands.json(提示 / 自动双模式)
 *
 * 模式借鉴 boocs/unreal-clangd："自动检测何时需更新编译命令（新增 .h/.cpp）"。
 * compile_commands.json 是 clangd 的输入清单 —— 新建的 .cpp 不会自动进清单，
 * 导致新文件长期"零 IntelliSense"。本模块消费 IncrementalFileWatcher 的
 * addedFiles（见 fileWatcher.ts），在检测到新增 C++ 源文件时按模式处理：
 *
 *   - notify（既有模式，`compileCommandsAutoRefresh=false`）：按节流间隔弹提示，
 *     用户点"更新"才触发重建。
 *   - auto（默认，add-004 / 决策 D9）：不弹任何窗，节流到期直接后台静默重建
 *     （executeCommand 传 { quiet: true } —— 无 picker、无成功弹窗、无"重启 clangd?"
 *     询问、失败不弹窗，见 generateCompileCommands.ts）；clangd 12+ 热重载
 *     compile_commands.json，无需重启。
 *
 * 设计要点：
 *   - 只看 add 事件：change（编辑已有文件）与 unlink（删除）不需要刷新清单。
 *   - 节流：notify 10 分钟 / auto 2 分钟（DEFAULT_AUTO_INTERVAL_MS）——UE 项目批量
 *     生成/拷贝文件时避免连环弹窗（notify）或周期性分钟级 UBT（auto）。
 *   - 防重入（auto）：UBT 生成分钟级，inFlight 标志保证跑完前忽略新批次；
 *     完成后的下个节流窗自然合批增量。失败 inFlight 复位，下窗自动重试。
 *   - 模式 getter 每拍现读：配置开关变更即时生效，无需 reload、无需事件监听。
 *   - 可注入 notify / execute：生产环境默认走 vscode.window.showInformationMessage
 *     + vscode.commands.executeCommand('vscodeUEHelper.generateCompileCommands')。
 *     用命令间接调用（而非直接 import commands 模块）避免 clangd → commands 循环依赖。
 */

import type { IncrementalBatch } from './fileWatcher';
import { t } from '@i18n';

/** notify 模式默认节流间隔：10 分钟 */
export const DEFAULT_HINT_INTERVAL_MS = 10 * 60 * 1000;

/** auto 模式默认节流间隔：2 分钟（首拍即建，之后的增量在窗内合批） */
export const DEFAULT_AUTO_INTERVAL_MS = 2 * 60 * 1000;

/**
 * 刷新处理模式（add-004 / 决策 D9）。
 * - 'notify'：节流弹提示，用户确认后重建
 * - 'auto'：节流到期后台静默重建，全程无弹窗
 */
export type CompileCommandsHintMode = 'notify' | 'auto';

/** 需要进编译清单的扩展名（与 fileWatcher 监听范围一致，大小写不敏感） */
const RELEVANT_EXT_RE = /\.(h|hpp|inl|cpp|cc|c)$/i;

export interface CompileCommandsHintOptions {
  /** notify 模式节流间隔（毫秒），默认 10 分钟 */
  intervalMs?: number;
  /** auto 模式节流间隔（毫秒），默认 2 分钟 */
  autoIntervalMs?: number;
  /**
   * 模式 getter，每个批次现读（配置开关变更即时生效）；默认恒为 'notify'。
   */
  mode?: () => CompileCommandsHintMode;
  /** 时间源（测试注入）；默认 performance.now */
  now?: () => number;
  /**
   * 提示函数，返回用户点击的按钮文案；默认 vscode.window.showInformationMessage。
   * 返回 undefined（Esc/关闭）视为放弃。仅 notify 模式使用。
   */
  notify?: (relevantFiles: string[]) => Promise<string | undefined>;
  /**
   * 重建动作执行函数；默认 vscode.commands.executeCommand——auto 模式附加
   * { quiet: true }（静默形态），notify 模式无参（用户已显式确认，保留完整反馈）。
   */
  execute?: (mode: CompileCommandsHintMode) => Promise<unknown>;
  /** "更新" 按钮文案 */
  updateLabel?: string;
  /** logger 兼容接口（只用到 warn/info 级别签名） */
  logger?: {
    info: (msg: string, ...rest: unknown[]) => void;
    warn: (msg: string, ...rest: unknown[]) => void;
  };
}

/**
 * CompileCommandsRefreshHint —— 挂在 IncrementalFileWatcher.onBatch 之后的刷新触发器
 *
 * 用法：
 *   ```ts
 *   const hint = new CompileCommandsRefreshHint({
 *     logger,
 *     mode: () => (config.compileCommandsAutoRefresh ? 'auto' : 'notify'),
 *   });
 *   watcher.onBatch = (batch) => {
 *     perfLog.recordIncrementalScan(batch.totalLatencyMs, batch.files.length);
 *     void hint.onBatch(batch);
 *   };
 *   ```
 */
export class CompileCommandsRefreshHint {
  private lastTriggerAt: number | null = null;
  private inFlight = false;
  private readonly intervalMs: number;
  private readonly autoIntervalMs: number;
  private readonly modeGetter: () => CompileCommandsHintMode;
  private readonly now: () => number;
  private readonly notifyImpl: (relevantFiles: string[]) => Promise<string | undefined>;
  private readonly executeImpl: (mode: CompileCommandsHintMode) => Promise<unknown>;
  private readonly updateLabel: string;
  private readonly logger?: CompileCommandsHintOptions['logger'];

  constructor(options: CompileCommandsHintOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_HINT_INTERVAL_MS;
    this.autoIntervalMs = options.autoIntervalMs ?? DEFAULT_AUTO_INTERVAL_MS;
    this.modeGetter = options.mode ?? (() => 'notify');
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
      (async (mode) => {
        const vscode = await import('vscode');
        return vscode.commands.executeCommand(
          'vscodeUEHelper.generateCompileCommands',
          ...(mode === 'auto' ? [{ quiet: true }] : []),
        );
      });
    // 注意:zh locale 的文案是"中文 / English"双语串,必须用运行时 t() 求值,
    // 否则 zh 环境下按钮文案与 updateLabel 永远不相等。
    this.updateLabel = options.updateLabel ?? t('clangd.newFilesHint.update');
    this.logger = options.logger;
  }

  /**
   * 消费一个 watcher 批次。命中新增 C++ 源文件且已过节流间隔时,按当前模式
   * 弹提示（notify）或后台静默重建（auto）。
   * 本方法吞掉自身异常 —— 刷新触发失败绝不影响 perfLog 主流程。
   */
  async onBatch(batch: IncrementalBatch): Promise<void> {
    try {
      const relevant = batch.addedFiles.filter((f) => RELEVANT_EXT_RE.test(f));
      if (relevant.length === 0) {
        return;
      }
      const mode = this.modeGetter();
      const intervalMs = mode === 'auto' ? this.autoIntervalMs : this.intervalMs;
      const ts = this.now();
      if (this.lastTriggerAt !== null && ts - this.lastTriggerAt < intervalMs) {
        this.logger?.info(
          `[compileCommandsHint] ${relevant.length} new file(s) within throttle window (${mode}), skip`,
        );
        return;
      }
      this.lastTriggerAt = ts;

      if (mode === 'auto') {
        await this.runAutoRefresh(relevant);
        return;
      }

      const choice = await this.notifyImpl(relevant);
      if (choice === this.updateLabel) {
        this.logger?.info('[compileCommandsHint] user accepted → regenerate compile_commands');
        await this.executeImpl('notify');
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
    this.lastTriggerAt = null;
  }

  /**
   * auto 模式：后台静默重建。inFlight 防重入——UBT 生成分钟级，
   * 执行期间的批次直接跳过（节流已记时，完成后的下个窗自然合批）。
   * 生产 executeCommand 不 reject（envelope 走返回值），命令未注册等极端
   * reject 由 onBatch 外层 catch 兜底；失败不弹窗、打失败日志，
   * 下个节流窗自动重试。
   */
  private async runAutoRefresh(relevant: string[]): Promise<void> {
    if (this.inFlight) {
      this.logger?.info(
        `[compileCommandsHint] ${relevant.length} new file(s) but a refresh is already in flight, skip`,
      );
      return;
    }
    this.inFlight = true;
    try {
      this.logger?.info(
        `[compileCommandsHint] auto-refresh triggered by ${relevant.length} new file(s)`,
      );
      const result = (await this.executeImpl('auto')) as { ok?: boolean } | undefined;
      // 管线失败经 envelope resolve 返回(ok:false)——打失败日志而非虚假成功
      // (评审 F-1);成功日志仅在 ok 时输出
      if (result && typeof result === 'object' && result.ok === false) {
        this.logger?.warn('[compileCommandsHint] auto-refresh failed, will retry next window');
        return;
      }
      this.logger?.info('[compileCommandsHint] auto-refresh finished (clangd will hot-reload)');
    } finally {
      this.inFlight = false;
    }
  }
}
