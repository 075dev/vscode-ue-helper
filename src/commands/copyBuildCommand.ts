/**
 * copyBuildCommand —— 把当前选中的项目/引擎/配置对应的 UBT 命令行复制到剪贴板
 *
 * 模式借鉴 vscode-boreal 的 "UE: Show UBT Build Command":排查构建问题时,
 * 拿到底层 UBT 命令在任意终端手动复现,是定位"插件包装层 vs UBT 本身"问题的
 * 最短路径。
 *
 * 命令组装复用 build 命令的同一套 resolve/buildUBTCommand,保证剪贴板里的
 * 命令与 Build 按钮实际执行的一致(含 rebuild/clean 参数后缀)。
 */

import * as vscode from 'vscode';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import { buildUBTCommand, resolveUBTPath, resolveUBTTarget } from '@build';
import { t } from '@i18n';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import { resolveProjectOrPick, resolveEngineOrPick, persistSelection } from './_resolve';
import { okEnvelope, errEnvelope, EC_PROJECT_NOT_DETECTED, EC_UBT_NOT_FOUND, type Envelope } from '@core/envelope';

export type CopyBuildCommandMode = 'build' | 'rebuild' | 'clean';

/** 可注入依赖(测试);省略时走 vscode.env.clipboard + 通知 */
export interface CopyBuildCommandDeps {
  clipboard?: { writeText(value: string): Thenable<void> };
  notify?: (message: string) => void;
}

/** 路径含空格时加引号(Windows 下 Build.bat/RunUBT.bat 绝对路径几乎必然含空格) */
export function formatUBTCommandLine(file: string, args: readonly string[]): string {
  const quotedFile = /[\s"]/.test(file) ? `"${file}"` : file;
  return [quotedFile, ...args].join(' ');
}

/**
 * 执行复制 UBT 构建命令。
 *
 * @returns 契约 envelope:成功 ok 时 data 为组装出的完整命令行;
 *          未选项目 → PROJECT_NOT_DETECTED,未选引擎 → UBT_NOT_FOUND
 */
export async function executeCopyBuildCommand(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  workspace?: WorkspaceState,
  mode: CopyBuildCommandMode = 'build',
  deps: CopyBuildCommandDeps = {},
): Promise<Envelope> {
  const project = await resolveProjectOrPick({ detection, workspace });
  if (!project) {
    return errEnvelope(EC_PROJECT_NOT_DETECTED, t('cmd.noUprojectSelected'));
  }
  await persistSelection(workspace, detection, project, undefined);

  const engine = await resolveEngineOrPick({ detection, workspace });
  if (!engine) {
    return errEnvelope(EC_UBT_NOT_FOUND, t('cmd.noUnrealEngineSelected'));
  }
  await persistSelection(workspace, detection, undefined, engine);

  const cmd = buildUBTCommand({
    project: project.path,
    target: resolveUBTTarget(project.path, config.target),
    platform: config.platform,
    configuration: config.configuration,
    ubtPath: resolveUBTPath(engine.path),
  });

  const args = cmd.args.slice();
  if (mode === 'rebuild') {
    args.push('-Rebuild');
  }
  if (mode === 'clean') {
    args.push('-Clean');
  }

  const commandLine = formatUBTCommandLine(cmd.file, args);
  const clipboard = deps.clipboard ?? vscode.env.clipboard;
  await clipboard.writeText(commandLine);

  const message = t('cmd.copyBuildCommand.success', { mode });
  if (deps.notify) {
    deps.notify(message);
  } else {
    void vscode.window.showInformationMessage(message);
  }
  logger.info(`[copyBuildCommand] ${mode}: ${commandLine}`);
  return okEnvelope(commandLine, message);
}
