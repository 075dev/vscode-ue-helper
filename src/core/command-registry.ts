/**
 * command-registry —— 命令注册的小封装
 *
 * 简化 `vscode.commands.registerCommand` + `context.subscriptions.push` 的样板代码。
 * 调用方只需要:
 *
 *   registerCommand(context, 'vscodeUEHelper.myCmd', () => doSomething());
 *
 * 而不用每次都写:
 *   const d = vscode.commands.registerCommand(...);
 *   context.subscriptions.push(d);
 *
 * ## 行为
 *
 * 1. 调用 `vscode.commands.registerCommand` 注册命令
 * 2. 把返回的 Disposable 推入 `context.subscriptions`（VS Code 卸载时自动释放）
 * 3. 返回 disposable（方便调用方持有引用做额外操作）
 *
 * ## 为什么这样设计？
 *
 * VS Code 命令必须在插件生命周期内被追踪（dispose），否则会内存泄漏。
 * 我们的统一约定：所有命令都通过这个函数注册，由它管理 dispose。
 * 在 `commands/index.ts:activateCommands()` 里集中调用。
 */

import * as vscode from 'vscode';

/**
 * 注册一个 VS Code 命令并自动追踪 disposable。
 *
 * @param context VS Code 扩展上下文，disposable 会被推入 context.subscriptions
 * @param command 命令 ID（如 'vscodeUEHelper.build'），需要在 package.json 里定义
 * @param callback 命令触发时执行的回调。可以是同步或 async 函数
 * @returns VS Code Disposable，调用方可以选择持有做额外清理
 *
 * 注意：命令 ID 必须在 `package.json` 的 `contributes.commands` 里定义，
 * 否则用户从命令面板找不到，但 `registerCommand` 不会报错。
 */
export function registerCommand(
  context: vscode.ExtensionContext,
  command: string,
  callback: (...args: unknown[]) => unknown,
): vscode.Disposable {
  const disposable = vscode.commands.registerCommand(command, callback);
  // push 到 context.subscriptions 是关键 —— 卸载插件时 VS Code 会自动 dispose 所有订阅
  context.subscriptions.push(disposable);
  return disposable;
}
