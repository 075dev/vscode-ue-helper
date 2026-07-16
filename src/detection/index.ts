/**
 * detection —— 检测模块入口
 *
 * ## 架构(信任 .code-workspace,不做扫描)
 *
 * - 项目: .code-workspace 的 folders[0] 是项目根目录,
 *   .uproject 路径 = folderPath + / + name + .uproject。不做文件系统搜索。
 * - 引擎: folders[1] 是引擎根目录,
 *   读 Engine/Build/Build.version 拿版本号。不查注册表,不做文件系统搜索。
 *
 * 任何文件不存在的情况,log error + 返回空结果,UI 显示警告。
 *
 * ## 核心导出
 *
 * - activateDetection: 创建 DetectionHandles,启动 ready Promise
 * - DetectionHandles.ready: Promise<DetectionResult>,UI 层 await 它
 *
 * ## 关键流程
 *
 * 见 doc/05-code-reference.md 第 1 节。
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import { UprojectScanner } from './uprojectScanner';
import { EngineDiscovery } from './engineDiscovery';
import { VsBuildTools } from './vsBuildTools';
import { WorkspaceContext } from './workspaceContext';
import { readBuildVersion } from './workspaceFolders';
import type { ProjectInfo, EngineInstall } from './types';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export { UprojectScanner, EngineDiscovery, VsBuildTools, WorkspaceContext };
export type { ProjectInfo, EngineInstall, VSInstallation, WorkspaceSelection } from './types';
export { readBuildVersion, type ClassifiedFolder } from './workspaceFolders';

/**
 * [Phase 8] 来自 .code-workspace folders[] 的单个 folder 条目。
 *
 * 这是根源信息——WorkspaceState 派生全部路径都从这里出发。
 * 规则（硬规则，用户不允许自定义）：
 *   - `role === 'project'` 当且仅当 `path === '.'`
 *   - `role === 'engine'` 当且仅当 `name === 'UE5'`
 *   - 其余 `role === 'unknown'`
 */
export interface WorkspaceFolderInfo {
  /** folder 在 .code-workspace 中的 name 字段 */
  name: string;
  /** folder 在 .code-workspace 中的 path 字段（可能是 "." 或绝对/相对路径） */
  path: string;
  /** 识别后的角色（project / engine / unknown） */
  role: 'project' | 'engine' | 'unknown';
  /** 解析后的绝对路径（path === '.' 时 = workspaceRoot） */
  absPath: string;
}

export interface DetectionHandles {
  scanner: UprojectScanner;
  discovery: EngineDiscovery;
  vsBuildTools: VsBuildTools;
  workspaceContext: WorkspaceContext;
  ready: Promise<DetectionResult>;
}

export interface DetectionResult {
  /** 解析后的项目（来自 path === '.' 的 folder） */
  projects: ProjectInfo[];
  /** 解析后的引擎（来自 name === 'UE5' 的 folder） */
  engines: EngineInstall[];
  /** .code-workspace 文件绝对路径（来自 vscode.workspace.workspaceFile） */
  workspaceFile: string | undefined;
  /** .code-workspace 文件所在目录 */
  workspaceRoot: string | undefined;
  /** 解析后的 folders[] 全部条目（含 project/engine 识别后的 role） */
  workspaceFolders: WorkspaceFolderInfo[];
  /** 识别为项目的 folder（path === '.'） */
  projectFolder: WorkspaceFolderInfo | null;
  /** 识别为引擎的 folder（name === 'UE5'） */
  engineFolder: WorkspaceFolderInfo | null;
}

export function activateDetection(
  context: vscode.ExtensionContext,
  _config: Config,
  logger: Logger,
): DetectionHandles {
  // deferred Promise 模式：先建 Promise 占位赋给 handles.ready，
  // IIFE 异步检测完成后调用 resolveReady 写入结果。
  // 避免对 undefined 做双重强转（T4.8 重构）。
  let resolveReady!: (value: DetectionResult) => void;
  const ready = new Promise<DetectionResult>((resolve) => {
    resolveReady = resolve;
  });

  const handles: DetectionHandles = {
    scanner: new UprojectScanner(),
    discovery: new EngineDiscovery({ candidates: [] }),
    vsBuildTools: new VsBuildTools(),
    workspaceContext: new WorkspaceContext(context.workspaceState),
    ready,
  };

  // 启动异步检测 IIFE：通过闭包访问 handles.scanner / handles.discovery
  void (async (): Promise<void> => {
    try {
      const workspaceFile = vscode.workspace.workspaceFile;

      if (!workspaceFile) {
        logger.error('[detection] no .code-workspace is open');
        resolveReady({
          projects: [],
          engines: [],
          workspaceFile: undefined,
          workspaceRoot: undefined,
          workspaceFolders: [],
          projectFolder: null,
          engineFolder: null,
        });
        return;
      }

        const workspaceFilePath = workspaceFile.fsPath;
        const workspaceRootDir = path.dirname(workspaceFilePath);

        // 读取 .code-workspace 并解析 folders 配置
        const workspaceRaw = await fs.readFile(workspaceFilePath, 'utf-8');
        const wsData = JSON.parse(workspaceRaw) as { folders?: Array<{ name?: string; path?: string }> };
        const rawEntries: Array<{ name: string; path: string }> = (wsData.folders ?? []).map(
          (f: { name?: string; path?: string }) => ({ name: f.name ?? '', path: f.path ?? '' }),
        );

        // [Phase 8] 解析 folders[] 为 WorkspaceFolderInfo（含 role + absPath）
        // 角色识别规则（硬规则，用户不允许自定义）：
        //   - path === '.'  → project
        //   - name === 'UE5' → engine
        //   - 其余 → unknown
        const workspaceFolders: WorkspaceFolderInfo[] = rawEntries.map((e) => {
          const absPath = path.resolve(workspaceRootDir, e.path);
          let role: 'project' | 'engine' | 'unknown' = 'unknown';
          if (e.path === '.') {role = 'project';}
          else if (e.name === 'UE5') {role = 'engine';}
          return { name: e.name, path: e.path, role, absPath };
        });

        // 调试日志
        logger.info(`[detection] workspaceFile = ${workspaceFilePath}`);
        logger.info(`[detection] workspaceRoot  = ${workspaceRootDir}`);
        logger.info(`[detection] entries (count=${workspaceFolders.length}):`);
        for (let i = 0; i < workspaceFolders.length; i++) {
          const e = workspaceFolders[i];
          if (!e) { continue; }
          logger.info(`[detection]   [${i}] role=${e.role} name="${e.name}" path="${e.path}" absPath=${e.absPath}`);
        }

        // ===== 项目识别（path === '.'）=====
        const projectFolder = workspaceFolders.find((e) => e.role === 'project') ?? null;
        const projects: ProjectInfo[] = [];

        if (!projectFolder) {
          logger.error(
            '[detection] no project folder declared: .code-workspace folders[] has no entry with path="."',
          );
        } else {
          const uprojectPath = path.join(projectFolder.absPath, `${projectFolder.name}.uproject`);
          const project = await handles.scanner.parseFromPath(uprojectPath);
          if (!project) {
            logger.error(
              `[detection] project .uproject not found or unreadable at ${uprojectPath}. ` +
                `Check that folders[] in your .code-workspace has an entry with path="." ` +
                `pointing to a folder containing "<name>.uproject".`,
            );
          } else {
            projects.push(project);
            logger.info(`[detection] project: name="${project.name}" path="${project.path}"`);
          }
        }

        // ===== 引擎识别（name === 'UE5'）=====
        const engineFolder = workspaceFolders.find((e) => e.role === 'engine') ?? null;
        const engines: EngineInstall[] = [];

        if (!engineFolder) {
          logger.error(
            '[detection] no engine folder declared: .code-workspace folders[] has no entry with name="UE5". ' +
              'Add a folder entry with name="UE5" pointing to the UE engine root.',
          );
        } else {
          const buildVersionPath = path.join(engineFolder.absPath, 'Engine', 'Build', 'Build.version');

          try {
            await fs.access(buildVersionPath);
          } catch {
            logger.error(
              `[detection] engine Build.version not found at ${buildVersionPath}. ` +
                `Check that the folder with name="UE5" points to a UE engine root.`,
            );
          }

          const version = await readBuildVersion(engineFolder.absPath);
          engines.push({
            path: engineFolder.absPath,
            version: version ?? 'unknown',
            isLauncherInstall: false,
          });
          logger.info(`[detection] engine: name="${engineFolder.name}" path="${engineFolder.absPath}" version=${version ?? 'unknown'}`);
        }

        handles.discovery = new EngineDiscovery({ candidates: engines.map((e) => e.path) });

        const projectNames = projects.map((p) => p.name).join(', ') || '(none)';
        const engineVersions = engines.map((e) => e.version).join(', ') || '(none)';
        logger.info(`[detection] projects: ${projectNames} | engines: ${engineVersions}`);

        resolveReady({
        projects,
        engines,
        workspaceFile: workspaceFilePath,
        workspaceRoot: workspaceRootDir,
        workspaceFolders,
        projectFolder,
        engineFolder,
      });
    } catch (err) {
      logger.error('[detection] pre-warm failed:', err);
      resolveReady({
        projects: [],
        engines: [],
        workspaceFile: undefined,
        workspaceRoot: undefined,
        workspaceFolders: [],
        projectFolder: null,
        engineFolder: null,
      });
    }
  })();

  return handles;
}
