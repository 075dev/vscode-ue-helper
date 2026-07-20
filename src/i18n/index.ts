/**
 * i18n —— 中英双语字符串查找
 *
 * locale 自动从 vscode.env.language 检测。
 * 字符串存在 src/i18n/locales/en.json 和 zh.json 里,
 * 用 t(key, params) 替换 {name} 占位符。
 * 如果当前 locale 缺某个 key,fallback 到英文。
 *
 * initI18n() 必须在 Logger 创建之前调用(Logger 输出也可能用翻译)。
 */

import * as vscode from 'vscode';
import en from './locales/en.json';
import zh from './locales/zh.json';

type Locale = 'en' | 'zh';
type TranslationKey = keyof typeof en;

const locales = { en, zh } as const;

let currentLocale: Locale = 'en';

export function initI18n(): void {
  const lang = (vscode.env.language ?? 'en').toLowerCase();
  currentLocale = lang.startsWith('zh') ? 'zh' : 'en';
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Translate a key. Falls back to English if missing in active locale.
 * Substitutes `{name}` placeholders with values from `params`.
 *
 * 占位符值支持 string 与 number(后者在 replace 时由 JS 自动 toString),
 * 便于调用方直接传计数等数值而无需显式 String() 包装。
 */
export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string;
export function t(
  key: string,
  params?: Record<string, string | number>,
): string;
export function t(key: string, params?: Record<string, string | number>): string {
  const lookup = (locale: Locale): string | undefined => {
    const dict = locales[locale] as Record<string, string>;
    return dict[key];
  };
  let text = lookup(currentLocale) ?? lookup('en') ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      // number / string 均支持:String.prototype.replace 第二个参数若非函数,
      // 会把传入值当 replacement string 处理(JS 自动 toString);此处显式
      // String(v) 让 TS strict 模式也能通过,避免调用方每次手写 String(...).
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

export { en, zh };
