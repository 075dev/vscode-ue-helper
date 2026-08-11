/**
 * localization —— 通用翻译本地化引擎
 *
 * 职责：
 * - 使用 genericTranslate（句式模板 + 短语字典）对 clangd 诊断消息进行中文本地化
 * - Hover 内容优先查 UE 文档词典，命中则显示翻译，未命中保留原文
 * - 纯字符串处理，不修改 CodeAction 的 edit/command/data 字段
 *
 * 设计原则：
 * - 不依赖精确规则匹配，使用句式模板和短语字典进行通用翻译
 * - 不信任外部输入：仅做模式匹配和替换，不执行任何代码
 */

import { genericTranslate } from './genericTranslator';
import { type UeDocLookup } from './ueDocLookup';

// ===== 词典实例（模块级单例） =====

let docLookup: UeDocLookup | undefined;

/**
 * 设置 UE 文档词典实例。
 * 在插件激活时由 bridge 或配置管理器调用。
 */
export function setDocLookup(lookup: UeDocLookup): void {
  docLookup = lookup;
}

// ===== 公开 API =====

/**
 * 对诊断消息应用本地化。
 *
 * @param message - 原始诊断消息
 * @returns 本地化后的诊断消息
 */
export function applyLocalizationToDiagnostic(message: string): string {
  const result = genericTranslate(message);
  return result ?? message;
}

/**
 * 对代码动作标题应用本地化。
 *
 * @param title - 原始代码动作标题
 * @returns 本地化后的代码动作标题
 */
export function applyLocalizationToCodeAction(title: string): string {
  const result = genericTranslate(title);
  return result ?? title;
}

/**
 * 对悬停内容应用本地化。
 *
 * 策略：
 * 1. 优先查 UE 文档词典，命中则返回翻译（保留声明行和代码块）
 * 2. 未命中则保留原文
 *
 * @param content - 原始悬停内容（可能包含 markdown）
 * @returns 本地化后的悬停内容
 */
export function applyLocalizationToHover(content: string): string {
  // 策略 1：查 UE 文档词典
  if (docLookup) {
    const dictResult = docLookup.lookup(content);
    if (dictResult !== null) {
      return dictResult;
    }
  }

  // 策略 2：未命中，保留原文
  return content;
}

/**
 * 对自动补全项说明应用本地化。
 *
 * TODO: 后续实现 Completion 项的 label/detail 汉化。
 *
 * @param item - 补全项内容
 * @returns 本地化后的补全项内容
 */
export function applyLocalizationToCompletion(item: string): string {
  return item;
}

/**
 * 对函数签名提示应用本地化。
 *
 * TODO: 后续实现 SignatureHelp 的参数名/标签汉化。
 *
 * @param label - 签名标签
 * @returns 本地化后的签名标签
 */
export function applyLocalizationToSignatureHelp(label: string): string {
  return label;
}

/**
 * 对内联提示应用本地化。
 *
 * TODO: 后续实现 InlayHint 的类型名/标签汉化。
 *
 * @param label - 内联提示标签
 * @returns 本地化后的内联提示标签
 */
export function applyLocalizationToInlayHint(label: string): string {
  return label;
}

/**
 * 从 append 模式的翻译结果中剥离原文，仅保留翻译部分。
 * 用于 zh-only 模式。
 *
 * @param original - 原始文本
 * @param translated - append 模式翻译结果（原文 + [翻译]）
 * @returns 仅翻译部分，或原文（如果格式不匹配）
 */
export function stripOriginalText(original: string, translated: string): string {
  if (translated.startsWith(original) && translated.length > original.length) {
    return translated.slice(original.length).trim();
  }
  return translated;
}
