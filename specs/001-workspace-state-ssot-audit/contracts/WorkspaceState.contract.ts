/**
 * WorkspaceState 公共契约（specs/001-workspace-state-ssot-audit）
 *
 * 本文件是 type-only 契约，由 `/speckit.analyze` 用于校验调用方实现是否符合 SSoT 边界。
 * 不引入运行时代码；仅用作类型证据。
 *
 * 引用方 MUST 遵守：
 * 1. 派生路径一律经 WorkspaceState getter，禁止 path.join 拼接
 * 2. 用户选择经 workspace.selectedProject / selectedEngine，禁止读 detection.workspaceContext.getSelected*
 * 3. 写入用户选择经 workspace.setSelectedProject / setSelectedEngine，禁止直接调 detection.workspaceContext.set*
 * 4. 实例经 extension.ts push 到 context.subscriptions，禁止自建
 */

import type { ProjectInfo, EngineInstall, WorkspaceFolderInfo } from '@detection/types';
import type { WorkspaceContext } from '@detection/workspaceContext';
import type { Logger } from '@core/logger';

/** detection.ready resolve 类型 */
export interface DetectionResult {
  projects: ProjectInfo[];
  engines: EngineInstall[];
  workspaceFile?: string;
  workspaceRoot?: string;
  workspaceFolders: WorkspaceFolderInfo[];
  projectFolder: WorkspaceFolderInfo | null;
  engineFolder: WorkspaceFolderInfo | null;
}

/** 构造选项 */
export interface WorkspaceStateOptions {
  detection: { ready: Promise<DetectionResult> };
  workspaceContext?: WorkspaceContext;
  logger: Logger;
}

/** 23 字段 union type */
export type WorkspaceField =
  | 'workspaceFile'
  | 'workspaceFolders'
  | 'projectFolder'
  | 'engineFolder'
  | 'project'
  | 'engine'
  | 'workspaceRoot'
  | 'projectDir'
  | 'projectFile'
  | 'projectName'
  | 'engineRoot'
  | 'engineVersion'
  | 'clangdConfigPath'
  | 'clangdHelperDir'
  | 'clangdPerfCachePath'
  | 'compileCommandsDir'
  | 'compileCommandsPath'
  | 'macroHelperPath'
  | 'ueClangdCompatPath'
  | 'addCompletionsPath'
  | 'addMacroCompletionsPath'
  | 'completionHelperPath'
  | 'defaultCompletionsPath';

/** WorkspaceState 公共契约 */
export interface WorkspaceStateContract {
  // ===== Level 0 根源 =====
  readonly workspaceFile: string | null;
  readonly workspaceFolders: WorkspaceFolderInfo[];
  readonly projectFolder: WorkspaceFolderInfo | null;
  readonly engineFolder: WorkspaceFolderInfo | null;
  readonly project: ProjectInfo | null;
  readonly engine: EngineInstall | null;

  // ===== Level 1 派生路径 =====
  readonly workspaceRoot: string | null;
  readonly projectDir: string | null;
  readonly projectFile: string | null;
  readonly projectName: string | null;
  readonly engineRoot: string | null;
  readonly engineVersion: string | null;

  // ===== Level 2 .clangd 相关 =====
  readonly clangdConfigPath: string | null;
  readonly clangdHelperDir: string | null;
  readonly clangdPerfCachePath: string | null;
  readonly compileCommandsDir: string | null;
  readonly compileCommandsPath: string | null;

  // ===== Level 3 补全文件路径 =====
  readonly macroHelperPath: string | null;
  readonly ueClangdCompatPath: string | null;
  readonly addCompletionsPath: string | null;
  readonly addMacroCompletionsPath: string | null;
  readonly completionHelperPath: string | null;
  readonly defaultCompletionsPath: string | null;

  // ===== 用户选择（Phase 9 SSoT） =====
  readonly selectedProject: string | null;
  readonly selectedEngine: string | null;
  setSelectedProject(project: ProjectInfo | undefined): Promise<void>;
  setSelectedEngine(engine: EngineInstall | undefined): Promise<void>;

  // ===== 解析助手 =====
  resolveSelectedProject(projects: readonly ProjectInfo[]): ProjectInfo | undefined;
  resolveSelectedEngine(engines: readonly EngineInstall[]): EngineInstall | undefined;

  // ===== 生命周期 =====
  readonly isInjected: boolean;
  readonly isDisposed: boolean;
  setResult(result: DetectionResult): void;
  dispose(): void;
}