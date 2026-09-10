/**
 * controlPanel.html.test.ts —— Webview HTML 模板 + escapeHtml XSS 单元测试
 *
 * 覆盖两大块:
 *
 * 1. escapeHtml XSS 防护(OWASP Filter Evasion 主要向量)
 *    - 基础字符: < > & " ' / unicode 控制字符
 *    - 攻击向量: <script>alert(1)</script> / javascript: 协议 / 属性注入 / 事件处理器
 *    - 边界: 空字符串 / 纯 ASCII / 嵌套 / 已转义实体
 *    - 性能: 10KB 字符串 < 5ms
 *
 * 2. getControlPanelHtml 模板完整性
 *    - title / 各 tab / 表单字段 / glossary 注入
 *    - projectName / engineVersion 空值时降级
 *    - ADD_FLAG_ENTRIES JSON 注入安全(JSON.stringify 自然处理)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getControlPanelHtml, escapeHtmlForTest } from '@ui/controlPanel.html';
import { initI18n } from '@i18n';
import type { AddFlagWire } from '@ui/controlPanelMessages';

const escapeHtml = escapeHtmlForTest;

beforeEach(() => {
  initI18n();
});

describe('escapeHtml — 基础字符', () => {
  it('空字符串', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('纯 ASCII 不含元字符', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });

  it('< > & 三个核心元字符', () => {
    expect(escapeHtml('a<b>c&d')).toBe('a&lt;b&gt;c&amp;d');
  });

  it('双引号与单引号', () => {
    expect(escapeHtml(`"hi" 'there'`)).toBe('&quot;hi&quot; &#039;there&#039;');
  });

  it('正斜杠不需要转义(HTML5 中安全,但要确认不会破坏 URL)', () => {
    // escapeHtml 实现不转 /,但这不影响 XSS 防护。URL 上下文需另行处理。
    expect(escapeHtml('https://example.com/path')).toBe('https://example.com/path');
  });

  it('unicode 中文 / 日文 / emoji 不变', () => {
    expect(escapeHtml('中文 / 日本語 / 🎉')).toBe('中文 / 日本語 / 🎉');
  });

  it('已转义实体不二次转义(由调用方负责)', () => {
    // 文档:escapeHtml 不识别已转义实体。&amp; 会被再次转成 &amp;amp;。
    // 这是有意为之——因为转义上下文(属性 vs 文本)不同,自动识别会引入歧义。
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('escapeHtml — XSS 攻击向量', () => {
  it('<script>alert(1)</script> 被完全中和', () => {
    const evil = '<script>alert(1)</script>';
    const safe = escapeHtml(evil);
    expect(safe).not.toContain('<script>');
    expect(safe).not.toContain('</script>');
    expect(safe).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('<img src=x onerror=alert(1)> 属性注入', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const safe = escapeHtml(evil);
    // < > 都已转义,所以浏览器不再把它解析为 img 标签
    expect(safe).not.toContain('<img');
    expect(safe).not.toContain('>');
    expect(safe).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('javascript: 协议 URL(属性上下文)需在 context 中处理', () => {
    // escapeHtml 不区分文本/属性上下文。javascript: 协议本身仍以字面字符出现,
    // 但 < 已被转义,所以无法构造 <a href="..."> 注入。验证输出不再含 < 与 ".
    const evil = '<a href="javascript:alert(1)">click</a>';
    const safe = escapeHtml(evil);
    expect(safe).not.toContain('<a');
    expect(safe).not.toContain('"');
    expect(safe).toBe(
      '&lt;a href=&quot;javascript:alert(1)&quot;&gt;click&lt;/a&gt;',
    );
  });

  it('SVG/iframe 标签同样中和', () => {
    expect(escapeHtml('<svg onload=alert(1)>')).not.toContain('<svg');
    expect(escapeHtml('<iframe src=javascript:1>')).not.toContain('<iframe');
  });

  it('事件处理器 = 符号在引号外', () => {
    const evil = '" onmouseover="alert(1)" data-x="';
    const safe = escapeHtml(evil);
    // 双引号转成 &quot; 后无法逃出属性边界
    expect(safe).toContain('&quot;');
    expect(safe).not.toMatch(/" onmouseover/);
  });

  it('HTML 注释注入', () => {
    const evil = '<!-- <script>alert(1)</script> -->';
    const safe = escapeHtml(evil);
    expect(safe).not.toContain('<!');
    expect(safe).toContain('&lt;!--');
  });

  it('CRLF / NULL 字节 / 制表符透传(XSS 攻击不依赖这些)', () => {
    // escapeHtml 不主动清理控制字符(它们不会产生 HTML 标签)
    expect(escapeHtml('a\nb\tc\0d')).toBe('a\nb\tc\0d');
  });

  it('反引号 / 反斜杠不需要转义', () => {
    // 这些字符在 HTML 文本中无解析语义
    expect(escapeHtml('a`b\\c')).toBe('a`b\\c');
  });

  it('HTML 实体字符 & 必须在 < 之前转义,否则会双重转义', () => {
    // 验证:&lt; 不会被错误地变成 &amp;lt;
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('escapeHtml — 性能与稳定性', () => {
  it('10KB 字符串 < 5ms', () => {
    const big = '<script>alert(1)</script>'.repeat(400); // ~9.6KB
    const start = performance.now();
    escapeHtml(big);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
  });

  it('100KB 字符串 < 50ms(确保不在循环/正则灾难区)', () => {
    const big = 'a&b<c>d"e\'f'.repeat(10000); // ~120KB
    const start = performance.now();
    escapeHtml(big);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('混合大小写不影响', () => {
    expect(escapeHtml('<SCRIPT>')).toBe('&lt;SCRIPT&gt;');
    expect(escapeHtml('<ScRiPt>')).toBe('&lt;ScRiPt&gt;');
  });

  it('连续 < 不触发回溯灾难', () => {
    const evil = '<'.repeat(1000) + 'safe';
    const start = performance.now();
    const safe = escapeHtml(evil);
    const elapsed = performance.now() - start;
    expect(safe).toBe('&lt;'.repeat(1000) + 'safe');
    expect(elapsed).toBeLessThan(10);
  });
});

describe('escapeHtml — 集成: 在 getControlPanelHtml 中正确转义', () => {
  it('projectName 含 <script> 时被转义', () => {
    const evil = '<script>alert("pwn")</script>';
    const html = getControlPanelHtml('vscode-webview://test', evil, '', []);
    // 验证 <script> 原文不出现
    expect(html).not.toContain(evil);
    expect(html).toContain('&lt;script&gt;');
  });

  it('engineVersion 含 "javascript: 时被转义', () => {
    const evil = '" onload="alert(1)';
    const html = getControlPanelHtml('vscode-webview://test', 'Proj', evil, []);
    expect(html).not.toMatch(/onload="alert/);
    expect(html).toContain('&quot;');
  });

  it('title 也走 escapeHtml', () => {
    const html = getControlPanelHtml(
      'vscode-webview://test',
      '<img src=x>',
      '5.4',
      [],
    );
    // title 元素内的项目名应被转义
    expect(html).toMatch(/<title>[^<]*&lt;img[^<]*<\/title>/);
  });

  it('i18n key 翻译结果含 < 也能安全渲染(若翻译未来加入 HTML 实体)', () => {
    // 防御性:即使翻译结果错误地含 < ,escapeHtml 会兜底
    const html = getControlPanelHtml('vscode-webview://test', '', '', []);
    // tab 标题等是翻译结果,应当已被转义(在源代码中用 escapeHtml 包了)
    expect(html).toMatch(/<button class="tab[^>]*>[^<]*<\/button>/);
  });
});

describe('getControlPanelHtml — 模板完整性', () => {
  it('返回合法 HTML 文档', () => {
    const html = getControlPanelHtml('vscode-webview://test', 'P', '5.4', []);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  it('5 个 tab 全部存在', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '', []);
    for (const id of [
      'tab-actions',
      'tab-config',
      'tab-add-flags',
      'tab-proxy-settings',
      'tab-status',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('projectName 为空时降级显示 noProject 文案', () => {
    const html = getControlPanelHtml('vscode-webview://test', '', '', []);
    expect(html).toMatch(/id="project-info">[^<]+</);
  });

  it('engineVersion 为空时 engine-badge 不渲染', () => {
    const html = getControlPanelHtml('vscode-webview://test', 'P', '', []);
    expect(html).not.toContain('id="engine-info"');
  });

  it('engineVersion 非空时渲染 UE <version>', () => {
    const html = getControlPanelHtml('vscode-webview://test', 'P', '5.4', []);
    expect(html).toMatch(/UE 5\.4/);
  });

  it('ADD_FLAG_ENTRIES 在 script-context 中转义 </script>(防 XSS 逃逸)', () => {
    // [XSS 修复] 模板里对 JSON 字符串插入反斜杠于 </script 前,
    // 防止攻击者通过 id/description 构造 "</script><script>..." 逃出 script 块。
    const evilEntry: AddFlagWire = {
      id: '</script><script>alert(1)</script>',
      category: 'forced-include',
      title: 'T',
      description: '</script>',
      severity: 'required',
    };
    const html = getControlPanelHtml('vscode-webview://test', '', '', [evilEntry]);
    // 注入的 <script> 块在浏览器中不应被解析为可执行脚本
    expect(html).not.toContain('</script><script>alert(1)</script>');
    // 反斜杠转义形式应出现
    expect(html).toContain('<\\/script><script>alert(1)<\\/script>');
  });

  it('cspSource 直接拼接到 meta[CSP] 而非 escapeHtml(URL 上下文,需外部保证安全)', () => {
    // cspSource 由 VS Code 提供,理论上安全。但若使用者注入,会破坏 CSP。
    // 这里是文档化:不要在外部调用时拼不可信 cspSource。
    const html = getControlPanelHtml('vscode-evil-source', '', '', []);
    expect(html).toContain('vscode-evil-source');
  });
});
