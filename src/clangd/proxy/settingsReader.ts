/**
 * settingsReader.ts —— 从 VS Code settings.json 读取配置（不依赖 CLI 参数）
 *
 * 职责：
 * - 从 .vscode/settings.json 读取 vscodeUEHelper.clangdProxy.localization.* 设置
 * - 不依赖 CLI 参数传递，绕过 launcher.bat → cmd.exe 的参数引号丢失问题
 * - 作为 LocalizationOptions 的二级来源（CLI 参数优先，settings.json 兜底）
 *
 * 设计原则：
 * - 纯函数，不依赖 vscode 模块
 * - 不抛出异常，读取失败返回 undefined
 * - 搜索顺序：process.cwd() → 逐级父目录 → $VSCODE_CWD
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import type { LocalizationOptions } from './bridge';

// VS Code settings 中本扩展的配置前缀
const VSCODE_SETTINGS_FILE = '.vscode' + sep + 'settings.json';
const CONFIG_PREFIX = 'vscodeUEHelper.clangdProxy.localization';

/**
 * 从 VS Code 的 settings.json 读取本地化配置。
 *
 * @param logFn - 可选的日志函数
 * @returns LocalizationOptions（如果启用）或 undefined
 */
export function loadLocalizationFromSettings(
  logFn?: (msg: string) => void,
): LocalizationOptions | undefined {
  const settingsPath = findSettingsFile();
  if (!settingsPath) {
    logFn?.('[settingsReader] no .vscode/settings.json found');
    return undefined;
  }

  try {
    const raw: unknown = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const enabled = (raw as Record<string, unknown>)[`${CONFIG_PREFIX}.enabled`];
    if (!enabled) {
      logFn?.('[settingsReader] localization not enabled in settings.json');
      return undefined;
    }

    const mode = (raw as Record<string, unknown>)[`${CONFIG_PREFIX}.mode`] ?? 'append';
    if (mode !== 'append' && mode !== 'zh-only') {
      logFn?.(`[settingsReader] invalid mode "${String(mode)}", falling back to append`);
      return {
        enabled: true,
        mode: 'append' as const,
      };
    }

    logFn?.(`[settingsReader] loaded localization: enabled=true, mode=${String(mode)}`);
    return {
      enabled: true,
      mode,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logFn?.(`[settingsReader] failed to read settings: ${msg}`);
    return undefined;
  }
}

/**
 * 查找 .vscode/settings.json 文件。
 *
 * 搜索顺序：
 * 1. process.cwd()/.vscode/settings.json
 * 2. 逐级父目录
 * 3. $VSCODE_CWD/.vscode/settings.json
 */
function findSettingsFile(): string | undefined {
  // 从当前目录开始搜索
  let dir = process.cwd();
  const root = sep; // Unix 根或 Windows 驱动器根

  // 向上搜索最多 10 级
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, VSCODE_SETTINGS_FILE);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir || parent === root) {
      break; // 已到根目录
    }
    dir = parent;
  }

  // 尝试 VSCODE_CWD 环境变量
  const vscodeCwd = process.env['VSCODE_CWD'];
  if (vscodeCwd) {
    const candidate = resolve(vscodeCwd, VSCODE_SETTINGS_FILE);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}
