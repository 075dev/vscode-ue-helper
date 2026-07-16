const fs = require('fs');
const path = require('path');

const en = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8'));
const enKeys = new Set(Object.keys(en));

function walkTs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkTs(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const usedKeys = new Set();
const keyRegex = /t\(['"]([a-zA-Z][a-zA-Z0-9._]*)['"]/g;
let totalMatches = 0;
for (const f of walkTs('src')) {
  const content = fs.readFileSync(f, 'utf8');
  for (const m of content.matchAll(keyRegex)) {
    usedKeys.add(m[1]);
    totalMatches++;
  }
}
const orphans = [...usedKeys].filter(k => !enKeys.has(k));
const unused = [...enKeys].filter(k => !usedKeys.has(k));

console.log('=== t() 总调用次数:', totalMatches);
console.log('=== 去重 t() key 数:', usedKeys.size);
console.log('=== en.json 总 key 数:', enKeys.size);
console.log('');
console.log('=== 孤儿 key (源码用但 en.json 缺) [' + orphans.length + '] ===');
orphans.forEach(k => console.log('  ' + k));
console.log('');
console.log('=== 未使用 key (en.json 有但源码未用) [' + unused.length + '] ===');
unused.forEach(k => console.log('  ' + k));