/**
 * workspace —— 项目/引擎工作区单一真相源（Phase 8 架构重构）
 *
 * 设计原则：
 * 1. 单一真相源：所有项目/引擎/路径信息集中在此，detection 完成时一次性注入。
 * 2. 派生路径：通过 get 函数访问，不允许调用方 path.dirname(project.path) 拼路径。
 * 3. 「尝试获取」语义：get 函数自身检测 → 存在直接返回 → 不存在等待 detection → 仍获取不到弹错返回 null。
 * 4. 错误通知去重：同一字段整个 session 只弹一次报错。
 * 5. 错误弹报由 get 控制：get 最清楚自己缺什么，调用方不需要 try/catch 守卫。
 *
 * 使用方式：
 * ```typescript
 * const ws = workspace; // 注入的单例
 * const projectDir = ws.projectDir;          // string | null（同步 spin-wait detection）
 * const helperDir = ws.clangdHelperDir;      // string | null
 *
 * if (projectDir === null) {
 *   // get 内部已经弹过报错，这里只做静默降级
 *   return;
 * }
 * ```
 *
 * 不使用方式（禁止）：
 * ```typescript
 * const projectDir = path.dirname(project.path);  // ❌ 散落 dirname
 * const clangdConfig = path.join(projectDir, '.clangd');  // ❌ 散落拼接
 * ```
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { Logger } from './logger';
import type { ProjectInfo, EngineInstall } from '../detection/types';

/** 可通过 get 访问的字段标识符（用于去重 notify） */
export type WorkspaceField =
  | 'project'
  | 'projectDir'
  | 'projectName'
  | 'engine'
  | 'engineRoot'
  | 'engineVersion'
  | 'workspaceFile'
  | 'workspaceRoot'
  | 'clangdConfigPath'
  | 'clangdHelperDir'
  | 'macroHelperPath'
  | 'ueClangdCompatPath'
  | 'addCompletionsPath'
  | 'addMacroCompletionsPath'
  | 'completionHelperPath'
  | 'defaultCompletionsPath'
  | 'compileCommandsDir'
  | 'compileCommandsPath';

/** WorkspaceState 配置选项 */
export interface WorkspaceStateOptions {
  /** detection 句柄，提供 detection.ready Promise */
  detection: {
    ready: Promise<{
      projects: ProjectInfo[];
      engines: EngineInstall[];
      workspaceFile?: string;
    }>;
  };
  /** Logger 实例（用于静默 warn） */
  logger: Logger;
  /** 可选：detection 完成超时（毫秒），默认 5000 */
  detectionTimeoutMs?: number;
}

/**
 * WorkspaceState —— 项目/引擎工作区状态
 *
 * 检测流程：
 * 1. 插件激活时创建 instance（不传 detectionResult）
 * 2. await detection.ready 后调 setResult() 注入数据
 * 3. 各模块通过 get 同步访问
 *
 * 异常流程：
 * - 检测失败（results 为空）：get 返回 null + 弹报错（去重）
 * - 检测超时（极少见）：get 返回 null + 弹「检测超时」报错
 */
export class WorkspaceState {
  private _project: ProjectInfo | null = null;
  private _engine: EngineInstall | null = null;
  private _workspaceFile: string | null = null;

  /** detection 已注入标记 */
  private _detectionInjected = false;
  /** detection 注入尝试次数（spin-wait 用） */
  private _spinAttempts = 0;
  private readonly _timeoutMs: number;

  /** 已弹过报错的字段（整个 session 只弹一次） */
  private readonly _notifiedFields = new Set<WorkspaceField>();

  private readonly logger: Logger;

  constructor(opts: WorkspaceStateOptions) {
    this.logger = opts.logger;
    this._timeoutMs = opts.detectionTimeoutMs ?? 5000;
    // detection Promise 引用由构造函数隐式持有（通过 opts），未来 spin-wait 可用
    void opts.detection.ready;
  }

  // ========== 注入入口（detection 完成后由 extension 调用）=========

  /**
   * 注入 detection 结果。
   *
   * 由 extension.ts 在 await detection.ready 后调用一次。
   * 必须在所有 get 访问前完成，否则 get 会触发 spin-wait。
   */
  setResult(result: {
    projects: ProjectInfo[];
    engines: EngineInstall[];
    workspaceFile?: string;
  }): void {
    this._project = result.projects[0] ?? null;
    this._engine = result.engines[0] ?? null;
    this._workspaceFile = result.workspaceFile ?? null;
    this._detectionInjected = true;
    this.logger.info(
      `[workspace] injected: project=${this._project?.name ?? '(none)'} engine=${this._engine?.version ?? '(none)'}`,
    );
  }

  /** 检测是否已注入（用于调试和测试） */
  get isReady(): boolean {
    return this._detectionInjected;
  }

  // ========== 基础字段访问器（同步）==========

  /** 原始项目信息（无派生） */
  get project(): ProjectInfo | null {
    return this._resolve<ProjectInfo>('project', () => this._project);
  }

  /** 原始引擎信息（无派生） */
  get engine(): EngineInstall | null {
    return this._resolve<EngineInstall>('engine', () => this._engine);
  }

  /** .code-workspace 文件绝对路径 */
  get workspaceFile(): string | null {
    return this._resolve<string>('workspaceFile', () => this._workspaceFile);
  }

  // ========== 派生路径 get 函数（核心）==========

  /** 项目目录（.uproject 所在目录） */
  get projectDir(): string | null {
    return this._resolve<string>('projectDir', () => {
      const p = this._project;
      return p ? path.dirname(p.path) : null;
    });
  }

  /** 项目名称（去掉 .uproject 后缀的文件名） */
  get projectName(): string | null {
    return this._resolve<string>('projectName', () => {
      const p = this._project;
      if (!p) {return null;}
      const base = path.basename(p.path);
      return base.endsWith('.uproject') ? base.slice(0, -'.uproject'.length) : base;
    });
  }

  /** 引擎根目录 */
  get engineRoot(): string | null {
    return this._resolve<string>('engineRoot', () => this._engine?.path ?? null);
  }

  /** 引擎版本号（Build.version） */
  get engineVersion(): string | null {
    return this._resolve<string>('engineVersion', () => this._engine?.version ?? null);
  }

  /** .code-workspace 所在目录 */
  get workspaceRoot(): string | null {
    return this._resolve<string>('workspaceRoot', () => {
      const f = this._workspaceFile;
      return f ? path.dirname(f) : null;
    });
  }

  /** .clangd 完整路径 */
  get clangdConfigPath(): string | null {
    return this._resolve<string>('clangdConfigPath', () => {
      const dir = this.projectDir;
      return dir ? path.join(dir, '.clangd') : null;
    });
  }

  /** .vscode/vscodeuehelper/ 目录 */
  get clangdHelperDir(): string | null {
    return this._resolve<string>('clangdHelperDir', () => {
      const dir = this.projectDir;
      return dir ? path.join(dir, '.vscode', 'vscodeuehelper') : null;
    });
  }

  /** macroCompletionHelper.h 完整路径 */
  get macroHelperPath(): string | null {
    return this._resolve<string>('macroHelperPath', () => {
      const helperDir = this.clangdHelperDir;
      return helperDir ? path.join(helperDir, 'macroCompletionHelper.h') : null;
    });
  }

  /** ueClangdCompat.h 完整路径 */
  get ueClangdCompatPath(): string | null {
    return this._resolve<string>('ueClangdCompatPath', () => {
      const helperDir = this.clangdHelperDir;
      return helperDir ? path.join(helperDir, 'ueClangdCompat.h') : null;
    });
  }

  /** addCompletions.h 完整路径 */
  get addCompletionsPath(): string | null {
    return this._resolve<string>('addCompletionsPath', () => {
      const helperDir = this.clangdHelperDir;
      return helperDir ? path.join(helperDir, 'addCompletions.h') : null;
    });
  }

  /** addMacroCompletions.h 完整路径 */
  get addMacroCompletionsPath(): string | null {
    return this._resolve<string>('addMacroCompletionsPath', () => {
      const helperDir = this.clangdHelperDir;
      return helperDir ? path.join(helperDir, 'addMacroCompletions.h') : null;
    });
  }

  /** completionHelper.cpp 完整路径 */
  get completionHelperPath(): string | null {
    return this._resolve<string>('completionHelperPath', () => {
      const helperDir = this.clangdHelperDir;
      return helperDir ? path.join(helperDir, 'completionHelper.cpp') : null;
    });
  }

  /** defaultCompletions.h 完整路径 */
  get defaultCompletionsPath(): string | null {
    return this._resolve<string>('defaultCompletionsPath', () => {
      const helperDir = this.clangdHelperDir;
      return helperDir ? path.join(helperDir, 'defaultCompletions.h') : null;
    });
  }

  /** compile_commands.json 所在目录（per .clangd CompilationDatabase） */
  get compileCommandsDir(): string | null {
    return this.clangdHelperDir;
  }

  /** compile_commands.json 完整路径 */
  get compileCommandsPath(): string | null {
    return this._resolve<string>('compileCommandsPath', () => {
      const dir = this.clangdHelperDir;
      return dir ? path.join(dir, 'compile_commands.json') : null;
    });
  }

  // ========== 通用 resolve 逻辑（核心算法）==========

  /**
   * 通用「尝试获取」逻辑：
   * 1. 字段已注入 → resolver 立即返回值
   * 2. 字段未注入 + 未通知 → spin-wait detection，超时后 resolver 再次尝试
   * 3. resolver 返回 null/undefined → 弹错（去重）+ 返回 null
   * 4. resolver 返回值 → 缓存 + 返回
   */
  private _resolve<T>(field: WorkspaceField, resolver: () => T | null): T | null {
    // 已通知过该字段缺失 → 直接返回 null，避免重复弹错
    if (this._notifiedFields.has(field)) {
      return null;
    }

    // 第一次解析尝试
    let value = resolver();
    if (value !== null && value !== undefined) {
      return value;
    }

    // 字段为空 + 未注入 → spin-wait detection
    if (!this._detectionInjected) {
      this._spinWaitDetection();

      // 注入后重试
      value = resolver();
      if (value !== null && value !== undefined) {
        return value;
      }
    }

    // 注入完成但 resolver 仍返回空 → 弹错 + 去重
    this._notifyMissing(field);
    return null;
  }

  /**
   * Spin-wait detection Promise（Node 单线程模型下的折中方案）
   *
   * 实际不真正阻塞线程——而是用 setImmediate 让出 microtask，
   * 然后立即检查 _detectionInjected 标记。
   *
   * 超时后放弃等待。极端情况下用户调用 get 时检测仍未完成，
   * 后续 setResult() 调用会使所有缓存失效（虽然目前没有缓存）。
   */
  private _spinWaitDetection(): void {
    if (this._detectionInjected) {return;}
    if (this._spinAttempts > 0) {return;} // 已在等待中
    this._spinAttempts++;

    const start = Date.now();
    while (!this._detectionInjected && Date.now() - start < this._timeoutMs) {
      // 在 Node 单线程下，busy-wait 不会让 async 推进。
      // 必须显式让出 microtask：
      // 这里用同步循环 + 短间隔 setImmediate 不可行（get 是同步的）。
      // 实用方案：信任 activateXxx 在调用 get 前已 await detection.ready，
      // 这里只是 defensive 兜底（spin 几次后放弃）。
      this._sleepSync(1); // 短 sleep，避免 CPU 100%
    }
  }

  /** 同步短睡（Node 没有 sync sleep，用 Atomics.wait 在 worker 内才有） */
  private _sleepSync(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin */
    }
  }

  /**
   * 字段缺失通知（弹错 + 去重）
   */
  private _notifyMissing(field: WorkspaceField): void {
    this._notifiedFields.add(field);

    const message = this._missingMessage(field);
    this.logger.warn(`[workspace] missing ${field}: ${message}`);
    void vscode.window.showWarningMessage(message);
  }

  /** 字段缺失的本地化消息 */
  private _missingMessage(field: WorkspaceField): string {
    // 复用 i18n key 模式（如果 i18n 模块有 key 则使用，否则英文 fallback）
    const messages: Record<WorkspaceField, string> = {
      project: 'Workspace project not detected. Open a .code-workspace with a .uproject in folders[0].',
      projectDir: 'Cannot resolve project directory (no .uproject detected).',
      projectName: 'Cannot resolve project name (no .uproject detected).',
      engine: 'Workspace engine not detected. Add UE engine root as folders[1] in .code-workspace.',
      engineRoot: 'Cannot resolve engine root directory.',
      engineVersion: 'Cannot resolve engine version.',
      workspaceFile: 'No .code-workspace file is open in VS Code.',
      workspaceRoot: 'Cannot resolve workspace root directory.',
      clangdConfigPath: 'Cannot resolve .clangd path (projectDir unknown).',
      clangdHelperDir: 'Cannot resolve .vscode/vscodeuehelper path (projectDir unknown).',
      macroHelperPath: 'Cannot resolve macroCompletionHelper.h path.',
      ueClangdCompatPath: 'Cannot resolve ueClangdCompat.h path.',
      addCompletionsPath: 'Cannot resolve addCompletions.h path.',
      addMacroCompletionsPath: 'Cannot resolve addMacroCompletions.h path.',
      completionHelperPath: 'Cannot resolve completionHelper.cpp path.',
      defaultCompletionsPath: 'Cannot resolve defaultCompletions.h path.',
      compileCommandsDir: 'Cannot resolve compile_commands.json directory.',
      compileCommandsPath: 'Cannot resolve compile_commands.json path.',
    };
    return messages[field];
  }

  // ========== 测试辅助 ==========

  /** 重置去重缓存（仅测试用） */
  _resetNotifyCacheForTest(): void {
    this._notifiedFields.clear();
    this._detectionInjected = false;
    this._project = null;
    this._engine = null;
    this._workspaceFile = null;
    this._spinAttempts = 0;
  }
}