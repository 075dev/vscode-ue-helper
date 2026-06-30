/**
 * diagnoseProject —— VS Code 命令入口
 *
 * 只读运行 clangd 项目诊断，把结构化报告写入 Output 面板并显示摘要弹窗。
 */

import * as vscode from 'vscode';
import type { Logger } from '@core/logger';
import type { DetectionHandles } from '@detection';
import { diagnoseProject, formatDiagnosticReport } from '@clangd/diagnoseProject';
import { pickProject } from '@ui/quickPicks';
import { t } from '@i18n';

export async function executeDiagnoseProject(
  logger: Logger,
  detection: DetectionHandles,
): Promise<void> {
  logger.info('[diagnoseProject] invoked');

  const projects = await detection.scanner.scan();
  let project = projects.find(
    (item) => item.path === detection.workspaceContext.getSelectedProject(),
  );
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

  const report = await diagnoseProject(project.path);
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
