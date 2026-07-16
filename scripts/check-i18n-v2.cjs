const fs = require('fs');
const path = require('path');

const en = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8'));
const zh = JSON.parse(fs.readFileSync('src/i18n/locales/zh.json', 'utf8'));
const enKeys = new Set(Object.keys(en));
const zhKeys = new Set(Object.keys(zh));

function walkTs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkTs(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

// 改进：只匹配独立标识符 t 后跟 ( 和引号
// 排除 t.format、this.format、hash.digest 等误匹配
const keyRegex = /(?:^|[^.\w])t\(['"]([a-zA-Z][a-zA-Z0-9._]*)['"]/gm;
const usedKeys = new Set();
let totalMatches = 0;
const orphanLocations = [];
for (const f of walkTs('src')) {
  const content = fs.readFileSync(f, 'utf8');
  for (const m of content.matchAll(keyRegex)) {
    usedKeys.add(m[1]);
    totalMatches++;
    if (!enKeys.has(m[1])) {
      const lineNo = content.substring(0, m.index).split('\n').length;
      orphanLocations.push(`${f}:${lineNo} -> ${m[1]}`);
    }
  }
}
const orphans = [...usedKeys].filter(k => !enKeys.has(k));
const unused = [...enKeys].filter(k => !usedKeys.has(k));

console.log('=== t() 总调用次数:', totalMatches);
console.log('=== 去重 t() key 数:', usedKeys.size);
console.log('=== en.json 总 key 数:', enKeys.size);
console.log('=== zh.json 总 key 数:', zhKeys.size);
console.log('');
console.log('=== EN 有但 ZH 没有 (0=完美) ===');
[...enKeys].filter(k => !zhKeys.has(k)).forEach(k => console.log('  ' + k));
console.log('');
console.log('=== ZH 有但 EN 没有 (0=完美) ===');
[...zhKeys].filter(k => !enKeys.has(k)).forEach(k => console.log('  ' + k));
console.log('');
console.log('=== 真正孤儿 key (源码用但 en.json 缺) [' + orphans.length + '] ===');
orphans.forEach(k => console.log('  ' + k));
console.log('');
if (orphanLocations.length) {
  console.log('=== 孤儿出现位置 ===');
  orphanLocations.forEach(l => console.log('  ' + l));
}
console.log('');
console.log('=== 未使用 key (en.json 有但源码未用) [' + unused.length + '] ===');
unused.forEach(k => console.log('  ' + k));

// 双语覆盖率
const total = new Set([...enKeys, ...zhKeys]);
const translated = [...total].filter(k => enKeys.has(k) && zhKeys.has(k));
console.log('');
console.log('=== i18n 双语覆盖率: ' + translated.length + '/' + total.size + ' = ' +
  ((translated.length / total.size) * 100).toFixed(1) + '%');