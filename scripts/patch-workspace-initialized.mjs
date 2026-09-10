#!/usr/bin/env node
/**
 * patch-workspace-initialized — 把 settings.vscodeUEHelper.initialized=true 原子写入 .code-workspace
 *
 * 适用场景:用户报告"已经初始化的项目,依旧提示我进行初始化",真实根因是
 * `runFirstTimeInit` 在 createProject/enableClangdProxy/markInitialized 任一步
 * 抛错 → return 'fail' → 未写入标 → 下次启动再弹。失败路径的 UX 修复已上线
 * (本次会话),但用户的真实工作区 .code-workspace 仍处于"未写标"状态。
 *
 * 此脚本直接对 .code-workspace 末尾原子注入最小标记,把状态从 "not initialized"
 * 推到 "initialized"。**严格降级** — 不走 createProject / enableClangdProxy,
 * 只写标。适用于"先消除初始化弹窗骚扰" 的清理场景。
 *
 * 用法:
 *   node scripts/patch-workspace-initialized.mjs <absolute-path-to-.code-workspace>
 *
 * 安全:
 *   1. 先原子备份 `<file>.bak.<timestamp>` —— 保留原内容可回滚
 *   2. 用 json5 parse 兜底校验原文件能解析,避免破坏性改坏
 *   3. 完整 settings.vscodeUEHelper.initialized 标记写入,二次校验
 *   4. 写入后立即 re-read 并调 isFirstRunVscodeWorkspace 验证读侧识别为 false
 *   5. **修复是否成功** 最终取决于二次启动插件时 isFirstRunVscodeWorkspace 返回 false
 *      —— 脚本只在写入侧保证正确;用户的重启二次确认才是验收标志
 *
 * 没有显式 `--apply` 参数时默认 dry-run,只打印将要做什么,不实际写入。
 *   node scripts/patch-workspace-initialized.mjs <path>           # dry-run
 *   node scripts/patch-workspace-initialized.mjs <path> --apply   # 实际写入 + 备份
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import json5 from 'json5';

const APPLY = process.argv.includes('--apply');
const targetArg = process.argv.find((a, i) => i >= 2 && !a.startsWith('--') && a !== process.argv[1]);
if (!targetArg) {
  console.error('用法: node scripts/patch-workspace-initialized.mjs <absolute-path-to-.code-workspace> [--apply]');
  process.exit(2);
}
const target = path.resolve(targetArg);

/**
 * 模拟 firstRunInit.ts 的 setInitializedInJsonc:
 *   0. 抹除非对象形态 / settings 块外的 vscodeUEHelper 条目
 *   1. 已有 vscodeUEHelper 对象 → set initialized=true
 *   2. 有 settings 对象 → 在 settings 内插入 vscodeUEHelper
 *   3. 都没有 → 文档末尾插入 settings 块
 *
 * 这里用最简化版:既然已用 read-only 复现确认当前文件没 vscodeUEHelper 也没 settings,
 *   第三条路径最稳。
 */

function indentOf(text, openIdx) {
  const lineStart = text.lastIndexOf('\n', openIdx - 1) + 1;
  return text.slice(lineStart, openIdx).match(/^[ \t]*/)?.[0] ?? '';
}

function defaultBlock() {
  return JSON.stringify({ settings: { vscodeUEHelper: { initialized: true } } }, null, 4) + '\n';
}

function injectInitialized(raw) {
  const data = json5.parse(raw);
  if (typeof data !== 'object' || data === null) {
    return defaultBlock();
  }
  const dataObj = /** @type {Record<string, unknown>} */ (data);
  // settings 已有 → 注入 vscodeUEHelper.initialized=true
  if (typeof dataObj.settings === 'object' && dataObj.settings !== null && !Array.isArray(dataObj.settings)) {
    const settings = /** @type {Record<string, unknown>} */ (dataObj.settings);
    if (typeof settings.vscodeUEHelper !== 'object' || settings.vscodeUEHelper === null || Array.isArray(settings.vscodeUEHelper)) {
      // settings 没 vscodeUEHelper 或形态异常 → 加一个
      settings.vscodeUEHelper = { initialized: true };
    } else {
      const vuh = /** @type {Record<string, unknown>} */ (settings.vscodeUEHelper);
      vuh.initialized = true;
    }
    dataObj.settings = settings;
    return JSON.stringify(dataObj, null, 2) + '\n';
  }
  // 顶层有 vscodeUEHelper(对象形态) → 直接标注
  if (typeof dataObj.vscodeUEHelper === 'object' && dataObj.vscodeUEHelper !== null && !Array.isArray(dataObj.vscodeUEHelper)) {
    const vuh = /** @type {Record<string, unknown>} */ (dataObj.vscodeUEHelper);
    vuh.initialized = true;
    dataObj.vscodeUEHelper = vuh;
    return JSON.stringify(dataObj, null, 2) + '\n';
  }
  // 文本级保守分支:settings vscodeUEHelper 都不存在 → 在最后一个 `}` 前插入 settings 块
  const lastBrace = raw.lastIndexOf('}');
  if (lastBrace === -1) {
    return defaultBlock();
  }
  const head = raw.slice(0, lastBrace).trimEnd();
  if (head === '{') {
    return defaultBlock();
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
 * 与 firstRunInit.ts 保持一致的探测函数(只读)
 */
async function isFirstRunVscodeWorkspace(raw) {
  let data;
  try {
    data = json5.parse(raw);
  } catch {
    return true;
  }
  if (typeof data !== 'object' || data === null) return true;
  const settings = /** @type {any} */ (data).settings;
  if (typeof settings !== 'object' || settings === null) return true;
  const vuh = settings.vscodeUEHelper;
  if (typeof vuh !== 'object' || vuh === null || Array.isArray(vuh)) return true;
  return vuh.initialized !== true;
}

(async () => {
  console.log(`target: ${target}`);
  console.log(`mode:   ${APPLY ? 'APPLY (将写盘)' : 'DRY-RUN (只读分析)'}`);

  let raw;
  try {
    raw = await fs.readFile(target, 'utf-8');
  } catch (e) {
    console.error(`读取失败: ${e.message}`);
    process.exit(1);
  }

  // 当前状态
  console.log('\n--- before ---');
  const before = await isFirstRunVscodeWorkspace(raw);
  console.log(`isFirstRunVscodeWorkspace = ${before}`);
  console.log(before ? '⚠  插件会弹初始化弹窗' : '✓  已初始化,不会再弹');

  // 计算注入结果
  let proposed;
  try {
    proposed = injectInitialized(raw);
  } catch (e) {
    console.error(`注入计算失败: ${e.message}`);
    process.exit(1);
  }
  // 兜底校验
  try {
    json5.parse(proposed);
  } catch (e) {
    console.error(`注入后内容无法解析,放弃: ${e.message}`);
    process.exit(1);
  }

  console.log('\n--- proposed (写入后内容预览) ---');
  console.log(proposed);

  console.log('--- after (isFirstRunVscodeWorkspace 重读 proposed) ---');
  const after = await isFirstRunVscodeWorkspace(proposed);
  console.log(`isFirstRunVscodeWorkspace = ${after}`);
  console.log(after ? '⚠  仍然未识别为已初始化 (BUG)' : '✓  写入后能被识别为已初始化');

  if (!before) {
    console.log('\n已是 initialized 状态,无需写入。');
    return;
  }
  if (after) {
    console.error('\n注入后仍 isFirstRunVscodeWorkspace=true,写入将不解决问题。不要执行 --apply。');
    process.exit(1);
  }
  if (!APPLY) {
    console.log('\n[DRY-RUN] 上述预览将会在 --apply 时落盘。');
    return;
  }

  // APPLY: 备份 + 原子写入
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${target}.bak.${ts}`;
  try {
    await fs.copyFile(target, bak);
    console.log(`\n[备份] ${bak}`);
  } catch (e) {
    console.error(`备份失败: ${e.message}`);
    process.exit(1);
  }
  // 原子写入:临时文件 + rename
  const tmp = `${target}.tmp`;
  try {
    await fs.writeFile(tmp, proposed, 'utf-8');
    await fs.rename(tmp, target);
  } catch (e) {
    console.error(`写入失败: ${e.message}`);
    process.exit(1);
  }
  // 二次校验
  const reread = await fs.readFile(target, 'utf-8');
  const finalCheck = await isFirstRunVscodeWorkspace(reread);
  console.log(`[写入成功] ${target}`);
  console.log(`[二次校验] isFirstRunVscodeWorkspace = ${finalCheck}`);
  console.log(finalCheck ? '⚠  警告:文件已写入但插件仍会弹初始化' : '✓  完成!重启 VS Code 后不会再弹初始化弹窗');
  console.log(`\n回滚命令(若需要):`);
  console.log(`  mv "${bak}" "${target}"`);
})();
