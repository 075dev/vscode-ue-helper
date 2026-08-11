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

export interface DocEntry {
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

export interface CliArgs {
  engineRoot: string;
  output: string;
  include?: string;
  exclude?: string;
  minDocLength: number;
}

export function parseArgs(argv: readonly string[] = process.argv.slice(2)): CliArgs {
  const get = (prefix: string, def?: string): string | undefined => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : def;
  };

  const engineRoot = get('--engine=');
  if (!engineRoot || !fs.existsSync(engineRoot)) {
    throw new Error(
      '用法: npx tsx scripts/extract-ue-docs.ts --engine="D:/UE_5.5" --output="data/ue-docs.json"\n' +
        '错误: --engine 路径不存在或未指定',
    );
  }

  return {
    engineRoot: path.resolve(engineRoot),
    output: get('--output=') ?? 'data/ue-docs.json',
    include: get('--include='),
    exclude: get('--exclude='),
    minDocLength: parseInt(get('--min-doc-length=', '80') ?? '80', 10),
  };
}

// ===== 文档注释解析器 =====

/**
 * 从源代码行中提取声明名称和类型。
 */
export function parseDeclaration(line: string): { name: string; kind: string } | null {
  const trimmed = line.trim();

  // 去掉前置 template<...> 前缀（可能有多层嵌套 <>）
  const afterTemplate = trimmed.replace(/^template\s*<[^<>]*(?:<[^<>]*>[^<>]*)*>\s*/, '').trim();

  // [Bug fix] 去掉前置 UE 宏（UCLASS()、USTRUCT()、UPROPERTY()、UFUNCTION()、UENUM()、
  // UINTERFACE()、UDELEGATE()、GENERATED_BODY()、UE_API、UE_NODISCARD 等），再尝试匹配。
  // 场景:findDeclaration 收集了 "UCLASS() class UMyComponent : public UObject {",parseDeclaration
  // 若不先剥 UCLASS,所有 ^using|^class|^struct 都不匹配,导致反射宏后的真实声明丢失。
  // 注意:UE_DECLARE_* 不在此处剥(parseDeclaration 后续分支单独识别为 macro)。
  const afterMacros = afterTemplate
    .replace(/^(UCLASS\s*\([^)]*\)|USTRUCT\s*\([^)]*\)|UENUM\s*\([^)]*\)|UINTERFACE\s*\([^)]*\)|UPROPERTY\s*\([^)]*\)|UFUNCTION\s*\([^)]*\)|UDELEGATE\s*\([^)]*\)|GENERATED_[A-Z_]*\s*\([^)]*\)|UE_API|UE_NODISCARD|UE_FORCEINLINE|UE_DEPRECATED)\s*/g, '')
    .trim();

  // 使用去掉 template + macros 后的文本匹配
  // template<...> using X = ...
  const usingMatch = afterMacros.match(/^using\s+(\w+)\s*=/);
  if (usingMatch) return { name: usingMatch[1]!, kind: 'type_alias' };

  // [class|struct] [UE_API|...] X ...
  // 允许以 ; { 或 { } 或行尾结尾(findDeclaration 合并后通常带 ; 或 { 或 { ... })
  const typeMatch = afterMacros.match(
    /^(class|struct)\s+(?:\w+\s+)?(\w+)(?:\s*:\s*.*)?(?:\s*\{[^}]*\})?\s*[;{]?$/,
  );
  if (typeMatch) {
    const name = typeMatch[2]!;
    const kind = typeMatch[1] === 'class' ? 'class' : 'struct';
    return { name, kind };
  }

  // enum class X ...
  const enumMatch = afterMacros.match(
    /^enum\s+(?:class\s+)?(\w+)\s*(?::\s*\w+)?(?:\s*\{[^}]*\})?\s*[;{]?$/,
  );
  if (enumMatch) return { name: enumMatch[1]!, kind: 'enum' };

  // UE_DECLARE_* macros
  const macroMatch = afterMacros.match(/^UE_DECLARE_(\w+)\(/);
  if (macroMatch) return { name: `UE_DECLARE_${macroMatch[1]}`, kind: 'macro' };

  // [Bug fix] 简单变量声明:type-name + name + ; 或 = initial
  // 场景:UPROPERTY() bool bReplicates; / int32 Count = 0;
  // 限制:仅 type 与 name 都不含 < > (避免误吞 template/func)。允许 type 带 * & 引用。
  // 必须放在 controlKeywords 引用之前——controlKeywords 在 funcMatch 检查时才声明。
  const controlKeywords = [
    'if', 'for', 'while', 'switch', 'catch', 'return', 'delete',
  ];
  const varMatch = afterMacros.match(
    /^(?:const\s+)?(?:unsigned\s+)?[\w:]+(?:\s+[*&]+)*\s+(\w+)\s*(?:=\s*[^;]+)?;?$/,
  );
  if (varMatch && varMatch[1] && !controlKeywords.includes(varMatch[1])) {
    const reserved = ['class', 'struct', 'enum', 'union', 'typename', 'using', 'namespace'];
    if (!reserved.includes(varMatch[1])) {
      return { name: varMatch[1], kind: 'variable' };
    }
  }

  // ReturnType FunctionName(params) or ReturnType FunctionName()
  const funcMatch = afterMacros.match(
    /^(?:\w+\s+)*(\w+)\s*\([^)]*\)\s*(?:const|override|final|;)*\s*\{?$/,
  );
  if (funcMatch && !controlKeywords.includes(funcMatch[1]!)) {
    return { name: funcMatch[1]!, kind: 'function' };
  }

  return null;
}

/**
 * 判断一行是否可能是声明行（非空、不以 * 开头、不以 // 开头、不以 # 开头、不以 / 开头）。
 */
export function isDeclarationLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('*') || trimmed.startsWith('//')) return false;
  if (trimmed.startsWith('#')) return false; // 预处理指令
  if (trimmed.startsWith('/')) return false; // 块注释 /** */ 等
  return true;
}

/**
 * 从文件内容中提取文档注释及其声明。
 */
export function extractDocComments(
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
export function findDeclaration(
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

    // [Bug fix] 必须在 isDeclarationLine 之前处理——否则 UCLASS() 自身会被当成
    // 声明行进入 multi-line 收集,导致合并后 parseDeclaration 失败,真实 class 丢失。
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

    return null;
  }

  return null;
}

// ===== 主流程 =====

export async function runExtract(args: CliArgs): Promise<DocEntry[]> {
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

  return uniqueEntries;
}

async function main(): Promise<void> {
  const args = parseArgs();
  await runExtract(args);
}

// 仅在作为 CLI 直接调用时执行;被 import 不会触发副作用
if (require.main === module) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
