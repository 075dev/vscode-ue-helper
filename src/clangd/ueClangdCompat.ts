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
    '* 重写 BODY_MACRO_COMBINE 宏，使 UCLASS() / GENERATED_BODY()',
    '* 在 .generated.h 过期/缺失时仍能展开为合法 C++。',
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
    '#define UE_CLANGD_COMPAT_BODY \\',
    '  friend struct UEClangdCompatStub; \\',
    '  static UClass* StaticClass()',
    '',
  ].join(EOL);

  return `${header}${EOL}${EOL}${pragmaOnce}${EOL}${bodyMacroCombineInner}${EOL}${bodyMacroCombine}${EOL}${compatBody}${EOL}`;
}
