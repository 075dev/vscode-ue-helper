/**
 * runTests.ts —— VS Code 扩展 e2e 测试入口(T5.5)
 *
 * 使用 @vscode/test-electron 启动 Extension Development Host (EDH),
 * 加载 out/extension.js 真扩展产物,跑 test/e2e/suite/index.ts。
 *
 * 必须先 `npm run build` 生成 out/extension.js 后再 `npm run test:e2e`。
 *
 * 设计:
 * - 1.x 阶段仓库无 CI(AGENTS.md § 打包/发布注意),e2e 仅本地开发者跑
 * - 下载 VS Code stable 二进制(首次跑慢,后续复用 ~/.vscode-test/)
 * - workspace 启动 2 秒后再验证:避免 activate 早期 assertion 抖动
 *
 * (2026-09-08) `extensionTestsPath` 指向 suite/index.js 文件,
 * 接入 mocha runner (ITestRunner 接口 run(testsRoot, clb))。
 * extensionDevelopmentPath 用绝对路径(锚定 __dirname 上溯到仓库根),
 * 因为 tsc 把 runTests 编译到 .tsc-e2e/ 时,__dirname 漂到编译产物目录。
 *
 * 启动时打开 test/e2e/fixtures/sample.code-workspace(内含 .uproject),
 * 触发 workspaceContains 激活事件,使 EDH 启动时立即激活扩展。
 */

import { runTests } from '@vscode/test-electron';
import * as path from 'node:path';

async function main(): Promise<void> {
  // .tsc-e2e -> 仓库根
  const repoRoot = path.resolve(__dirname, '..');
  const extensionDevelopmentPath = repoRoot;
  const extensionTestsPath = path.join(repoRoot, '.tsc-e2e', 'suite', 'index.js');
  const fixtureWorkspace = path.join(
    repoRoot,
    'test',
    'e2e',
    'fixtures',
    'sample.code-workspace',
  );

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ['--disable-gpu', '--no-sandbox', fixtureWorkspace],
    version: 'stable',
  });
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- e2e 入口错误
  console.error('[e2e] runTests failed:', err);
  process.exit(1);
});