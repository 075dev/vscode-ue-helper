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
 * ## 进度显示位置（progressLocation）
 *
 * VS Code 的通知进度（右下角弹窗）没有"自动折叠/自动隐藏"API —— 弹窗在任务
 * 期间会一直占着通知区。想要不打扰,标准做法是切到 `ProgressLocation.Window`:
 * 状态栏小 spinner,任务结束自动消失。本模块的 `resolveProgressLocation()` 是
 * 全插件进度位置的单一来源（settings: `vscodeUEHelper.progressLocation`,
 * 默认 'window'）,build / createProject / generateCompileCommands 三处入口
 * 都从这里取值。
 *
 * 详细用法见 doc/05-code-reference.md 第 8 节。
 */

import * as vscode from 'vscode';
import { Config } from '@core/config';

/**
 * 解析当前配置的进度显示位置（全插件单一来源）。
 *
 * - 'window'(默认) → 状态栏 spinner,任务结束自动消失,不弹右下角弹窗
 * - 'notification' → 右下角通知弹窗(旧行为)
 */
export function resolveProgressLocation(): vscode.ProgressLocation {
  return new Config().progressLocation === 'notification'
    ? vscode.ProgressLocation.Notification
    : vscode.ProgressLocation.Window;
}

export async function withProgress<T>(
  title: string,
  task: (
    report: (msg: string, increment?: number) => void,
    token: vscode.CancellationToken,
  ) => Promise<T>,
): Promise<T> {
  return vscode.window.withProgress(
    {
      location: resolveProgressLocation(),
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
