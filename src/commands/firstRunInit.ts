/**
 * firstRunInit —— 首次打开插件时执行一次性初始化编排
 *
 * ## 设计原则
 *
 * 1. **触发前提**：仅当 `WorkspaceState.project` 非空时（即检测到 UE 工程）才提示。
 *    空工作区或非 UE 工程直接跳过，不弹窗。
 *
 * 2. **持久化方式**：标记写在 `.code-workspace` 文件的 `settings` 字段
 *    （key = `vscodeUEHelper.initialized`）。**不**用 `context.globalState`。
 *    文件丢失即视为未初始化，符合"换机拷贝 / .code-workspace 损坏 / 删除工程都自动重跑"的语义。
 *
 * 3. **失败语义**：任一步骤失败 → 弹错误信息，**不**写 initialized 标记，**不**重启窗口，
 *    下次启动再次提示（用户可手动重试）。
 *
 * 4. **跳过语义**：用户点 "Later" / 关闭弹窗 → **不**写标记，**不**执行任何动作，
 *    下次启动再次提示。
 *
 * 5. **并发安全**：标记写入走 temp + rename 原子操作。同一进程内多窗口触发是各自独立的
 *    workspaceFile，不会冲突。
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import json5 from 'json5';
import type { Logger } from '@core/logger';
import type { Config } from '@core/config';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdHandles } from '@clangd';
import type { DetectionHandles } from '@detection';
import { executeCreateProject } from '@commands/createProject';
import { executeEnableClangdProxy } from '@commands/enableClangdProxy';
import { t } from '@i18n';

/**
 * runFirstTimeInit 的依赖项。
 *
 * 与 `extension.ts` 中传入的对象结构对应。所有字段必填。
 */
export interface FirstRunInitDeps {
  /** VS Code 扩展上下文（用于透传给子流程；编排器本身不写 globalState） */
  context: vscode.ExtensionContext;
  /** 已初始化的 Config 实例 */
  config: Config;
  /** Logger 实例 */
  logger: Logger;
  /** detection 句柄（含 ready Promise） */
  detection: DetectionHandles;
  /** clangd 句柄（含 proxyManager，用于 enableClangdProxy） */
  clangd: ClangdHandles;
  /** workspace 状态（含 project / workspaceFile 等单一真相源） */
  workspace: WorkspaceState;
  /** ClangdOps（保留以便后续扩展；本编排器当前不直接调用） */
  clangdOps?: unknown;
}

/**
 * 编排结果分类：
 *   - 'init'：用户点了 Initialize，两步均成功，已写标记，已触发 reload
 *   - 'skip'：非工程 / 空工作区 / 已初始化 → 不弹窗
 *   - 'later'：用户点了 Later 或关闭弹窗 → 不执行任何动作
 *   - 'fail'：用户点了 Initialize，但任一步骤失败
 */
export type FirstRunInitResult = 'init' | 'skip' | 'later' | 'fail';

/**
 * 探测：当前 `.code-workspace` 是否处于"尚未初始化"状态。
 *
 * 判定规则：
 *   - 文件不存在 → true（首次打开，符合用户意图）
 *   - 解析失败（JSON 损坏）→ true（"丢失即重跑"）
 *   - 缺 `settings.vscodeUEHelper.initialized` 字段 → true
 *   - `initialized === true` → false（已初始化）
 *   - `initialized === false` 或其他值 → true（不等于 true 即视为未初始化）
 *
 * @param workspaceFile .code-workspace 文件绝对路径
 * @returns 是否需要弹窗提示
 */
export async function isFirstRunVscodeWorkspace(workspaceFile: string): Promise<boolean> {
  // 文件不存在 → 视为首次运行
  try {
    await fs.access(workspaceFile);
  } catch {
    return true;
  }

  // 读取并解析（json5 支持注释，兼容 VS Code 的 JSONC 工作区文件）
  let data: unknown;
  try {
    const raw = await fs.readFile(workspaceFile, 'utf-8');
    data = json5.parse(raw);
  } catch {
    // 解析失败 → 视为首次运行
    return true;
  }

  // 类型守卫：必须为对象
  if (typeof data !== 'object' || data === null) {
    return true;
  }

  const settings = (data as { settings?: unknown }).settings;
  if (typeof settings !== 'object' || settings === null) {
    return true;
  }

  const vscodeUEHelper = (settings as { vscodeUEHelper?: unknown }).vscodeUEHelper;
  if (typeof vscodeUEHelper !== 'object' || vscodeUEHelper === null) {
    return true;
  }

  const initialized = (vscodeUEHelper as { initialized?: unknown }).initialized;
  // 仅当 === true 才视为已初始化；其他值（false / 缺失 / 类型异常）一律视为未初始化
  return initialized !== true;
}

/**
 * 原子写入：在 `.code-workspace` 的 `settings.vscodeUEHelper.initialized` 字段标记 `true`。
 *
 * 写入策略：
 *   - re-read 现有内容（保留用户其他设置）
 *   - 改写 `settings.vscodeUEHelper.initialized = true`（其他字段不动）
 *   - 序列化 → 写临时文件 `.tmp` → rename（原子）
 *
 * 失败抛错，调用方决定是否继续 reload。
 *
 * @param workspaceFile .code-workspace 文件绝对路径
 */
export async function markInitializedInWorkspace(workspaceFile: string): Promise<void> {
  // 读取现有内容（容忍文件不存在 → 视为空对象）
  let data: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(workspaceFile, 'utf-8');
    const parsed: unknown = json5.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // 文件不存在或解析失败 → 视为空对象继续写入
    data = {};
  }

  // 确保 data.settings 与 data.settings.vscodeUEHelper 存在
  let settings = data['settings'] as Record<string, unknown> | undefined;
  if (typeof settings !== 'object' || settings === null) {
    settings = {};
    data['settings'] = settings;
  }

  let vscodeUEHelper = settings['vscodeUEHelper'] as Record<string, unknown> | undefined;
  if (typeof vscodeUEHelper !== 'object' || vscodeUEHelper === null) {
    vscodeUEHelper = {};
    settings['vscodeUEHelper'] = vscodeUEHelper;
  }

  // 覆盖写 initialized = true（保留 vscodeUEHelper 内其他字段）
  vscodeUEHelper['initialized'] = true;

  // 序列化（VS Code 工作区文件惯例：4 空格缩进 + 末尾换行）
  const serialized = JSON.stringify(data, null, 4) + '\n';

  // 原子写入：先写临时文件，再 rename
  const tempFile = workspaceFile + '.tmp';
  await fs.writeFile(tempFile, serialized, 'utf-8');
  await fs.rename(tempFile, workspaceFile);
}

/**
 * 主编排器：首次打开插件时执行一次性初始化流程。
 *
 * ## 流程（严格按 plan Step 1）
 *
 * 1. await detection.ready（避免 project 为 null 的 race condition）
 * 2. workspace.project 为空 → 'skip'（AC-7：非工程跳过）
 * 3. workspace.workspaceFile 为空 → 'skip'（AC-7：空工作区）
 * 4. isFirstRunVscodeWorkspace === false → 'skip'（已初始化）
 * 5. 弹窗让用户选择 Initialize / Later；选择非 Initialize → 'later'（AC-2）
 * 6. executeCreateProject 失败 → 弹错误信息 + 'fail'（AC-4）
 * 7. executeEnableClangdProxy 失败 → 弹错误信息 + 'fail'（AC-5）
 * 8. markInitializedInWorkspace 失败 → 仅 warn（不阻断 reload）
 * 9. 触发 reload window
 * 10. 返回 'init'
 *
 * @returns 编排结果分类（见 FirstRunInitResult）
 */
export async function runFirstTimeInit(
  deps: FirstRunInitDeps,
  _context: vscode.ExtensionContext,
): Promise<FirstRunInitResult> {
  const { config, logger, detection, clangd, workspace } = deps;

  // 等待 detection 完成注入（避免 race condition：project 可能为 null）
  await detection.ready;

  // 非 UE 工程 → 直接跳过（AC-7）
  if (!workspace.project) {
    return 'skip';
  }

  // 无 .code-workspace 文件 → 跳过（AC-7）
  const wsFile = workspace.workspaceFile;
  if (!wsFile) {
    return 'skip';
  }

  // 已初始化 → 跳过（AC-3 末态）
  if (!(await isFirstRunVscodeWorkspace(wsFile))) {
    return 'skip';
  }

  // 弹窗：Initialize / Later（AC-1）
  const choice = await vscode.window.showInformationMessage(
    t('init.prompt'),
    t('init.btn.initialize'),
    t('init.btn.later'),
  );

  // 用户选择 Later 或关闭弹窗 → 'later'（AC-2）
  if (choice !== t('init.btn.initialize')) {
    return 'later';
  }

  // 第一步：Create Unreal Clangd Project（AC-4）
  try {
    await executeCreateProject(config, logger, detection);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[firstRunInit] createProject failed:', msg);
    void vscode.window.showErrorMessage(t('init.fail.createProject', { '0': msg }));
    return 'fail';
  }

  // 第二步：Enable Clangd Proxy（AC-5）
  // suppressReloadPrompt: true —— 禁止 enableClangdProxy 内部弹 reload 弹窗。
  // 否则用户点 Reload Window 时 reload 立即触发，但 markInitializedInWorkspace
  // 还没执行，.code-workspace 没标记 → 重新激活后再次提示未初始化（双 reload 时序 bug）。
  // 真正的 reload 由本编排器在 markInitializedInWorkspace 之后统一触发。
  try {
    await executeEnableClangdProxy(config, logger, clangd, { suppressReloadPrompt: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[firstRunInit] enableClangdProxy failed:', msg);
    void vscode.window.showErrorMessage(t('init.fail.enableProxy', { '0': msg }));
    return 'fail';
  }

  // 写标记（仅 warn，不阻断 reload —— 用户已点确认，标记写入是 best-effort）
  try {
    await markInitializedInWorkspace(wsFile);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[firstRunInit] markInitializedInWorkspace failed: ${msg}`);
    logger.warn(t('init.fail.markWorkspace', { '0': msg }));
  }

  // 触发窗口 reload（AC-3）。失败仅 warn，不影响 init 返回值
  try {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  } catch (err) {
    logger.warn('[firstRunInit] reloadWindow failed:', err);
  }

  return 'init';
}