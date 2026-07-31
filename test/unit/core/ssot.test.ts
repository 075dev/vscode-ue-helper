/**
 * ssot.test.ts —— SSoT 收敛回归守卫（Phase 9）
 *
 * 防止后续 PR 静默破坏单一真相源契约：
 *   1. WorkspaceState.selectedProject / selectedEngine getter 必须存在
 *   2. WorkspaceState 必须接受可选的 workspaceContext 参数
 *   3. @clangd barrel 不能再导出过期的 writeClangdConfig / findClangdConfig
 *   4. src/ 下不应再直读 `vscode.workspace.workspaceFile`（排除 detection 根 + workspace impl）
 *
 * 这些断言是 ESLint 规则的反向工程保险 —— 即使 ESLint 配置被误删，
 * 单元测试也会失败。错误信息应引导修复。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

const SRC_ROOT = path.resolve(__dirname, '../../../src');

/** 列出 src/ 下所有 .ts 文件（排除 node_modules / out） */
function listTsFiles(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'out') {
        continue;
      }
      listTsFiles(p, results);
    } else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) {
      results.push(p);
    }
  }
  return results;
}

describe('SSoT surface regression', () => {
  describe('WorkspaceState.selected* getter 必须存在', () => {
    it('src/core/workspace.ts 必须包含 selectedProject getter', () => {
      const src = readFileSync(path.join(SRC_ROOT, 'core/workspace.ts'), 'utf-8');
      expect(src).toMatch(/get\s+selectedProject\s*\(\s*\)\s*:\s*string\s*\|\s*null/);
    });

    it('src/core/workspace.ts 必须包含 selectedEngine getter', () => {
      const src = readFileSync(path.join(SRC_ROOT, 'core/workspace.ts'), 'utf-8');
      expect(src).toMatch(/get\s+selectedEngine\s*\(\s*\)\s*:\s*string\s*\|\s*null/);
    });

    it('src/core/workspace.ts 必须包含 setSelectedProject 方法', () => {
      const src = readFileSync(path.join(SRC_ROOT, 'core/workspace.ts'), 'utf-8');
      expect(src).toMatch(/setSelectedProject\s*\(/);
    });

    it('src/core/workspace.ts 必须包含 setSelectedEngine 方法', () => {
      const src = readFileSync(path.join(SRC_ROOT, 'core/workspace.ts'), 'utf-8');
      expect(src).toMatch(/setSelectedEngine\s*\(/);
    });

    it('WorkspaceStateOptions 必须接受可选 workspaceContext 字段', () => {
      const src = readFileSync(path.join(SRC_ROOT, 'core/workspace.ts'), 'utf-8');
      expect(src).toMatch(/workspaceContext\?\s*:\s*WorkspaceContext/);
    });
  });

  describe('@clangd barrel 不能再导出过期 API', () => {
    it('src/clangd/index.ts 不能 export writeClangdConfig', () => {
      const src = readFileSync(path.join(SRC_ROOT, 'clangd/index.ts'), 'utf-8');
      // 注释里可以"提及"已删除的 API（历史说明），但不能 export
      expect(src).not.toMatch(/^export\s+\{[^}]*writeClangdConfig/m);
    });

    it('src/clangd/index.ts 不能 export findClangdConfig', () => {
      const src = readFileSync(path.join(SRC_ROOT, 'clangd/index.ts'), 'utf-8');
      expect(src).not.toMatch(/^export\s+\{[^}]*findClangdConfig/m);
    });

    it('src/clangd/clangdConfig.ts 不应包含 writeClangdConfig 函数定义', () => {
      const src = readFileSync(path.join(SRC_ROOT, 'clangd/clangdConfig.ts'), 'utf-8');
      expect(src).not.toMatch(/function\s+writeClangdConfig/);
    });
  });

  describe('src/ 下不应再出现过期 bypass 模式', () => {
    it('commands/ui/detection 内不再直读 vscode.workspace.workspaceFile（仅 detection 根 + workspace impl 例外）', () => {
      const excluded = new Set([
        path.join(SRC_ROOT, 'detection/index.ts'),
        path.join(SRC_ROOT, 'core/workspace.ts'),
      ]);
      const tsFiles = listTsFiles(path.join(SRC_ROOT, 'commands')).concat(
        listTsFiles(path.join(SRC_ROOT, 'ui')),
      );
      const violations: string[] = [];
      for (const file of tsFiles) {
        if (excluded.has(file)) {
          continue;
        }
        const src = readFileSync(file, 'utf-8');
        // 找 `vscode.workspace.workspaceFile` 但跳过注释
        const lines = src.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]?.trim() ?? '';
          if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) {
            continue;
          }
          if (line.includes('vscode.workspace.workspaceFile')) {
            violations.push(`${path.relative(SRC_ROOT, file)}:${i + 1}: ${line}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe('SSoT 锁定文档必须存在', () => {
    it('仓库根 .eslintrc.json 必须包含 no-restricted-syntax SSoT 规则', () => {
      const eslintConfig = readFileSync(
        path.resolve(__dirname, '../../..', '.eslintrc.json'),
        'utf-8',
      );
      expect(eslintConfig).toMatch(/no-restricted-syntax/);
      expect(eslintConfig).toMatch(/workspaceFile/);
    });

    it('仓库根 .eslintrc.json 必须包含 no-restricted-imports SSoT 规则', () => {
      const eslintConfig = readFileSync(
        path.resolve(__dirname, '../../..', '.eslintrc.json'),
        'utf-8',
      );
      expect(eslintConfig).toMatch(/no-restricted-imports/);
    });

    it('根 AGENTS.md 必须把 TRAP #12 标为已解决', () => {
      const agents = readFileSync(path.resolve(__dirname, '../../..', 'AGENTS.md'), 'utf-8');
      expect(agents).toMatch(/TRAP #12.*已解决|populateAddCompletions.*已解决/);
    });

    it('src/core/AGENTS.md 必须有 SSoT 规则章节', () => {
      const coreAgents = readFileSync(path.join(SRC_ROOT, 'core/AGENTS.md'), 'utf-8');
      expect(coreAgents).toMatch(/SSoT 规则|SSoT 收敛/);
    });
  });

  /**
   * SubprocessRegistry 豁免清单守卫 (2026-07-31,见 AGENTS.md 仓库陷阱 #14)。
   *
   * 这些文件含短探测类 spawn (ms 级 await + Promise 框定) 或 VS Code Task system
   * 托管的进程,生命周期不跨函数,**故意不接入** SubprocessRegistry。
   * 一旦这些文件开始 import `sharedSubprocessRegistry`,说明有人把短探测改成了
   * fire-and-forget / detached 模式,需要重新评估豁免资格 —— 此测试会失败提醒。
   */
  describe('SubprocessRegistry 豁免清单 (仓库陷阱 #14)', () => {
    const EXEMPT_FILES = [
      'clangd/compileCommands/task.ts', // vscode.tasks.executeTask + ms 级 where 探测
      'clangd/windowsSdk.ts', // clang/clang++ -v -E + cl.exe banner 探测
      'detection/vsBuildTools.ts', // vswhere.exe 探测
    ];

    it.each(EXEMPT_FILES)(
      '豁免文件 %s 不能 import sharedSubprocessRegistry (短探测不走 registry 路径)',
      (rel) => {
        const src = readFileSync(path.join(SRC_ROOT, rel), 'utf-8');
        // 文件里可以"提到" SubprocessRegistry (注释里解释豁免理由),
        // 但不能真的 import 它 —— 那等于改变了设计意图。
        expect(src).not.toMatch(/from\s+['"]@core\/subprocessRegistry['"]/);
        expect(src).not.toMatch(/require\(['"]@core\/subprocessRegistry['"]\)/);
      },
    );

    it('根 AGENTS.md 仓库陷阱 #14 必须列出豁免清单', () => {
      const agents = readFileSync(path.resolve(__dirname, '../../..', 'AGENTS.md'), 'utf-8');
      // 必须有 SubprocessRegistry 豁免清单 (windowsSdk.ts / task.ts / vsBuildTools.ts)
      expect(agents).toMatch(/compileCommands\/task\.ts.*豁免|豁免.*compileCommands\/task\.ts/s);
      expect(agents).toMatch(/windowsSdk\.ts.*豁免|豁免.*windowsSdk\.ts/s);
    });
  });
});
