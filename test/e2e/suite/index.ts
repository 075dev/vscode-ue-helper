/**
 * e2e/suite/index.ts —— 加载全部 e2e 测试入口(T5.5)
 *
 * mocha test loader 装载本文件,本文件再 import e2e tests。
 * 实际执行由 runTests.ts + @vscode/test-electron 完成。
 */

import { run } from './extension.test';

void (async (): Promise<void> => {
  const result = await run();
  if (result.failed > 0) {
    throw new Error(`e2e suite failed: ${result.failed}/${result.passed + result.failed}\n${result.failures.join('\n')}`);
  }
})();
