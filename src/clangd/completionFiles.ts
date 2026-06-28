/**
 * completionFiles —— 管理 clangd 补全头文件
 *
 * 参考 unreal-clangd (boocs/unreal-clangd v3) 的 src/modules/completionFiles.ts，
 * 使用 curated header 系统提供 UE 代码补全，而非扫描 UHT 生成的 .generated.h。
 *
 * 在 .vscode/vscodeuehelper/ 下创建 5 个文件：
 *   completionHelper.cpp    — 编译单元，被加入 compile_commands.json
 *   defaultCompletions.h    — 核心 UE PCH 头（不可编辑）
 *   addCompletions.h        — 用户可添加非宏补全头文件
 *   macroCompletionHelper.h — 被 .clangd 的 -include 引用，控制宏补全
 *   addMacroCompletions.h   — 精选 30+ UE 宏头文件，用户可添加自定义
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
 * 主要导出：
 *   - createCompletionFiles: 创建 5 个补全文件
 *   - addCompletionHelperToCompileCommands: 把 completionHelper.cpp 加入 compile_commands.json
 *   - getMacroCompletionHelperPath: 返回 macroCompletionHelper.h 的绝对路径（供 .clangd 引用）
 *   - FILENAME_*: 文件名常量
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EOL } from 'node:os';

// ---- 文件名常量 ----

export const FILENAME_COMPLETION_HELPER = 'completionHelper.cpp';
export const FILENAME_DEFAULT_COMP = 'defaultCompletions.h';
export const FILENAME_ADD_COMPLETIONS = 'addCompletions.h';
export const FILENAME_MACRO_COMP_HELPER = 'macroCompletionHelper.h';
export const FILENAME_ADD_MACRO_COMPLETIONS = 'addMacroCompletions.h';

/** .vscode/vscodeuehelper/ 目录（相对于项目根） */
const UNREAL_CLANGD_DIR = '.vscode/vscodeuehelper';

// ---- 文件内容生成器 ----

/**
 * completionHelper.cpp 的内容。
 * 它是一个编译单元，include 基础补全 + 用户自定义。
 * 会被加入到 compile_commands.json 中，让 clangd 索引这些头文件。
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
    `#include "defaultCompletions.h"`,
    `#include "addCompletions.h"`,
  ].join(EOL);
  return `${doNotModify}${EOL}${EOL}${includes}${EOL}`;
}

/**
 * defaultCompletions.h 的内容。
 * 包含 UE 核心 PCH 头，提供基础符号补全（类名、函数等）。
 * 这些头文件覆盖了 UE 引擎的最常用模块。
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
  // SharedPCH 顺序按 UE 模块依赖链：Core → CoreUObject → Engine → Slate → UnrealEd
  // UnrealEdSharedPCH 是 Editor-only，用 #if WITH_EDITOR 包裹（Game-only 项目不会编译 Editor 模块）
  const includes = [
    '#include "Runtime/Core/Public/CoreSharedPCH.h"',
    '#include "Runtime/CoreUObject/Public/CoreUObjectSharedPCH.h"',
    '#include "Runtime/Engine/Public/EngineSharedPCH.h"',
    '#include "Runtime/Slate/Public/SlateSharedPCH.h"',
    '#if WITH_EDITOR',
    '#include "Editor/UnrealEd/Public/UnrealEdSharedPCH.h"',
    '#endif',
  ].join(EOL);
  return `${header}${EOL}${EOL}${includes}${EOL}`;
}

/**
 * addCompletions.h 的内容（模板文件，不覆盖已有）。
 * 用户可以在这里添加任何需要非宏补全的头文件。
 * 不会造成代码补全加载变慢。
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
  return `${header}${EOL}${includes}`;
}

/**
 * macroCompletionHelper.h 的内容（会被覆盖）。
 * 在 slow 模式下，.clangd 通过 -include 引用此文件。
 * 它包含 addMacroCompletions.h，后者包含所有 UE 宏定义头文件。
 *
 * 注意：此文件本身包含 defaultCompletions.h 的引用被注释掉了，
 * 因为 defaultCompletions.h 已经通过 completionHelper.cpp 加载。
 * 取消注释会重复加载但不影响功能。
 */
function getMacroCompletionsHelperContent(): string {
  const header = [
    '/*',
    '* ***** DO NOT MODIFY *****',
    '* 此文件由 VSCodeUEHelper 自动生成，修改将被覆盖。',
    '* 如需添加宏补全头文件，请编辑 addMacroCompletions.h',
    '*',
    '* 此文件在 slow 模式下被 .clangd 通过 -include 预包含。',
    '*',
    '* *** 注意：直接打开此文件会显示 IntelliSense 错误/警告 ***',
    '*/',
  ].join(EOL);
  const includes = [
    '// #include "defaultCompletions.h"  // 已通过 completionHelper.cpp 加载',
    '#include "addMacroCompletions.h"',
  ].join(EOL);
  return `${header}${EOL}${EOL}${includes}${EOL}`;
}

/**
 * addMacroCompletions.h 的内容（模板文件，不覆盖已有）。
 * 包含 30+ 个 UE 宏定义头文件，覆盖 UPROPERTY、UFUNCTION、UE_LOG 等常用宏。
 * 用户可以添加自定义的宏头文件。
 *
 * 注意：此文件只影响 slow 模式（通过 macroCompletionHelper.h 间接引用）。
 */
function getAddMacroCompletionsContent(): string {
  const noWorkTill = [
    '* *** 注意：修改后需要重新加载文件或点击状态栏 UC 按钮两次才能使更改生效 ***',
  ].join(EOL);
  const willHaveErrors = [
    '* *** 注意：直接打开此文件会显示 IntelliSense 错误/警告 ***',
  ].join(EOL);

  const lines = [
    '/*',
    '* addMacroCompletions.h — 添加宏补全和非宏补全头文件',
    '* 此文件中的 #include 在 slow 模式下被 clangd 预包含。',
    '* 添加更多头文件会**增加**代码补全加载时间。',
    '*',
    '* 提示：直接在源码中 #include 头文件也能获得该文件的所有补全（包括宏），',
    '* 所以通常只需在此添加常用但没直接 include 的模块头文件。',
    '*',
    noWorkTill,
    '*',
    willHaveErrors,
    '*/',
    '',
    '// ==== 常用 UE 宏头文件（30+ 精选） ====',
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
    '// ==== 用户自定义宏补全（示例，取消注释以启用） ====',
    '',
    '// ***** 模块: GameplayAbilities *****',
    '// #include "AttributeSet.h"  // GAMEPLAYATTRIBUTE_PROPERTY_GETTER, GAMEPLAYATTRIBUTE_VALUE_GETTER 等',
    '',
    '// ***** 模块: CQTest (自动化测试) *****',
    '// #include "CQTest.h"  // AFTER_EACH, BEFORE_EACH, TEST_CLASS_WITH_BASE_AND_FLAGS 等',
    '',
  ];

  return lines.join(EOL) + EOL;
}

// ---- 路径工具函数 ----

/**
 * 返回项目的 .vscode/vscodeuehelper/ 目录的绝对路径。
 * projectPath 是 .uproject 的绝对路径，项目根 = path.dirname(projectPath)。
 */
function getUnrealClangdDir(projectPath: string): string {
  return path.join(path.dirname(projectPath), UNREAL_CLANGD_DIR);
}

/**
 * 返回 macroCompletionHelper.h 的绝对路径。
 * 供 .clangd 的 -include 标志使用。
 */
export function getMacroCompletionHelperPath(projectPath: string): string {
  return path.join(getUnrealClangdDir(projectPath), FILENAME_MACRO_COMP_HELPER);
}

/**
 * 返回 completionHelper.cpp 的绝对路径。
 * 供 compile_commands.json 新增条目使用。
 */
export function getCompletionHelperPath(projectPath: string): string {
  return path.join(getUnrealClangdDir(projectPath), FILENAME_COMPLETION_HELPER);
}

// ---- 主要导出函数 ----

/**
 * 在 .vscode/vscodeuehelper/ 下创建 5 个补全文件。
 *
 * 安全策略：
 *   - completionHelper.cpp / defaultCompletions.h / macroCompletionHelper.h：
 *     每次都覆盖（这些由扩展管理）。
 *   - addCompletions.h / addMacroCompletions.h：
 *     仅在不存在时创建模板（保留用户编辑）。
 *
 * @returns 创建的每个文件的信息数组
 */
export async function createCompletionFiles(
  projectPath: string,
): Promise<{ name: string; path: string; created: boolean }[]> {
  const dir = getUnrealClangdDir(projectPath);
  await fs.mkdir(dir, { recursive: true });

  const fileDefs: { name: string; content: string; overwrite: boolean }[] = [
    { name: FILENAME_COMPLETION_HELPER, content: getCompletionHelperContent(), overwrite: true },
    { name: FILENAME_DEFAULT_COMP, content: getDefaultCompletionsContent(), overwrite: true },
    { name: FILENAME_ADD_COMPLETIONS, content: getAddCompletionsContent(), overwrite: false },
    { name: FILENAME_MACRO_COMP_HELPER, content: getMacroCompletionsHelperContent(), overwrite: true },
    { name: FILENAME_ADD_MACRO_COMPLETIONS, content: getAddMacroCompletionsContent(), overwrite: false },
  ];

  const results: { name: string; path: string; created: boolean }[] = [];

  for (const def of fileDefs) {
    const filePath = path.join(dir, def.name);
    let created = false;

    if (def.overwrite) {
      await fs.writeFile(filePath, def.content, 'utf-8');
      created = true;
    } else {
      try {
        await fs.access(filePath);
        // 文件已存在，不覆盖
      } catch {
        await fs.writeFile(filePath, def.content, 'utf-8');
        created = true;
      }
    }

    results.push({ name: def.name, path: filePath, created });
  }

  return results;
}

// ---- compile_commands.json 集成 ----

/**
 * 把 completionHelper.cpp 作为新条目添加到 compile_commands.json 中。
 *
 * 做法：复制已有条目的结构（directory / arguments / command），
 * 替换 file 为 completionHelper.cpp 的路径。
 *
 * 如果 compile_commands.json 不存在或为空，则跳过（先运行 generateCompileCommands）。
 *
 * @param projectPath .uproject 的绝对路径
 * @param ccJsonPath compile_commands.json 的路径（可选，默认 projectDir/compile_commands.json）。由 generateCompileCommands 返回。
 * @returns true 表示成功添加（或已存在），false 表示跳过
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

  // 检查是否已经存在 completionHelper.cpp 的条目
  const normalizedHelper = helperPath.replace(/\\/g, '/');
  if (entries.some((e) => String(e.file ?? '').replace(/\\/g, '/') === normalizedHelper)) {
    return true; // 已存在
  }

  // 复制第一个条目作为模板
  const template = { ...entries[0] };
  template.file = helperPath;

  // 如果模板用 command 而非 arguments，保持一致性
  if (typeof template.command === 'string') {
    // command 中包含了 file 路径，需要替换
    const oldFile = entries[0]?.file as string | undefined;
    if (oldFile) {
      template.command = template.command.replace(oldFile, helperPath);
    }
  }

  entries.push(template);

  await fs.writeFile(ccPath, JSON.stringify(entries, null, 2), 'utf-8');
  return true;
}

// ---- 向后兼容：保留 populateAddCompletions（已废弃的 .generated.h 扫描方式） ----
// 保留原有导出，避免破坏现有调用方。标记为 @deprecated。

/**
 * @deprecated 请使用 createCompletionFiles() 代替。
 * 旧的 .generated.h 扫描方式已废弃。
 */
export interface PopulateOptions {
  projectPath: string;
  overwrite?: boolean;
}

/**
 * @deprecated 请使用 createCompletionFiles() 代替。
 */
export interface PopulateResult {
  filePath: string;
  added: number;
  skipped: number;
  found: number;
}

/**
 * @deprecated 请使用 createCompletionFiles() 代替。
 * 旧的实现扫描 Intermediate/Build 中的 .generated.h，已不再推荐。
 * 现在直接返回 mock 结果。
 */
export async function populateAddCompletions(opts: PopulateOptions): Promise<PopulateResult> {
  // 确保目录存在并调用新的系统
  await createCompletionFiles(opts.projectPath);

  const dir = getUnrealClangdDir(opts.projectPath);
  return {
    filePath: path.join(dir, FILENAME_ADD_COMPLETIONS),
    added: 0,
    skipped: 0,
    found: 0,
  };
}

/**
 * @deprecated 请使用 createCompletionFiles() 代替。
 */
export function findUhtGeneratedHeaders(_projectPath: string): string[] {
  return [];
}

/**
 * @deprecated 请使用 createCompletionFiles() 代替。
 */
export function parseExistingIncludes(_filePath: string): string[] {
  return [];
}
