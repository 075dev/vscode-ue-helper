/**
 * outputChannel —— 整个插件共享的 VS Code OutputChannel
 *
 * 封装 vscode.window.createOutputChannel,所有模块写同一个 VSCodeUEHelper
 * 通道,用户滚动查看更方便。
 *
 * getOutputChannel() 懒创建(第一次调用才创建)
 * disposeOutputChannel() 释放
 */

import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('VSCodeUEHelper');
  }
  return channel;
}

export function disposeOutputChannel(): void {
  channel?.dispose();
  channel = undefined;
}
