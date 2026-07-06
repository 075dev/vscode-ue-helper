/**
 * cliArgs.ts —— clangd LSP 代理 CLI 参数解析
 *
 * 职责：
 * - 定义 CLI 选项与解析结果类型
 * - 解析代理参数与 -- 分隔符后的真实 clangd 参数
 * - 验证 --real-clangd 必填
 *
 * 设计原则：parseArgs 为纯函数，不依赖 I/O，不抛出异常。
 */

/** 代理 CLI 选项 */
export interface CliOptions {
  /** 最大保活条目数，默认 20 */
  keepaliveMax: number;
  /** TTL 秒数，默认 900（15 分钟） */
  keepaliveTtlSec: number;
  /** 真实 clangd 可执行文件路径（必填） */
  realClangd: string;
  /** 日志文件路径（可选） */
  logPath?: string;
  /** 是否启用本地化 */
  localizationEnabled: boolean;
  /** 本地化模式 */
  localizationMode: 'append' | 'zh-only';
  /** UE 文档词典 JSON 路径（可选） */
  dictionaryPath?: string;
  /** [Phase 8] 项目根目录（.uproject 所在目录）。提供时启用 .generated.h 变化监听 + clangd 主动通知 */
  projectDir?: string;
  /** [Phase 8] 引擎根目录。提供时启用 UE 诊断被动响应模式（诊断到 UE 报错 → 触发 UBT） */
  engineRoot?: string;
  /** [Phase 8] UE 诊断触发阈值：连续多少次诊断到 UE 报错才触发 UBT（默认 2） */
  ueDiagnosticTriggerThreshold?: number;
  /** [Phase 8] UBT 最小间隔（毫秒），防止频繁触发（默认 10000） */
  ueDiagnosticMinUbtIntervalMs?: number;
  /** [Phase 8] 最大重试次数（默认 3） */
  ueDiagnosticMaxRetries?: number;
  /** [Phase 8] 是否启用主动模式（文件变化监听 + trigger 文件）。默认 false（只用被动诊断模式） */
  enableGeneratedHeaderWatcher?: boolean;
  /** 传递给真实 clangd 的参数（-- 分隔符之后） */
  realClangdArgs: string[];
}

/** 参数解析结果 */
export interface ParseArgsResult {
  /** 解析后的选项 */
  options: CliOptions;
  /** 错误信息列表（空数组表示无错误） */
  errors: string[];
}

const DEFAULT_KEEPALIVE_MAX = 20;
const DEFAULT_KEEPALIVE_TTL_SEC = 900;
const DEFAULT_LOCALIZATION_MODE = 'append';

/**
 * 解析 CLI 参数。
 *
 * 代理参数在 -- 分隔符之前解析，真实 clangd 参数在 -- 之后保留。
 */
export function parseArgs(argv: string[]): ParseArgsResult {
  const errors: string[] = [];
  const options: CliOptions = {
    keepaliveMax: DEFAULT_KEEPALIVE_MAX,
    keepaliveTtlSec: DEFAULT_KEEPALIVE_TTL_SEC,
    realClangd: '',
    logPath: undefined,
    localizationEnabled: false,
    localizationMode: DEFAULT_LOCALIZATION_MODE,
    projectDir: undefined,
    engineRoot: undefined,
    ueDiagnosticTriggerThreshold: undefined,
    ueDiagnosticMinUbtIntervalMs: undefined,
    ueDiagnosticMaxRetries: undefined,
    enableGeneratedHeaderWatcher: false,
    realClangdArgs: [],
  };

  const dashDashIdx = argv.indexOf('--');
  const proxyArgs = dashDashIdx === -1 ? argv : argv.slice(0, dashDashIdx);
  const realArgs = dashDashIdx === -1 ? [] : argv.slice(dashDashIdx + 1);
  let i = 0;

  while (i < proxyArgs.length) {
    const arg = proxyArgs[i];
    if (arg === undefined) {break;}
    if (!arg.startsWith('--')) {
      i++;
      continue;
    }

    switch (arg) {
      case '--keepalive-max': {
        i++;
        const val = proxyArgs[i];
        const num = Number(val);
        if (val !== undefined && Number.isFinite(num) && Number.isInteger(num) && num > 0) {
          options.keepaliveMax = num;
        }
        break;
      }
      case '--keepalive-ttl-sec': {
        i++;
        const val = proxyArgs[i];
        const num = Number(val);
        if (val !== undefined && Number.isFinite(num) && Number.isInteger(num) && num >= 0) {
          options.keepaliveTtlSec = num;
        }
        break;
      }
      case '--real-clangd': {
        i++;
        const val = proxyArgs[i];
        if (val !== undefined && !val.startsWith('--')) {
          options.realClangd = val;
        }
        break;
      }
      case '--log-path': {
        i++;
        const val = proxyArgs[i];
        if (val !== undefined && !val.startsWith('--')) {
          options.logPath = val;
        }
        break;
      }
      case '--localization-enabled': {
        options.localizationEnabled = true;
        break;
      }
      case '--localization-mode': {
        i++;
        const val = proxyArgs[i];
        if (val === 'append' || val === 'zh-only') {
          options.localizationMode = val;
        }
        break;
      }
      case '--dictionary-path': {
        i++;
        const val = proxyArgs[i];
        if (val !== undefined && !val.startsWith('--')) {
          options.dictionaryPath = val;
        }
        break;
      }
      case '--project-dir': {
        i++;
        const val = proxyArgs[i];
        if (val !== undefined && !val.startsWith('--')) {
          options.projectDir = val;
        }
        break;
      }
      case '--engine-root': {
        i++;
        const val = proxyArgs[i];
        if (val !== undefined && !val.startsWith('--')) {
          options.engineRoot = val;
        }
        break;
      }
      case '--ue-diagnostic-trigger-threshold': {
        i++;
        const val = proxyArgs[i];
        const num = Number(val);
        if (val !== undefined && Number.isFinite(num) && Number.isInteger(num) && num > 0) {
          options.ueDiagnosticTriggerThreshold = num;
        }
        break;
      }
      case '--ue-diagnostic-min-ubt-interval-ms': {
        i++;
        const val = proxyArgs[i];
        const num = Number(val);
        if (val !== undefined && Number.isFinite(num) && num >= 0) {
          options.ueDiagnosticMinUbtIntervalMs = num;
        }
        break;
      }
      case '--ue-diagnostic-max-retries': {
        i++;
        const val = proxyArgs[i];
        const num = Number(val);
        if (val !== undefined && Number.isFinite(num) && Number.isInteger(num) && num >= 0) {
          options.ueDiagnosticMaxRetries = num;
        }
        break;
      }
      case '--enable-generated-header-watcher': {
        options.enableGeneratedHeaderWatcher = true;
        break;
      }
      default:
        errors.push(`Unknown proxy argument: ${arg}`);
        break;
    }
    i++;
  }

  if (!options.realClangd) {
    errors.push('Missing required argument: --real-clangd <path>');
  }

  options.realClangdArgs = realArgs.filter((a) => a !== '--');
  return { options, errors };
}
