/**
 * e2e/suite/index.ts —— VS Code 扩展测试 runner 入口(T5.5)
 *
 * VS Code 在 --extensionTestsPath 路径上调用此模块导出的 `run(testsRoot, clb)`:
 *
 *   interface ITestRunner {
 *     run(testsRoot: string, clb: (error: Error, failures?: number) => void): void;
 *   }
 *
 * 本 runner 内部自管 mocha:new Mocha() → addFile(测试源) → run() →
 * 失败数通过 clb 回调给 VS Code。
 *
 * (2026-09-08) 自管 mocha runner:
 * - 不在 package.json#devDependencies 写 mocha(AGENTS.md §17 约束);
 * - mocha 通过 npm install --no-save --no-package-lock mocha@10 一次性拉取,跑完即清理;
 * - 测试断言复用 ./extension.test 的 describe/it,此处仅作为 mocha 容器。
 *
 * 实际执行由 runTests.ts + @vscode/test-electron 完成。
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports -- 测试 runner 必需
const MochaCtor = require('mocha') as new () => {
  addFile: (file: string) => void;
  run: (cb: (failures: number) => void) => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports -- 测试 runner 必需
const mochaModule = require('mocha') as {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  before: (fn: () => void | Promise<void>) => void;
  after: (fn: () => void | Promise<void>) => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node 内置
const pathModule = require('node:path') as typeof import('node:path');

// mocha 在 require 测试文件时会读取 globalThis.describe / globalThis.it
(globalThis as unknown as Record<string, unknown>).describe = mochaModule.describe;
(globalThis as unknown as Record<string, unknown>).it = mochaModule.it;
(globalThis as unknown as Record<string, unknown>).before = mochaModule.before;
(globalThis as unknown as Record<string, unknown>).after = mochaModule.after;

export function run(
  _testsRoot: string,
  clb: (error: Error, failures?: number) => void,
): void {
  const mocha = new MochaCtor();
  // 装载真实测试源(编译后 .js 在 .tsc-e2e/ 下,本 ts 编译时同目录)
  const testFile = pathModule.join(__dirname, 'extension.test.js');
  mocha.addFile(testFile);

  try {
    mocha.run((failures: number): void => {
      if (failures > 0) {
        clb(new Error(`mocha run failed: ${failures} failures`), failures);
      } else {
        clb(null as unknown as Error, 0);
      }
    });
  } catch (err) {
    clb(err instanceof Error ? err : new Error(String(err)));
  }
}