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
 * 在已 json5.parse 过的对象中递归寻找 vscodeUEHelper.initialized === true。
 *
 * json5 对重复 key 取最后一个值，导致 setInitializedInJsonc 把标写进 settings、
 * 但旧版/模板写过"非对象形态 vscodeUEHelper"（数组/字符串等）时,深层
 * `settings.vscodeUEHelper` 被旧形态污染 → 取到错误值。这个兜底扫描:
 *   - 直接读 settings.vscodeUEHelper.initialized === true → true
 *   - 扫任意嵌套位置找到一个 vscodeUEHelper.initialized === true → true
 * 配套 setInitializedInJsonc 在写入时也会主动抹除非对象形态/重复 key,
 * 双重防护。
 */
function findInitializedTrueInTree(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) {
    return false;
  }
  // 直接命中
  if (Array.isArray(node)) {
    for (const item of node) {
      if (findInitializedTrueInTree(item)) {
        return true;
      }
    }
    return false;
  }
  const obj = node as Record<string, unknown>;
  if (obj.vscodeUEHelper && typeof obj.vscodeUEHelper === 'object' && obj.vscodeUEHelper !== null) {
    const inner = obj.vscodeUEHelper as Record<string, unknown>;
    if (inner.initialized === true) {
      return true;
    }
  }
  for (const key of Object.keys(obj)) {
    if (findInitializedTrueInTree(obj[key])) {
      return true;
    }
  }
  return false;
}

/**
 * 探测：当前 `.code-workspace` 是否处于"尚未初始化"状态。
 *
 * 判定规则：
 *   - 文件不存在 → true（首次打开，符合用户意图）
 *   - 解析失败（JSON 损坏）→ true（"丢失即重跑"）
 *   - 缺 `settings.vscodeUEHelper.initialized` 字段 → true
 *   - `settings.vscodeUEHelper.initialized === true` → false（已初始化）
 *   - 任意嵌套位置 `*.vscodeUEHelper.initialized === true` → false（兜底：覆盖
 *     .code-workspace 形态异常的边角 case，例如顶层 vscodeUEHelper、json5 重复
 *     key 取最后值导致 settings 内 vscodeUEHelper 被旧形态污染等）
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

  // 主判定：settings.vscodeUEHelper.initialized === true
  if (typeof data === 'object' && data !== null) {
    const settings = (data as { settings?: unknown }).settings;
    if (typeof settings === 'object' && settings !== null) {
      const vuh = (settings as { vscodeUEHelper?: unknown }).vscodeUEHelper;
      if (typeof vuh === 'object' && vuh !== null && !Array.isArray(vuh)) {
        if ((vuh as { initialized?: unknown }).initialized === true) {
          return false;
        }
      }
    }
  }

  // 兜底扫描：任意嵌套位置出现 vscodeUEHelper.initialized === true 都视为已初始化
  // 覆盖以下真实场景:
  //   (a) 用户把 vscodeUEHelper 手编到顶层 settings 之外
  //   (b) 同 key 重复出现,新形态被旧形态(string/array/数字)盖过,导致 settings 内读不到
  if (findInitializedTrueInTree(data)) {
    return false;
  }

  return true;
}

/**
 * 失败时给用户一个可点击的错误弹窗,把整段失败栈写到 OutputChannel,并暴露
 * "查看日志" + "重试" 两个按钮,workspaceFile 路径也附在 message 里。
 *
 * 历史问题:用户报告"已经初始化的项目依旧提示我进行初始化"。根因不是
 * settings.vscodeUEHelper 形态异常,而是 initialize 流程在 createProject /
 * enableClangdProxy / markInitialized 某一步抛错 → return 'fail' → 不写标 →
 * 下次启动再次提示。之前错误弹窗是一闪而过的 showErrorMessage,用户没感知
 * 重试入口,所以永远卡在未初始化循环。本次修复:
 *   1. 整段错误打到 OutputChannel(用户随时可查);
 *   2. 弹窗带 "View Log" / "Retry" / "Dismiss" 三个动作;
 *   3. message 里把 workspaceFile 绝对路径附上,方便用户自查文件问题。
 */
/** [F2-20/§8.9] 无可保留内容时(文件缺失/损坏)整写的最小结构 */
function defaultInitializedJson(): string {
  return JSON.stringify({ settings: { vscodeUEHelper: { initialized: true } } }, null, 4) + '\n';
}

async function reportInitFailure(
  logger: Logger,
  step: 'createProject' | 'enableProxy' | 'markWorkspace',
  rawMessage: string,
  err: unknown,
  workspaceFile: string,
): Promise<void> {
  const i18nKey =
    step === 'createProject'
      ? 'init.fail.createProject'
      : step === 'enableProxy'
        ? 'init.fail.enableProxy'
        : 'init.fail.markWorkspace';
  const baseMessage = t(i18nKey, { '0': rawMessage });
  const fullMessage = t('init.fail.withWorkspaceFile', {
    message: baseMessage,
    path: workspaceFile,
  });
  // 整段 stack 写到 OutputChannel——重试前后用户可对照检查
  logger.error(
    `[firstRunInit] ${step} failed. workspaceFile=${workspaceFile}. message=${rawMessage}`,
  );
  if (err instanceof Error && err.stack) {
    logger.error(`[firstRunInit] ${step} stack:`, err.stack);
  } else {
    logger.error(`[firstRunInit] ${step} raw error:`, err);
  }
  logger.show();
  const choice = await vscode.window.showErrorMessage(
    fullMessage,
    t('init.fail.btn.viewLog'),
    t('init.fail.btn.retry'),
    t('init.fail.btn.dismiss'),
  );
  if (choice === t('init.fail.btn.viewLog')) {
    logger.show();
  } else if (choice === t('init.fail.btn.retry')) {
    // 触发新一轮初始化(走完整编排,所有 deps 已 ready)
    void vscode.commands.executeCommand('vscodeUEHelper.retryFirstTimeInit');
  }
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
 * 删除文本中所有"非对象形态"的 `vscodeUEHelper` 属性条目(即 value 不是 `{...}`
 * 的形态:数组、字符串、数字、null、布尔等),同时清理与之相连的逗号。
 *
 * 背景:`json5` 对同名重复 key 取最后一个值,而 setInitializedInJsonc 走"settings
 * 内插入",如果文件里已存在非对象的 vscodeUEHelper(老插件版本写过的数组、用户
 * 手编错误形态、模板覆盖等),新写入会被旧值"压住",再读时仍然看不到
 * initialized=true → 反复提示初始化。这里在写入前先做一次文本级清理,
 * 保证最终 json5.parse 出的 settings.vscodeUEHelper 一定是新值。
 *
 * 同时清理顶层 vscodeUEHelper(防止旧版把它写到 settings 之外)。
 *
 * **对象形态的 vscodeUEHelper 不在此删除**——对象形态会走正常的
 * setBooleanKeyInObject,保留对象内部用户其他键(注释/尾逗号同样保留)。
 *
 * 限制:仅识别属性 key 位置的 vscodeUEHelper(后续必须是 `:`),不会误删
 * value 中的同名字符串。
 */
/**
 * 收集所有"属性 key 形式"的 vscodeUEHelper 出现位置,返回每个出现的
 * { start, end, isObject } 列表。start/end 是属性名起始引号到 value 结束下标的范围。
 * isObject: value 形态是否为 `{...}`。
 */
function findAllVscodeUEHelperRanges(
  raw: string,
): Array<{ start: number; end: number; isObject: boolean }> {
  const ranges: Array<{ start: number; end: number; isObject: boolean }> = [];
  let searchFrom = 0;
  for (;;) {
    const idx = findKeyInRange(raw, searchFrom, raw.length, 'vscodeUEHelper');
    if (idx === -1) {
      break;
    }
    const valueStart = valueAfterKey(raw, idx);
    if (valueStart === -1) {
      searchFrom = idx + 1;
      continue;
    }
    const valueEndIdx = valueEnd(raw, valueStart);
    if (valueEndIdx === -1) {
      searchFrom = idx + 1;
      continue;
    }
    ranges.push({ start: idx, end: valueEndIdx, isObject: raw[valueStart] === '{' });
    searchFrom = valueEndIdx;
  }
  return ranges;
}

/**
 * 抹除 raw 文本中所有"非对象形态"的 vscodeUEHelper,以及"位于 settings 块之外"
 * 的对象形态 vscodeUEHelper。同时清理与之相连的逗号。
 *
 * 为什么剔除 settings 之外的对象形态:`isFirstRunVscodeWorkspace` 兜底扫描
 * 任意嵌套位置,理论上即使顶层有 initialized=true 也能识别;但写入走
 * "settings.vscodeUEHelper"是真相源,把顶层形态剔掉可以让写入路径走得更干净。
 * 反之,settings 内的对象形态不能碰——用户可能在 vscodeUEHelper 里放了别的键,
 * 不应破坏。
 */
function purgeVscodeUEHelperOutsideTarget(raw: string): string {
  const settings = findKeyObject(raw, 'settings');
  const settingsInsideStart = settings ? settings.open : Number.POSITIVE_INFINITY;
  const settingsInsideEnd = settings ? settings.close : -1;

  const ranges = findAllVscodeUEHelperRanges(raw).filter((r) => {
    // 剔除:非对象形态 + 对象形态但不在 settings 块内
    if (!r.isObject) {
      return true;
    }
    return r.start < settingsInsideStart || r.end > settingsInsideEnd + 1;
  });
  if (ranges.length === 0) {
    return raw;
  }

  let result = raw;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i];
    if (!range) {
      continue;
    }
    const { start, end } = range;
    let deleteEnd = end;
    while (deleteEnd < result.length && isWs(result[deleteEnd])) {
      deleteEnd++;
    }
    if (result[deleteEnd] === ',') {
      deleteEnd++;
      while (deleteEnd < result.length && isWs(result[deleteEnd])) {
        deleteEnd++;
      }
    }
    let deleteStart = start;
    while (deleteStart > 0 && isWs(result[deleteStart - 1])) {
      deleteStart--;
    }
    if (deleteStart > 0 && result[deleteStart - 1] === ',') {
      deleteStart--;
      while (deleteStart > 0 && isWs(result[deleteStart - 1])) {
        deleteStart--;
      }
    }
    result = result.slice(0, deleteStart) + result.slice(deleteEnd);
  }
  return result;
}

/**
 * 在 JSONC 文本中定点设置 `settings.vscodeUEHelper.initialized = true`,保留注释。
 *
 * [F2-20/§8.9] 不做整体 JSON 重序列化(那会毁掉 .code-workspace 的注释/尾逗号),
 * 而是字符串级定点手术:
 *   0. 先调用 purgeVscodeUEHelperOutsideTarget 抹除所有非对象形态 vscodeUEHelper
 *      + 所有位于 settings 块外的 vscodeUEHelper(对象/非对象),保证后续 json5
 *      parse 读到的 settings.vscodeUEHelper 一定是我们新写的对象,不被旧值污染;
 *   1. 已有 vscodeUEHelper 对象 → 替换/插入 initialized 属性;
 *   2. 只有 settings 对象 → 在 settings 内插入 vscodeUEHelper;
 *   3. 都没有 → 文档末尾(最后一个 `}`)前插入 settings 块。
 * 插入均为 JSONC 合法写法(允许尾逗号),调用方会再 json5 解析兜底,改坏则回退整写。
 */
function setInitializedInJsonc(raw: string): string {
  const purged = purgeVscodeUEHelperOutsideTarget(raw);

  // 情况 1:已有 vscodeUEHelper 对象
  const vuh = findKeyObject(purged, 'vscodeUEHelper');
  if (vuh) {
    return setBooleanKeyInObject(purged, vuh.open, vuh.close, 'initialized', indentOf(purged, vuh.open));
  }

  // 情况 2:有 settings 对象但没有 vscodeUEHelper → 在 settings 内插入
  const settings = findKeyObject(purged, 'settings');
  if (settings) {
    const childIndent = indentOf(purged, settings.open) + '  ';
    const suffix = `\n${childIndent}"vscodeUEHelper": { "initialized": true },`;
    return purged.slice(0, settings.open + 1) + suffix + purged.slice(settings.open + 1);
  }

  // 情况 3:都没有 → 文档末尾插入 settings 块(前面已含尾逗号则不再加逗号)
  const lastBrace = purged.lastIndexOf('}');
  if (lastBrace === -1) {
    return defaultInitializedJson();
  }
  const head = purged.slice(0, lastBrace).trimEnd();
  // 空对象 {} → 直接整写最小结构,避免产生 `{,` 非法片段
  if (head === '{') {
    return defaultInitializedJson();
  }
  const base = indentOf(purged, lastBrace);
  const hasTrailingComma = head.endsWith(',');
  const block =
    `${hasTrailingComma ? '' : ','}\n` +
    `${base}  "settings": {\n` +
    `${base}    "vscodeUEHelper": { "initialized": true }\n` +
    `${base}  }\n${base}`;
  return purged.slice(0, lastBrace) + block + purged.slice(lastBrace);
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
    await reportInitFailure(logger, 'createProject', msg, err, wsFile);
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
    await reportInitFailure(logger, 'enableProxy', msg, err, wsFile);
    return 'fail';
  }

  // 写标记。失败 → 弹错并返回 fail,不触发 reload(与文件头设计原则 3 一致:
  // 任一步骤失败 → 弹错误信息、不重启窗口,下次启动再次提示)。
  try {
    await markInitializedInWorkspace(wsFile);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await reportInitFailure(logger, 'markWorkspace', msg, err, wsFile);
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
