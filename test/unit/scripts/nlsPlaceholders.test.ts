/**
 * nlsPlaceholders.test.ts —— package.json 本地化占位符守护测试
 *
 * 背景:仓库曾用 `description@zh` / `title@zh` / `name@zh` 这类非标准字段写中文,
 * VS Code 会直接忽略(中文用户在设置界面只看到英文),且 `package.nls.zh.json`
 * 文件名无效(VS Code 只认 `package.nls.zh-cn.json`)。2026-09 迁移到标准机制:
 * package.json 用 `%key%` 占位符,nls 文件按语言提供翻译。
 *
 * 本测试守护三条铁律:
 * 1. package.json 中所有 %占位符% 在 package.nls.json(默认英文)与
 *    package.nls.zh-cn.json(简中)中都必须有键——缺键会显示原始 %key%。
 * 2. nls 文件不允许孤儿键(键存在但 package.json 未引用,多为改名后遗留)。
 * 3. 不允许再出现 `@zh` 字段或 `package.nls.zh.json` 文件(无效机制回归)。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../');
const pkgRaw = readFileSync(resolve(root, 'package.json'), 'utf8');
const pkg = JSON.parse(pkgRaw) as unknown;
const nlsEn = JSON.parse(readFileSync(resolve(root, 'package.nls.json'), 'utf8')) as Record<
  string,
  string
>;
const nlsZh = JSON.parse(readFileSync(resolve(root, 'package.nls.zh-cn.json'), 'utf8')) as Record<
  string,
  string
>;

function collectPlaceholders(obj: unknown, out: string[] = []): string[] {
  if (typeof obj === 'string') {
    for (const m of obj.matchAll(/%([\w.]+)%/g)) {
      out.push(m[1]!);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      collectPlaceholders(item, out);
    }
  } else if (obj !== null && typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      collectPlaceholders(value, out);
    }
  }
  return out;
}

describe('package.json nls 占位符', () => {
  it('所有 %占位符% 在 en/zh-cn 两个 nls 文件中都有键(缺键会显示原始 %key%)', () => {
    const refs = collectPlaceholders(pkg);
    expect(refs.length).toBeGreaterThan(50); // 22 设置 + 26 命令 + 2 视图 + enum 描述
    const missingEn = refs.filter((r) => !(r in nlsEn));
    const missingZh = refs.filter((r) => !(r in nlsZh));
    expect(missingEn).toEqual([]);
    expect(missingZh).toEqual([]);
  });

  it('nls 文件无孤儿键(键存在但 package.json 未引用,多为改名后遗留)', () => {
    const refSet = new Set(collectPlaceholders(pkg));
    const orphanEn = Object.keys(nlsEn).filter((k) => !refSet.has(k));
    const orphanZh = Object.keys(nlsZh).filter((k) => !refSet.has(k));
    expect(orphanEn).toEqual([]);
    expect(orphanZh).toEqual([]);
  });

  it('中文翻译全部非空', () => {
    const empty = Object.entries(nlsZh).filter(([, v]) => !v || !v.trim());
    expect(empty.map(([k]) => k)).toEqual([]);
  });

  it('不允许再出现无效 @zh 字段(VS Code 会忽略,中文永不生效)', () => {
    // 深度遍历所有键名,任何包含 @zh 的键都是回归
    const offenders: string[] = [];
    const walk = (obj: unknown, path: string): void => {
      if (Array.isArray(obj)) {
        obj.forEach((v, i) => walk(v, `${path}[${i}]`));
      } else if (obj !== null && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (k.includes('@zh')) {
            offenders.push(`${path}.${k}`);
          }
          walk(v, `${path}.${k}`);
        }
      }
    };
    walk(pkg, '$');
    expect(offenders).toEqual([]);
  });

  it('中文 nls 文件名必须是 zh-cn(package.nls.zh.json 不会被 VS Code 加载)', () => {
    expect(existsSync(resolve(root, 'package.nls.zh.json'))).toBe(false);
    expect(existsSync(resolve(root, 'package.nls.zh-cn.json'))).toBe(true);
  });

  it('22 个设置项全部有中文描述', () => {
    const props = (
      pkg as {
        contributes: {
          configuration: {
            properties: Record<string, { description?: string; markdownDescription?: string }>;
          };
        };
      }
    ).contributes.configuration.properties;
    const keys = Object.keys(props);
    expect(keys).toHaveLength(22);
    for (const full of keys) {
      const short = full.replace(/^vscodeUEHelper\./, '');
      expect(`config.${short}.desc` in nlsZh, `${short} 缺中文描述`).toBe(true);
    }
  });
});
