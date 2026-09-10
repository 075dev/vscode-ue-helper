/**
 * proxyLogChannel.ts —— clangd proxy 日志独立 OutputChannel
 *
 * 职责：
 * - 懒创建名为 'VSCodeUEHelper Proxy' 的 Output 通道
 * - 提供全局 dispose 释放
 *
 * 设计原则：
 * - 仿 src/ui/outputChannel.ts 模式（共享单例 + 懒创建）
 * - 放在 @clangd/ 下而非 @ui/，避免 proxyManager（@clangd/）反向依赖 @ui/
 *   造成循环引用；proxy 日志与扩展主日志（'VSCodeUEHelper'）分属两个面板
 */

import * as vscode from 'vscode';

/** proxy 日志通道名称（用户在 Output 面板下拉里看到的名字） */
const CHANNEL_NAME = 'VSCodeUEHelper Proxy';

let channel: vscode.OutputChannel | undefined;

/**
 * 获取（必要时懒创建）proxy 日志 Output 通道。
 * 同名通道在 VS Code 内共享，多次调用返回同一实例。
 */
export function getProxyLogChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel(CHANNEL_NAME);
  }
  return channel;
}

/** 释放 proxy 日志通道（VS Code 卸载插件时调用）。 */
export function disposeProxyLogChannel(): void {
  channel?.dispose();
  channel = undefined;
}
