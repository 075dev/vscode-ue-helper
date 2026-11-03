/**
 * ueCapabilities —— UE 版本 × 能力矩阵(纯函数,零 vscode 依赖)
 *
 * ## 借鉴来源
 *
 * - **[unreal-engine-mcp](https://github.com/FFZackFair92/unreal-engine-mcp)** —— `ue_status`
 *   工具按「引擎实际支持的特性」逐项报告,而不是在缺失能力时抛一个看不懂的 Python 错误。
 *   该项目的版本兼容表说明 UE 版本差异会直接决定工具能否工作。
 * - **[boocs/unreal-clangd](https://github.com/boocs/unreal-clangd)** —— 明确记录
 *   「5.0.0 uses compile commands while 5.1.1 uses compile commands + response files」,
 *   以及各 UE 版本对应的 LLVM/clangd 版本要求。
 * - **[Incanta/vscode-cpp-unreal](https://github.com/Incanta/vscode-cpp-unreal)** ——
 *   明确区分「UE 5.x」并要求 clangd 17+,把工具链版本当作一等约束。
 *
 * ## 为什么需要
 *
 * 本插件横跨多个 UE 版本,而不同版本在 **编译数据库形态**(compile_commands vs .rsp 响应文件)、
 * **推荐 clangd 版本**(Epic 为每个 UE 版本锁定不同 LLVM)、
 * **反射代码生成机制**(UHT .generated.h) 上行为不同。
 * 过去这些差异只散落在各处注释里,用户在「为什么我的 clangd 报了一堆假错」时无处可查。
 * 本模块把这些差异收敛成一份可查询、可测试的能力矩阵,
 * 供 `Diagnose Clangd Project` 与 MCP `ue_status` 共同消费。
 *
 * ## 设计约束
 *
 * - **纯函数**:不 import vscode,便于单测(覆盖率门槛 75/70/70/75)。
 * - **事实来源明确**:每条能力都标注 `since`(引入版本),数据来自上面三个项目的
 *   公开文档与 Epic 官方 Hardware and Software Specifications 页面。
 * - **不猜版本**:无法从证据确定的 UE 版本(5.5+)一律返回 `recommendedClangd: null`,
 *   并在 detail 里指引用户查 Epic 官方文档 —— 而不是填一个可能错误的数字。
 */

/** 解析出的 UE 版本号(仅 major/minor,patch 不参与能力判定) */
export interface ParsedUeVersion {
  readonly major: number;
  readonly minor: number;
}

/** 单项能力 */
export interface UeCapability {
  /** 稳定标识(MCP 输出键 / 诊断 check 前缀) */
  readonly id: string;
  /** 能力名(英文标识;UI 文案走 i18n,此处用于日志与 MCP) */
  readonly title: string;
  /** 当前 UE 版本是否具备该能力 */
  readonly supported: boolean;
  /** 引入该能力的最低 UE 版本(展示用,如 '5.1') */
  readonly since: string;
  /** 面向用户的说明:这条能力对本插件意味着什么 */
  readonly detail: string;
}

/** 能力矩阵报告 */
export interface UeCapabilityReport {
  /** 原始版本串(可能带 'UE' 前缀 / 三段式 / 预发布后缀);未检测到时为 null */
  readonly version: string | null;
  readonly major: number | null;
  readonly minor: number | null;
  /** 本插件声明的最低支持版本 */
  readonly minimumSupported: string;
  /** 当前版本是否满足最低支持要求 */
  readonly supported: boolean;
  /** Epic 为该 UE 版本锁定的 clangd/LLVM 版本;无可靠来源时为 null */
  readonly recommendedClangd: string | null;
  readonly capabilities: readonly UeCapability[];
}

/** 本插件最低支持的 UE 版本 */
export const MINIMUM_SUPPORTED_UE: ParsedUeVersion = { major: 5, minor: 2 };

/** 最低支持版本的展示串 */
export const MINIMUM_SUPPORTED_UE_TEXT = '5.2';

/**
 * Epic 为每个 UE 版本锁定的 clangd/LLVM 版本。
 *
 * 来源:Epic 官方 "Hardware and Software Specifications" 页面,
 * 以及 boocs/unreal-clangd README 中「Unreal 5.3 requires LLVM 16.0.6」的明确说明。
 *
 * 5.5+ 未收录 —— 证据不足以断言具体版本,返回 null 而不是猜一个数字。
 */
const RECOMMENDED_CLANGD: Readonly<Record<string, string>> = {
  '5.2': '14',
  '5.3': '16.0.6',
  '5.4': '17',
};

/** 能力定义表 */
interface CapabilitySpec {
  readonly id: string;
  readonly title: string;
  readonly since: ParsedUeVersion;
  readonly detail: string;
}

const CAPABILITY_SPECS: readonly CapabilitySpec[] = [
  {
    id: 'projectFilesCompileDb',
    title: 'UBT -ProjectFiles compile database',
    since: { major: 5, minor: 0 },
    detail: 'UBT 支持 -ProjectFiles 模式产出 compile_commands.json —— 本插件编译数据库的主来源。',
  },
  {
    id: 'responseFileCommands',
    title: 'UBT response file (.rsp) commands',
    since: { major: 5, minor: 1 },
    detail: 'UBT 自 5.1 起在 compile_commands 之外额外产出 .rsp 响应文件，需要单独的路径修正链路。',
  },
  {
    id: 'uhtGeneratedHeaders',
    title: 'UHT generated reflection headers',
    since: { major: 5, minor: 0 },
    detail:
      'UHT 生成 .generated.h 反射代码 —— UHT 状态追踪与 clangd 代理的 .generated.h 监听依赖该机制。',
  },
  {
    id: 'clangdToolchain',
    title: 'Pinned clangd/LLVM toolchain',
    since: { major: 5, minor: 2 },
    detail: 'Epic 为每个 UE 版本锁定不同 LLVM/clangd 版本，版本不匹配会产生大量假诊断。',
  },
];

/**
 * 解析 UE 版本串。
 *
 * 容忍的形态:`5.3`、`5.3.2`、`5`、`UE5.3`、`UE_5_3`、`5.3.0-rc1`。
 * 解析不出数字时返回 null(调用方据此跳过能力判定,而不是当作 0.0 误判为「不支持」)。
 */
export function parseUeVersion(version: string | null | undefined): ParsedUeVersion | null {
  if (typeof version !== 'string') {
    return null;
  }
  const trimmed = version.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // 下划线版本串(UE_5_4 / UE_5_3_2)先归一为点号,再取首个 major.minor
  const normalized = trimmed.replace(/_/g, '.');
  const majorMinor = /(\d+)(?:\.(\d+))?/.exec(normalized);
  if (!majorMinor) {
    return null;
  }
  const major = Number.parseInt(majorMinor[1] ?? '', 10);
  if (!Number.isFinite(major)) {
    return null;
  }
  const minorRaw = majorMinor[2];
  const minor = minorRaw === undefined ? 0 : Number.parseInt(minorRaw, 10);
  if (!Number.isFinite(minor)) {
    return null;
  }
  return { major, minor };
}

/**
 * 比较两个 UE 版本。a < b 返回负数,a === b 返回 0,a > b 返回正数。
 *
 * major 优先,minor 次之;patch 不参与比较(本插件的能力边界只到 minor)。
 */
export function compareUeVersion(a: ParsedUeVersion, b: ParsedUeVersion): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  return a.minor - b.minor;
}

/** 版本是否 >= 给定下限 */
function isAtLeast(version: ParsedUeVersion, min: ParsedUeVersion): boolean {
  return compareUeVersion(version, min) >= 0;
}

/**
 * 构建能力矩阵报告。
 *
 * @param version 检测到的 UE 版本串;null/无法解析时返回「未知版本」报告,
 *                所有能力标记为不判定(`supported: false` 且 detail 说明未知),
 *                `supported` 字段同样为 false —— 调用方需自行区分「版本过低」与「版本未知」。
 */
export function buildUeCapabilityReport(version: string | null | undefined): UeCapabilityReport {
  const parsed = parseUeVersion(version);
  const versionText = typeof version === 'string' ? version.trim() : null;

  if (!parsed) {
    return {
      version: versionText,
      major: null,
      minor: null,
      minimumSupported: MINIMUM_SUPPORTED_UE_TEXT,
      supported: false,
      recommendedClangd: null,
      capabilities: CAPABILITY_SPECS.map((spec) => ({
        id: spec.id,
        title: spec.title,
        supported: false,
        since: `${spec.since.major}.${spec.since.minor}`,
        detail: `${spec.detail} (未检测到 UE 版本,无法判定)`,
      })),
    };
  }

  const recommendedClangd = RECOMMENDED_CLANGD[`${parsed.major}.${parsed.minor}`] ?? null;
  const meetsMinimum = isAtLeast(parsed, MINIMUM_SUPPORTED_UE);

  const capabilities = CAPABILITY_SPECS.map((spec): UeCapability => {
    const supported = isAtLeast(parsed, spec.since);
    let detail = spec.detail;
    if (spec.id === 'clangdToolchain') {
      detail =
        recommendedClangd === null
          ? `${spec.detail} (UE ${parsed.major}.${parsed.minor} 的 clangd 版本请查 Epic 官方 Hardware and Software Specifications 页面)`
          : `${spec.detail} (UE ${parsed.major}.${parsed.minor} 建议 clangd ${recommendedClangd})`;
    }
    return {
      id: spec.id,
      title: spec.title,
      supported,
      since: `${spec.since.major}.${spec.since.minor}`,
      detail,
    };
  });

  return {
    version: versionText,
    major: parsed.major,
    minor: parsed.minor,
    minimumSupported: MINIMUM_SUPPORTED_UE_TEXT,
    supported: meetsMinimum,
    recommendedClangd,
    capabilities,
  };
}

/**
 * 能力矩阵的紧凑摘要(用于日志 / 弹窗)。
 *
 * 例:`UE 5.3 · 4/4 能力可用 · 建议 clangd 16.0.6`
 */
export function summarizeUeCapabilities(report: UeCapabilityReport): string {
  if (report.major === null || report.minor === null) {
    return 'UE 版本未知 · 能力无法判定';
  }
  const supportedCount = report.capabilities.filter((cap) => cap.supported).length;
  const total = report.capabilities.length;
  const toolchain =
    report.recommendedClangd === null
      ? 'clangd 版本请查 Epic 官方文档'
      : `建议 clangd ${report.recommendedClangd}`;
  const base = `UE ${report.major}.${report.minor} · ${supportedCount}/${total} 能力可用 · ${toolchain}`;
  return report.supported ? base : `${base} · 低于最低支持版本 ${report.minimumSupported}`;
}
