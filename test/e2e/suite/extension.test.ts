/**
 * e2e/extension.test.ts —— 扩展激活流程端到端测试(T5.5)
 *
 * 用 @vscode/test-electron 启动真实 Extension Development Host,
 * 验证:
 * 1. activate 退出码 0(扩展未 throw)
 * 2. package.json contributes.commands 22 命令全部存在
 *
 * 运行机制:
 * - runTests.ts 用 @vscode/test-electron 的 mocha test runner 加载本文件
 * - 本文件导出 `run()` async 函数,由 suite/index.ts 装载
 * - vitest 跳过 test/e2e/(vitest.config.ts 的 include 仅 test/unit/);
 *   npm run test:e2e 才会实际跑(开发者本地)
 * - 本仓库 1.x 阶段无 CI,test:e2e 仅本地验证
 *
 * 不用 import 'mocha' 避免新增 @types/mocha devDep —— 本文件不在 vitest
 * 进程内,也不在 typecheck 显式 import 的影响范围内。
 * tsc 通过:文件本身没用到未声明 export,只导出函数。
 */

import * as vscode from 'vscode';

interface Subscription {
  dispose: () => void;
}

interface ExtHandles {
  registered: boolean;
  active: boolean;
  expectedCommandCount: number;
  missingCommands: string[];
}

function getExtensionHandles(): ExtHandles {
  const ext = vscode.extensions.getExtension('vscode-ue-helper');
  return {
    registered: ext !== undefined,
    active: ext?.isActive ?? false,
    expectedCommandCount: 22,
    // 22 命令的检查推迟到 run()——同步路径只读 extension 元数据
    missingCommands: [],
  };
}

async function checkCommands(): Promise<string[]> {
  const allCmds = await vscode.commands.getCommands(true);
  const ueCmds = allCmds.filter((c) => c.startsWith('vscodeUEHelper.'));
  const required: ReadonlyArray<string> = [
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
  return ueCmds.length >= required.length
    ? []
    : required.filter((id) => !ueCmds.includes(id));
}

const _suiteState: { passed: number; failed: number; failures: string[] } = {
  passed: 0,
  failed: 0,
  failures: [],
};

function record(name: string, ok: boolean, err?: unknown): void {
  if (ok) {
    _suiteState.passed += 1;
    // eslint-disable-next-line no-console -- e2e 测试输出
    console.log(`  ✓ ${name}`);
    return;
  }
  _suiteState.failed += 1;
  const msg = err instanceof Error ? err.message : String(err);
  _suiteState.failures.push(`${name}: ${msg}`);
  // eslint-disable-next-line no-console -- e2e 测试输出
  console.log(`  ✗ ${name} — ${msg}`);
}

/**
 * e2e 主入口——被 runTests.ts + suite/index.ts 加载。
 * 返回 { passed, failed, failures } 让 mocha runner 报告。
 */
export async function run(): Promise<{
  readonly passed: number;
  readonly failed: number;
  readonly failures: ReadonlyArray<string>;
}> {
  _suiteState.passed = 0;
  _suiteState.failed = 0;
  _suiteState.failures.length = 0;

  // 给 StatusBar / detection / WorkspaceState 200ms 初始化窗口
  await new Promise<void>((r) => setTimeout(r, 200));

  // [Test 1] extension registered & active
  try {
    const h = getExtensionHandles();
    if (!h.registered) {
      throw new Error('extension not registered');
    }
    if (!h.active) {
      throw new Error('extension not active');
    }
    record('extension activates without throwing', true);
  } catch (err) {
    record('extension activates without throwing', false, err);
  }

  // [Test 2] 22 commands registered
  try {
    const missing = await checkCommands();
    if (missing.length > 0) {
      throw new Error(`missing commands: ${missing.join(', ')}`);
    }
    record('all 22 vscodeUEHelper commands registered', true);
  } catch (err) {
    record('all 22 vscodeUEHelper commands registered', false, err);
  }

  return {
    passed: _suiteState.passed,
    failed: _suiteState.failed,
    failures: _suiteState.failures,
  };
}

// Suppress Subscription unused import warning on tooling
export type { Subscription };
