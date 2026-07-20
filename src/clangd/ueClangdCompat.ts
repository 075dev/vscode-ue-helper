/**
 * ueClangdCompat —— UE + clangd 兼容层
 *
 * 提供一个独立兼容头 ueClangdCompat.h，在所有 UE 头被 include 之前
 * 重写 BODY_MACRO_COMBINE 宏，让 UCLASS() / GENERATED_BODY() 在
 * .generated.h 过期/缺失时仍能展开为合法 C++，解决 clangd 报的
 * unknown_typename 错误以及后续代码补全失效。
 *
 * 原理：
 *   UE 的 GENERATED_BODY() 展开依赖 BODY_MACRO_COMBINE，
 *   而 BODY_MACRO_COMBINE 定义在 .generated.h 中。
 *   当 .generated.h 过期/缺失时，BODY_MACRO_COMBINE 未定义，
 *   导致 UCLASS() 展开失败 → unknown_typename。
 *
 *   本兼容头通过 /FI 强制在所有其他 include 之前被包含，
 *   先 #undef 再 #define BODY_MACRO_COMBINE 为 UE_CLANGD_COMPAT_BODY，
 *   保证 clangd 总能正确解析 UCLASS() / GENERATED_BODY()。
 *
 * 注意：
 *   - 此兼容头仅用于 clangd 索引，不影响实际编译（编译器用真正的 .generated.h）
 *   - stub body 只包含 friend struct + static UClass*，不引入 DECLARE_CLASS 等反射宏
 */
import * as path from 'node:path';
import { EOL } from 'node:os';

/** .vscode/vscodeuehelper/ 目录（相对于项目根） */
const UNREAL_CLANGD_DIR = '.vscode/vscodeuehelper';

/** ueClangdCompat.h 文件名常量 */
export const FILENAME_UE_CLANGD_COMPAT = 'ueClangdCompat.h';

/**
 * 返回项目的 .vscode/vscodeuehelper/ 目录的绝对路径。
 * projectPath 是 .uproject 的绝对路径，项目根 = path.dirname(projectPath)。
 */
export function getUeClangdCompatDir(projectPath: string): string {
  return path.join(path.dirname(projectPath), UNREAL_CLANGD_DIR);
}

/**
 * 返回 ueClangdCompat.h 的绝对路径。
 * 供 .clangd 的 /FI 标志使用。
 */
export function getUeClangdCompatPath(projectPath: string): string {
  return path.join(getUeClangdCompatDir(projectPath), FILENAME_UE_CLANGD_COMPAT);
}

/**
 * 生成 ueClangdCompat.h 的内容。
 *
 * 内容结构：
 *   1. 文件头注释
 *   2. #pragma once
 *   3. BODY_MACRO_COMBINE_INNER 的 #undef + #define
 *   4. BODY_MACRO_COMBINE 的 #undef + #define
 *   5. UE_CLANGD_COMPAT_BODY 宏定义（stub body）
 *
 * 使用 node:os 的 EOL 保证跨平台换行。
 * 不带 BOM。
 */
export function getUeClangdCompatContent(): string {
  const header = [
    '/*',
    '* ***** DO NOT MODIFY *****',
    '* 此文件由 VSCodeUEHelper 自动生成，用于 clangd 索引兼容。',
    '* 扩展为完整 UE 反射宏 stub：让 clangd 即使 .generated.h 缺失也能解析原 .h',
    '* (重写 BODY_MACRO_COMBINE + 12 个外层反射宏 + WITH_EDITOR + CURRENT_FILE_ID)',
    '*',
    '* 注意：此文件仅影响 clangd 索引，不影响实际编译。',
    '*/',
  ].join(EOL);

  const pragmaOnce = '#pragma once';

  const bodyMacroCombineInner = [
    '',
    '// 重写 BODY_MACRO_COMBINE_INNER：当 .generated.h 过期/缺失时提供 stub 展开',
    '#ifdef BODY_MACRO_COMBINE_INNER',
    '#undef BODY_MACRO_COMBINE_INNER',
    '#endif',
    '#define BODY_MACRO_COMBINE_INNER(RootClass, ClassName) UE_CLANGD_COMPAT_BODY',
    '',
  ].join(EOL);

  const bodyMacroCombine = [
    '// 重写 BODY_MACRO_COMBINE：当 .generated.h 过期/缺失时提供 stub 展开',
    '#ifdef BODY_MACRO_COMBINE',
    '#undef BODY_MACRO_COMBINE',
    '#endif',
    '#define BODY_MACRO_COMBINE(RootClass, ClassName) UE_CLANGD_COMPAT_BODY',
    '',
  ].join(EOL);

  const compatBody = [
    '// clangd 兼容 stub body：仅提供 clangd 索引所需的最小结构',
    '// 空 stub struct：friend struct 需要前置声明的类型',
    'struct UEClangdCompatStub {};',
    '',
    '#define UE_CLANGD_COMPAT_BODY \\',
    '  friend struct UEClangdCompatStub; \\',
    '  static UClass* StaticClass() { return nullptr; }',
    '',
  ].join(EOL);

  // 启用 WITH_EDITOR / WITH_EDITORONLY_DATA：让 #if WITH_EDITOR 块在 clangd 中展开
  const withEditor = [
    '// 启用 WITH_EDITOR / WITH_EDITORONLY_DATA：让 #if WITH_EDITOR 块在 clangd 中展开',
    '#define WITH_EDITOR 1',
    '#define WITH_EDITORONLY_DATA 1',
    '',
  ].join(EOL);

  // 12 个外层 UE 反射宏空展开：让 UCLASS() / UPROPERTY() 等在 .generated.h 缺失时不报 unknown macro
  const outerReflectionMacros = [
    '// 12 个外层 UE 反射宏空展开：让 UCLASS() / UPROPERTY() 等在 .generated.h 缺失时不报 unknown macro',
    '#ifndef UCLASS',
    '#define UCLASS(...)',
    '#endif',
    '#ifndef USTRUCT',
    '#define USTRUCT(...)',
    '#endif',
    '#ifndef UENUM',
    '#define UENUM(...)',
    '#endif',
    '#ifndef UINTERFACE',
    '#define UINTERFACE(...)',
    '#endif',
    '#ifndef UPROPERTY',
    '#define UPROPERTY(...)',
    '#endif',
    '#ifndef UFUNCTION',
    '#define UFUNCTION(...)',
    '#endif',
    '#ifndef UMETA',
    '#define UMETA(...)',
    '#endif',
    '#ifndef UPARAM',
    '#define UPARAM(...)',
    '#endif',
    '#ifndef GENERATED_UCLASS_BODY',
    '#define GENERATED_UCLASS_BODY(...)',
    '#endif',
    '#ifndef GENERATED_USTRUCT_BODY',
    '#define GENERATED_USTRUCT_BODY(...)',
    '#endif',
    '#ifndef GENERATED_UINTERFACE_BODY',
    '#define GENERATED_UINTERFACE_BODY(...)',
    '#endif',
    '#ifndef GENERATED_IINTERFACE_BODY',
    '#define GENERATED_IINTERFACE_BODY(...)',
    '#endif',
    '',
  ].join(EOL);

  // CURRENT_FILE_ID：UHT 用于标识 .generated.h 归属，无 .generated.h 时强制 0
  const currentFileId = [
    '// CURRENT_FILE_ID：UHT 用于标识 .generated.h 归属，无 .generated.h 时强制 0',
    '#undef CURRENT_FILE_ID',
    '#define CURRENT_FILE_ID 0',
    '',
  ].join(EOL);

  // GENERATED_BODY：与 .generated.h 可能冲突的宏，强制覆盖为空展开
  const generatedBody = [
    '// GENERATED_BODY：与 .generated.h 可能冲突的宏，强制覆盖为空展开',
    '#undef GENERATED_BODY',
    '#define GENERATED_BODY(...)',
    '',
  ].join(EOL);

  return [
    header,
    '',
    pragmaOnce,
    bodyMacroCombineInner,
    bodyMacroCombine,
    compatBody,
    withEditor,
    outerReflectionMacros,
    currentFileId,
    generatedBody,
    '',
  ].join(EOL);
}
