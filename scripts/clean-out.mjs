// 打包前清理 esbuild 旧配置产物 out/src/ 和 out/test/（避免残留文件被打进 .vsix）。
// 幂等设计：force:true 在目录不存在时也不会报错，可安全重复执行。

import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const targets = ['out/src', 'out/test'];

for (const rel of targets) {
  const abs = resolve(repoRoot, rel);
  rmSync(abs, { recursive: true, force: true });
  console.log(`[clean-out] removed ${rel}`);
}
