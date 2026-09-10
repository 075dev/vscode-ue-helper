const fs = require('fs');
const path = require('path');

function walkTs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkTs(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const callRegex = /vscode\.window\.(show(?:Information|Error|Warning)Message|showQuickPick)\s*\(/g;
const results = [];
for (const f of walkTs('src')) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (callRegex.test(line)) {
      const stripped = line.trim();
      const isI18n = /,\s*t\(/.test(line) || /t\(['"]/.test(line) || /\(t\(/.test(line);
      results.push({
        line: i + 1,
        text: stripped.substring(0, 110),
        i18n: isI18n,
        file: f.replace(/\\/g, '/')
      });
    }
    callRegex.lastIndex = 0;
  }
}

console.log('=== show*Message / showQuickPick 调用统计 ===');
console.log('总调用:', results.length);
console.log('已包裹 t():', results.filter(r => r.i18n).length);
console.log('硬编码候选（行内无 t()）:', results.filter(r => !r.i18n).length);
console.log('');
console.log('=== 硬编码清单 ===');
results.filter(r => !r.i18n).forEach(r => {
  console.log(r.file + ':' + r.line);
  console.log('  ' + r.text);
});