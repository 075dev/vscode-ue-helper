/**
 * workspace —— 项目/引擎/工作区状态单一真相源
 *
 * ## 设计原则（Phase 8 用户锁定）
 *
 * 1. **根源信息硬规则** —— 项目/引擎识别规则不允许自定义：
 *    - `path === '.'`  → project folder
 *    - `name === 'UE5'` → engine folder
 *    - 这两条规则由 WorkspaceFolderInfo.role 在 detection 层标记，WorkspaceState 不再做识别。
 *
 * 2. **不允许调用方拼接路径** —— 任何路径获取必须通过本类 getter，不允许调用方自己
 *    path.join / path.dirname / 硬编码字符串拼接。
 *
 * 3. **根源信息缺失 → 错误通知** —— get 函数内部检测，缺失时通过 `vscode.window.showWarningMessage`
 *    弹错（**「从 .uproject 重新生成工作区」** 简单提示，无按钮），整 session 只弹一次（去重）。
 *
 * 4. **不允许扩展派生规则** —— WorkspaceState 字段集固定，不允许外部添加「自定义」字段
 *    （如 buildVersionPath、engineSourcePath 等其他硬编码路径拼接都不允许）。
 *
 * ## 字段层级
 *
 * - **Level 0 根源**：workspaceFile / workspaceFolders / projectFolder / engineFolder
 * - **Level 0 注入对象**：project / engine
 * - **Level 1 派生路径**：projectDir / projectFile / projectName / engineRoot / engineVersion / workspaceRoot
 * - **Level 2 .clangd 相关**：clangdConfigPath / clangdHelperDir / compileCommandsDir / compileCommandsPath
 * - **Level 3 补全文件路径**：macroHelperPath / ueClangdCompatPath / addCompletionsPath / ...
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { Logger } from './logger';
import type { ProjectInfo, EngineInstall } from '@detection/types';

/** 从 .code-workspace folders[] 派生的 folder 元信息（detection 层标记 role） */
export interface WorkspaceFolderInfo {
  name: string;
  path: string;
  role: 'project' | 'engine' | 'unknown';
  absPath: string;
}

/** get 函数访问的字段标识符（用于去重 notify） */
export type WorkspaceField =
  | 'workspaceFile'
  | 'workspaceFolders'
  | 'projectFolder'
  | 'engineFolder'
  | 'project'
  | 'engine'
  | 'projectDir'
  | 'projectFile'
  | 'projectName'
  | 'engineRoot'
  | 'engineVersion'
  | 'workspaceRoot'
  | 'clangdConfigPath'
  | 'clangdHelperDir'
  | 'compileCommandsDir'
  | 'compileCommandsPath'
  | 'macroHelperPath'
  | 'ueClangdCompatPath'
  | 'addCompletionsPath'
  | 'addMacroCompletionsPath'
  | 'completionHelperPath'
  | 'defaultCompletionsPath';

/** WorkspaceState 配置选项 */
export interface WorkspaceStateOptions {
  /** detection 句柄，提供 detection.ready Promise + 项目/引擎/folder 解析结果 */
  detection: {
    ready: Promise<{
      projects: ProjectInfo[];
      engines: EngineInstall[];
      workspaceFile?: string;
      workspaceRoot?: string;
      workspaceFolders: WorkspaceFolderInfo[];
      projectFolder: WorkspaceFolderInfo | null;
      engineFolder: WorkspaceFolderInfo | null;
    }>;
  };
  /** Logger 实例 */
  logger: Logger;
}

/**
 * WorkspaceState —— 项目/引擎/工作区状态
 *
 * 用法：
 *   1. 创建 instance 后调用 await setResult(...)
 *   2. 同步访问各 getter
 *   3. 根源信息缺失时 get 自动弹错（去重）
 */
export class WorkspaceState implements vscode.Disposable {
  // ===== 根源信息（来自 detection 注入） =====
  private _workspaceFile: string | null = null;
  private _workspaceFolders: WorkspaceFolderInfo[] = [];
  private _projectFolder: WorkspaceFolderInfo | null = null;
  private _engineFolder: WorkspaceFolderInfo | null = null;
  private _project: ProjectInfo | null = null;
  private _engine: EngineInstall | null = null;

  /** 已弹过报错的字段（整 session 只弹一次） */
  private readonly _notifiedFields = new Set<WorkspaceField>();

  /** 是否已注入（用于测试） */
  private _injected = false;

  /** 是否已 dispose（防止 dispose 后被访问） */
  private _disposed = false;

  private readonly logger: Logger;

  constructor(opts: WorkspaceStateOptions) {
    this.logger = opts.logger;
    // 立即订阅 detection.ready，注入完成后自动 setResult
    void opts.detection.ready.then((result) => {
      this.setResult(result);
    });
  }

  /**
   * 注入 detection 结果。
   *
   * 不验证（detection 已保证语义正确，缺失会返回 null/[]）。本类只做透传。
   */
  setResult(result: {
    projects: ProjectInfo[];
    engines: EngineInstall[];
    workspaceFile?: string;
    workspaceRoot?: string;
    workspaceFolders: WorkspaceFolderInfo[];
    projectFolder: WorkspaceFolderInfo | null;
    engineFolder: WorkspaceFolderInfo | null;
  }): void {
    this._project = result.projects[0] ?? null;
    this._engine = result.engines[0] ?? null;
    this._workspaceFile = result.workspaceFile ?? null;
    this._workspaceFolders = result.workspaceFolders;
    this._projectFolder = result.projectFolder;
    this._engineFolder = result.engineFolder;
    this._injected = true;
    this.logger.info(
      `[workspace] injected: project=${this._project?.name ?? '(none)'} ` +
      `engine=${this._engine?.version ?? '(none)'} ` +
      `folders=${this._workspaceFolders.length}`,
    );
  }

  /** 测试辅助：是否已注入 */
  get isInjected(): boolean {
    return this._injected;
  }

  // ===== Level 0 根源 =====
  get workspaceFile(): string | null {
    return this._resolve<string>('workspaceFile', () => this._workspaceFile);
  }
  get workspaceFolders(): WorkspaceFolderInfo[] {
    return this._resolve<WorkspaceFolderInfo[]>('workspaceFolders', () => this._workspaceFolders) ?? [];
  }
  get projectFolder(): WorkspaceFolderInfo | null {
    return this._resolve<WorkspaceFolderInfo>('projectFolder', () => this._projectFolder);
  }
  get engineFolder(): WorkspaceFolderInfo | null {
    return this._resolve<WorkspaceFolderInfo>('engineFolder', () => this._engineFolder);
  }
  get project(): ProjectInfo | null {
    return this._resolve<ProjectInfo>('project', () => this._project);
  }
  get engine(): EngineInstall | null {
    return this._resolve<EngineInstall>('engine', () => this._engine);
  }

  // ===== Level 1 派生路径 =====
  get workspaceRoot(): string | null {
    return this._resolve<string>('workspaceRoot', () => {
      const f = this._workspaceFile;
      return f ? path.dirname(f) : null;
    });
  }
  get projectDir(): string | null {
    return this._resolve<string>('projectDir', () => {
      // 优先用 projectFolder.absPath（detection 已解析），fallback 用 project.path 的 dirname
      if (this._projectFolder) {return this._projectFolder.absPath;}
      const p = this._project;
      return p ? path.dirname(p.path) : null;
    });
  }
  get projectFile(): string | null {
    return this._resolve<string>('projectFile', () => {
      if (this._project) {return this._project.path;}
      const dir = this.projectDir;
      const name = this._projectFolder?.name;
      if (dir && name) {return path.join(dir, `${name}.uproject`);}
      return null;
    });
  }
  get projectName(): string | null {
    return this._resolve<string>('projectName', () => {
      if (this._projectFolder) {return this._projectFolder.name;}
      const p = this._project;
      if (!p) {return null;}
      const base = path.basename(p.path);
      return base.endsWith('.uproject') ? base.slice(0, -'.uproject'.length) : base;
    });
  }
  get engineRoot(): string | null {
    return this._resolve<string>('engineRoot', () => {
      if (this._engineFolder) {return this._engineFolder.absPath;}
      return this._engine?.path ?? null;
    });
  }
  get engineVersion(): string | null {
    return this._resolve<string>('engineVersion', () => this._engine?.version ?? null);
  }

  // ===== Level 2 .clangd 相关 =====
  get clangdConfigPath(): string | null {
    return this._resolve<string>('clangdConfigPath', () => {
      const dir = this.projectDir;
      return dir ? path.join(dir, '.clangd') : null;
    });
  }
  get clangdHelperDir(): string | null {
    return this._resolve<string>('clangdHelperDir', () => {
      const dir = this.projectDir;
      return dir ? path.join(dir, '.vscode', 'vscodeuehelper') : null;
    });
  }
  get compileCommandsDir(): string | null {
    return this.clangdHelperDir; // 同 clangdHelperDir（per .clangd CompilationDatabase）
  }
  get compileCommandsPath(): string | null {
    return this._resolve<string>('compileCommandsPath', () => {
      const dir = this.clangdHelperDir;
      return dir ? path.join(dir, 'compile_commands.json') : null;
    });
  }

  // ===== Level 3 补全文件路径 =====
  get macroHelperPath(): string | null {
    return this._resolve<string>('macroHelperPath', () => {
      const dir = this.clangdHelperDir;
      return dir ? path.join(dir, 'macroCompletionHelper.h') : null;
    });
  }
  get ueClangdCompatPath(): string | null {
    return this._resolve<string>('ueClangdCompatPath', () => {
      const dir = this.clangdHelperDir;
      return dir ? path.join(dir, 'ueClangdCompat.h') : null;
    });
  }
  get addCompletionsPath(): string | null {
    return this._resolve<string>('addCompletionsPath', () => {
      const dir = this.clangdHelperDir;
      return dir ? path.join(dir, 'addCompletions.h') : null;
    });
  }
  get addMacroCompletionsPath(): string | null {
    return this._resolve<string>('addMacroCompletionsPath', () => {
      const dir = this.clangdHelperDir;
      return dir ? path.join(dir, 'addMacroCompletions.h') : null;
    });
  }
  get completionHelperPath(): string | null {
    return this._resolve<string>('completionHelperPath', () => {
      const dir = this.clangdHelperDir;
      return dir ? path.join(dir, 'completionHelper.cpp') : null;
    });
  }
  get defaultCompletionsPath(): string | null {
    return this._resolve<string>('defaultCompletionsPath', () => {
      const dir = this.clangdHelperDir;
      return dir ? path.join(dir, 'defaultCompletions.h') : null;
    });
  }

  // ===== 通用 resolve 逻辑 =====

  /**
   * 通用「存在 → 直接返回；不存在 → 弹错（去重）→ 返回 null」
   *
   * 不做 spin-wait——detection.ready 在构造时已订阅，setResult 会同步设置。
   * 不做自我重试——根源信息缺失就是缺失，需要用户手动从 .uproject 重新生成工作区。
   */
  private _resolve<T>(field: WorkspaceField, resolver: () => T | null): T | null {
    if (this._notifiedFields.has(field)) {
      return null;
    }
    const value = resolver();
    if (value !== null && value !== undefined) {
      return value;
    }
    this._notifyMissing(field);
    return null;
  }

  /**
   * 字段缺失通知（弹错 + 去重）
   *
   * 文案：简短提示「从 .uproject 重新生成工作区」，无按钮。
   * 这是用户拍板的方案——根源信息缺失时不要提供修复按钮（按按钮还是要 .code-workspace，会死循环）。
   */
  private _notifyMissing(field: WorkspaceField): void {
    this._notifiedFields.add(field);
    const message = this._missingMessage(field);
    this.logger.warn(`[workspace] missing ${field}: ${message}`);
    void vscode.window.showWarningMessage(message);
  }

  /** 字段缺失消息（统一指向「从 .uproject 重新生成工作区」） */
  private _missingMessage(_field: WorkspaceField): string {
    // 统一文案，避免泄露内部字段名（让用户困惑）
    // 来源：用户拍板，简短一行，无按钮
    return '从 .uproject 重新生成工作区';
  }

  // ===== 测试辅助 =====

  /** 重置去重缓存（仅测试用） */
  _resetForTest(): void {
    this._notifiedFields.clear();
    this._injected = false;
    this._project = null;
    this._engine = null;
    this._workspaceFile = null;
    this._workspaceFolders = [];
    this._projectFolder = null;
    this._engineFolder = null;
  }

  // ===== Disposable =====

  /**
   * 释放资源：
   * - 清空去重通知 Set
   * - 重置内部状态字段（与 _resetForTest 等价，避免外部继续访问到旧数据）
   * - 设置 disposed 标志（幂等，重复调用安全）
   *
   * 不需要释放 EventEmitter——本类未持有任何 emitter。
   * 调用方负责把本实例 push 到 context.subscriptions，让 deactivate 时自动释放。
   */
  dispose(): void {
    if (this._disposed) {return;}
    this._disposed = true;
    this._notifiedFields.clear();
    this._injected = false;
    this._project = null;
    this._engine = null;
    this._workspaceFile = null;
    this._workspaceFolders = [];
    this._projectFolder = null;
    this._engineFolder = null;
    this.logger.info('[workspace] disposed');
  }

  /** 测试辅助：是否已 dispose */
  get isDisposed(): boolean {
    return this._disposed;
  }
}