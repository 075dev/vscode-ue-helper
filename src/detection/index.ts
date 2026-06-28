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

export interface DetectionHandles {
  scanner: UprojectScanner;
  discovery: EngineDiscovery;
  vsBuildTools: VsBuildTools;
  workspaceContext: WorkspaceContext;
  ready: Promise<DetectionResult>;
}

export interface DetectionResult {
  projects: ProjectInfo[];
  engines: EngineInstall[];
  workspaceFile: string | undefined;
}

export function activateDetection(
  context: vscode.ExtensionContext,
  _config: Config,
  logger: Logger,
): DetectionHandles {
  const handles: DetectionHandles = {
    scanner: new UprojectScanner(),
    discovery: new EngineDiscovery({ candidates: [] }),
    vsBuildTools: new VsBuildTools(),
    workspaceContext: new WorkspaceContext(context.workspaceState),
    ready: undefined as unknown as Promise<DetectionResult>,
  };

  handles.ready = (async (): Promise<DetectionResult> => {
    try {
      const workspaceFile = vscode.workspace.workspaceFile;

      if (!workspaceFile) {
        logger.error('[detection] no .code-workspace is open');
        return { projects: [], engines: [], workspaceFile: undefined };
      }

      const WorkspacePath = workspaceFile.fsPath;
      const workspaceRootDir = path.dirname(WorkspacePath);

      // 读取根目录下的 .code-workspace 并解析 folders 配置
      const workspaceRaw = await fs.readFile(WorkspacePath, 'utf-8');
      const wsData = JSON.parse(workspaceRaw) as { folders?: Array<{ name?: string; path?: string }> };
      const entries: Array<{ name: string; path: string }> = (wsData.folders ?? []).map(
        (f: { name?: string; path?: string }) => ({ name: f.name ?? '', path: f.path ?? '' }),
      );

      // 调试打印：让用户看到 .code-workspace 在哪、解析出了什么
      logger.info(`[detection] workspaceFile = ${WorkspacePath}`);
      logger.info(`[detection] workspaceRoot  = ${workspaceRootDir}`);
      logger.info(`[detection] entries (count=${entries.length}):`);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e) { continue; }
        logger.info(`[detection]   [${i}] name="${e.name}" path="${e.path}"`);
      }

      // folders[0] = 项目目录（path 为 "."，对应工作区根目录）
      const projectEntry = entries[0]!;
      const projectAbsPath = path.resolve(workspaceRootDir, projectEntry.path);
      const uprojectPath = path.join(projectAbsPath, `${projectEntry.name}.uproject`);

      const project = await handles.scanner.parseFromPath(uprojectPath);
      if (!project) {
        logger.error(
          `[detection] project .uproject not found or unreadable at ${uprojectPath}. ` +
            `Check that folders[0] in your .code-workspace points to a folder ` +
            `containing "<name>.uproject".`,
        );
        return { projects: [], engines: [], workspaceFile: workspaceFile?.fsPath };
      }
      const projects: ProjectInfo[] = [project];

      // folders[1] = UE 引擎目录
      const engines: EngineInstall[] = [];
      const engineEntry = entries[1];

      if (!engineEntry) {
        logger.error(
          '[detection] no engine folder declared: .code-workspace folders[1] is missing. ' +
            'Add the UE install folder as folders[1].',
        );
      } else {
        const engineAbsPath = path.resolve(workspaceRootDir, engineEntry.path);
        const buildVersionPath = path.join(engineAbsPath, 'Engine', 'Build', 'Build.version');

        try {
          await fs.access(buildVersionPath);
        } catch {
          logger.error(
            `[detection] engine Build.version not found at ${buildVersionPath}. ` +
              `Check that folders[1] points to a UE engine root.`,
          );
          return { projects, engines: [], workspaceFile: workspaceFile?.fsPath };
        }

        const version = await readBuildVersion(engineAbsPath);
        engines.push({
          path: engineAbsPath,
          version: version ?? 'unknown',
          isLauncherInstall: false,
        });
      }

      handles.discovery = new EngineDiscovery({ candidates: engines.map((e) => e.path) });

      const projectNames = projects.map((p) => p.name).join(', ') || '(none)';
      const engineVersions = engines.map((e) => e.version).join(', ') || '(none)';
      logger.info(`[detection] projects: ${projectNames} | engines: ${engineVersions}`);

      return {
        projects,
        engines,
        workspaceFile: workspaceFile?.fsPath,
      };
    } catch (err) {
      logger.error('[detection] pre-warm failed:', err);
      return { projects: [], engines: [], workspaceFile: undefined };
    }
  })();

  return handles;
}
