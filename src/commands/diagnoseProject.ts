/**
 * diagnoseProject —— VS Code 命令入口
 *
 * 只读运行 clangd 项目诊断，把结构化报告写入 Output 面板并显示摘要弹窗。
 */

import * as vscode from 'vscode';
import type { Logger } from '@core/logger';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from '@clangd/clangdOps';
import { diagnoseProject, formatDiagnosticReport } from '@clangd/diagnoseProject';
import { t } from '@i18n';
import { withProgress } from '@ui/notifications';
import { resolveProjectOrPick } from '@commands/_resolve';

export async function executeDiagnoseProject(
  logger: Logger,
  detection: DetectionHandles,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
  // [Phase 9 SSoT 收尾] 可选——为老调用方/test 留 fallback；生产 index.ts 必传，让 .clangd 读取走 ClangdOps 单一入口
  clangdOps?: ClangdOps,
): Promise<void> {
  logger.info('[diagnoseProject] invoked');

  // [Phase 11 SSoT] 选目标逻辑收敛到 @commands/_resolve（仅解析不持久化）
  const project = await resolveProjectOrPick({
    detection,
    workspace,
    warningKey: 'diagnoseProject.noProject',
  });
  if (!project) {
    return;
  }

  // 扫描可能较慢：套 withProgress，避免面板 toast「正在执行…」之外无任何反馈
  const report = await withProgress(t('diagnoseProject.running'), async (reportProgress) => {
    reportProgress('Scanning .clangd / compile_commands / helper files...');
    return diagnoseProject(project.path, workspace, clangdOps);
  });
  const formatted = formatDiagnosticReport(report);
  logger.info(formatted);
  logger.show();

  const message =
    report.overallStatus === 'ok'
      ? t('diagnoseProject.summary.ok')
      : t('diagnoseProject.summary.failed', {
          count: String(report.checks.filter((check) => check.status === 'fail').length),
        });
  void vscode.window.showInformationMessage(message, t('showInfo.openOutput'));
}
