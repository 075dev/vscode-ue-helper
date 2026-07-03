/**
 * extract-ue-docs.ts —— UE 源码头文件文档注释提取脚本
 *
 * 扫描 UE 引擎源码头文件，提取文档注释及其对应的类型声明，
 * 输出 JSON 双语词典（原文 + 待翻译字段）。
 *
 * 用法：
 *   npx tsx scripts/extract-ue-docs.ts --engine="D:/UE_5.5" --output="data/ue-docs.json"
 *   npx tsx scripts/extract-ue-docs.ts --engine="D:/UE_5.5" --output="data/ue-docs.json" --include="**\ObjectPtr.h"
 *
 * 输出格式：
 *   [
 *     {
 *       "name": "TObjectPtr",
 *       "kind": "type_alias",
 *       "file": "Runtime/CoreUObject/UObject/ObjectPtr.h",
 *       "signature": "template<typename T> using TObjectPtr = TObjectPtr<T>",
 *       "doc": "TObjectPtr is a type of pointer to a UObject that...",
 *       "translation": ""
 *     }
 *   ]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { sync as globSync } from 'glob';

// ===== 类型定义 =====

interface DocEntry {
  /** 类型/函数名称 */
  name: string;
  /** 种类：type_alias / class / struct / function / variable / enum / macro */
  kind: string;
  /** 相对于引擎根目录的路径 */
  file: string;
  /** 声明签名（第一行） */
  signature: string;
  /** 文档注释原文 */
  doc: string;
  /** 中文翻译（留空，由人工填写） */
  translation: string;
}

// ===== 命令行参数 =====

interface CliArgs {
  engineRoot: string;
  output: string;
  include?: string;
  exclude?: string;
  minDocLength: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (prefix: string, def?: string): string | undefined => {
    const arg = args.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : def;
  };

  const engineRoot = get('--engine=');
  if (!engineRoot || !fs.existsSync(engineRoot)) {
    console.error('用法: npx tsx scripts/extract-ue-docs.ts --engine="D:/UE_5.5" --output="data/ue-docs.json"');
    console.error('错误: --engine 路径不存在或未指定');
    process.exit(1);
  }

  return {
    engineRoot: path.resolve(engineRoot),
    output: get('--output=') ?? 'data/ue-docs.json',
    include: get('--include='),
    exclude: get('--exclude='),
    minDocLength: parseInt(get('--min-doc-length=', '80'), 10),
  };
}

// ===== 文档注释解析器 =====

/**
 * 从源代码行中提取声明名称和类型。
 */
function parseDeclaration(line: string): { name: string; kind: string } | null {
  const trimmed = line.trim();

  // 去掉前置 template<...> 前缀（可能有多层嵌套 <>）
  const afterTemplate = trimmed.replace(/^template\s*<[^<>]*(?:<[^<>]*>[^<>]*)*>\s*/, '').trim();

  // 使用去掉 template 后的文本匹配
  // template<...> using X = ...
  const usingMatch = afterTemplate.match(/^using\s+(\w+)\s*=/);
  if (usingMatch) return { name: usingMatch[1]!, kind: 'type_alias' };

  // [class|struct] [UE_API|...] X ...
  const typeMatch = afterTemplate.match(/^(class|struct)\s+(?:\w+\s+)?(\w+)(?:\s*:\s*.*)?\s*\{?$/);
  if (typeMatch) {
    const name = typeMatch[2]!;
    const kind = typeMatch[1] === 'class' ? 'class' : 'struct';
    return { name, kind };
  }

  // enum class X ...
  const enumMatch = trimmed.match(/^enum\s+(?:class\s+)?(\w+)\s*(?::\s*\w+)?\s*\{?$/);
  if (enumMatch) return { name: enumMatch[1]!, kind: 'enum' };

  // UE_DECLARE_* macros
  const macroMatch = trimmed.match(/^UE_DECLARE_(\w+)\(/);
  if (macroMatch) return { name: `UE_DECLARE_${macroMatch[1]}`, kind: 'macro' };

  // ReturnType FunctionName(params) or ReturnType FunctionName()
  const funcMatch = trimmed.match(
    /^(?:\w+\s+)*(\w+)\s*\([^)]*\)\s*(?:const|override|final|;)*\s*\{?$/,
  );
  const controlKeywords = [
    'if', 'for', 'while', 'switch', 'catch', 'return', 'delete',
  ];
  if (funcMatch && !controlKeywords.includes(funcMatch[1]!)) {
    return { name: funcMatch[1]!, kind: 'function' };
  }

  return null;
}

/**
 * 判断一行是否可能是声明行（非空、不以 * 开头、不以 // 开头）。
 */
function isDeclarationLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('*') || trimmed.startsWith('//')) return false;
  return true;
}

/**
 * 从文件内容中提取文档注释及其声明。
 */
function extractDocComments(
  content: string,
  relativePath: string,
  minDocLength: number,
): DocEntry[] {
  const entries: DocEntry[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // === 检测 /** */ 块注释 ===
    if (line.trim().startsWith('/**')) {
      const trimmed = line.trim();
      const docLines: string[] = [];

      // 单行 /** ... */ 注释
      if (trimmed.endsWith('*/')) {
        const text = trimmed.replace(/^\/\*\*\s*/, '').replace(/\s*\*\/$/, '').trim();
        docLines.push(text);
        const docText = docLines.join(' ').trim();

        const decl = findDeclaration(lines, i + 1);
        if (docText.length >= minDocLength && decl) {
          entries.push({
            name: decl.name,
            kind: decl.kind,
            file: relativePath,
            signature: decl.signature,
            doc: docText,
            translation: '',
          });
        }
        i++;
        continue;
      }

      // 多行 /** ... */ 注释
      docLines.push(trimmed);
      let j = i + 1;
      while (j < lines.length && !lines[j]!.trim().endsWith('*/')) {
        const text = lines[j]!.trim();
        docLines.push(text.replace(/^\s*\*\s?/, ''));
        j++;
      }
      if (j < lines.length) {
        const endLine = lines[j]!.trim();
        docLines.push(endLine.replace(/^\s*\*\s?/, '').replace(/\s*\*\/$/, ''));
      }

      const docText = docLines
        .map((l) => l.replace(/^\/\*\*$/, '').replace(/^\*\/$/, '').trim())
        .filter(Boolean)
        .join(' ')
        .trim();

      const decl = findDeclaration(lines, j + 1);
      if (docText.length >= minDocLength && decl) {
        entries.push({
          name: decl.name,
          kind: decl.kind,
          file: relativePath,
          signature: decl.signature,
          doc: docText,
          translation: '',
        });
      }

      i = j + 1;
      continue;
    }

    // === 检测 /// 行注释 ===
    if (line.trim().startsWith('///')) {
      const docLines: string[] = [];
      let j = i;

      while (j < lines.length && lines[j]!.trim().startsWith('///')) {
        const text = lines[j]!.trim().replace(/^\/\/\/\s?/, '');
        docLines.push(text);
        j++;
      }

      const docText = docLines.join(' ').trim();

      // 查找接下来的声明
      const decl = findDeclaration(lines, j);
      if (docText.length >= minDocLength && decl) {
        entries.push({
          name: decl.name,
          kind: decl.kind,
          file: relativePath,
          signature: decl.signature,
          doc: docText,
          translation: '',
        });
      }

      i = j;
      continue;
    }

    i++;
  }

  return entries;
}

/**
 * 从指定行开始查找声明。
 * 跳过空行、宏、属性标记（如 UE_API、template 前缀行）。
 */
function findDeclaration(
  lines: string[],
  startLine: number,
): { name: string; kind: string; signature: string } | null {
  let i = startLine;
  const prefixLines: string[] = [];

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // 跳过空行
    if (!trimmed) {
      i++;
      continue;
    }

    // 跳过 # 开头的预处理指令
    if (trimmed.startsWith('#')) {
      i++;
      continue;
    }

    // 收集 template 前缀
    if (trimmed.startsWith('template')) {
      prefixLines.push(trimmed);
      i++;
      continue;
    }

    // 如果这行是声明，收集多行声明
    if (isDeclarationLine(trimmed)) {
      // 收集后续行直到完整声明（遇到 { 或 ; 或空行）
      const declLines = [...prefixLines, trimmed];
      let k = i + 1;

      // 如果当前行没有终止符，继续收集
      if (!trimmed.endsWith(';') && !trimmed.endsWith('{') && !trimmed.endsWith(')')) {
        while (k < lines.length) {
          const nextLine = lines[k]!.trim();
          if (!nextLine) break;
          declLines.push(nextLine);
          if (nextLine.endsWith(';') || nextLine.endsWith('{') || nextLine.endsWith(')')) {
            k++;
            break;
          }
          k++;
        }
      }

      const fullDecl = declLines.join(' ').trim();
      const result = parseDeclaration(fullDecl);

      if (result) {
        return {
          ...result,
          signature: fullDecl.replace(/\s+/g, ' ').slice(0, 200),
        };
      }
      return null;
    }

    // 宏属性标记等（UE_API, UCLASS(), UPROPERTY() 等）
    if (
      trimmed.startsWith('UE_') ||
      trimmed.startsWith('UCLASS') ||
      trimmed.startsWith('USTRUCT') ||
      trimmed.startsWith('UENUM') ||
      trimmed.startsWith('UINTERFACE') ||
      trimmed.startsWith('UPROPERTY') ||
      trimmed.startsWith('UFUNCTION') ||
      trimmed.startsWith('UDELEGATE') ||
      trimmed.startsWith('DECLARE_') ||
      trimmed.startsWith('GENERATED_')
    ) {
      prefixLines.push(trimmed);
      i++;
      continue;
    }

    // 其他不可识别的内容，放弃
    return null;
  }

  return null;
}

// ===== 主流程 =====

async function main(): Promise<void> {
  const args = parseArgs();

  console.log(`UE 引擎根目录: ${args.engineRoot}`);
  console.log(`最小文档长度: ${args.minDocLength}`);
  console.log('正在扫描头文件...');

  // 构建 glob 模式
  const globPattern = args.include ?? '**/*.h';
  const fullPattern = path.join(args.engineRoot, globPattern).replace(/\\/g, '/');

  // 收集文件
  const files = globSync(fullPattern, {
    ignore: args.exclude?.split(',').map((p) => path.join(args.engineRoot, p.trim()).replace(/\\/g, '/')),
  });

  console.log(`找到 ${files.length} 个头文件`);
  console.log('正在提取文档注释...');

  // 跳过过大的文件（> 5MB）
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  let totalEntries = 0;
  const allEntries: DocEntry[] = [];

  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE || stat.size === 0) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(args.engineRoot, filePath).replace(/\\/g, '/');
      const entries = extractDocComments(content, relativePath, args.minDocLength);
      allEntries.push(...entries);
      totalEntries += entries.length;

      if (entries.length > 0) {
        console.log(`  ${relativePath}: ${entries.length} 条`);
      }
    } catch {
      // 二进制文件或编码问题，跳过
    }
  }

  // 去重：相同名称 + 相同文档视为重复
  const seen = new Set<string>();
  const uniqueEntries = allEntries.filter((e) => {
    const key = `${e.name}|${e.doc.slice(0, 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\n提取完成：${totalEntries} 条原始，${uniqueEntries.length} 条去重唯一`);

  // 输出 JSON
  const outputPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(uniqueEntries, null, 2), 'utf-8');

  console.log(`输出文件: ${outputPath}`);
  console.log('翻译字段已留空，请填入 translation 后使用。');
}

main().catch(console.error);
