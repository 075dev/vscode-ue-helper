/**
 * completionFiles —— 管理 clangd 补全头文件
 *
 * 参考 unreal-clangd (boocs/unreal-clangd v3) 的 src/modules/completionFiles.ts，
 * 使用 curated header 系统提供 UE 代码补全，而非扫描 UHT 生成的 .generated.h。
 *
 * 在 .vscode/vscodeuehelper/ 下创建 6 个文件：
 *   completionHelper.cpp    — 编译单元，被加入 compile_commands.json
 *   defaultCompletions.h    — 核心 UE PCH 头（不可编辑）
 *   addCompletions.h        — 用户可添加非宏补全头文件
 *   macroCompletionHelper.h — 被 .clangd 的 -include 引用，控制宏补全
 *   addMacroCompletions.h   — 精选 30+ UE 宏头文件，托管刷新 + 用户区保留
 *   ueClangdCompat.h        — UE + clangd 兼容层
 *
 * 原理：
 *   clangd 的代码补全分两种：
 *     1) 非宏补全（类名、函数签名等）— 通过 compile_commands.json 自然发现
 *     2) 宏补全（UPROPERTY、UFUNCTION 等）— 需要用 -include 预包含宏定义头
 *
 *   本模块的 macroCompletionHelper.h 包含 addMacroCompletions.h，
 *   后者包含 ObjectMacros.h / LogMacros.h 等定义 UE 宏的头文件。
 *   在 slow 模式下，.clangd 的 CompileFlags.Add 会添加：
 *     -include <项目>/.vscode/vscodeuehelper/macroCompletionHelper.h
 *   这样 clangd 就能在任意 .cpp 中补全 UE 宏。
 *
 * 托管区域刷新（T3）：
 *   addMacroCompletions.h 使用 MANAGED/USER 区域标记：
 *     - MANAGED 区由扩展自动生成/刷新，不可手动编辑
 *     - USER 区供用户添加自定义 include，刷新时保留
 *     - 无标记的旧文件会被安全迁移：原内容移入 USER 区，MANAGED 区追加当前内容
 *
 * 主要导出：
 *   - createCompletionFiles: 创建/刷新补全文件
 *   - addCompletionHelperToCompileCommands: 把 completionHelper.cpp 加入 compile_commands.json
 *   - getMacroCompletionHelperPath: 返回 macroCompletionHelper.h 的绝对路径（供 .clangd 引用）
 *   - FILENAME_*: 文件名常量
 *   - MANAGED_BEGIN_MARKER 等: 托管区域标记常量
 *   - parseManagedRegions / buildManagedFile: 区域解析/组装工具
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EOL } from 'node:os';
import {
  FILENAME_UE_CLANGD_COMPAT,
  getUeClangdCompatContent,
} from '@clangd/ueClangdCompat';

// ---- 文件名常量 ----

export const FILENAME_COMPLETION_HELPER = 'completionHelper.cpp';
export const FILENAME_DEFAULT_COMP = 'defaultCompletions.h';
export const FILENAME_ADD_COMPLETIONS = 'addCompletions.h';
export const FILENAME_MACRO_COMP_HELPER = 'macroCompletionHelper.h';
export const FILENAME_ADD_MACRO_COMPLETIONS = 'addMacroCompletions.h';

/** .vscode/vscodeuehelper/ 目录（相对于项目根） */
const UNREAL_CLANGD_DIR = '.vscode/vscodeuehelper';

// ---- 托管区域标记 ----

/** 托管区起始标记：此标记之后为扩展自动生成的内容，刷新时会被替换 */
export const MANAGED_BEGIN_MARKER = '/* ==== VSCodeUEHelper MANAGED BEGIN (DO NOT EDIT) ==== */';

/** 托管区结束标记 */
export const MANAGED_END_MARKER = '/* ==== VSCodeUEHelper MANAGED END ==== */';

/** 用户区起始标记：此标记之后为用户自定义内容，刷新时保留 */
export const USER_BEGIN_MARKER = '/* ==== VSCodeUEHelper USER BEGIN ==== */';

/** 用户区结束标记 */
export const USER_END_MARKER = '/* ==== VSCodeUEHelper USER END ==== */';

/**
 * 托管区域解析结果。
 */
export interface ManagedRegions {
  /** 是否包含完整的 managed begin + end 标记 */
  hasManagedMarkers: boolean;
  /** 托管区内容（不含标记行） */
  managedContent: string;
  /** 用户区内容（不含标记行）；若无标记则为全文 */
  userContent: string;
}

/**
 * 解析文件内容中的托管/用户区域。
 *
 * 规则：
 *  - MANAGED_BEGIN → MANAGED_END 之间的内容为 managed 区。
 *  - USER_BEGIN → USER_END 之间的内容为 user 区。
 *  - 如果缺少任一标记对，hasManagedMarkers = false，userContent = 全文。
 *
 * 标记行本身不会出现在 managedContent 或 userContent 中。
 */
export function parseManagedRegions(content: string): ManagedRegions {
  const managedBeginIdx = content.indexOf(MANAGED_BEGIN_MARKER);
  const managedEndIdx = content.indexOf(MANAGED_END_MARKER);
  const userBeginIdx = content.indexOf(USER_BEGIN_MARKER);
  const userEndIdx = content.indexOf(USER_END_MARKER);

  // 需要四个标记都存在才算有效托管文件
  if (
    managedBeginIdx === -1 ||
    managedEndIdx === -1 ||
    userBeginIdx === -1 ||
    userEndIdx === -1
  ) {
    return { hasManagedMarkers: false, managedContent: '', userContent: content };
  }

  // managed 区：MANAGED_BEGIN 行尾 → MANAGED_END 行首
  const managedStart = managedBeginIdx + MANAGED_BEGIN_MARKER.length;
  const managedAfterNewline = content.indexOf('\n', managedStart);
  const managedContentStart = managedAfterNewline === -1 ? managedStart : managedAfterNewline + 1;
  const managedContentEnd = managedEndIdx;
  const managedContent = content.slice(managedContentStart, managedContentEnd).trimEnd();

  // user 区：USER_BEGIN 行尾 → USER_END 行首
  const userStart = userBeginIdx + USER_BEGIN_MARKER.length;
  const userAfterNewline = content.indexOf('\n', userStart);
  const userContentStart = userAfterNewline === -1 ? userStart : userAfterNewline + 1;
  const userContentEnd = userEndIdx;
  const userContent = content.slice(userContentStart, userContentEnd).trimEnd();

  return { hasManagedMarkers: true, managedContent, userContent };
}

/**
 * 将托管内容和用户内容组装为完整的文件内容。
 *
 * 格式：
 *   MANAGED_BEGIN_MARKER
 *   <managedContent>
 *   MANAGED_END_MARKER
 *   (空行)
 *   USER_BEGIN_MARKER
 *   <userContent>
 *   USER_END_MARKER
 */
export function buildManagedFile(managedContent: string, userContent: string): string {
  const parts = [
    MANAGED_BEGIN_MARKER,
    managedContent.trimEnd(),
    MANAGED_END_MARKER,
    '',
    USER_BEGIN_MARKER,
    userContent.trimEnd(),
    USER_END_MARKER,
    '',
  ];
  return parts.join(EOL);
}

/**
 * 旧版 addMacroCompletions.h 样板头的第一行。
 *
 * 无标记迁移时只保留用户实际 include/注释，避免把旧样板说明重复塞进 USER 区。
 */
const ADD_MACRO_HEADER_TITLE = '* addMacroCompletions.h — 添加宏补全和非宏补全头文件';

/**
 * 从无标记旧文件中提取迁移到 USER 区的内容。
 *
 * 安全策略：
 *  - 旧版扩展样板头丢弃，避免升级后出现两套说明头。
 *  - 用户 include 与用户注释原样保留。
 *  - 损坏/半标记文件按普通用户内容迁移，最大化避免数据丢失。
 */
function extractLegacyUserContent(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const titleIndex = lines.findIndex((line) => line.trim() === ADD_MACRO_HEADER_TITLE);

  if (titleIndex === -1) {
    return content.trimEnd();
  }

  const headerEndIndex = lines.findIndex((line, index) => index > titleIndex && line.trim() === '*/');
  if (headerEndIndex === -1) {
    return content.trimEnd();
  }

  // allow: SIZE_OK — T3 只在既有 completionFiles 模块内实现区域迁移，避免为一个私有迁移流程引入新文件扩大范围。
  return lines.slice(headerEndIndex + 1).join('\n').trimStart().trimEnd();
}

/**
 * 使用当前生成的 managed 区内容刷新 addMacroCompletions.h。
 */
function refreshManagedMacroContent(existingContent: string, generatedContent: string): string {
  const generatedRegions = parseManagedRegions(generatedContent);
  const existingRegions = parseManagedRegions(existingContent);
  const userContent = existingRegions.hasManagedMarkers
    ? existingRegions.userContent
    : extractLegacyUserContent(existingContent);

  return generatedContent.replace(generatedRegions.userContent, userContent);
}

// ---- 文件内容生成器 ----

/**
 * completionHelper.cpp 的内容。
 */
function getCompletionHelperContent(): string {
  const doNotModify = [
    '/*',
    '* ***** DO NOT MODIFY *****',
    '* 此文件由 VSCodeUEHelper 自动生成，修改将在下次创建项目时被覆盖。',
    '* 如需添加非宏补全头文件，请编辑 addCompletions.h',
    '*/',
  ].join(EOL);
  const includes = [
    '#include "defaultCompletions.h"',
    '#include "addCompletions.h"',
  ].join(EOL);
  return doNotModify + EOL + EOL + includes + EOL;
}

/**
 * defaultCompletions.h 的内容。
 */
function getDefaultCompletionsContent(): string {
  const header = [
    '/*',
    '* ***** DO NOT MODIFY *****',
    '* 此文件由 VSCodeUEHelper 自动生成。',
    '* 包含 Unreal Engine 核心 PCH 头文件，提供基础代码补全。',
    '*',
    '* 如需添加自定义非宏补全头文件，请编辑 addCompletions.h',
    '* 如需添加宏补全头文件（UPROPERTY/UFUNCTION 等），请编辑 addMacroCompletions.h',
    '*',
    '* *** 注意：直接打开此文件会显示 IntelliSense 错误/警告 ***',
    '*/',
  ].join(EOL);
  const includes = [
    '#include "Runtime/Core/Public/CoreSharedPCH.h"',
    '#include "Runtime/CoreUObject/Public/CoreUObjectSharedPCH.h"',
    '#include "Runtime/Engine/Public/EngineSharedPCH.h"',
    '#include "Runtime/Slate/Public/SlateSharedPCH.h"',
    '#if WITH_EDITOR',
    '#include "Editor/UnrealEd/Public/UnrealEdSharedPCH.h"',
    '#endif',
  ].join(EOL);
  return header + EOL + EOL + includes + EOL;
}

/**
 * addCompletions.h 的内容（模板文件，不覆盖已有）。
 */
function getAddCompletionsContent(): string {
  const header = [
    '/*',
    '* addCompletions.h — 添加任意"非宏"补全头文件',
    '* 此文件中的 #include 会被 completionHelper.cpp 包含，',
    '* 从而被 clangd 索引。不会导致代码补全加载变慢。',
    '*',
    '* 用法：取消下面示例的注释，或添加自己的 #include 行。',
    '*',
    '* *** 注意：修改后需要重新加载文件或点击状态栏 UC 按钮两次才能使更改生效 ***',
    '* *** 注意：直接打开此文件会显示 IntelliSense 错误/警告 ***',
    '*/',
  ].join(EOL);
  const includes = [
    '',
    '// 示例：添加 KismetMathLibrary 的补全（默认不包含）',
    '// #include "Kismet/KismetMathLibrary.h"',
    '',
  ].join(EOL);
  return header + EOL + includes;
}

/**
 * addMacroCompletions.h 的内容（托管区域格式）。
 *
 * 文件结构：
 *   1. 文件头注释
 *   2. MANAGED_BEGIN → 自动生成区（30+ 精选 include + UE 宏签名 stub）
 *   3. MANAGED_END
 *   4. USER_BEGIN → 用户自定义区（示例注释，刷新时保留）
 *   5. USER_END
 *
 * 注意：此文件只影响 slow 模式（通过 macroCompletionHelper.h 间接引用）。
 */
export function getAddMacroCompletionsContent(): string {
  // ---- 文件头 ----
  const header = [
    '/*',
    '* addMacroCompletions.h — 添加宏补全和非宏补全头文件',
    '* 此文件中的 #include 在 slow 模式下被 clangd 预包含。',
    '* 添加更多头文件会**增加**代码补全加载时间。',
    '*',
    '* 提示：直接在源码中 #include 头文件也能获得该文件的所有补全（包括宏），',
    '* 所以通常只需在此添加常用但没直接 include 的模块头文件。',
    '*',
    '* ==== VSCodeUEHelper 托管文件 ====',
    '* MANAGED 区域由扩展自动生成/刷新，请勿手动编辑。',
    '* USER 区域供用户添加自定义 include，刷新时保留。',
    '*',
    '* *** 注意：修改后需要重新加载文件或点击状态栏 UC 按钮两次才能使更改生效 ***',
    '*',
    '* *** 注意：直接打开此文件会显示 IntelliSense 错误/警告 ***',
    '*/',
  ].join(EOL);

  // ---- 托管区内容 ----
  const managedLines = [
    '// ==== 常用 UE 宏头文件（30+ 精选，由 VSCodeUEHelper 自动生成） ====',
    '',
    '// -- 核心对象宏：UPROPERTY, UFUNCTION, UCLASS, USTRUCT, UENUM 等',
    '#include "UObject/ObjectMacros.h"',
    '',
    '// -- 日志宏：UE_LOG, DECLARE_LOG_CATEGORY_EXTERN 等',
    '#include "Logging/LogMacros.h"',
    '',
    '// -- 断言宏：check, ensure, verify, checkf 等',
    '#include "Misc/AssertionMacros.h"',
    '',
    '// -- 平台/构建宏：TEXT, UE_BUILD_SHIPPING, PLATFORM_* 等',
    '#include "HAL/Platform.h"',
    '#include "Misc/Build.h"',
    '',
    '// -- 废弃/代码分析宏：UE_DEPRECATED, PRAGMA_DISABLE_DEPRECATION_WARNINGS 等',
    '#include "Misc/CoreMiscDefines.h"',
    '#include "GenericPlatform/GenericPlatformCompilerPreSetup.h"',
    '',
    '// -- 委托宏：DECLARE_DELEGATE, DECLARE_MULTICAST_DELEGATE 等',
    '#include "Delegates/DelegateCombinations.h"',
    '',
    '// -- 网络复制宏：DOREPLIFETIME, DOREPLIFETIME_CONDITION 等',
    '#include "Net/UnrealNetwork.h"',
    '',
    '// -- 国际化宏：LOCTEXT, NSLOCTEXT 等',
    '#include "Internationalization/Internationalization.h"',
    '',
    '// -- 模块宏：IMPLEMENT_MODULE, IMPLEMENT_PRIMARY_GAME_MODULE 等',
    '#include "Modules/ModuleManager.h"',
    '',
    '// -- 统计宏：DECLARE_STATS_GROUP, SCOPE_CYCLE_COUNTER, QUICK_SCOPE_CYCLE_COUNTER 等',
    '#include "Stats/Stats.h"',
    '#include "Stats/StatsMisc.h"',
    '',
    '// -- 数学宏：各种数学常量和工具宏',
    '#include "Math/UnrealMathUtility.h"',
    '',
    '// -- 枚举位标志宏：ENUM_CLASS_FLAGS',
    '#include "Misc/EnumClassFlags.h"',
    '',
    '// -- 脚本相关宏：P_GET_*, PARAM_* 等',
    '#include "UObject/ScriptMacros.h"',
    '#include "UObject/Script.h"',
    '',
    '// -- Trace/Profiling 宏：UE_TRACE_*, CSV_*, TRACE_*',
    '#include "Trace/Trace.h"',
    '#include "ProfilingDebugging/CpuProfilerTrace.h"',
    '#include "ProfilingDebugging/CsvProfiler.h"',
    '',
    '// -- Network/Iris 序列化宏',
    '#include "Iris/ReplicationState/PropertyNetSerializerInfoRegistry.h"',
    '',
    '// -- GameplayTags 宏：UE_DEFINE_GAMEPLAY_TAG 等',
    '#include "NativeGameplayTags.h"',
    '',
    '// -- 碰撞查询宏：SCENE_QUERY_STAT',
    '#include "CollisionQueryParams.h"',
    '',
    '// -- 调试绘制宏：ENABLE_DRAW_DEBUG',
    '#include "DrawDebugHelpers.h"',
    '',
    '// -- 在线相关宏：MAX_LOCAL_PLAYERS',
    '#include "Online/CoreOnline.h"',
    '',
    '// -- 虚拟函数/纯虚函数宏：PURE_VIRTUAL',
    '#include "HAL/MemoryMisc.h"',
    '',
    '// ==== UE 宏签名 stub（供 clangd 在 slow 模式下提供参数补全 + 悬停提示）====',
    '// 原理：UE 宏是开放的 variadic，clangd 即使 include 引擎头文件也无法推断参数。',
    '// 社区做法是手写 __attribute__((annotate(...))) + inline 空声明作为 stub，',
    '// clangd 只看 token 不执行宏，因此能看到这些 stub 并据此提供 SignatureHelp 和 Hover。',
    '// 这些声明不参与真实编译，仅用于 clangd 解析。',
    '',
    '// -- UFUNCTION(Specifier, ...) 常见参数',
    '__attribute__((annotate("UFUNCTION: BlueprintPure, BlueprintCallable, Category, meta, ..."))) inline void UE_UFUNCTION_Stub_BlueprintPure();',
    '__attribute__((annotate("UFUNCTION: BlueprintCallable, Category, meta, ..."))) inline void UE_UFUNCTION_Stub_BlueprintCallable();',
    '__attribute__((annotate("UFUNCTION: Category=\\"...\\", meta=(...)"))) inline void UE_UFUNCTION_Stub_Category(const char* InCategory);',
    '__attribute__((annotate("UFUNCTION: meta=(DisplayName, Keywords, ...)"))) inline void UE_UFUNCTION_Stub_meta(const char* InMeta);',
    '',
    '// -- UPROPERTY(Specifier, ...) 常见参数',
    '__attribute__((annotate("UPROPERTY: EditAnywhere, BlueprintReadWrite, Category, meta, ..."))) inline void UE_UPROPERTY_Stub_EditAnywhere();',
    '__attribute__((annotate("UPROPERTY: BlueprintReadWrite, Category, meta, ..."))) inline void UE_UPROPERTY_Stub_BlueprintReadWrite();',
    '__attribute__((annotate("UPROPERTY: Category=\\"...\\", meta=(...)"))) inline void UE_UPROPERTY_Stub_Category(const char* InCategory);',
    '',
    '// -- UCLASS(Specifier, ...) 常见参数',
    '__attribute__((annotate("UCLASS: ClassGroup=\\"...\\", meta=(...), BlueprintType, ..."))) inline void UE_UCLASS_Stub_ClassGroup(const char* InGroup);',
    '__attribute__((annotate("UCLASS: meta=(...), BlueprintType, ..."))) inline void UE_UCLASS_Stub_meta(const char* InMeta);',
    '',
    '// -- USTRUCT(Specifier, ...) 常见参数',
    '__attribute__((annotate("USTRUCT: BlueprintType, meta=(...), ..."))) inline void UE_USTRUCT_Stub();',
    '',
    '// -- UENUM(Specifier, ...) 常见参数',
    '__attribute__((annotate("UENUM: BlueprintType, meta=(...), ..."))) inline void UE_UENUM_Stub_BlueprintType();',
    '',
    '// -- UMETA(...) 常见参数',
    '__attribute__((annotate("UMETA: DisplayName=\\"...\\", ToolTip=\\"...\\", ..."))) inline void UE_UMETA_Stub();',
    '',
  ];

  const managedContent = managedLines.join(EOL);

  // ---- 用户区内容（示例注释，刷新时保留） ----
  const userLines = [
    '// ==== 用户自定义宏补全（示例，取消注释以启用） ====',
    '',
    '// ***** 模块: GameplayAbilities *****',
    '// #include "AttributeSet.h"  // GAMEPLAYATTRIBUTE_PROPERTY_GETTER, GAMEPLAYATTRIBUTE_VALUE_GETTER 等',
    '',
    '// ***** 模块: CQTest (自动化测试) *****',
    '// #include "CQTest.h"  // AFTER_EACH, BEFORE_EACH, TEST_CLASS_WITH_BASE_AND_FLAGS 等',
    '',
  ];

  const userContent = userLines.join(EOL);

  return header + EOL + EOL + buildManagedFile(managedContent, userContent);
}

// ---- 路径工具函数 ----

/**
 * 返回项目的 .vscode/vscodeuehelper/ 目录的绝对路径。
 */
function getUnrealClangdDir(projectPath: string): string {
  return path.join(path.dirname(projectPath), UNREAL_CLANGD_DIR);
}

/**
 * 返回 macroCompletionHelper.h 的绝对路径。
 */
export function getMacroCompletionHelperPath(projectPath: string): string {
  return path.join(getUnrealClangdDir(projectPath), FILENAME_MACRO_COMP_HELPER);
}

/**
 * 返回 completionHelper.cpp 的绝对路径。
 */
export function getCompletionHelperPath(projectPath: string): string {
  return path.join(getUnrealClangdDir(projectPath), FILENAME_COMPLETION_HELPER);
}

// ---- 主要导出函数 ----

/**
 * 在 .vscode/vscodeuehelper/ 下创建/刷新补全文件。
 *
 * 安全策略：
 *   - completionHelper.cpp / defaultCompletions.h / macroCompletionHelper.h / ueClangdCompat.h：
 *     每次都覆盖（这些由扩展管理）。
 *   - addCompletions.h：
 *     仅在不存在时创建模板（保留用户编辑，纯用户文件）。
 *   - addMacroCompletions.h（托管刷新）：
 *     如果已存在且包含 MANAGED/USER 标记 → 替换 MANAGED 区，保留 USER 区。
 *     如果已存在但无标记（旧版本） → 原内容移入 USER 区，MANAGED 区写入当前内容。
 *     如果不存在 → 创建新文件。
 *
 * @returns 创建的每个文件的信息数组
 */
export async function createCompletionFiles(
  projectPath: string,
): Promise<{ name: string; path: string; created: boolean }[]> {
  const dir = getUnrealClangdDir(projectPath);
  await fs.mkdir(dir, { recursive: true });

  const results: { name: string; path: string; created: boolean }[] = [];

  // 1) 纯覆盖文件
  //    Plan B: 模式合并后 macroCompletionHelper.h 成为冗余间接层
  //    （它只 #include "addMacroCompletions.h"，后者已通过 preparse 直接包含）。
  //    跳过生成该文件；已存在的旧文件不动（用户升级后保留无害）。
  const overwriteDefs: { name: string; content: string }[] = [
    { name: FILENAME_COMPLETION_HELPER, content: getCompletionHelperContent() },
    { name: FILENAME_DEFAULT_COMP, content: getDefaultCompletionsContent() },
    { name: FILENAME_UE_CLANGD_COMPAT, content: getUeClangdCompatContent() },
  ];

  for (const def of overwriteDefs) {
    const filePath = path.join(dir, def.name);
    await fs.writeFile(filePath, def.content, 'utf-8');
    results.push({ name: def.name, path: filePath, created: true });
  }

  // 2) addCompletions.h：仅首次创建
  const addCompletionsPath = path.join(dir, FILENAME_ADD_COMPLETIONS);
  try {
    await fs.access(addCompletionsPath);
    // 已存在，不覆盖
    results.push({ name: FILENAME_ADD_COMPLETIONS, path: addCompletionsPath, created: false });
  } catch {
    await fs.writeFile(addCompletionsPath, getAddCompletionsContent(), 'utf-8');
    results.push({ name: FILENAME_ADD_COMPLETIONS, path: addCompletionsPath, created: true });
  }

  // 3) addMacroCompletions.h：托管刷新
  const macroPath = path.join(dir, FILENAME_ADD_MACRO_COMPLETIONS);
  const generatedMacroContent = getAddMacroCompletionsContent();

  try {
    const existing = await fs.readFile(macroPath, 'utf-8');
    const refreshed = refreshManagedMacroContent(existing, generatedMacroContent);
    await fs.writeFile(macroPath, refreshed, 'utf-8');
    // 已存在，非首次创建
    results.push({ name: FILENAME_ADD_MACRO_COMPLETIONS, path: macroPath, created: false });
  } catch {
    // 文件不存在，创建新文件
    await fs.writeFile(macroPath, generatedMacroContent, 'utf-8');
    results.push({ name: FILENAME_ADD_MACRO_COMPLETIONS, path: macroPath, created: true });
  }

  return results;
}

// ---- compile_commands.json 集成 ----

/**
 * 把 completionHelper.cpp 作为新条目添加到 compile_commands.json 中。
 */
export async function addCompletionHelperToCompileCommands(
  projectPath: string,
  ccJsonPath?: string,
): Promise<boolean> {
  const projectDir = path.dirname(projectPath);
  const ccPath = ccJsonPath ?? path.join(projectDir, 'compile_commands.json');
  const helperPath = getCompletionHelperPath(projectPath);

  let entries: Array<Record<string, unknown>>;

  try {
    const text = await fs.readFile(ccPath, 'utf-8');
    entries = JSON.parse(text) as Array<Record<string, unknown>>;
    if (!Array.isArray(entries) || entries.length === 0) {
      return false;
    }
  } catch {
    return false;
  }

  const normalizedHelper = helperPath.replace(/\\/g, '/');
  if (entries.some((e) => String(e.file ?? '').replace(/\\/g, '/') === normalizedHelper)) {
    return true;
  }

  const template = { ...entries[0] };
  template.file = helperPath;

  if (typeof template.command === 'string') {
    const oldFile = entries[0]?.file as string | undefined;
    if (oldFile) {
      template.command = template.command.replace(oldFile, helperPath);
    }
  }

  entries.push(template);

  await fs.writeFile(ccPath, JSON.stringify(entries, null, 2), 'utf-8');
  return true;
}
