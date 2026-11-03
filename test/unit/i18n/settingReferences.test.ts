/**
 * settingReferences.test.ts —— 用户可见文案不得引用不存在的设置项
 *
 * 背景(2026-10-21):`quickPicks.noEngines` 与 `showInfo.enginesFoundEmpty` 引导用户
 * 「手动设置 vscodeUEHelper.engineRoot」,但 `engineRoot` **从来不是**本插件的设置项
 * ——package.json 的 contributes.configuration 里没有这个键,引擎路径只来自
 * `.code-workspace` 的 `folders[]`(见 src/detection/AGENTS.md「这是前提,不是降级方案」)。
 *
 * 中文文案早就写对了(「在 .code-workspace 的 folders[] 中未声明」),英文文案却一直指向
 * 那个幽灵设置项 —— 英文用户被误导,而没有任何测试能发现。
 *
 * 本测试守护:
 * 1. i18n 文案里出现的每个 `vscodeUEHelper.<key>` 都必须是 package.json 里真实存在的设置项;
 * 2. en.json / zh.json 的键集合完全一致(防止只改一边,像上面那个 bug 一样);
 * 3. 文案里**不允许**出现 `engineRoot` 作为设置项引导(引擎路径只来自 folders[])。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  contributes: {
    configuration: {
      properties: Record<string, unknown>;
    };
  };
};

const en = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/en.json'), 'utf8')) as Record<
  string,
  string
>;
const zh = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/zh.json'), 'utf8')) as Record<
  string,
  string
>;

const SETTING_KEYS = Object.keys(pkg.contributes.configuration.properties);

/** 收集文案里出现的 `vscodeUEHelper.<path>` 引用 */
function collectSettingRefs(locale: Record<string, string>): { key: string; ref: string }[] {
  const out: { key: string; ref: string }[] = [];
  for (const [key, value] of Object.entries(locale)) {
    for (const match of value.matchAll(/vscodeUEHelper\.([A-Za-z][A-Za-z0-9_.]*)/g)) {
      out.push({ key, ref: `vscodeUEHelper.${match[1] ?? ''}` });
    }
  }
  return out;
}

describe('i18n 文案引用的设置项必须真实存在', () => {
  it('en.json 引用的 vscodeUEHelper.* 都在 package.json 配置项里', () => {
    const refs = collectSettingRefs(en);
    const bogus = refs.filter((r) => !SETTING_KEYS.includes(r.ref));
    expect(bogus.map((r) => `${r.key} → ${r.ref}`)).toEqual([]);
  });

  it('zh.json 引用的 vscodeUEHelper.* 都在 package.json 配置项里', () => {
    const refs = collectSettingRefs(zh);
    const bogus = refs.filter((r) => !SETTING_KEYS.includes(r.ref));
    expect(bogus.map((r) => `${r.key} → ${r.ref}`)).toEqual([]);
  });

  it('采集器本身可用(防止上面两条因采集器失效而空转通过)', () => {
    // 真实 locale 里可能一条 vscodeUEHelper.* 引用都没有(理想状态),
    // 所以「引用数 > 0」不能作为非空断言 —— 改为直接验证采集器行为。
    const synthetic = { 'x.y': '请设置 vscodeUEHelper.engineRoot 或 vscodeUEHelper.ueVersion' };
    const refs = collectSettingRefs(synthetic);
    expect(refs.map((r) => r.ref)).toEqual([
      'vscodeUEHelper.engineRoot',
      'vscodeUEHelper.ueVersion',
    ]);
    // 其中 engineRoot 不是真实设置项 → 必须被上面两条规则判为 bogus
    expect(refs.filter((r) => !SETTING_KEYS.includes(r.ref))).toHaveLength(1);
    // ueVersion 是真实设置项 → 不算 bogus
    expect(SETTING_KEYS).toContain('vscodeUEHelper.ueVersion');
  });

  it('文案不得引导用户设置 engineRoot(引擎路径只来自 .code-workspace folders[])', () => {
    // engineRoot 不是设置项;出现即为回归
    const offenders: string[] = [];
    for (const [localeName, locale] of [
      ['en.json', en],
      ['zh.json', zh],
    ] as const) {
      for (const [key, value] of Object.entries(locale)) {
        if (/engineRoot/.test(value)) {
          offenders.push(`${localeName}:${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('en.json 与 zh.json 的键集合完全一致', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });
});
