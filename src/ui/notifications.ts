/**
 * notifications —— 包装 vscode.window.withProgress 给长任务用
 *
 * 透传 report 回调和 VS Code 的 CancellationToken,
 * 让 task 可以在用户点取消时取消底层进程。
 *
 * withProgress(title, task):
 *   - task 接收 (report, token) 两个参数
 *   - report(msg, increment?): 更新进度文字
 *   - token.isCancellationRequested: 用户是否已点取消
 *   - token.onCancellationRequested(cb): 注册取消回调
 *
 * cancellable: true,VS Code 自动显示取消按钮。
 *
 * 详细用法见 doc/05-code-reference.md 第 8 节。
 */

import * as vscode from 'vscode';

export async function withProgress<T>(
  title: string,
  task: (
    report: (msg: string, increment?: number) => void,
    token: vscode.CancellationToken,
  ) => Promise<T>,
): Promise<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (progress, token) => {
      const report = (msg: string, increment?: number): void => {
        progress.report({ message: msg, increment });
      };
      return task(report, token);
    },
  );
}
