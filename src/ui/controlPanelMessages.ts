/**
 * controlPanelMessages —— WebView ↔ Extension 消息协议类型定义
 */

/** Config Tab 配置项定义 */
export interface ConfigValues {
  configuration: string;
  target: string;
  platform: string;
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
  /** T2.1 之后 completionMode 写死为 'slow'，状态栏仍显式告知用户当前模式。 */
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

// ===== Plan Add 收束：自定义 Add Flags Tab 协议 =====

/** Add Flag 一条 wire 形态（注入到 webview 的元数据）。 */
export interface AddFlagWire {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly severity: 'required' | 'recommended' | 'optional';
}

/** Add Flags 面板状态（webview 渲染用） */
export interface AddFlagValues {
  /** 全部可暴露 flag（id -> wire） */
  readonly entries: readonly AddFlagWire[];
  /** 当前已勾选 id 列表（与 vscodeUEHelper.clangd.userAddFlags 同步） */
  readonly selectedIds: readonly string[];
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
  | { type: 'getStatus' }
  | { type: 'getAddFlags' }
  | { type: 'saveAddFlags'; selectedIds: string[] };

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
  /**
   * [面板可用性] 按项目/引擎检测状态推送按钮适用度。
   * hasProject = 工作区检测到 .uproject；hasEngine = 检测到 UE 引擎安装。
   * webview 据此切换空状态（无项目时面板整体不可用）并 disable 超出适用度的按钮。
   */
  | { type: 'panelState'; hasProject: boolean; hasEngine: boolean }
  | { type: 'configValues'; values: ConfigValues }
  | { type: 'proxyConfigValues'; values: ProxyConfigValues }
  | { type: 'statusValues'; values: StatusValues }
  | { type: 'saveResult'; scope: 'config' | 'proxy'; result: SaveResult }
  | { type: 'addFlagValues'; values: AddFlagValues }
  | { type: 'addFlagSaveResult'; result: SaveResult };

/**
 * [D18] 按钮 id → 命令 ID 映射的原始定义。
 *
 * 单独抽出来是为了让 COMMAND_MAP 能包一层 null 原型对象（见下）。
 */
const COMMAND_MAP_RAW = {
  build: 'vscodeUEHelper.build',
  rebuild: 'vscodeUEHelper.rebuild',
  clean: 'vscodeUEHelper.clean',
  launchEditor: 'vscodeUEHelper.launchEditor',
  liveCoding: 'vscodeUEHelper.liveCoding',
  createProject: 'vscodeUEHelper.createProject',
  generateCompileCommands: 'vscodeUEHelper.generateCompileCommands',
  diagnoseProject: 'vscodeUEHelper.diagnoseProject',
  setSystemIncludes: 'vscodeUEHelper.setSystemIncludes',
  enableClangdProxy: 'vscodeUEHelper.enableClangdProxy',
  disableClangdProxy: 'vscodeUEHelper.disableClangdProxy',
  openWorkspaceFile: 'vscodeUEHelper.openWorkspaceFile',
  installRules: 'vscodeUEHelper.installRules',
  uninstall: 'vscodeUEHelper.uninstall',
} as const;

/**
 * [D18] 按钮 id → 命令 ID 映射。
 *
 * 用 **null 原型对象**（`Object.create(null)`）而不是对象字面量：
 * 对象字面量继承 `Object.prototype`，所以 `COMMAND_MAP['constructor']` /
 * `['toString']` 会返回继承来的函数（truthy）→ 绕过"未知命令"分支。
 * 伪造一条 `{type:'executeCommand', command:'constructor'}` 就会让扩展去
 * 执行 `Object` 构造函数，用户看到 "command function Object() { [native code] }
 * not found"。webview 消息可以被伪造，白名单必须是封闭集合。
 */
export const COMMAND_MAP: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  COMMAND_MAP_RAW,
);

/**
 * 按钮适用档位 —— 按当前工作区状态决定面板按钮是否可用：
 * - always  ：任意工作区可用（如创建项目——无项目时的唯一入口）
 * - project ：需要检测到 .uproject 项目
 * - engine  ：需要项目 + UE 引擎安装（跑 UBT / 启动编辑器等）
 */
export type ButtonRequirement = 'always' | 'project' | 'engine';

export interface ButtonGroup {
  id: string;
  i18nKey: string;
  buttons: ButtonDef[];
}

export interface ButtonDef {
  id: string;
  i18nKey: string;
  icon: string;
  /** 适用档位；webview 据此 disable，扩展侧据此做服务端兜底校验 */
  requirement: ButtonRequirement;
}

export const BUTTON_GROUPS: ButtonGroup[] = [
  {
    id: 'build',
    i18nKey: 'panel.group.build',
    buttons: [
      { id: 'build', i18nKey: 'cmd.build', icon: '🔧', requirement: 'engine' },
      { id: 'rebuild', i18nKey: 'cmd.rebuild', icon: '🔄', requirement: 'engine' },
      { id: 'clean', i18nKey: 'cmd.clean', icon: '🗑️', requirement: 'engine' },
    ],
  },
  {
    id: 'launch',
    i18nKey: 'panel.group.launch',
    buttons: [
      { id: 'launchEditor', i18nKey: 'cmd.launchEditor', icon: '▶️', requirement: 'engine' },
      { id: 'liveCoding', i18nKey: 'cmd.liveCoding', icon: '⚡', requirement: 'engine' },
    ],
  },
  {
    id: 'project',
    i18nKey: 'panel.group.project',
    buttons: [
      // createProject 是无项目工作区的入口，任何状态下都可用
      { id: 'createProject', i18nKey: 'cmd.createProject', icon: '📁', requirement: 'always' },
      {
        id: 'generateCompileCommands',
        i18nKey: 'cmd.generateCompileCommands',
        icon: '📄',
        requirement: 'engine',
      },
    ],
  },
  {
    id: 'diagnostics',
    i18nKey: 'panel.group.diagnostics',
    buttons: [
      { id: 'diagnoseProject', i18nKey: 'cmd.diagnoseProject', icon: '✅', requirement: 'project' },
      { id: 'setSystemIncludes', i18nKey: 'cmd.setSystemIncludes', icon: '📚', requirement: 'project' },
    ],
  },
  {
    id: 'proxy',
    i18nKey: 'panel.group.proxy',
    buttons: [
      { id: 'enableClangdProxy', i18nKey: 'proxy.enable', icon: '🔌', requirement: 'project' },
      { id: 'disableClangdProxy', i18nKey: 'proxy.disable', icon: '🔗', requirement: 'project' },
    ],
  },
  {
    id: 'tools',
    i18nKey: 'panel.group.tools',
    buttons: [
      { id: 'openWorkspaceFile', i18nKey: 'cmd.openWorkspaceFile', icon: '📋', requirement: 'project' },
      { id: 'installRules', i18nKey: 'cmd.installRules', icon: '📜', requirement: 'project' },
      { id: 'uninstall', i18nKey: 'cmd.uninstall', icon: '🗑️', requirement: 'project' },
    ],
  },
];

/**
 * 按钮适用档位查表（按钮 id → requirement）。
 * 扩展侧 executeCommand 兜底校验与 webview 渲染共用同一份定义，避免两处漂移。
 *
 * [D18] 同样用 null 原型对象 —— 否则 `COMMAND_REQUIREMENT['constructor']`
 * 会命中 Object.prototype 上的继承属性，把未知按钮当成"需要引擎"。
 */
export const COMMAND_REQUIREMENT: Record<string, ButtonRequirement> = Object.assign(
  Object.create(null) as Record<string, ButtonRequirement>,
  Object.fromEntries(
    BUTTON_GROUPS.flatMap((group) => group.buttons.map((btn) => [btn.id, btn.requirement])),
  ),
);

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
  // T2.1：completionMode 不再是用户可选设置（fast/slow 已合并为唯一 slow），
  //      从 CONFIG_SELECTS 移除（CONFIG_FIELDS / CONFIG_KEY_MAP 同步清理）。
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
  'configuration',
  'target',
  'useMCP',
  'lspLoggingLevel',
  'autoBackupWorkspace',
];

export const PROXY_FIELDS: string[] = [
  'clangdProxyEnabled',
  'clangdProxyKeepaliveMax',
  'clangdProxyKeepaliveTtlSec',
  'clangdProxyRealClangdPath',
  'clangdProxyLogPath',
  'localizationEnabled',
  'localizationMode',
];

export type FieldType = 'select' | 'boolean' | 'number' | 'text';

export function getFieldType(field: string, isProxy: boolean): FieldType {
  const booleans = isProxy ? PROXY_BOOLEANS : CONFIG_BOOLEANS;
  if (booleans.includes(field)) {
    return 'boolean';
  }
  const selects = isProxy ? PROXY_SELECTS : CONFIG_SELECTS;
  if (field in selects) {
    return 'select';
  }
  if (field.includes('Max') || field.includes('Ttl') || field.includes('Sec')) {
    return 'number';
  }
  return 'text';
}

export const CONFIG_KEY_MAP: Record<string, string> = {
  configuration: 'configuration',
  target: 'target',
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

// ===== [D18] 配置值类型校验 =====

/**
 * [D18] 配置字段 → 值类型。
 *
 * 显式列出，不靠字段名猜（`'Max'|'Ttl'|'Sec'` 那套字符串匹配会漏）。
 */
export type ConfigValueKind = 'boolean' | 'number' | 'select' | 'string';

const CONFIG_VALUE_KINDS: Record<string, ConfigValueKind> = {
  configuration: 'select',
  target: 'select',
  useMCP: 'select',
  lspLoggingLevel: 'select',
  autoBackupWorkspace: 'boolean',
  clangdProxyEnabled: 'boolean',
  clangdProxyKeepaliveMax: 'number',
  clangdProxyKeepaliveTtlSec: 'number',
  clangdProxyRealClangdPath: 'string',
  clangdProxyLogPath: 'string',
  localizationEnabled: 'boolean',
  localizationMode: 'select',
};

/** 配置值校验结果 */
export type ConfigValueCheck = { ok: true } | { ok: false; reason: string };

/** 值的类型名（用于错误文案） */
function describeValueType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

/**
 * [D18] 校验 webview 传来的配置值。
 *
 * 背景:webview 消息可以被伪造,而 `updateConfig` / `updateProxyConfig` 的
 * `value` 是 `unknown` —— 直接写进 settings.json 后,后续消费方
 * （如 `path.join(对象)`）会抛 TypeError,故障点离原因很远。
 * 这里按目标字段的类型逐类校验,不匹配即拒绝并回推错误。
 */
export function validateConfigValue(key: string, value: unknown): ConfigValueCheck {
  const kind = CONFIG_VALUE_KINDS[key];
  if (!kind) {
    return { ok: false, reason: `Unknown config key: ${key}` };
  }

  switch (kind) {
    case 'boolean':
      return typeof value === 'boolean'
        ? { ok: true }
        : { ok: false, reason: `Expected boolean, got ${describeValueType(value)}` };
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? { ok: true }
        : { ok: false, reason: `Expected finite number, got ${describeValueType(value)}` };
    case 'select': {
      const options = { ...CONFIG_SELECTS, ...PROXY_SELECTS }[key] ?? [];
      const allowed = options.map((o) => o.value);
      return typeof value === 'string' && allowed.includes(value)
        ? { ok: true }
        : { ok: false, reason: `Expected one of: ${allowed.join(', ')}` };
    }
    case 'string':
      return typeof value === 'string'
        ? { ok: true }
        : { ok: false, reason: `Expected string, got ${describeValueType(value)}` };
  }
}
