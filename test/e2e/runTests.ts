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
import * as fs from 'node:fs';
import * as os from 'node:os';

/** clangd 扩展目录名前缀 —— 对应 package.json#extensionDependencies 声明的扩展 ID */
const CLANGD_EXT_PREFIX = 'llvm-vs-code-extensions.vscode-clangd';

/**
 * 准备 e2e 专用的 VS Code 扩展目录。
 *
 * 为什么必须有这一步:package.json 声明了
 *   extensionDependencies = ["llvm-vs-code-extensions.vscode-clangd"]
 * EDH 默认使用一个空的扩展目录,依赖扩展不存在 → VS Code 拒绝激活本扩展
 * → e2e 的「28 个命令全部注册」断言必然失败(实测 3 个用例全红)。
 *
 * 这里把用户已安装的 clangd 扩展**复制**到隔离目录再挂 --extensions-dir:
 * - 复制而非直接复用用户目录,避免把无关的用户扩展带进测试环境;
 * - 隔离目录在 .vscode-test/ 下,已被 .gitignore 忽略,不污染仓库。
 */
function prepareExtensionsDir(extensionsDir: string): void {
  fs.mkdirSync(extensionsDir, { recursive: true });
  const existing = fs
    .readdirSync(extensionsDir)
    .find((entry) => entry.startsWith(CLANGD_EXT_PREFIX));
  if (existing) {
    return;
  }
  const userExtensionsDir = path.join(os.homedir(), '.vscode', 'extensions');
  let candidates: string[] = [];
  try {
    candidates = fs
      .readdirSync(userExtensionsDir)
      .filter((entry) => entry.startsWith(CLANGD_EXT_PREFIX));
  } catch {
    candidates = [];
  }
  const picked = candidates.sort().pop();
  if (!picked) {
    throw new Error(
      `[e2e] 未找到 clangd 扩展(${CLANGD_EXT_PREFIX})。` +
        '请先在 VS Code 中安装 "clangd" 扩展(llvm-vs-code-extensions.vscode-clangd),再重跑 e2e。',
    );
  }
  fs.cpSync(path.join(userExtensionsDir, picked), path.join(extensionsDir, picked), {
    recursive: true,
  });
}

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
  // EDH 专用扩展目录(承载 extensionDependencies 里的 clangd 扩展)
  const extensionsDir = path.join(repoRoot, '.vscode-test', 'extensions-e2e');
  prepareExtensionsDir(extensionsDir);

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      '--disable-gpu',
      '--no-sandbox',
      '--extensions-dir',
      extensionsDir,
      fixtureWorkspace,
    ],
    version: 'stable',
  });
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- e2e 入口错误
  console.error('[e2e] runTests failed:', err);
  process.exit(1);
});