/**
 * outputChannel —— 整个插件共享的 VS Code OutputChannel
 *
 * 整个插件通过 @core/logger 的共享注册表复用 VSCodeUEHelper 通道，
 * 用户滚动查看更方便。
 *
 * getOutputChannel() 获取共享通道，disposeOutputChannel() 释放。
 */

import type * as vscode from 'vscode';
import { disposeLoggerOutputChannel, getLoggerOutputChannel } from '@core/logger';

export function getOutputChannel(): vscode.OutputChannel {
  return getLoggerOutputChannel();
}

export function disposeOutputChannel(): void {
  disposeLoggerOutputChannel();
}
