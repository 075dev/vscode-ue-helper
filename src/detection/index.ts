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
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import { UprojectScanner } from './uprojectScanner';
import { EngineDiscovery } from './engineDiscovery';
import { WorkspaceContext } from './workspaceContext';
import { readBuildVersion } from './workspaceFolders';
import type { ProjectInfo, EngineInstall, WorkspaceFolderInfo } from './types';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as JSON5 from 'json5';

export { UprojectScanner, EngineDiscovery, WorkspaceContext };
export type {
  ProjectInfo,
  EngineInstall,
  WorkspaceSelection,
  WorkspaceFolderInfo,
} from './types';
export { readBuildVersion, type ClassifiedFolder } from './workspaceFolders';

export interface DetectionHandles {
  scanner: UprojectScanner;
  /** 引擎路径验证器。IIFE 检测完成后一次性赋值；ready 前为 null，读取方需防御。 */
  discovery: EngineDiscovery | null;
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
    // 不预建空 candidates 实例：ready 前任何读取都是 null（消费方已防御）。
    // IIFE 检测完成后在下方一次性赋值真实 EngineDiscovery。
    discovery: null,
    workspaceContext: new WorkspaceContext(context.workspaceState),
    ready,
  };

  // 启动异步检测 IIFE：通过闭包访问 handles.scanner / handles.discovery
  void (async (): Promise<void> => {
    try {
      // [Phase 9 SSoT] 这里合法直读 vscode.workspace.workspaceFile —— detection 层是 single source of truth 的根
      // eslint-disable-next-line no-restricted-syntax -- detection 根（唯一往 WorkspaceState 注入的入口）
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
      // .code-workspace 是 JSONC(允许注释/尾逗号),严格 JSON.parse 会失败导致检测静默降级,
      // 改用 JSON5.parse(同 uprojectScanner.ts 的教训,json5 已是 dependencies)。
      const workspaceRaw = await fs.readFile(workspaceFilePath, 'utf-8');
      let wsData: { folders?: Array<{ name?: string; path?: string } | null> };
      try {
        // wsData 已声明目标类型,JSON5.parse<T> 由上下文推断 T,无需显式断言
        wsData = JSON5.parse(workspaceRaw);
      } catch (err) {
        // 解析语法错误单独 log 具体错误信息(JSON5 错误消息含行号列号,
        // 能直接定位 .code-workspace 里的注释/尾逗号问题),而不是被外层 catch-all 吞成一行 "pre-warm failed"。
        logger.error(
          `[detection] failed to parse ${workspaceFilePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
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
      // W20 空值守卫:folders 数组可能含 null 条目,直接访问 f.name 会抛 TypeError → catch-all 全空。
      // 先把 null 条目映射为空 name/path,保证后续逻辑不崩。
      const rawEntries: Array<{ name: string; path: string }> = (wsData.folders ?? []).map(
        (f: { name?: string; path?: string } | null) =>
          // eslint-disable-next-line eqeqeq -- 空值守卫:宽松等于同时覆盖 null 与 undefined
          f == null ? { name: '', path: '' } : { name: f.name ?? '', path: f.path ?? '' },
      );

      // [Phase 8] 解析 folders[] 为 WorkspaceFolderInfo（含 role + absPath）
      // 角色识别规则（硬规则，用户不允许自定义）：
      //   - path === '.'  → project
      //   - name === 'UE5' → engine
      //   - 其余 → unknown
      const workspaceFolders: WorkspaceFolderInfo[] = rawEntries.map((e) => {
        const absPath = path.resolve(workspaceRootDir, e.path);
        let role: 'project' | 'engine' | 'unknown' = 'unknown';
        if (e.path === '.') {
          role = 'project';
        } else if (e.name === 'UE5') {
          role = 'engine';
        }
        return { name: e.name, path: e.path, role, absPath };
      });

      // 调试日志
      logger.info(`[detection] workspaceFile = ${workspaceFilePath}`);
      logger.info(`[detection] workspaceRoot  = ${workspaceRootDir}`);
      logger.info(`[detection] entries (count=${workspaceFolders.length}):`);
      for (let i = 0; i < workspaceFolders.length; i++) {
        const e = workspaceFolders[i];
        if (!e) {
          continue;
        }
        logger.info(
          `[detection]   [${i}] role=${e.role} name="${e.name}" path="${e.path}" absPath=${e.absPath}`,
        );
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
        const buildVersionPath = path.join(
          engineFolder.absPath,
          'Engine',
          'Build',
          'Build.version',
        );

        // [F2-13/W21] Build.version 读不到时不 push 引擎(遵循模块契约"读不到 → engines = []")。
        // 旧代码缺失时仍 push version='unknown',违反 src/detection/AGENTS.md 错误处理策略,
        // 会让下游把假引擎当成真实引擎。缺失直接 log error + 不 push。
        const version = await readBuildVersion(engineFolder.absPath);
        if (version === null) {
          logger.error(
            `[detection] engine Build.version not found at ${buildVersionPath}. ` +
              `Check that the folder with name="UE5" points to a UE engine root.`,
          );
        } else {
          engines.push({
            path: engineFolder.absPath,
            version,
            isLauncherInstall: false,
          });
          logger.info(
            `[detection] engine: name="${engineFolder.name}" path="${engineFolder.absPath}" version=${version}`,
          );
        }
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
