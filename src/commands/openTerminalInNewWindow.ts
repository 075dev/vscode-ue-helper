/**
 * openTerminalInNewWindow —— 在独立 OS 窗口打开终端
 *
 * VS Code 内置的“Open in Integrated Terminal”只能在当前窗口的终端面板打开;
 * 如果要拿到独立窗口,只能先开再在终端 tab 右键 → “Move Terminal to New Window”,
 * 多一步。本命令把两步合并:右键目录 → 立刻在独立 OS 窗口开终端,cwd 正确。
 *
 * 实现:createTerminal({ cwd }) 拿到实例,terminal.show(true) 让它成为活动终端,
 * 然后通过 executeCommand 复用 VS Code 内置的
 * `workbench.action.terminal.moveIntoNewWindow` 把它搬到独立 OS 窗口。
 *
 * 为什么不直接用 `executeCommand('workbench.action.terminal.newInNewWindow')`:
 * 该命令内部使用未导出的 `AUX_WINDOW_GROUP` 枚举,无法在 createTerminal 的
 * location 参数里直接指定 cwd —— 终端开在 $HOME 而不是用户右键的目录。
 *
 * 不依赖 WorkspaceState / ClangdOps / detection:
 * 这是个纯 UI 工具命令,只接收目录 URI 即可。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { t } from '@i18n';
import type { Logger } from '@core/logger';

/**
 * 右键菜单传入参数可能形态：
 * - explorer/context 菜单传 `vscode.Uri`（资源管理器右键目录）
 * - view/item/context 菜单（Project Explorer 树）按 VS Code 约定传 tree item（element），
 *   即 `{ uri: vscode.Uri, label, kind, contextValue, ... }`，本身没有 fsPath 字段
 */
type OpenTerminalArg = vscode.Uri | { uri?: vscode.Uri };

/**
 * 解析右键菜单传入的参数为绝对目录路径。
 *
 * 资源管理器右键传的是目录 URI(已在文件系统存在的目录);
 * 侧边 Project Explorer 树传的是 tree item(element),取它的 `uri` 字段;
 * 传入的也可能是文件而非目录,此处用 stat 兜底判断。
 */
async function resolveDirectory(uri: OpenTerminalArg | undefined): Promise<string | null> {
  if (!uri) {
    return null;
  }
  // 兼容 `{ uri }` 包装形态（tree item）：先取 uri 字段；本身就是 vscode.Uri 时
  // 该字段不存在（undefined），回退到整个参数。
  const wrapped = uri as { uri?: vscode.Uri } | undefined;
  const targetUri = wrapped?.uri ?? (uri as vscode.Uri);
  const target = targetUri.fsPath;
  if (!target) {
    // 取不到 fsPath（参数既不是 Uri 也没有 uri 字段），交由上层提示无效路径
    return null;
  }
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      return target;
    }
    // 传入的是文件——回退到文件所在目录(贴近“在文件所在目录打开终端”习惯)
    return path.dirname(target);
  } catch {
    return null;
  }
}

/**
 * 把当前活动终端搬到独立 OS 窗口的 VS Code 内置命令 ID。
 * 与右键终端 tab 时的 “Move Terminal to New Window” 是同一个动作。
 */
const MOVE_INTO_NEW_WINDOW_COMMAND = 'workbench.action.terminal.moveIntoNewWindow';

export async function executeOpenTerminalInNewWindow(
  uri: OpenTerminalArg | undefined,
  logger?: Logger,
): Promise<void> {
  const cwd = await resolveDirectory(uri);
  if (!cwd) {
    logger?.warn('[commands] openTerminalInNewWindow: 无效的目录 URI,已跳过');
    void vscode.window.showWarningMessage(t('openTerminalInNewWindow.invalidPath'));
    return;
  }

  // 1) 创建一个 cwd 正确的新终端实例
  const terminal = vscode.window.createTerminal({
    name: path.basename(cwd) || 'Terminal',
    cwd,
  });
  // show(true) 把终端 focus 到当前 VS Code 窗口并设为活动实例,
  // 后续 moveIntoNewWindow 命令才能作用于它。
  terminal.show(true);

  // 2) 把它搬到独立 OS 窗口(用户看到的是:闪一下 → 终端消失 → 新窗口弹出)
  // executeCommand 返回 Thenable,链式吞掉异常避免污染用户操作。
  try {
    await vscode.commands.executeCommand(MOVE_INTO_NEW_WINDOW_COMMAND);
    logger?.info(`[commands] moved terminal to new window at ${cwd}`);
  } catch (err) {
    // 旧版 VS Code 可能没有该命令;终端已在主窗口创建,告诉用户。
    logger?.error(
      `[commands] moveIntoNewWindow failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    void vscode.window.showWarningMessage(t('openTerminalInNewWindow.moveFailed'));
  }
}
