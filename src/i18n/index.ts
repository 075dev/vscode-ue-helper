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
 */
export function t(key: TranslationKey, params?: Record<string, string>): string {
  const lookup = (locale: Locale): string | undefined => {
    const dict = locales[locale] as Record<string, string>;
    return dict[key];
  };
  let text = lookup(currentLocale) ?? lookup('en') ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return text;
}

export { en, zh };
