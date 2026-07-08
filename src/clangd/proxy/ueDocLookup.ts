/**
 * ueDocLookup.ts —— UE 文档注释词典查找模块
 *
 * 从 extract-ue-docs.ts 提取的 JSON 词典中查找 hover 内容的翻译。
 *
 * 匹配策略：
 * 1. 提取 hover 内容的类型名/函数名（第一行中的标识符）
 * 2. 在词典中按 name 查找
 * 3. 命中则替换整段文档，未命中返回 null
 */

import * as fs from 'node:fs';

// ===== 类型定义 =====

export interface DocEntry {
  name: string;
  kind: string;
  file: string;
  signature: string;
  doc: string;
  translation: string;
}

// ===== UeDocLookup =====

export class UeDocLookup {
  private index: Map<string, DocEntry> = new Map();
  private loaded = false;

  /**
   * 从 JSON 文件加载词典。
   *
   * @param jsonPath - 词典 JSON 文件路径
   */
  load(jsonPath: string): void {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(raw) as DocEntry[];
    this.loadFromData(data);
  }

  /**
   * 直接注入词典数据（用于测试）。
   *
   * @param data - 词典条目数组
   */
  loadFromData(data: DocEntry[]): void {
    this.index = new Map();
    for (const entry of data) {
      if (entry.translation) {
        this.index.set(entry.name, entry);
      }
    }
    this.loaded = true;
  }

  /**
   * 词典是否已加载。
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * 返回词典条目数（仅含已翻译的）。
   */
  size(): number {
    return this.index.size;
  }

  /**
   * 查找 hover 内容的翻译。
   *
   * 匹配策略：
   * 1. 从 hover 内容第一行提取类型名/函数名
   * 2. 在词典中按 name 查找
   * 3. 命中则返回翻译文本，未命中返回 null
   *
   * hover 内容格式示例：
   *   "struct TObjectPtr<USkeletalMeshComponent>\nprovided by ...\n\nTObjectPtr is a type of..."
   *   "class UClass : public UObject { ..."
   *   "FString GetName() const"
   *
   * @param hoverContent - 完整的 hover 内容
   * @returns 翻译文本，或 null
   */
  lookup(hoverContent: string): string | null {
    if (!this.loaded || !hoverContent) {
      return null;
    }

    // 从第一行提取名称
    const firstLine = hoverContent.split('\n')[0]?.trim();
    if (!firstLine) {return null;}

    const name = this.extractName(firstLine);
    if (!name) {return null;}

    const entry = this.index.get(name);
    if (!entry) {return null;}

    // 替换整个 hover 内容中的文档部分
    return this.replaceDocInHover(hoverContent, entry);
  }

  /**
   * 从声明行提取类型/函数名称。
   */
  private extractName(line: string): string | null {
    // "class TObjectPtr<USkeletalMeshComponent>" → "TObjectPtr"
    // "struct FString {" → "FString"
    // "FString GetName() const" → "GetName"
    // "### class `UAttributeSet`" → "UAttributeSet"

    // 去掉 markdown 标题标记（###）和反引号
    let clean = line
      .replace(/^#+\s*/, '')   // 去掉 markdown 标题 ###
      .replace(/`([^`]+)`/g, '$1') // 反引号内的内容去反引号
      .replace(/<[^>]*>/g, '') // 去掉模板参数
      .replace(/\s*\{.*$/, '') // 去掉 { 及之后
      .replace(/\s*;.*$/, '')  // 去掉 ; 及之后
      .replace(/\s*:.*$/, '')  // 去掉 : 及之后（继承）
      .replace(/\(.*\)/, '')   // 去掉参数列表
      .trim();

    // "struct TObjectPtr" → "TObjectPtr"
    const keywords = [
      'class', 'struct', 'enum', 'union', 'using', 'namespace',
    ];
    for (const kw of keywords) {
      if (clean.startsWith(kw + ' ')) {
        clean = clean.slice(kw.length).trim();
        break;
      }
    }

    // "template<...> using TObjectPtr" → 前面已处理模板参数
    if (clean.startsWith('using ')) {
      clean = clean.slice(6).trim();
    }

    // 取第一个单词
    const name = clean.split(/\s+/)[0];
    if (!name || name.length < 2) {return null;}

    return name;
  }

  /**
   * 在 hover 内容中替换文档部分为翻译。
   *
   * 保持第一行的类型声明不变，只替换后续的文档说明文本。
   */
  private replaceDocInHover(hoverContent: string, entry: DocEntry): string {
    const lines = hoverContent.split('\n');

    // 找到第一个空行后的文档开始位置
    let docStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.trim() === '' && i + 1 < lines.length) {
        const next = lines[i + 1]?.trim() ?? '';
        // 跳过 "provided by" 之类的辅助信息
        if (next.startsWith('provided by') || next.startsWith('From ')) {
          continue;
        }
        docStart = i + 1;
        break;
      }
    }

    if (docStart < 0) {
      // 没有空行，直接替换整段
      return entry.translation;
    }

    // 保留声明行 + 辅助信息，替换文档部分
    const header = lines.slice(0, docStart).join('\n');
    return `${header}\n\n${entry.translation}`;
  }
}
