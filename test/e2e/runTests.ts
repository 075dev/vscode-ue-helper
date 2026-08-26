/**
 * runTests.ts —— VS Code 扩展 e2e 测试入口(T5.5)
 *
 * 使用 @vscode/test-electron 启动 Extension Development Host (EDH),
 * 加载 out/extension.js 真扩展产物,跑 test/e2e/extension.test.ts。
 *
 * 必须先 `npm run build` 生成 out/extension.js 后再 `npm run test:e2e`。
 *
 * 设计:
 * - 1.x 阶段仓库无 CI(AGENTS.md § 打包/发布注意),e2e 仅本地开发者跑
 * - 下载 VS Code stable 二进制(首次跑慢,后续复用 ~/.vscode-test/)
 * - workspace 启动 2 秒后再验证:避免 activate 早期 assertion 抖动
 */

import { runTests } from '@vscode/test-electron';
import * as path from 'node:path';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
  const extensionTestsPath = path.resolve(__dirname, './suite');

  // download VS Code stable
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ['--disable-gpu', '--no-sandbox'],
    version: 'stable',
  });
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- test runner bootstrap error
  console.error('[e2e] runTests failed:', err);
  process.exit(1);
});
