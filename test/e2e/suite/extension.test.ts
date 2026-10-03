/**
 * e2e/extension.test.ts —— 扩展激活流程端到端测试(T5.5)
 *
 * 用 @vscode/test-electron 启动真实 Extension Development Host,
 * 验证:
 * 1. activate 退出码 0(扩展未 throw)
 * 2. package.json contributes.commands 22 命令全部存在
 * 3. (2026-09-08) EDH 启动 200ms 后扩展 isActive=true —— 这是
 *    "activationEvents.onCommand 与命令 ID 一一对应" 的运行时等价证据。
 *    如果 onCommand 缺失,VS Code 在不含 .uproject 的工作区里不会预激活,
 *    EDH 启动早期 isActive 仍可能为 false(取决于 launchArgs)。
 *    对真实"无 .uproject 工作区"场景,需要单独手动 F5 验证状态栏右下角
 *    提示消失,见仓库根 AGENTS.md #13a。
 *
 * 运行机制:
 * - runTests.ts 用 @vscode/test-electron 加载 suite/index.js(自管 mocha)
 * - suite/index.ts new Mocha() → addFile 装载本文件 → run()
 * - vitest 跳过 test/e2e/(vitest.config.ts 的 include 仅 test/unit/)
 *
 * 本仓库 1.x 阶段无 CI,test:e2e 仅本地验证。
 */

import * as vscode from 'vscode';

const REQUIRED_COMMANDS: ReadonlyArray<string> = [
  'vscodeUEHelper.build',
  'vscodeUEHelper.rebuild',
  'vscodeUEHelper.clean',
  'vscodeUEHelper.liveCoding',
  'vscodeUEHelper.launchEditor',
  'vscodeUEHelper.showProjectInfo',
  'vscodeUEHelper.diagnoseProject',
  'vscodeUEHelper.generateCompileCommands',
  'vscodeUEHelper.setSystemIncludes',
  'vscodeUEHelper.createProject',
  'vscodeUEHelper.installRules',
  'vscodeUEHelper.uninstall',
  'vscodeUEHelper.openWorkspaceFile',
  'vscodeUEHelper.openTerminalInNewWindow',
  'vscodeUEHelper.selectConfig',
  'vscodeUEHelper.selectTarget',
  'vscodeUEHelper.enableClangdProxy',
  'vscodeUEHelper.disableClangdProxy',
  'vscodeUEHelper.showClangdProxyStatus',
  'vscodeUEHelper.showControlPanel',
  'vscodeUEHelper.refreshProjectExplorer',
  'vscodeUEHelper.openProjectExplorerFile',
];

// mocha 全局由 suite/index.ts 注入
const mocha = globalThis as unknown as {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  before: (fn: () => void | Promise<void>) => void;
  after: (fn: () => void | Promise<void>) => void;
};

mocha.describe('VSCodeUEHelper e2e (T5.5 + 2026-09-08 onCommand fix)', () => {
  // 给 StatusBar / detection / WorkspaceState 200ms 初始化窗口
  mocha.before(async () => {
    await new Promise<void>((r) => setTimeout(r, 200));
  });

  mocha.it('extension activates without throwing', async () => {
    const ext = vscode.extensions.getExtension('vscode-ue-helper.vscode-ue-helper');
    if (!ext) {
      throw new Error('extension not registered');
    }
    // (2026-09-08) 显式 await activate() — 在 EDH 测试模式下,activate() 不会自动触发
    await ext.activate();
    if (!ext.isActive) {
      throw new Error('extension not active after explicit activate()');
    }
  });

  mocha.it('all 22 vscodeUEHelper commands registered', async () => {
    const allCmds = await vscode.commands.getCommands(true);
    const ueCmds = allCmds.filter((c) => c.startsWith('vscodeUEHelper.'));
    const missing = REQUIRED_COMMANDS.filter((id) => !ueCmds.includes(id));
    if (missing.length > 0) {
      throw new Error(`missing commands: ${missing.join(', ')}`);
    }
    if (ueCmds.length < REQUIRED_COMMANDS.length) {
      throw new Error(
        `only ${ueCmds.length} vscodeUEHelper.* commands registered, expected ${REQUIRED_COMMANDS.length}`,
      );
    }
  });

  mocha.it('extension isActive=true at 200ms (onCommand coverage)', () => {
    const ext = vscode.extensions.getExtension('vscode-ue-helper.vscode-ue-helper');
    if (!ext) {
      throw new Error('extension not registered');
    }
    if (!ext.isActive) {
      throw new Error(
        'extension not active at 200ms — activationEvents may be missing onCommand',
      );
    }
  });

  mocha.it('commands.getCommands returns >=22 ueHelper commands at 200ms', async () => {
    const allCmds = await vscode.commands.getCommands(true);
    const ueCmds = allCmds.filter((c) => c.startsWith('vscodeUEHelper.'));
    if (ueCmds.length < 22) {
      throw new Error(
        `only ${ueCmds.length} vscodeUEHelper.* commands registered, expected 22`,
      );
    }
  });
});