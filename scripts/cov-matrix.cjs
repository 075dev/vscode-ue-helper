const fs = require('fs');
const path = require('path');

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const srcRaw = listFiles('src');
const testRaw = listFiles('test').filter(f => !f.includes('.bak'));

// 标准化：用 basename + 父目录作为匹配 key
function norm(p) {
  return p.replace(/\\/g, '/').replace(/^(src|test\/unit)\//, '');
}

// src/ 下每个文件 basename
const srcFiles = srcRaw.map(f => ({ full: f, rel: norm(f), base: path.basename(f, '.ts') }));
const testFiles = testRaw.map(f => ({ full: f, rel: norm(f), base: path.basename(f, '.test.ts') }));

// 用 test 集合做覆盖：每个 test 文件可以覆盖多个 src 文件（通过 import）
// 简单匹配：test 文件名 == src 文件名（去掉 .test.ts 后缀）
const coveredMap = {}; // src basename -> [test files]
for (const t of testFiles) {
  coveredMap[t.base] = coveredMap[t.base] || [];
  coveredMap[t.base].push(t.rel);
}

const covered = [];
const uncovered = [];
for (const s of srcFiles) {
  if (coveredMap[s.base]) {
    covered.push({ src: s.rel, tests: coveredMap[s.base] });
  } else {
    uncovered.push(s.rel);
  }
}

console.log('=== 覆盖率统计 ===');
console.log('src/ 文件总数:', srcFiles.length);
console.log('已覆盖 (basename 匹配):', covered.length);
console.log('未覆盖:', uncovered.length);
console.log('覆盖率 (basename 镜像):', ((covered.length / srcFiles.length) * 100).toFixed(1) + '%');
console.log('');
console.log('=== 未覆盖文件（按目录分组） ===');
const byDir = {};
for (const f of uncovered) {
  const dir = f.split('/')[0];
  if (!byDir[dir]) byDir[dir] = [];
  byDir[dir].push(f);
}
for (const [dir, files] of Object.entries(byDir).sort()) {
  console.log('  [' + dir + '] ' + files.length + ' 个:');
  files.forEach(f => console.log('    ' + f));
}
console.log('');
console.log('=== 已覆盖文件 ===');
covered.sort((a, b) => a.src.localeCompare(b.src)).forEach(c => {
  console.log('  [OK] ' + c.src + ' -> ' + c.tests.join(', '));
});