/**
 * controlPanel.html —— WebView HTML 模板生成器
 */

import { t } from '@i18n';
import {
  BUTTON_GROUPS,
  COMMAND_MAP,
  CONFIG_FIELDS,
  CONFIG_SELECTS,
  CONFIG_BOOLEANS,
  PROXY_FIELDS,
  PROXY_SELECTS,
  PROXY_BOOLEANS,
  type AddFlagWire,
} from './controlPanelMessages';
import type { ButtonGroup } from './controlPanelMessages';

export function getControlPanelHtml(
  cspSource: string,
  projectName: string,
  engineVersion: string,
  /** [Plan Add 收束] 注入到 webview 的 glossary 元数据。空数组 → fallback 客户端无渲染。 */
  addFlagEntries: readonly AddFlagWire[],
): string {
  const title = projectName
    ? `${t('panel.title')} — ${projectName}${engineVersion ? ` (UE ${engineVersion})` : ''}`
    : t('panel.title');

  return `<!DOCTYPE html>
<html lang="${t('panel.lang')}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'unsafe-inline'; font-src ${cspSource};">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --radius-sm: 4px;
      --radius-md: 6px;
      --radius-lg: 8px;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.15);
      --shadow-md: 0 2px 6px rgba(0,0,0,0.2);
      --transition-fast: 120ms ease;
      --transition-normal: 200ms ease;
      --c-bg: var(--vscode-editor-background, #1e1e1e);
      --c-fg: var(--vscode-editor-foreground, #d4d4d4);
      --c-border: var(--vscode-panel-border, #2d2d2d);
      --c-border-light: color-mix(in srgb, var(--c-border) 50%, transparent);
      --c-primary: var(--vscode-button-background, #0e639c);
      --c-primary-hover: var(--vscode-button-hoverBackground, #1177bb);
      --c-primary-fg: var(--vscode-button-foreground, #fff);
      --c-tab-active-bg: var(--vscode-tab-activeBackground, #1e1e1e);
      --c-tab-inactive-bg: var(--vscode-tab-inactiveBackground, #2d2d2d);
      --c-tab-active-border: var(--vscode-tab-activeBorderTop, #007acc);
      --c-input-bg: var(--vscode-input-background, #3c3c3c);
      --c-input-fg: var(--vscode-input-foreground, #ccc);
      --c-input-border: var(--vscode-input-border, #555);
      --c-dropdown-bg: var(--vscode-dropdown-background, #3c3c3c);
      --c-badge-green: #1b7b34;
      --c-badge-gray: #5a5a5a;
      --c-success: #4ec9b0;
      --c-error: var(--vscode-errorForeground, #f14c4c);
      --font-ui: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      --font-mono: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', 'Consolas', monospace);
      --font-size: var(--vscode-font-size, 13px);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-ui);
      font-size: var(--font-size);
      background: var(--c-bg);
      color: var(--c-fg);
      padding: 0;
      margin: 0;
      overflow-x: hidden;
      line-height: 1.5;
    }
    .panel-header {
      padding: 10px 14px;
      border-bottom: 1px solid var(--c-border);
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: color-mix(in srgb, var(--c-tab-inactive-bg) 50%, transparent);
      gap: 8px;
    }
    .panel-header .project-name { font-weight: 600; opacity: 0.85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .panel-header .engine-badge {
      flex-shrink: 0; padding: 1px 8px; border-radius: 10px;
      background: var(--c-primary); color: var(--c-primary-fg);
      font-size: 10px; font-weight: 600; letter-spacing: 0.3px; opacity: 0.9;
    }
    .tab-bar {
      display: flex; border-bottom: 1px solid var(--c-border);
      background: var(--c-tab-inactive-bg); position: sticky; top: 0; z-index: 20; padding: 0 4px;
    }
    .tab {
      flex: 1; padding: 8px 6px; cursor: pointer; border: none;
      background: transparent; color: var(--c-fg); font-size: 11px; font-family: inherit;
      font-weight: 500; letter-spacing: 0.2px; opacity: 0.55;
      transition: opacity var(--transition-normal), background var(--transition-normal);
      user-select: none; text-align: center; position: relative; border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    }
    .tab::after {
      content: ''; position: absolute; bottom: 0; left: 50%;
      transform: translateX(-50%) scaleX(0); width: 60%; height: 2px;
      background: var(--c-tab-active-border); border-radius: 1px 1px 0 0;
      transition: transform var(--transition-normal);
    }
    .tab:hover { opacity: 0.8; }
    .tab.active { opacity: 1; background: var(--c-tab-active-bg); }
    .tab.active::after { transform: translateX(-50%) scaleX(1); }
    .tab-content { display: none; padding: 12px; animation: fadeIn var(--transition-normal); }
    .tab-content.active { display: block; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .section-title {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; opacity: 0.45;
      margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--c-border-light);
      display: flex; align-items: center; gap: 6px;
    }
    .section-title::before {
      content: ''; display: inline-block; width: 3px; height: 10px;
      border-radius: 2px; background: var(--c-tab-active-border); opacity: 0.6;
    }
    .group { margin-bottom: 16px; }
    .group:last-child { margin-bottom: 0; }
    .button-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .panel-btn {
      display: flex; align-items: center; gap: 6px; padding: 8px 10px;
      border: 1px solid var(--c-border-light); border-radius: var(--radius-md);
      cursor: pointer; font-size: 12px; font-family: inherit;
      background: color-mix(in srgb, var(--c-bg) 80%, var(--c-primary));
      color: var(--c-fg); transition: background var(--transition-fast), border-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      user-select: none; box-shadow: var(--shadow-sm);
    }
    .panel-btn:hover:not(:disabled) {
      background: color-mix(in srgb, var(--c-bg) 60%, var(--c-primary));
      border-color: var(--c-primary); transform: translateY(-1px); box-shadow: var(--shadow-md);
    }
    .panel-btn:active:not(:disabled) { transform: translateY(0); box-shadow: var(--shadow-sm); }
    .panel-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }
    .panel-btn .icon { font-size: 15px; flex-shrink: 0; opacity: 0.7; width: 18px; text-align: center; }
    .panel-btn.primary { background: var(--c-primary); color: var(--c-primary-fg); border-color: transparent; }
    .panel-btn.primary:hover:not(:disabled) { background: var(--c-primary-hover); border-color: transparent; }
    .panel-btn.primary .icon { opacity: 0.9; }
    .form-section { margin-bottom: 20px; }
    .form-field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
    .form-label { font-size: 12px; font-weight: 500; opacity: 0.8; }
    .form-label .desc { font-weight: 400; font-size: 11px; opacity: 0.45; margin-left: 4px; }
    .form-field select,
    .form-field input[type="text"],
    .form-field input[type="number"] {
      padding: 5px 8px; border: 1px solid var(--c-input-border); border-radius: var(--radius-sm);
      background: var(--c-input-bg); color: var(--c-input-fg); font-size: 12px; font-family: inherit;
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    .form-field select { background: var(--c-dropdown-bg); }
    .form-field select:focus,
    .form-field input:focus { border-color: var(--c-primary); box-shadow: 0 0 0 1px var(--c-primary); outline: none; }
    .form-field.checkbox-field {
      flex-direction: row; align-items: center; gap: 8px; padding: 6px 8px;
      border-radius: var(--radius-sm); background: color-mix(in srgb, var(--c-input-bg) 40%, transparent);
      transition: background var(--transition-fast); cursor: pointer;
    }
    .form-field.checkbox-field:hover { background: color-mix(in srgb, var(--c-input-bg) 60%, transparent); }
    .form-field.checkbox-field input[type="checkbox"] { width: 14px; height: 14px; accent-color: var(--c-primary); cursor: pointer; }
    .form-field .checkbox-group { display: flex; flex-wrap: wrap; gap: 6px; }
    .form-field .checkbox-group label {
      display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12px;
      padding: 3px 8px; border: 1px solid var(--c-border-light); border-radius: var(--radius-sm);
      transition: background var(--transition-fast), border-color var(--transition-fast); user-select: none;
    }
    .form-field .checkbox-group label:hover { background: color-mix(in srgb, var(--c-input-bg) 50%, transparent); border-color: var(--c-primary); }
    .save-btn {
      display: inline-flex; align-items: center; gap: 6px; padding: 6px 20px;
      border: none; border-radius: var(--radius-md); cursor: pointer; font-size: 12px; font-family: inherit;
      font-weight: 500; background: var(--c-primary); color: var(--c-primary-fg);
      transition: background var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast);
      box-shadow: var(--shadow-sm);
    }
    .save-btn:hover:not(:disabled) { background: var(--c-primary-hover); transform: translateY(-1px); }
    .save-btn:active:not(:disabled) { transform: translateY(0); }
    .save-btn:disabled { opacity: 0.35; cursor: not-allowed; transform: none; box-shadow: none; }
    .status-section { margin-bottom: 20px; }
    .status-card {
      background: color-mix(in srgb, var(--c-input-bg) 30%, transparent);
      border: 1px solid var(--c-border-light); border-radius: var(--radius-lg); overflow: hidden;
    }
    .status-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 7px 12px; font-size: 12px; border-bottom: 1px solid var(--c-border-light);
      gap: 12px; transition: background var(--transition-fast);
    }
    .status-row:last-child { border-bottom: none; }
    .status-row:hover { background: color-mix(in srgb, var(--c-input-bg) 20%, transparent); }
    .status-label { opacity: 0.6; flex-shrink: 0; font-size: 11px; min-width: 70px; }
    .status-value { text-align: right; word-break: break-all; font-weight: 500; font-size: 12px; max-width: 65%; }
    .status-value.path { font-size: 11px; font-family: var(--font-mono); font-weight: 400; opacity: 0.7; }
    .status-badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.2px; }
    .status-badge.enabled, .status-badge.active { background: var(--c-badge-green); color: #fff; }
    .status-badge.disabled, .status-badge.inactive { background: var(--c-badge-gray); color: #ccc; }
    .status-refresh-btn {
      display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px;
      border: 1px solid var(--c-border); border-radius: var(--radius-md); cursor: pointer;
      font-size: 12px; font-family: inherit; background: transparent; color: var(--c-fg);
      transition: background var(--transition-fast), border-color var(--transition-fast); margin-top: 12px;
    }
    .status-refresh-btn:hover { background: color-mix(in srgb, var(--c-input-bg) 50%, transparent); border-color: var(--c-primary); }
    #result-toast {
      position: fixed; bottom: 12px; left: 12px; right: 12px;
      padding: 8px 14px; border-radius: var(--radius-md); font-size: 12px; font-weight: 500;
      z-index: 100; opacity: 0; transform: translateY(8px);
      transition: opacity 0.25s ease, transform 0.25s ease; pointer-events: none;
      text-align: center; word-break: break-all; box-shadow: var(--shadow-md);
    }
    #result-toast.show { opacity: 1; transform: translateY(0); }
    #result-toast.success { background: var(--c-success); color: #1e1e1e; }
    #result-toast.failure { background: var(--c-error); color: #fff; }
    .warning-notice {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; margin: 8px 12px 0 12px;
      background: #856404; color: #fff; border-radius: var(--radius-md);
      font-size: 12px; line-height: 1.4; box-shadow: var(--shadow-sm);
      animation: slideDown var(--transition-normal);
    }
    @keyframes slideDown { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    .warning-notice .notice-icon { font-size: 16px; flex-shrink: 0; }
    .warning-notice .notice-text { flex: 1; }
    .warning-notice .notice-close {
      background: none; border: none; color: #fff; cursor: pointer;
      font-size: 16px; padding: 0 4px; opacity: 0.7; line-height: 1;
    }
    .warning-notice .notice-close:hover { opacity: 1; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--c-border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--c-primary); }
    @media (max-width: 320px) { .button-grid { grid-template-columns: 1fr; } .tab { font-size: 10px; padding: 6px 4px; } }
  </style>
</head>
<body>
  <div class="panel-header">
    <span class="project-name" id="project-info">${escapeHtml(projectName || t('panel.noProject'))}</span>
    ${engineVersion ? `<span class="engine-badge" id="engine-info">UE ${escapeHtml(engineVersion)}</span>` : ''}
  </div>
  <div class="tab-bar">
    <button class="tab active" data-tab="actions" id="tab-actions">${escapeHtml(t('panel.tab.actions'))}</button>
    <button class="tab" data-tab="config" id="tab-config">${escapeHtml(t('panel.tab.config'))}</button>
    <button class="tab" data-tab="add-flags" id="tab-add-flags">${escapeHtml(t('panel.tab.addFlags'))}</button>
    <button class="tab" data-tab="proxy" id="tab-proxy-settings">${escapeHtml(t('panel.tab.proxySettings'))}</button>
    <button class="tab" data-tab="status" id="tab-status">${escapeHtml(t('panel.tab.status'))}</button>
  </div>
  <div class="tab-content active" id="content-actions">
    ${renderButtonGroups()}
  </div>
  <div class="tab-content" id="content-config">
    <div class="form-section">
      <div class="section-title">${escapeHtml(t('panel.section.build'))}</div>
      ${renderConfigFields(['configuration', 'target'])}
    </div>
    <div class="form-section">
      <div class="section-title">${escapeHtml(t('panel.section.clangd'))}</div>
      <div class="form-help">${escapeHtml(t('panel.help.completionModeUnified'))}</div>
    </div>
    <div class="form-section">
      <div class="section-title">${escapeHtml(t('panel.section.general'))}</div>
      ${renderConfigFields(['useMCP', 'lspLoggingLevel', 'autoBackupWorkspace'])}
    </div>
    <button class="save-btn" id="config-save-btn" disabled>💾 ${escapeHtml(t('panel.save'))}</button>
  </div>
  <div class="tab-content" id="content-proxy">
    <div class="form-section">
      <div class="section-title">${escapeHtml(t('panel.section.proxyGeneral'))}</div>
      ${renderProxyFields(['clangdProxyEnabled', 'clangdProxyKeepaliveMax', 'clangdProxyKeepaliveTtlSec', 'clangdProxyRealClangdPath', 'clangdProxyLogPath'])}
    </div>
    <div class="form-section">
      <div class="section-title">${escapeHtml(t('panel.section.localization'))}</div>
      ${renderProxyFields(['localizationEnabled', 'localizationMode'])}
    </div>
    <button class="save-btn" id="proxy-save-btn" disabled>💾 ${escapeHtml(t('panel.save'))}</button>
  </div>
  <div class="tab-content" id="content-add-flags">
    <div class="form-section">
      <div class="section-title">📦 ${escapeHtml(t('panel.section.addFlags.glossary'))}</div>
      <div id="add-flag-list"></div>
      <p style="opacity:0.5;font-size:11px;margin-top:8px">${escapeHtml(t('panel.help.addFlags'))}</p>
    </div>
    <button class="save-btn" id="add-flags-save-btn" disabled>💾 ${escapeHtml(t('panel.save'))}</button>
    <span id="add-flags-status" style="margin-left:10px;font-size:11px;opacity:0.6"></span>
  </div>
  <div class="tab-content" id="content-status">
    <div class="status-section">
      <div class="section-title">📁 ${escapeHtml(t('panel.section.project'))}</div>
      <div class="status-card">
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.projectName'))}</span><span class="status-value" id="st-project-name">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.projectPath'))}</span><span class="status-value path" id="st-project-path">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.engineVersion'))}</span><span class="status-value" id="st-engine-version">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.enginePath'))}</span><span class="status-value path" id="st-engine-path">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.workspaceFile'))}</span><span class="status-value path" id="st-workspace-file">—</span></div>
      </div>
    </div>
    <div class="status-section">
      <div class="section-title">⚙️ ${escapeHtml(t('panel.section.build'))}</div>
      <div class="status-card">
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.configuration'))}</span><span class="status-value" id="st-configuration">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.target'))}</span><span class="status-value" id="st-target">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.platform'))}</span><span class="status-value" id="st-platform">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.clangdPath'))}</span><span class="status-value path" id="st-clangd-path">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.completionMode'))}</span><span class="status-value" id="st-completion-mode">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.mcpMode'))}</span><span class="status-value" id="st-mcp-mode">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.mcpHost'))}</span><span class="status-value path" id="st-mcp-host">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.logLevel'))}</span><span class="status-value" id="st-log-level">—</span></div>
      </div>
    </div>
    <div class="status-section">
      <div class="section-title">🔌 ${escapeHtml(t('panel.section.proxyGeneral'))}</div>
      <div class="status-card">
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.proxyEnabled'))}</span><span id="st-proxy-enabled"></span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.proxyActive'))}</span><span id="st-proxy-active"></span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.proxyLauncherPath'))}</span><span class="status-value path" id="st-proxy-launcher-path">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.proxyRealClangdPath'))}</span><span class="status-value path" id="st-proxy-real-clangd">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.proxyKeepalive'))}</span><span class="status-value" id="st-proxy-keepalive">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.proxyLogPath'))}</span><span class="status-value path" id="st-proxy-log-path">—</span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.proxyBackupExists'))}</span><span id="st-proxy-backup"></span></div>
        <div class="status-row"><span class="status-label">${escapeHtml(t('panel.status.localization'))}</span><span class="status-value" id="st-localization">—</span></div>
      </div>
    </div>
    <button class="status-refresh-btn" id="status-refresh-btn">↻ ${escapeHtml(t('panel.status.refresh'))}</button>
  </div>
  <div id="result-toast"></div>
  <div id="proxy-restart-notice" class="warning-notice" style="display:none">
    <span class="notice-icon">&#9888;</span>
    <span class="notice-text" data-i18n="panel.notice.restartProxy"></span>
    <button class="notice-close" id="notice-close-btn">&times;</button>
  </div>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      const toast = document.getElementById('result-toast');
      let toastTimer = null;
      // [Plan Add 收束] 注入 glossary 元数据 + 当前 selectedIds 由后续 addFlagValues 消息覆盖
      const ADD_FLAG_ENTRIES = ${JSON.stringify(addFlagEntries)};
      let addFlagSelectedIds = [];
      document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
          tab.classList.add('active');
          const content = document.getElementById('content-' + tab.dataset.tab);
          if (content) content.classList.add('active');
          if (tab.dataset.tab === 'config') vscode.postMessage({ type: 'getConfig' });
          else if (tab.dataset.tab === 'proxy') vscode.postMessage({ type: 'getProxyConfig' });
          else if (tab.dataset.tab === 'status') vscode.postMessage({ type: 'getStatus' });
          else if (tab.dataset.tab === 'add-flags') vscode.postMessage({ type: 'getAddFlags' });
        });
      });
      document.querySelectorAll('.panel-btn').forEach(btn => {
        btn.addEventListener('click', function() {
          const cmd = this.dataset.command;
          if (!cmd) return;
          this.disabled = true;
          setTimeout(() => { this.disabled = false; }, 3000);
          showToast('⟳ ${escapeHtml(t('panel.executing'))}...', '');
          vscode.postMessage({ type: 'executeCommand', command: cmd });
        });
      });
      document.addEventListener('change', function(e) {
        const tab = e.target.closest('.tab-content');
        if (!tab) return;
        if (tab.id === 'content-config') document.getElementById('config-save-btn').disabled = false;
        else if (tab.id === 'content-proxy') document.getElementById('proxy-save-btn').disabled = false;
      });
      document.getElementById('config-save-btn').addEventListener('click', function() {
        const fields = ${JSON.stringify(CONFIG_FIELDS)};
        const updates = [];
        for (const field of fields) {
          const el = document.getElementById('cfg-' + field);
          if (!el) continue;
          let value = el.type === 'checkbox' ? el.checked : el.value;
          if (el.type === 'number') value = Number(value);
          updates.push({ key: field, value });
        }
        this.disabled = true;
        showToast('⟳ ${escapeHtml(t('panel.saving'))}...', '');
        vscode.postMessage({ type: 'saveConfig', updates });
      });
      document.getElementById('proxy-save-btn').addEventListener('click', function() {
        const fields = ${JSON.stringify(PROXY_FIELDS)};
        const updates = [];
        for (const field of fields) {
          const el = document.getElementById('proxy-' + field);
          if (!el) continue;
          let value;
          if (el.type === 'checkbox') value = el.checked;
          else if (el.type === 'number') value = Number(el.value);
          else value = el.value;
          updates.push({ key: field, value });
        }
        this.disabled = true;
        showToast('⟳ ${escapeHtml(t('panel.saving'))}...', '');
        vscode.postMessage({ type: 'saveProxyConfig', updates });
      });
      // [Plan Add 收束] 渲染 glossary 与勾选状态
      function renderAddFlags(entries, selectedIds) {
        const list = document.getElementById('add-flag-list');
        if (!list) return;
        const sel = new Set(selectedIds);
        const byCategory = {};
        for (const e of entries) {
          (byCategory[e.category] = byCategory[e.category] || []).push(e);
        }
        const order = ['forced-include', 'standard', 'preparse', 'uht-include'];
        const labels = {
          'forced-include': '${escapeHtml(t('panel.section.addFlags.forcedInclude'))}',
          'standard': '${escapeHtml(t('panel.section.addFlags.standard'))}',
          'preparse': '${escapeHtml(t('panel.section.addFlags.preparse'))}',
          'uht-include': '${escapeHtml(t('panel.section.addFlags.uhtInclude'))}',
        };
        const severityLabels = {
          'required': '${escapeHtml(t('panel.severity.required'))}',
          'recommended': '${escapeHtml(t('panel.severity.recommended'))}',
          'optional': '${escapeHtml(t('panel.severity.optional'))}',
        };
        let html = '';
        for (const cat of order) {
          const items = byCategory[cat];
          if (!items || items.length === 0) continue;
          html += '<div style="margin-bottom:12px"><div style="font-size:10px;opacity:0.6;margin-bottom:4px">' + labels[cat] + '</div>';
          for (const e of items) {
            const checked = sel.has(e.id);
            const sev = severityLabels[e.severity] || e.severity;
            html += '<label class="form-field checkbox-field" style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:8px;border:1px solid var(--c-border-light);border-radius:6px;margin-bottom:4px">'
              + '<input type="checkbox" data-flag-id="' + e.id + '" ' + (checked ? 'checked' : '') + ' style="margin-top:3px">'
              + '<div style="flex:1"><div style="font-weight:500">' + e.title
              + ' <span style="font-size:10px;opacity:0.5;margin-left:6px">[' + sev + ']</span></div>'
              + '<div style="font-size:11px;opacity:0.65;margin-top:2px;line-height:1.4">' + e.description + '</div>'
              + '</div></label>';
          }
          html += '</div>';
        }
        list.innerHTML = html || '<p style="opacity:0.5">${escapeHtml(t('panel.empty'))}</p>';
        list.querySelectorAll('input[type=checkbox][data-flag-id]').forEach((cb) => {
          cb.addEventListener('change', () => {
            document.getElementById('add-flags-save-btn').disabled = false;
          });
        });
      }
      document.getElementById('add-flags-save-btn').addEventListener('click', function() {
        const ids = [];
        document.querySelectorAll('input[type=checkbox][data-flag-id]').forEach((cb) => {
          if (cb.checked) ids.push(cb.getAttribute('data-flag-id'));
        });
        this.disabled = true;
        const status = document.getElementById('add-flags-status');
        if (status) status.textContent = '${escapeHtml(t('panel.saving'))}...';
        vscode.postMessage({ type: 'saveAddFlags', selectedIds: ids });
      });
      window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.type) {
          case 'commandResult':
            if (msg.success) showToast('✓ ' + (msg.message || '${escapeHtml(t('panel.result.success'))}'), 'success');
            else showToast('✗ ' + (msg.message || '${escapeHtml(t('panel.result.failure'))}'), 'failure');
            break;
          case 'showError': showToast('✗ ' + msg.message, 'failure'); break;
          case 'updateTitle':
            const proj = document.getElementById('project-info');
            const eng = document.getElementById('engine-info');
            if (proj) proj.textContent = msg.projectName || '${escapeHtml(t('panel.noProject'))}';
            if (eng) { if (msg.engineVersion) { eng.textContent = 'UE ' + msg.engineVersion; eng.style.display = ''; } else { eng.style.display = 'none'; } }
            break;
          case 'configValues': applyConfigValues(msg.values); break;
          case 'proxyConfigValues': applyProxyValues(msg.values); break;
          case 'statusValues': applyStatusValues(msg.values); break;
          case 'saveResult':
            if (msg.result.success) showToast('✓ ' + msg.result.saved + ' settings saved', 'success');
            else {
              showToast('✗ ' + msg.result.saved + ' saved, ' + msg.result.failed + ' failed' + (msg.result.firstError ? ': ' + msg.result.firstError : ''), 'failure');
              document.getElementById(msg.scope === 'config' ? 'config-save-btn' : 'proxy-save-btn').disabled = false;
            }
            if (msg.result.localizationModeChanged) {
              document.getElementById('proxy-restart-notice').style.display = 'flex';
            }
            break;
          case 'addFlagValues':
            addFlagSelectedIds = msg.values.selectedIds || [];
            renderAddFlags(msg.values.entries || [], addFlagSelectedIds);
            document.getElementById('add-flags-save-btn').disabled = true;
            break;
          case 'addFlagSaveResult':
            const af = document.getElementById('add-flags-save-btn');
            const ast = document.getElementById('add-flags-status');
            if (msg.result.success) {
              if (ast) ast.textContent = '${escapeHtml(t('panel.saveSuccess'))}';
              showToast('✓ ${escapeHtml(t('panel.saveSuccess'))}', 'success');
            } else {
              if (af) af.disabled = false;
              if (ast) ast.textContent = '${escapeHtml(t('panel.saveFailed'))}';
              showToast('✗ ${escapeHtml(t('panel.saveFailed'))}' + (msg.result.firstError ? ': ' + msg.result.firstError : ''), 'failure');
            }
            break;
        }
      });
      document.getElementById('status-refresh-btn').addEventListener('click', function() {
        vscode.postMessage({ type: 'getStatus' });
        showToast('⟳ ${escapeHtml(t('panel.status.refreshing'))}', '');
      });
      document.getElementById('notice-close-btn').addEventListener('click', function() {
        document.getElementById('proxy-restart-notice').style.display = 'none';
      });
      function applyConfigValues(values) {
        const fields = ${JSON.stringify(CONFIG_FIELDS)};
        const booleans = ${JSON.stringify(CONFIG_BOOLEANS)};
        for (const field of fields) {
          const el = document.getElementById('cfg-' + field);
          if (!el) continue;
          if (booleans.includes(field)) el.checked = !!values[field];
          else if (el.tagName === 'SELECT') el.value = values[field] || '';
          else el.value = values[field] || '';
        }
        document.getElementById('config-save-btn').disabled = true;
      }
      function applyProxyValues(values) {
        const fields = ${JSON.stringify(PROXY_FIELDS)};
        const booleans = ${JSON.stringify(PROXY_BOOLEANS)};
        for (const field of fields) {
          const el = document.getElementById('proxy-' + field);
          if (!el) continue;
          if (booleans.includes(field)) el.checked = !!values[field];
          else if (el.tagName === 'SELECT') el.value = values[field] || '';
          else el.value = values[field] != null ? String(values[field]) : '';
        }
        document.getElementById('proxy-save-btn').disabled = true;
      }
      function applyStatusValues(values) {
        setText('st-project-name', values.projectName || '—');
        setText('st-project-path', values.projectPath || '—');
        setText('st-engine-version', values.engineVersion ? 'UE ' + values.engineVersion : '—');
        setText('st-engine-path', values.enginePath || '—');
        setText('st-workspace-file', values.hasWorkspaceFile ? values.workspaceFilePath : '—');
        setText('st-configuration', values.configuration || '—');
        setText('st-target', values.target || '—');
        setText('st-platform', values.platform || '—');
        setText('st-clangd-path', values.clangdPath || '—');
        setText('st-completion-mode', values.completionMode || '—');
        setText('st-mcp-mode', values.mcpMode || '—');
        setText('st-mcp-host', values.mcpHost || '(none)');
        setText('st-log-level', values.logLevel || '—');
        setBadge('st-proxy-enabled', values.proxyEnabled, 'Enabled', 'Disabled');
        setBadge('st-proxy-active', values.proxyActive, 'Active', 'Inactive');
        setText('st-proxy-launcher-path', values.proxyLauncherPath || '—');
        setText('st-proxy-real-clangd', values.proxyRealClangdPath || '—');
        setText('st-proxy-keepalive', 'max=' + values.proxyKeepaliveMax + ', ttl=' + values.proxyKeepaliveTtlSec + 's');
        setText('st-proxy-log-path', values.proxyLogPath || '—');
        setBadge('st-proxy-backup', values.proxyBackupExists, 'Exists', 'None');
        if (values.proxyLocalizationEnabled) {
          const mode = values.proxyLocalizationMode === 'zh-only' ? '仅中文' : '中英双语';
          setText('st-localization', mode);
        } else setText('st-localization', 'Disabled');
      }
      function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
      function setBadge(id, enabled, enabledLabel, disabledLabel) {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '<span class="status-badge ' + (enabled ? 'enabled' : 'disabled') + '">' + (enabled ? enabledLabel : disabledLabel) + '</span>';
      }
      function showToast(text, type) {
        if (toastTimer) clearTimeout(toastTimer);
        toast.textContent = text; toast.className = type;
        void toast.offsetWidth; toast.classList.add('show');
        toastTimer = setTimeout(() => { toast.classList.remove('show'); toastTimer = null; }, 3000);
      }
      vscode.postMessage({ type: 'panelReady' });
    })();
  </script>
</body>
</html>`;
}

function renderButtonGroups(): string {
  return BUTTON_GROUPS.map(renderGroup).join('\n');
}

function renderGroup(group: ButtonGroup): string {
  const buttonsHtml = group.buttons
    .map((btn) => {
      const cmdId = COMMAND_MAP[btn.id];
      if (!cmdId) {
        return '';
      }
      const isPrimary = ['build', 'liveCoding', 'launchEditor'].includes(btn.id);
      return `<button class="panel-btn${isPrimary ? ' primary' : ''}" data-command="${btn.id}" title="${escapeHtml(t(btn.i18nKey))}"><span class="icon">${btn.icon}</span>${escapeHtml(t(btn.i18nKey))}</button>`;
    })
    .join('\n      ');
  return `    <div class="group"><div class="section-title">${escapeHtml(t(group.i18nKey))}</div><div class="button-grid">${buttonsHtml}</div></div>`;
}

function renderConfigFields(fields: string[]): string {
  return fields.map((field) => renderFormField('cfg-', field, false)).join('\n');
}

function renderProxyFields(fields: string[]): string {
  return fields.map((field) => renderFormField('proxy-', field, true)).join('\n');
}

function renderFormField(prefix: string, field: string, isProxy: boolean): string {
  const booleans = isProxy ? PROXY_BOOLEANS : CONFIG_BOOLEANS;
  const selects = isProxy ? PROXY_SELECTS : CONFIG_SELECTS;
  const labelKey = `panel.field.${field}`;

  if (booleans.includes(field)) {
    return `<div class="form-field checkbox-field"><input type="checkbox" id="${prefix}${field}"><label class="form-label" for="${prefix}${field}">${escapeHtml(t(labelKey))}</label></div>`;
  }
  if (field in selects) {
    const options = selects[field] ?? [];
    const optsHtml = options
      .map((opt) => {
        const label = opt.labelKey ? t(opt.labelKey) : (opt.label ?? opt.value);
        return `<option value="${escapeHtml(opt.value)}">${escapeHtml(label)}</option>`;
      })
      .join('\n        ');
    return `<div class="form-field"><label class="form-label" for="${prefix}${field}">${escapeHtml(t(labelKey))}</label><select id="${prefix}${field}">${optsHtml}</select></div>`;
  }
  const isNumber = field.includes('Max') || field.includes('Ttl') || field.includes('Sec');
  return `<div class="form-field"><label class="form-label" for="${prefix}${field}">${escapeHtml(t(labelKey))}</label><input type="${isNumber ? 'number' : 'text'}" id="${prefix}${field}"></div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
