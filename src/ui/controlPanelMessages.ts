/**
 * controlPanelMessages —— WebView ↔ Extension 消息协议类型定义
 */

/** Config Tab 配置项定义 */
export interface ConfigValues {
  configuration: string;
  target: string;
  platform: string;
  completionMode: string;
  useMCP: string;
  autoBackupWorkspace: boolean;
  lspLoggingLevel: string;
}

/** Proxy Tab 配置项定义 */
export interface ProxyConfigValues {
  clangdProxyEnabled: boolean;
  clangdProxyKeepaliveMax: number;
  clangdProxyKeepaliveTtlSec: number;
  clangdProxyRealClangdPath: string;
  clangdProxyLogPath: string;
  localizationEnabled: boolean;
  localizationMode: string;
}

/** Status Tab 状态信息 */
export interface StatusValues {
  projectName: string;
  projectPath: string;
  engineVersion: string;
  enginePath: string;
  hasWorkspaceFile: boolean;
  workspaceFilePath: string;
  configuration: string;
  target: string;
  platform: string;
  clangdPath: string;
  completionMode: string;
  mcpMode: string;
  mcpHost: string;
  logLevel: string;
  proxyEnabled: boolean;
  proxyActive: boolean;
  proxyLauncherPath: string;
  proxyRealClangdPath: string;
  proxyKeepaliveMax: number;
  proxyKeepaliveTtlSec: number;
  proxyLogPath: string;
  proxyBackupExists: boolean;
  proxyLastKnownProblem: string;
  proxyLocalizationEnabled: boolean;
  proxyLocalizationMode: string;
}

/** 单条配置更新 */
export interface ConfigUpdate {
  key: string;
  value: unknown;
}

/** WebView → Extension 消息 */
export type WebViewMessage =
  | { type: 'executeCommand'; command: string }
  | { type: 'panelReady' }
  | { type: 'getConfig' }
  | { type: 'getProxyConfig' }
  | { type: 'updateConfig'; key: string; value: unknown }
  | { type: 'updateProxyConfig'; key: string; value: unknown }
  | { type: 'saveConfig'; updates: ConfigUpdate[] }
  | { type: 'saveProxyConfig'; updates: ConfigUpdate[] }
  | { type: 'getStatus' };

/** 批量保存结果 */
export interface SaveResult {
  success: boolean;
  saved: number;
  failed: number;
  firstError?: string;
  localizationModeChanged?: boolean;
}

/** Extension → WebView 消息 */
export type PanelMessage =
  | { type: 'commandResult'; command: string; success: boolean; message?: string }
  | { type: 'showError'; message: string }
  | { type: 'updateTitle'; projectName: string; engineVersion: string }
  | { type: 'configValues'; values: ConfigValues }
  | { type: 'proxyConfigValues'; values: ProxyConfigValues }
  | { type: 'statusValues'; values: StatusValues }
  | { type: 'saveResult'; scope: 'config' | 'proxy'; result: SaveResult };

export const COMMAND_MAP: Record<string, string> = {
  build: 'vscodeUEHelper.build',
  rebuild: 'vscodeUEHelper.rebuild',
  clean: 'vscodeUEHelper.clean',
  launchEditor: 'vscodeUEHelper.launchEditor',
  liveCoding: 'vscodeUEHelper.liveCoding',
  createProject: 'vscodeUEHelper.createProject',
  generateCompileCommands: 'vscodeUEHelper.generateCompileCommands',
  diagnoseProject: 'vscodeUEHelper.diagnoseProject',
  toggleCompletionMode: 'vscodeUEHelper.toggleCompletionMode',
  setSystemIncludes: 'vscodeUEHelper.setSystemIncludes',
  enableClangdProxy: 'vscodeUEHelper.enableClangdProxy',
  disableClangdProxy: 'vscodeUEHelper.disableClangdProxy',
  openWorkspaceFile: 'vscodeUEHelper.openWorkspaceFile',
  installRules: 'vscodeUEHelper.installRules',
  uninstall: 'vscodeUEHelper.uninstall',
} as const;

export interface ButtonGroup {
  id: string;
  i18nKey: string;
  buttons: ButtonDef[];
}

export interface ButtonDef {
  id: string;
  i18nKey: string;
  icon: string;
}

export const BUTTON_GROUPS: ButtonGroup[] = [
  {
    id: 'build',
    i18nKey: 'panel.group.build',
    buttons: [
      { id: 'build', i18nKey: 'cmd.build', icon: '🔧' },
      { id: 'rebuild', i18nKey: 'cmd.rebuild', icon: '🔄' },
      { id: 'clean', i18nKey: 'cmd.clean', icon: '🗑️' },
    ],
  },
  {
    id: 'launch',
    i18nKey: 'panel.group.launch',
    buttons: [
      { id: 'launchEditor', i18nKey: 'cmd.launchEditor', icon: '▶️' },
      { id: 'liveCoding', i18nKey: 'cmd.liveCoding', icon: '⚡' },
    ],
  },
  {
    id: 'project',
    i18nKey: 'panel.group.project',
    buttons: [
      { id: 'createProject', i18nKey: 'cmd.createProject', icon: '📁' },
      { id: 'generateCompileCommands', i18nKey: 'cmd.generateCompileCommands', icon: '📄' },
    ],
  },
  {
    id: 'diagnostics',
    i18nKey: 'panel.group.diagnostics',
    buttons: [
      { id: 'diagnoseProject', i18nKey: 'cmd.diagnoseProject', icon: '✅' },
      { id: 'toggleCompletionMode', i18nKey: 'cmd.toggleCompletionMode', icon: '🔑' },
      { id: 'setSystemIncludes', i18nKey: 'cmd.setSystemIncludes', icon: '📚' },
    ],
  },
  {
    id: 'proxy',
    i18nKey: 'panel.group.proxy',
    buttons: [
      { id: 'enableClangdProxy', i18nKey: 'proxy.enable', icon: '🔌' },
      { id: 'disableClangdProxy', i18nKey: 'proxy.disable', icon: '🔗' },
    ],
  },
  {
    id: 'tools',
    i18nKey: 'panel.group.tools',
    buttons: [
      { id: 'openWorkspaceFile', i18nKey: 'cmd.openWorkspaceFile', icon: '📋' },
      { id: 'installRules', i18nKey: 'cmd.installRules', icon: '📜' },
      { id: 'uninstall', i18nKey: 'cmd.uninstall', icon: '🗑️' },
    ],
  },
];

export interface SelectOption {
  value: string;
  /** 显示文本（与 labelKey 二选一；渲染时 labelKey 优先走 i18n，无则用 label，再无则用 value） */
  label?: string;
  labelKey?: string;
}

export const CONFIG_SELECTS: Record<string, SelectOption[]> = {
  configuration: [
    { value: 'Debug', label: 'Debug' },
    { value: 'DebugGame', label: 'DebugGame' },
    { value: 'Development', label: 'Development' },
    { value: 'Shipping', label: 'Shipping' },
    { value: 'Test', label: 'Test' },
  ],
  target: [
    { value: 'Editor', label: 'Editor' },
    { value: 'Game', label: 'Game' },
    { value: 'Server', label: 'Server' },
    { value: 'Client', label: 'Client' },
  ],
  completionMode: [
    { value: 'fast', labelKey: 'config.completionMode.enum.fast' },
    { value: 'slow', labelKey: 'config.completionMode.enum.slow' },
  ],
  useMCP: [
    { value: 'auto', labelKey: 'config.useMCP.enum.auto' },
    { value: 'always', labelKey: 'config.useMCP.enum.always' },
    { value: 'never', labelKey: 'config.useMCP.enum.never' },
  ],
  lspLoggingLevel: [
    { value: 'error', labelKey: 'config.lspLoggingLevel.enum.error' },
    { value: 'warn', labelKey: 'config.lspLoggingLevel.enum.warn' },
    { value: 'info', labelKey: 'config.lspLoggingLevel.enum.info' },
    { value: 'debug', labelKey: 'config.lspLoggingLevel.enum.debug' },
  ],
};

export const PROXY_SELECTS: Record<string, SelectOption[]> = {
  localizationMode: [
    { value: 'append', label: '中英双语 / Bilingual' },
    { value: 'zh-only', label: '仅中文 / Chinese Only' },
  ],
};

export const CONFIG_BOOLEANS: string[] = ['autoBackupWorkspace'];
export const PROXY_BOOLEANS: string[] = ['clangdProxyEnabled', 'localizationEnabled'];

export const CONFIG_FIELDS: string[] = [
  'configuration', 'target',
  'completionMode', 'useMCP', 'lspLoggingLevel', 'autoBackupWorkspace',
];

export const PROXY_FIELDS: string[] = [
  'clangdProxyEnabled', 'clangdProxyKeepaliveMax', 'clangdProxyKeepaliveTtlSec',
  'clangdProxyRealClangdPath', 'clangdProxyLogPath',
  'localizationEnabled', 'localizationMode',
];

export type FieldType = 'select' | 'boolean' | 'number' | 'text';

export function getFieldType(field: string, isProxy: boolean): FieldType {
  const booleans = isProxy ? PROXY_BOOLEANS : CONFIG_BOOLEANS;
  if (booleans.includes(field)) {return 'boolean';}
  const selects = isProxy ? PROXY_SELECTS : CONFIG_SELECTS;
  if (field in selects) {return 'select';}
  if (field.includes('Max') || field.includes('Ttl') || field.includes('Sec')) {return 'number';}
  return 'text';
}

export const CONFIG_KEY_MAP: Record<string, string> = {
  configuration: 'configuration',
  target: 'target',
  completionMode: 'completionMode',
  useMCP: 'useMCP',
  autoBackupWorkspace: 'autoBackupWorkspace',
  lspLoggingLevel: 'lspLoggingLevel',
  clangdProxyEnabled: 'clangdProxy.enabled',
  clangdProxyKeepaliveMax: 'clangdProxy.keepaliveMax',
  clangdProxyKeepaliveTtlSec: 'clangdProxy.keepaliveTtlSec',
  clangdProxyRealClangdPath: 'clangdProxy.realClangdPath',
  clangdProxyLogPath: 'clangdProxy.logPath',
  localizationEnabled: 'clangdProxy.localization.enabled',
  localizationMode: 'clangdProxy.localization.mode',
};
