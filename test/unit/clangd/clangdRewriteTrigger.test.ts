/**
 * clangdRewriteTrigger.test.ts —— 「哪些配置变更需要重写 .clangd」的单一真相源守卫
 *
 * [D5] `.clangd` 的 `CompileFlags.Add` 内容由四个配置项共同决定：
 *   `clangd.userAddFlags` / `clangd.msvcRoot` / `clangd.sdkRoot` / `clangd.fmsCompatibilityVersion`
 *
 * 漏登记任何一个的症状都是「用户改了设置，磁盘上的 `.clangd` 却没变」——
 * 没有报错、没有提示、界面照常显示已保存，排查成本极高。本文件把「清单 ↔ package.json」
 * 的对应关系钉死：新增 `vscodeUEHelper.clangd.*` 设置项却忘记登记进清单，本例立刻红。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  CLANGD_REWRITE_CONFIG_KEYS,
  shouldRewriteClangd,
} from '@clangd/clangdFlagRenderer';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** 读取 package.json 里声明的全部配置键 */
function packageConfigKeys(): string[] {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as {
    contributes: { configuration: unknown };
  };
  const raw = pkg.contributes.configuration;
  const blocks = (Array.isArray(raw) ? raw : [raw]) as Array<{
    properties?: Record<string, unknown>;
  }>;
  return blocks.flatMap((b) => Object.keys(b.properties ?? {}));
}

/** 构造一个只对指定 key 返回 true 的 ConfigurationChangeEvent 替身 */
function changeEvent(affected: readonly string[]): { affectsConfiguration: (s: string) => boolean } {
  return {
    affectsConfiguration: (section: string) => affected.includes(section),
  };
}

describe('[D5] .clangd 重写触发配置键', () => {
  it('登记了全部四个决定 CompileFlags.Add 的设置项', () => {
    expect([...CLANGD_REWRITE_CONFIG_KEYS].sort()).toEqual([
      'vscodeUEHelper.clangd.fmsCompatibilityVersion',
      'vscodeUEHelper.clangd.msvcRoot',
      'vscodeUEHelper.clangd.sdkRoot',
      'vscodeUEHelper.clangd.userAddFlags',
    ]);
  });

  it('package.json 里每个 vscodeUEHelper.clangd.* 设置项都已登记（漏登记会被抓到）', () => {
    const declared = packageConfigKeys().filter((k) => k.startsWith('vscodeUEHelper.clangd.'));
    // 前置断言：package.json 确实有 clangd.* 设置项，避免「过滤条件写错导致空跑通过」
    expect(declared.length).toBeGreaterThan(0);
    const missing = declared.filter(
      (k) => !(CLANGD_REWRITE_CONFIG_KEYS as readonly string[]).includes(k),
    );
    expect(missing).toEqual([]);
  });

  it('不把代理配置算进来 —— clangdProxy.* / clangdPath 与 .clangd 内容无关', () => {
    const keys = CLANGD_REWRITE_CONFIG_KEYS as readonly string[];
    expect(keys.some((k) => k.includes('clangdProxy'))).toBe(false);
    expect(keys.some((k) => k === 'vscodeUEHelper.clangdPath')).toBe(false);
  });

  it('shouldRewriteClangd 对四个键逐一判定为 true', () => {
    for (const key of CLANGD_REWRITE_CONFIG_KEYS) {
      expect(shouldRewriteClangd(changeEvent([key]))).toBe(true);
    }
  });

  it('shouldRewriteClangd 对无关配置判定为 false', () => {
    expect(shouldRewriteClangd(changeEvent(['vscodeUEHelper.configuration']))).toBe(false);
    expect(shouldRewriteClangd(changeEvent(['vscodeUEHelper.clangdProxy.enabled']))).toBe(false);
    expect(shouldRewriteClangd(changeEvent([]))).toBe(false);
  });

  it('fmsCompatibilityVersion 变更会触发重写（漏监听会导致设置项与 .clangd 脱节）', () => {
    expect(
      shouldRewriteClangd(changeEvent(['vscodeUEHelper.clangd.fmsCompatibilityVersion'])),
    ).toBe(true);
  });
});
