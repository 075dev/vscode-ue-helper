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
import type { ClangdOps } from '@clangd/clangdOps';
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
  /** ClangdOps（注入 executeCreateProject 等需写 .clangd 的命令） */
  clangdOps?: ClangdOps;
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

/** [F2-20/§8.9] 无可保留内容时(文件缺失/损坏)整写的最小结构 */
function defaultInitializedJson(): string {
  return JSON.stringify({ settings: { vscodeUEHelper: { initialized: true } } }, null, 4) + '\n';
}

function isWs(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/** 返回字符串的结束引号下标(支持转义),找不到返回 -1 */
function findStringEnd(text: string, start: number, quote: string): number {
  let pos = start + 1;
  while (pos < text.length) {
    if (text[pos] === '\\') {
      pos += 2;
      continue;
    }
    if (text[pos] === quote) {
      return pos;
    }
    pos++;
  }
  return -1;
}

/** 从 openIdx 起匹配括号(跳字符串),返回对应的闭括号下标;不匹配返回 -1 */
function matchBrace(text: string, openIdx: number): number {
  const open = text[openIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let pos = openIdx;
  let inString = false;
  let strQuote = '';
  while (pos < text.length) {
    const ch = text[pos];
    if (inString) {
      if (ch === '\\') {
        pos += 2;
        continue;
      }
      if (ch === strQuote) {
        inString = false;
      }
    } else if (ch === '"' || ch === "'") {
      inString = true;
      strQuote = ch;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return pos;
      }
    }
    pos++;
  }
  return -1;
}

/**
 * 在 [from, to) 范围内找属性 key(形如 "key": 或 'key':,key 后允许空白再跟冒号),
 * 返回属性 key 起始引号下标;找不到返回 -1。出现在 value 位置的同名字符串不会命中
 * (因为要求 key 后跟 `:`)。
 */
function findKeyInRange(text: string, from: number, to: number, key: string): number {
  let pos = from;
  while (pos < to) {
    const double = text.indexOf('"', pos);
    const single = text.indexOf("'", pos);
    let quote: number;
    let q: string;
    if (double === -1 && single === -1) {
      break;
    }
    if (double === -1) {
      quote = single;
      q = "'";
    } else if (single === -1) {
      quote = double;
      q = '"';
    } else {
      quote = Math.min(double, single);
      q = text[quote] ?? '"';
    }
    if (quote >= to) {
      break;
    }
    const end = findStringEnd(text, quote, q);
    if (end === -1) {
      break;
    }
    if (end < to && text.slice(quote + 1, end) === key) {
      let k = end + 1;
      while (k < to && isWs(text[k])) {
        k++;
      }
      if (text[k] === ':') {
        return quote;
      }
    }
    pos = quote + 1;
  }
  return -1;
}

/** 返回属性 key(引号起始下标)之后的值起始下标;不是属性/找不到返回 -1 */
function valueAfterKey(text: string, keyStart: number): number {
  const q = text[keyStart];
  if (q !== '"' && q !== "'") {
    return -1;
  }
  const keyEnd = findStringEnd(text, keyStart, q);
  if (keyEnd === -1) {
    return -1;
  }
  let pos = keyEnd + 1;
  while (pos < text.length && isWs(text[pos])) {
    pos++;
  }
  if (text[pos] !== ':') {
    return -1;
  }
  pos++;
  while (pos < text.length && isWs(text[pos])) {
    pos++;
  }
  return pos;
}

/** 返回值从 start 起到结束后的下标(支持对象/数组/字符串/字面量) */
function valueEnd(text: string, start: number): number {
  const c = text[start];
  if (c === '{' || c === '[') {
    const close = matchBrace(text, start);
    return close === -1 ? -1 : close + 1;
  }
  if (c === '"' || c === "'") {
    const end = findStringEnd(text, start, c);
    return end === -1 ? -1 : end + 1;
  }
  let pos = start;
  while (
    pos < text.length &&
    !isWs(text[pos]) &&
    text[pos] !== ',' &&
    text[pos] !== '}' &&
    text[pos] !== ']'
  ) {
    pos++;
  }
  return pos;
}

/** 返回 openIdx 所在行的行首缩进(插入新行对齐用) */
function indentOf(text: string, openIdx: number): string {
  const lineStart = text.lastIndexOf('\n', openIdx - 1) + 1;
  const line = text.slice(lineStart, openIdx);
  return line.match(/^[ \t]*/)?.[0] ?? '';
}

/** 在文本中查找属性 key 的值为对象的属性,返回该对象 `{...}` 的开闭下标;找不到返回 null */
function findKeyObject(text: string, key: string): { open: number; close: number } | null {
  let searchFrom = 0;
  for (;;) {
    const idx = findKeyInRange(text, searchFrom, text.length, key);
    if (idx === -1) {
      return null;
    }
    const valueStart = valueAfterKey(text, idx);
    if (valueStart !== -1 && text[valueStart] === '{') {
      const close = matchBrace(text, valueStart);
      if (close !== -1) {
        return { open: valueStart, close };
      }
    }
    searchFrom = idx + 1;
  }
}

/** 在对象 [open, close] 内定点设置布尔属性:已存在 → 替换值为 true;不存在 → 在 `{` 后插入 */
function setBooleanKeyInObject(
  raw: string,
  open: number,
  close: number,
  key: string,
  indent: string,
): string {
  const keyIdx = findKeyInRange(raw, open + 1, close, key);
  if (keyIdx !== -1) {
    const valueStart = valueAfterKey(raw, keyIdx);
    if (valueStart !== -1) {
      const end = valueEnd(raw, valueStart);
      if (end !== -1) {
        return raw.slice(0, valueStart) + 'true' + raw.slice(end);
      }
    }
  }
  const suffix = `\n${indent}  "${key}": true,`;
  return raw.slice(0, open + 1) + suffix + raw.slice(open + 1);
}

/**
 * 在 JSONC 文本中定点设置 `settings.vscodeUEHelper.initialized = true`,保留注释。
 *
 * [F2-20/§8.9] 不做整体 JSON 重序列化(那会毁掉 .code-workspace 的注释/尾逗号),
 * 而是字符串级定点手术:
 *   1. 已有 vscodeUEHelper 对象 → 替换/插入 initialized 属性;
 *   2. 只有 settings 对象 → 在 settings 内插入 vscodeUEHelper;
 *   3. 都没有 → 文档末尾(最后一个 `}`)前插入 settings 块。
 * 插入均为 JSONC 合法写法(允许尾逗号),调用方会再 json5 解析兜底,改坏则回退整写。
 */
function setInitializedInJsonc(raw: string): string {
  // 情况 1:已有 vscodeUEHelper 对象
  const vuh = findKeyObject(raw, 'vscodeUEHelper');
  if (vuh) {
    return setBooleanKeyInObject(raw, vuh.open, vuh.close, 'initialized', indentOf(raw, vuh.open));
  }

  // 情况 2:有 settings 对象但没有 vscodeUEHelper → 在 settings 内插入
  const settings = findKeyObject(raw, 'settings');
  if (settings) {
    const childIndent = indentOf(raw, settings.open) + '  ';
    const suffix = `\n${childIndent}"vscodeUEHelper": { "initialized": true },`;
    return raw.slice(0, settings.open + 1) + suffix + raw.slice(settings.open + 1);
  }

  // 情况 3:都没有 → 文档末尾插入 settings 块(前面已含尾逗号则不再加逗号)
  const lastBrace = raw.lastIndexOf('}');
  if (lastBrace === -1) {
    return defaultInitializedJson();
  }
  const head = raw.slice(0, lastBrace).trimEnd();
  // 空对象 {} → 直接整写最小结构,避免产生 `{,` 非法片段
  if (head === '{') {
    return defaultInitializedJson();
  }
  const base = indentOf(raw, lastBrace);
  const hasTrailingComma = head.endsWith(',');
  const block =
    `${hasTrailingComma ? '' : ','}\n` +
    `${base}  "settings": {\n` +
    `${base}    "vscodeUEHelper": { "initialized": true }\n` +
    `${base}  }\n${base}`;
  return raw.slice(0, lastBrace) + block + raw.slice(lastBrace);
}

/**
 * 原子写入：在 `.code-workspace` 的 `settings.vscodeUEHelper.initialized` 字段标记 `true`。
 *
 * 写入策略：
 *   - re-read 现有内容（保留用户其他设置与 JSONC 注释）
 *   - [F2-20/§8.9] 定点改写 `settings.vscodeUEHelper.initialized = true`（其他字段不动,
 *     注释/尾逗号保留）;文件缺失/损坏时整写最小结构
 *   - 序列化 → 写临时文件 `.tmp` → rename（原子）
 *
 * 失败抛错，调用方决定是否继续 reload。
 *
 * @param workspaceFile .code-workspace 文件绝对路径
 */
export async function markInitializedInWorkspace(workspaceFile: string): Promise<void> {
  // 读取现有内容（文件不存在 → 直接写全新文件）
  let raw: string;
  try {
    raw = await fs.readFile(workspaceFile, 'utf-8');
  } catch {
    raw = '';
  }

  let serialized: string;
  if (raw.trim() === '') {
    serialized = defaultInitializedJson();
  } else {
    serialized = setInitializedInJsonc(raw);
    // 兜底校验:定点手术改坏(扫描器边界)时回退为最小结构整写
    try {
      json5.parse(serialized);
    } catch {
      serialized = defaultInitializedJson();
    }
  }

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
    await executeCreateProject(config, logger, detection, deps.clangdOps, workspace);
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

  // 写标记。失败 → 弹错并返回 fail,不触发 reload(与文件头设计原则 3 一致:
  // 任一步骤失败 → 弹错误信息、不重启窗口,下次启动再次提示)。
  try {
    await markInitializedInWorkspace(wsFile);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[firstRunInit] markInitializedInWorkspace failed: ${msg}`);
    void vscode.window.showErrorMessage(t('init.fail.markWorkspace', { '0': msg }));
    return 'fail';
  }

  // 触发窗口 reload（AC-3）。失败仅 warn，不影响 init 返回值
  try {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  } catch (err) {
    logger.warn('[firstRunInit] reloadWindow failed:', err);
  }

  return 'init';
}
