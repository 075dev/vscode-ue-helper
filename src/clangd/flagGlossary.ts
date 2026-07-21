/**
 * flagGlossary —— `.clangd` CompileFlags.Add 中所有可注入 flag 的数据源
 *
 * 设计动机（per Plan A.1）：
 * 过去 `defaultClangdConfig()` 在 Add 字段中散点注入多类 flag 来源，跨模块
 * 累积导致 clangd 报难以定位的错误。
 *
 * 现在 [Phase 9 SSoT] 把"系统隐式注入"全部去除，由用户在控制面板「自定义
 * Add Flags」tab 显式勾选决定。本文件提供：
 *   - DEFAULT_FLAG_GLOSSARY：UI 渲染用的元数据（id / category / 标题 / 中文说明 / severity）
 *   - resolveFlags：把勾选 id + 动态路径 context 解析成最终 Add 字面串
 *   - 唯一写入点：ClangdOps.applyAddFlags（不要直接 fs.writeFile .clangd）
 *
 * ⚠️ MSVC warning 64 项由 baseline 集中管理，**不**进入 flagGlossary。
 *
 * 词条中文文本是常量化（不通过 i18n），符合用户偏好（"本地 TS 常量表"）。
 * 因 flag 词条工程敏感、面向高级用户且需要维护 in 中文，转 i18n 收益低。
 */

export type FlagCategory =
  | 'forced-include'   // /FI<ueClangdCompat.h>、/FI<macroCompletionHelper.h>
  | 'standard'         // /std:c++20
  | 'system-include'   // /X、/imsvc<...>、-fms-compatibility-version=
  | 'preparse'         // -include <preparse header>
  | 'uht-include';     // /I<Intermediate/.../Inc/UHT>

export type FlagSeverity = 'required' | 'recommended' | 'optional';

export interface FlagEntry {
  /** 稳定 id（写入 userAddFlags 设置项），如 'compat-header'、'system-include-x' */
  readonly id: string;
  /** UI 展示与 schema 用的稳定分类 */
  readonly category: FlagCategory;
  /** 中文短标题 */
  readonly title: string;
  /** 中文详细说明（不通过 i18n，常量化） */
  readonly description: string;
  /** 用户可关闭性提示（required 仍可关，仅是警告强烈程度） */
  readonly severity: FlagSeverity;
}

/**
 * 模板展开：每个 FlagEntry 的 id 对应一段解析逻辑。
 * 之所以 id-only（不放 flag 字面），是为了让 UI 与具体字面解耦：
 *   - 动态路径（/FI<compatHeader>、/I<UHT>）由 resolveContext 注入；
 *   - 升级时基础字面变化（如 clangd 22.x → 23.x）只改 resolveFlags。
 */
export interface ResolveContext {
  readonly compatHeaderPath?: string;
  readonly macroHelperPath?: string;
  /** preparse header 列表（已解析 $(EngineRoot)）。Windows 用 /FI；其它平台用 -include。 */
  readonly preparseHeaders?: readonly string[];
  /** Windows SDK / MSVC 渲染后的字面串（来自 windowsSdk.renderClangdFlags）。 */
  readonly systemIncludeFlags?: readonly string[];
  /** Intermediate/.../Inc/UHT 目录绝对路径列表。 */
  readonly intermediateUhtDirs?: readonly string[];
}

/**
 * UI 可见的常量表。
 *
 * ⚠️ MSVC warning flag 全部不列入（由 baseline 集中产出，避免 UI 过载与误操作）。
 *    包括：/X、/imsvc<...>、-fms-compatibility-version= 来自 systemInclude category，
 *    但它们的"暴露"由系统强制写出，不入 glossary。
 *
 * 当前覆盖：
 *   - forced-include：compat-header、macro-helper
 *   - standard：/std:c++20
 *   - preparse：preparse-headers (单条目，渲染时按 preparseHeaders[] 多路展开)
 *   - uht-include：uht-include (单条目，渲染时按 intermediateUhtDirs[] 展开为多行 /I<dir>)
 */
export const DEFAULT_FLAG_GLOSSARY: readonly FlagEntry[] = [
  {
    id: 'compat-header',
    category: 'forced-include',
    title: '强制包含 UE Clangd 兼容头',
    description:
      '通过 /FI 在每个 TU 起始处强制包含插件生成的 ueClangdCompat.h，提供 UE 反射宏（UCLASS / UPROPERTY / UFUNCTION 等）的兼容定义。' +
      '关闭后补全会大量缺失，但如果你主要写非反射代码可关闭。',
    severity: 'recommended',
  },
  {
    id: 'macro-helper',
    category: 'forced-include',
    title: '强制包含宏补全 helper',
    description:
      '通过 /FI 强制包含 macroCompletionHelper.h，提供额外宏补全。该文件已被 preparse 列表替代，功能上是冗余。' +
      '为兼容可能的手动修改保留。',
    severity: 'optional',
  },
  {
    id: 'std-cxx20',
    category: 'standard',
    title: 'C++20 标准（/std:c++20）',
    description:
      '指定 clangd 按 C++20 标准解析。UE 5.x 大量使用 C++20 概念与 requires 表达式，关闭可能造成大量 false-positive。',
    severity: 'recommended',
  },
  {
    id: 'preparse-headers',
    category: 'preparse',
    title: '预解析头（-include 列表）',
    description:
      '把若干 SharedPCH + addMacroCompletions.h 当作已包含，使 UE 反射宏在补全阶段就被识别。' +
      '每条 header 会展开为一个 flag；Windows 平台为 /FI<PATH>，其他平台为 -include <PATH>。',
    severity: 'recommended',
  },
  {
    id: 'uht-include-dirs',
    category: 'uht-include',
    title: 'UHT 生成头目录（/I）',
    description:
      '把 Intermediate/Build/.../Inc/<Module>/UHT 目录通过 /I 注入，让 plugin .cpp 能找到 .generated.h。' +
      '每个目录展开为一行 /I<PATH>。',
    severity: 'recommended',
  },
];

/**
 * 根据 id 在词条表中查找。
 * UI 端校验用，运行时 resolve 也内部复用。
 */
export function findFlagEntry(id: string): FlagEntry | undefined {
  return DEFAULT_FLAG_GLOSSARY.find((e) => e.id === id);
}

/**
 * 把勾选 id 数组 + 动态路径 context 解析为最终 .clangd Add 字面串数组。
 *
 * 行为约定：
 *   - 未知 id 静默跳过（向前兼容：将来 glossary 删某条目不会让已存配置炸错）
 *   - 动态 id（preparse-headers / uht-include-dirs）若 ctx 对应字段为空则不产生 flag
 *   - prepareIncludes 的"systemIncludeFlags"通过 ctx.systemIncludeFlags 整体注入，
 *     即一个 id 'system-include-windows' 由调用方在拿到 SDK flag 后包装并 push 到 ids
 *
 * ⚠️ windows SDK flag（/X、/imsvc、-fms-compatibility-version=）按设计**不暴露**给 UI，
 *    它们由 setSystemIncludes 命令强制写入，不进入 glossary。
 *    因此本函数不处理 windowsSdk 渲染逻辑——调用方在外部组装 ids 时直接带 'system-include-windows'。
 */
export function resolveFlags(
  ids: readonly string[],
  ctx: ResolveContext = {},
): string[] {
  const out: string[] = [];

  // 处理 dynamic id（无对应 FlagEntry 但语义已知）
  // 这里保持 glossary-only：dynamic id 在调用方构造并附带数据后传入
  // 例如 'system-include-windows' 已在 caller 把 systemIncludeFlags 展开后并入 ids

  for (const id of ids) {
    // [Phase 自定义] windows SDK 整体一组
    if (id === 'system-include-windows') {
      if (ctx.systemIncludeFlags && ctx.systemIncludeFlags.length > 0) {
        out.push(...ctx.systemIncludeFlags);
      }
      continue;
    }

    // glossary 中存在的 id
    const entry = findFlagEntry(id);
    if (!entry) {
      // 未知 id：静默跳过
      continue;
    }

    switch (id) {
      case 'compat-header': {
        if (ctx.compatHeaderPath) {
          out.push(`/FI${ctx.compatHeaderPath}`);
        }
        break;
      }
      case 'macro-helper': {
        if (ctx.macroHelperPath) {
          out.push(`/FI${ctx.macroHelperPath}`);
        }
        break;
      }
      case 'std-cxx20': {
        const std = process.platform === 'win32' ? '/std:c++20' : '-std=c++20';
        out.push(std);
        break;
      }
      case 'preparse-headers': {
        const headers = ctx.preparseHeaders ?? [];
        out.push(...preparseAsFlags(headers));
        break;
      }
      case 'uht-include-dirs': {
        const dirs = ctx.intermediateUhtDirs ?? [];
        const prefix = process.platform === 'win32' ? '/I' : '-I';
        for (const dir of dirs) {
          out.push(`${prefix}${dir}`);
        }
        break;
      }
      default:
        // 词条存在但 resolveFlags 暂未实现（例如未来新增 category 但未跟进）
        break;
    }
  }

  return out;
}

/**
 * 把 preparse header 列表按平台转成 .clangd Add flag。
 * 与 preparseIncludes.toIncludeFlags 行为一致；为避免循环依赖，本函数独立实现。
 */
function preparseAsFlags(headers: readonly string[]): string[] {
  if (headers.length === 0) {
    return [];
  }
  if (process.platform === 'win32') {
    return headers.map((h) => `/FI${h}`);
  }
  const out: string[] = [];
  for (const h of headers) {
    out.push('-include', h);
  }
  return out;
}

/**
 * 平台无关的 fixed list，用于在控制面板 webview 端注入的常量数据
 * （避免 webview 调用 resolveFlags、避免传播 dynamic ctx 路径）。
 */
export interface WireFlagEntry {
  readonly id: string;
  readonly category: FlagCategory;
  readonly title: string;
  readonly description: string;
  readonly severity: FlagSeverity;
}

export function getGlossaryForWebview(): readonly WireFlagEntry[] {
  return DEFAULT_FLAG_GLOSSARY.map((e) => ({
    id: e.id,
    category: e.category,
    title: e.title,
    description: e.description,
    severity: e.severity,
  }));
}
