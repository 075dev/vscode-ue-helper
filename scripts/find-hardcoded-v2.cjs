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

// 多行匹配：vscode.window.showXxxMessage( 起，向下查找直到匹配的右括号
function findCallBlock(content, startLine, fnNames) {
  const lines = content.split('\n');
  let depth = 0;
  let foundStart = false;
  let buffer = '';
  for (let i = startLine; i < lines.length; i++) {
    buffer += lines[i] + '\n';
    for (const ch of lines[i]) {
      if (ch === '(') { depth++; foundStart = true; }
      else if (ch === ')') { depth--; }
    }
    if (foundStart && depth <= 0) return { block: buffer, endLine: i + 1 };
    if (i - startLine > 10) break; // 防止无限循环
  }
  return null;
}

const results = [];
for (const f of walkTs('src')) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/vscode\.window\.(show(?:Information|Error|Warning)Message|showQuickPick|createQuickPick)\s*\(/);
    if (!m) continue;
    const fn = m[1];
    const block = findCallBlock(content, i, [fn]);
    if (!block) continue;
    const blockText = block.block;
    // 检查块内是否包含 t('...') 或 t("...") 调用
    const hasT = /\bt\(['"][a-zA-Z]/.test(blockText);
    // 检查块内是否只有静态字符串（不含模板字符串插值的英文/中文）
    const isHardcodedLiteral = /['"][A-Z][a-zA-Z]/.test(blockText) && !hasT;
    results.push({
      file: f.replace(/\\/g, '/'),
      startLine: i + 1,
      endLine: block.endLine,
      fn,
      hasT,
      snippet: blockText.split('\n').slice(0, 4).join(' / ').substring(0, 200)
    });
    i = block.endLine - 1; // 跳到 block 结尾
  }
}

console.log('=== show*Message/showQuickPick 多行块统计 ===');
console.log('总调用:', results.length);
console.log('已包裹 t():', results.filter(r => r.hasT).length);
console.log('无 t() 的:', results.filter(r => !r.hasT).length);
console.log('');
console.log('=== 无 t() 的调用（按文件分组）===');
const byFile = {};
for (const r of results.filter(r => !r.hasT)) {
  if (!byFile[r.file]) byFile[r.file] = [];
  byFile[r.file].push(r);
}
for (const [file, calls] of Object.entries(byFile).sort()) {
  console.log('[' + file + '] ' + calls.length + ' 处:');
  for (const c of calls) {
    console.log('  L' + c.startLine + '-' + c.endLine + '  ' + c.fn + ': ' + c.snippet.replace(/\n/g, ' / ').substring(0, 160));
  }
}