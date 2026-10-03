/**
 * activationEvents.test.ts —— `package.json` 激活事件守卫
 *
 * 背景（2026-09-08）:历史 `activationEvents` 只声明了 4 个 `onCommand`,
 * 其余 18 个命令（`rebuild` / `clean` / `launchEditor` / `selectConfig` /
 * `selectTarget` / `generateCompileCommands` / `createProject` /
 * `setSystemIncludes` / `installRules` / `uninstall` / `openWorkspaceFile` /
 * `openTerminalInNewWindow` / `enableClangdProxy` / `disableClangdProxy` /
 * `showClangdProxyStatus` / `showControlPanel` / `retryFirstTimeInit` /
 * `refreshProjectExplorer` / `openProjectExplorerFile`）点击时会触发
 * "Extension 'VSCodeUEHelper' is activating…" 提示。
 *
 * 本测试确保未来新增/删除命令时,`activationEvents` 的 `onCommand` 集合
 * 始终与 `contributes.commands` 的 `command` ID 集合保持一致,作为
 * 防回归门禁。
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface PackageJsonShape {
  contributes?: {
    commands?: Array<{ command?: string }>;
  };
  activationEvents?: string[];
}

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const pkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
) as PackageJsonShape;

const commands = (pkg.contributes?.commands ?? [])
  .map((c) => c.command)
  .filter((c): c is string => typeof c === 'string' && c.length > 0);

const events = pkg.activationEvents ?? [];

describe('package.json#activationEvents 与 contributes.commands 一致性', () => {
  it('仓库下 package.json 至少声明 22 个命令（已知数量 22）', () => {
    // 防止有命令被悄悄删除;若意图减命令,请同步更新本测试断言。
    expect(commands.length).toBeGreaterThanOrEqual(22);
  });

  it('每个 contributes.command 都在 activationEvents 中找到对应的 onCommand', () => {
    const missing: string[] = [];
    for (const id of commands) {
      const expected = `onCommand:${id}`;
      if (!events.includes(expected)) {
        missing.push(id);
      }
    }
    expect(missing).toEqual([]);
  });

  it('activationEvents 中所有 onCommand 都对应真实命令 ID（防止悬挂事件）', () => {
    const dangling: string[] = [];
    const known = new Set(commands);
    for (const ev of events) {
      if (!ev.startsWith('onCommand:')) {
        continue;
      }
      const id = ev.slice('onCommand:'.length);
      if (!known.has(id)) {
        dangling.push(id);
      }
    }
    expect(dangling).toEqual([]);
  });

  it('activationEvents 至少包含一个 workspaceContains 兜底', () => {
    expect(events.some((e) => e.startsWith('workspaceContains'))).toBe(true);
  });
});