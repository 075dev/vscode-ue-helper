/**
 * diagnoseProject —— VS Code 命令入口
 *
 * 只读运行 clangd 项目诊断，把结构化报告写入 Output 面板并显示摘要弹窗。
 */

import * as vscode from 'vscode';
import type { Logger } from '@core/logger';
import type { DetectionHandles } from '@detection';
import type { ProjectInfo } from '@detection/types';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from '@clangd/clangdOps';
import { diagnoseProject, formatDiagnosticReport } from '@clangd/diagnoseProject';
import { pickProject } from '@ui/quickPicks';
import { t } from '@i18n';

export async function executeDiagnoseProject(
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
  // [Phase 9 SSoT 收尾] 可选——为老调用方/test 留 fallback；生产 index.ts 必传，让 .clangd 读取走 ClangdOps 单一入口
  clangdOps?: ClangdOps,
): Promise<void> {
  logger.info('[diagnoseProject] invoked');

  const { projects } = await detection.ready;
  // [Phase 9 SSoT] 收敛 selected* 访问
  function legacyFind(): ProjectInfo | undefined {
    const sp = detection.workspaceContext.getSelectedProject();
    return sp ? projects.find((p) => p.path === sp) : undefined;
  }
  let project = workspace?.resolveSelectedProject(projects) ?? legacyFind();
  if (!project && projects.length === 1) {
    project = projects[0];
  }
  if (!project) {
    project = await pickProject(projects);
  }
  if (!project) {
    void vscode.window.showWarningMessage(t('diagnoseProject.noProject'));
    return;
  }

  const report = await diagnoseProject(project.path, workspace, clangdOps);
  const formatted = formatDiagnosticReport(report);
  logger.info(formatted);
  logger.show();

  const message = report.overallStatus === 'ok'
    ? t('diagnoseProject.summary.ok')
    : t('diagnoseProject.summary.failed', {
        count: String(report.checks.filter((check) => check.status === 'fail').length),
      });
  void vscode.window.showInformationMessage(message, t('showInfo.openOutput'));
}
